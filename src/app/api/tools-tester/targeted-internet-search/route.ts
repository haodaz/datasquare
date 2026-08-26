import { NextResponse } from 'next/server';
import { ToolUsageLogger } from '@/lib/supabase/tool-usage-logger';
import OpenAI from "openai";

function getOpenAIClient() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');
  return new OpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  });
}

function encoder() { return new TextEncoder(); }
const enc = encoder();

function makeStream(handler: (ctrl: ReadableStreamDefaultController) => Promise<void>) {
  return new ReadableStream({ start: handler });
}

function sendLog(ctrl: ReadableStreamDefaultController, step: string, msg: string, logger?: any) {
  if (logger) logger.addLog(step, msg);
  ctrl.enqueue(enc.encode('data: ' + JSON.stringify({ type: 'log', data: { step, message: msg } }) + '\n\n'));
}

function sendResult(ctrl: ReadableStreamDefaultController, data: unknown, logger?: any) {
  if (logger) { logger.setResult(data); logger.setAiRenderedResult(typeof data === 'string' ? data : JSON.stringify(data)); }
  ctrl.enqueue(enc.encode('data: ' + JSON.stringify({ type: 'result', data }) + '\n\n'));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name_cn, name_en, target_claim } = body;

    if (!target_claim) {
      return NextResponse.json({ error: 'Missing target_claim' }, { status: 400 });
    }

    const serpApiKey = process.env.SERPAPI_KEY;
    if (!serpApiKey) {
      return NextResponse.json({ error: 'SERPAPI_KEY 未配置' }, { status: 500 });
    }

    const stream = makeStream(async (ctrl) => {
        const logger = new ToolUsageLogger('targeted-internet-search', queryName || name_cn || '');
      try {
        const factItems: any[] = [];
        
        // 构建查询关键词
        const searchName = name_cn || name_en || '';
        const query = `"${searchName}" ${target_claim}`;
        
        sendLog(ctrl, 'info', `[1] 组装检索 Query: [${query}]`);
        sendLog(ctrl, 'info', `[2] 调用 SerpAPI (Google 引擎) 进行全网定点突破检索...`);
        
        const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=3`;
        const res = await fetch(url);
        const data = await res.json();

        const organicResults = data.organic_results || [];
        let extractedText = '';
        const evidenceUrls: string[] = [];

        if (organicResults.length > 0) {
          sendLog(ctrl, 'success', `[3] 找到 ${organicResults.length} 条相关结果，提取 snippet...`);
          organicResults.forEach((r: any, idx: number) => {
            sendLog(ctrl, 'info', `    - [结果${idx+1}] ${r.title}`);
            extractedText += `【来源${idx+1}: ${r.title}】\n${r.snippet || ''}\n\n`;
            if (r.link) evidenceUrls.push(r.link);
          });
        } else {
          sendLog(ctrl, 'warn', `[3] 互联网上未找到关于此 Claim 的任何公开信息。`);
        }

        const rawData = {
          query,
          resultsCount: organicResults.length,
          extractedText,
          evidenceUrls
        };

        if (organicResults.length === 0) {
          factItems.push({
            title: '定点互联网核查',
            confidence: 'Low Confidence',
            source: 'Google Search',
            method: '精确关键词检索',
            desc: '未在互联网上检索到相关支撑证据',
            claimText: target_claim,
            evidence: [],
            matchedFields: [],
            mismatchedFields: [],
            internetData: '无公开即时答案',
            score: 0,
            status: 'manual_review',
            experienceId: 'internet_targeted'
          });
          sendResult(ctrl, { factItems, rawData });
          return;
        }

        sendLog(ctrl, 'info', `[4] 启动大模型进行证据交叉比对...`);
        const client = getOpenAIClient();
        const prompt = `
          你是一个严苛的事实核查员。
          这是候选人简历中声明的具体经历/成就（Claim）：
          "${target_claim}"
          相关人物姓名："${searchName}"

          这是通过搜索引擎（Google）获取到的 Top3 相关网页摘要：
          ${extractedText}
          
          请判断这些搜索结果是否能作为支撑该 Claim 的有效证据。
          
          请输出 JSON 格式：
          {
            "factItems": [
              {
                "title": "定点互联网核查",
                "confidence": "High Confidence" 或 "Medium Confidence",
                "source": "Google Search",
                "method": "互联网证据比对",
                "desc": "搜索结果支撑了该声明" 或 "搜索结果不足以支撑该声明，需人工核实" 或 "搜索结果与声明矛盾",
                "claimText": "简历声明的成就",
                "internetData": "从搜索结果中摘录的关键支撑句（不超过80字）",
                "score": 100或50或0,
                "status": "match" 或 "manual_review" 或 "mismatch"
              }
            ]
          }
        `;

        try {
          const aiResponse = await client.chat.completions.create({
            model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
            response_format: { type: "json_object" },
            messages: [{ role: 'user', content: prompt }]
          });
          
          const aiResult = JSON.parse(aiResponse.choices[0].message.content || '{}');
          if (aiResult.factItems) {
            // 补充 evidence
            aiResult.factItems.forEach((item: any) => {
              item.evidence = evidenceUrls;
              item.experienceId = 'internet_targeted';
            });
            factItems.push(...aiResult.factItems);
            sendLog(ctrl, 'success', `[5] 交叉验证完成，生成了 ${aiResult.factItems.length} 条 FactItem`);
          }
        } catch (e: any) {
           sendLog(ctrl, 'error', `[5] AI 交叉验证执行失败: ${e.message}`);
        }

        sendResult(ctrl, { factItems, rawData });
      } catch (err: any) {
        sendLog(ctrl, 'error', `[Error] ${err.message}`);
      } finally {
        logger.save().catch(() => {}); ctrl.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
