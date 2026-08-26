import { NextResponse } from 'next/server';
import { ToolUsageLogger } from '@/lib/supabase/tool-usage-logger';
import OpenAI from "openai";
import { talentJournal } from '@/lib/supabase/talent-journal';
import { getToken } from '@/lib/auth';

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
    const token = await getToken(req);
    const { name_en, institution, resume_claims_text } = body;

    if (!name_en) {
      return NextResponse.json({ error: 'Missing name_en' }, { status: 400 });
    }

    const serpApiKey = process.env.SERPAPI_KEY;
    if (!serpApiKey) {
      return NextResponse.json({ error: 'SERPAPI_KEY 未配置' }, { status: 500 });
    }

    const stream = makeStream(async (ctrl) => {
        const logger = new ToolUsageLogger('scholar-search', queryName || name_cn || '');
      try {
        const factItems: any[] = [];
        
        const searchQuery = institution ? `${name_en} ${institution}` : name_en;
        sendLog(ctrl, 'info', `[1] 使用 SerpAPI 搜索 Google Scholar Profiles: "${searchQuery}"`);
        
        let profileUrl = `https://serpapi.com/search.json?engine=google_scholar_profiles&mauthors=${encodeURIComponent(searchQuery)}&api_key=${serpApiKey}`;
        
        let res = await fetch(profileUrl);
        let data = await res.json();

        if (!data.profiles || data.profiles.length === 0) {
          if (institution) {
            sendLog(ctrl, 'warn', `[2] 带机构搜索无结果，降级为纯名字搜索 "${name_en}"...`);
            const fallbackUrl = `https://serpapi.com/search.json?engine=google_scholar_profiles&mauthors=${encodeURIComponent(name_en)}&api_key=${serpApiKey}`;
            res = await fetch(fallbackUrl);
            data = await res.json();
          }
        }

        let bestProfile = null;
        let authorId = '';

        if (data.profiles && data.profiles.length > 0) {
          sendLog(ctrl, 'info', `[3] 找到 ${data.profiles.length} 个候选 Profile，开始机构消歧...`);
          const instLower = (institution || '').toLowerCase();
          
          const instMatch = data.profiles.find((p: any) => 
            instLower && (p.affiliations || '').toLowerCase().includes(instLower)
          );

          if (instMatch) {
            bestProfile = instMatch;
            sendLog(ctrl, 'success', `[4] 机构消歧成功，命中 Profile：${instMatch.name} (${instMatch.affiliations})`);
          } else {
            bestProfile = data.profiles[0];
            sendLog(ctrl, 'warn', `[4] 机构未精确匹配，使用首个搜索结果：${bestProfile.name}`);
          }
          authorId = bestProfile.author_id;
        }

        let rawData: any = {};

        if (authorId) {
          sendLog(ctrl, 'info', `[5] 拉取完整学者档案（h-index, 论文列表）... Author ID: ${authorId}`);
          const authorUrl = `https://serpapi.com/search.json?engine=google_scholar_author&author_id=${authorId}&api_key=${serpApiKey}&num=10`;
          const authorRes = await fetch(authorUrl);
          const authorData = await authorRes.json();

          rawData = {
            name: authorData.author?.name || bestProfile?.name,
            affiliations: authorData.author?.affiliations || bestProfile?.affiliations,
            cited_by: bestProfile?.cited_by || 0,
            h_index: null,
            i10_index: null,
            interests: (authorData.author?.interests || []).map((i: any) => i.title || i).filter(Boolean),
            articles: authorData.articles || []
          };

          if (authorData.cited_by && authorData.cited_by.table) {
            const row = authorData.cited_by.table.find((r: any) => r.citations && r.h_index);
            if (row) {
              rawData.cited_by = row.citations.all || rawData.cited_by;
              rawData.h_index = row.h_index.all;
              rawData.i10_index = row.i10_index.all;
            }
          }

          sendLog(ctrl, 'success', `[6] 学者核心数据提取完毕 -> h-index: ${rawData.h_index}, citations: ${rawData.cited_by}`);
        } else {
          sendLog(ctrl, 'warn', `[5] Scholar Profiles 未找到该学者，降级到纯论文搜索...`);
          const paperSearchUrl = `https://serpapi.com/search.json?engine=google_scholar&q=author:"${encodeURIComponent(name_en)}"&api_key=${serpApiKey}&num=5`;
          const paperRes = await fetch(paperSearchUrl);
          const paperData = await paperRes.json();
          
          const organicResults = paperData.organic_results || [];
          if (organicResults.length > 0) {
            let totalCitations = 0;
            organicResults.forEach((r: any) => {
              if (r.inline_links?.cited_by?.total) {
                totalCitations += r.inline_links.cited_by.total;
              }
            });
            sendLog(ctrl, 'info', `[6] 论文搜索找到 ${organicResults.length} 条结果, Top5 合计引用: ${totalCitations}`);
            rawData = {
              name: name_en,
              isFallbackToPaperSearch: true,
              estimated_citations: totalCitations,
              articles: organicResults.map((r: any) => ({ title: r.title, link: r.link }))
            };
          } else {
            sendLog(ctrl, 'error', `[6] 论文搜索亦无结果。`);
            rawData = null;
          }
        }

        if (!rawData) {
          factItems.push({
            title: '学术影响力指标核验',
            confidence: 'Low Confidence',
            source: 'Google Scholar',
            method: '影响力提取',
            desc: '未检索到 Google Scholar 记录',
            claimText: name_en,
            evidence: [],
            matchedFields: [],
            mismatchedFields: [],
            score: 0,
            status: 'manual_review',
            experienceId: 'scholar_impact'
          });
          sendResult(ctrl, { factItems, rawData: null });
          return;
        }

        if (rawData) {
          const rawDataScholar = {
            display_name: rawData.name,
            h_index: rawData.h_index,
            cited_by_count: rawData.cited_by || rawData.estimated_citations,
            works_count: rawData.articles?.length || 0,
          };
          try {
            await talentJournal.saveTalentData(
              rawData.name || name_en,
              institution || '',
              { scholar: rawDataScholar },
              '',
              token,
              'tool-scholar-search',
              { scholar: rawData, scholar_articles: rawData.articles || [] },
            );
            sendLog(ctrl, 'success', `[7] talentJournal 写入成功`);
          } catch (tjErr: any) {
            sendLog(ctrl, 'error', `[7] talentJournal 写入失败: ${tjErr.message}`);
          }
        }
        
        // AI 比对
        if (resume_claims_text) {
          sendLog(ctrl, 'info', `[8] 对比简历声明指标与 Scholar 真实数据...`);
          const client = getOpenAIClient();
          const prompt = `
            你是一个严谨的人才学术审查员。
            这是简历中声称的学术成就/影响力指标：
            "${resume_claims_text}"

            这是从 Google Scholar 获取的真实客观数据：
            ${JSON.stringify(rawData)}
            
            请判断简历中的声明是否存在严重虚假（如 h-index 或引用数被夸大 20% 以上，或者声称自己是高被引学者但实际引用极低）。
            如果简历数据接近或低于真实数据，算作合理（因为数据可能滞后）。
            
            请输出 JSON 格式：
            {
              "factItems": [
                {
                  "title": "Google Scholar 影响力交叉比对",
                  "confidence": "High Confidence",
                  "source": "Google Scholar",
                  "method": "指标交叉验证",
                  "desc": "简历声明的指标合理" 或 "发现影响力指标夸大造假",
                  "claimText": "简历相关声明",
                  "matchedFields": [],
                  "mismatchedFields": [],
                  "score": 100或0,
                  "status": "match"或"manual_review"
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
              factItems.push(...aiResult.factItems);
              sendLog(ctrl, 'success', `[9] 交叉验证完成，生成了 ${aiResult.factItems.length} 条 FactItem`);
            }
          } catch (e: any) {
            sendLog(ctrl, 'error', `[9] AI 交叉验证执行失败: ${e.message}`);
          }
        } else {
          sendLog(ctrl, 'info', `[8] 未提供简历指标声明，提取纯客观数据。`);
          factItems.push({
            title: 'Google Scholar 影响力提取',
            confidence: 'High Confidence',
            source: 'Google Scholar',
            method: '直接提取',
            desc: `成功提取到学者学术档案，被引次数：${rawData.cited_by}`,
            claimText: name_en,
            evidence: [],
            matchedFields: ['name'],
            mismatchedFields: [],
            score: 100,
            status: 'match'
          });
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
