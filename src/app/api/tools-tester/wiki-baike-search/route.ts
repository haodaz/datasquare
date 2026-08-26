import { NextResponse } from 'next/server';
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

function sendLog(ctrl: ReadableStreamDefaultController, step: string, msg: string) {
  ctrl.enqueue(enc.encode('data: ' + JSON.stringify({ type: 'log', data: { step, message: msg } }) + '\n\n'));
}

function sendResult(ctrl: ReadableStreamDefaultController, data: unknown) {
  ctrl.enqueue(enc.encode('data: ' + JSON.stringify({ type: 'result', data }) + '\n\n'));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = await getToken(req);
    const { name_cn, name_en, resume_claims_text } = body;

    const stream = makeStream(async (ctrl) => {
      try {
        const factItems: any[] = [];
        let wikiText = '';
        let baikeText = '';
        const rawData: any = {};

        sendLog(ctrl, 'info', `[1] 启动百科并发检索...`);

        // 1. 检索 English Wikipedia
        if (name_en) {
          try {
            sendLog(ctrl, 'info', `[2-Wiki] 正在检索 Wikipedia: ${name_en}`);
            const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name_en)}&srlimit=1&utf8=&format=json&origin=*`;
            const searchRes = await fetch(wikiSearchUrl);
            const searchData = await searchRes.json();
            const topResult = searchData.query?.search?.[0];
            
            if (topResult) {
              sendLog(ctrl, 'info', `[2-Wiki] 命中 Wikipedia 词条: ${topResult.title}, 获取正文...`);
              const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${topResult.pageid}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
              const contentRes = await fetch(contentUrl);
              const contentData = await contentRes.json();
              const pageObj = contentData.query?.pages?.[topResult.pageid];
              if (pageObj && pageObj.extract) {
                wikiText = pageObj.extract.substring(0, 1500);
                rawData.wikipedia = { title: topResult.title, extract: wikiText, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(topResult.title.replace(/ /g, '_'))}` };
                sendLog(ctrl, 'success', `[2-Wiki] 成功提取 Wikipedia 摘要 (${wikiText.length} 字符)`);
              }
            } else {
              sendLog(ctrl, 'warn', `[2-Wiki] 未找到 Wikipedia 词条。`);
            }
          } catch (e: any) {
            sendLog(ctrl, 'error', `[2-Wiki] 检索失败: ${e.message}`);
          }
        }

        // 2. 检索 百度百科
        if (name_cn) {
          try {
            sendLog(ctrl, 'info', `[2-Baike] 正在检索 Baidu Baike: ${name_cn}`);
            const bkUrl = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(name_cn)}&bk_length=1500`;
            const bkRes = await fetch(bkUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const bkData = await bkRes.json();
            
            if (bkData && bkData.id && bkData.abstract) {
              baikeText = bkData.abstract.replace(/<[^>]+>/g, '').substring(0, 1500);
              rawData.baike = { title: bkData.title, extract: baikeText, url: bkData.url || `https://baike.baidu.com/item/${encodeURIComponent(name_cn)}` };
              sendLog(ctrl, 'success', `[2-Baike] 成功提取 百度百科 摘要 (${baikeText.length} 字符)`);
            } else {
              sendLog(ctrl, 'warn', `[2-Baike] 未找到 百度百科 词条。`);
            }
          } catch (e: any) {
             sendLog(ctrl, 'error', `[2-Baike] 检索失败: ${e.message}`);
          }
        }

        if (!wikiText && !baikeText) {
          sendLog(ctrl, 'warn', `[3] 未命中任何百科词条。`);
          factItems.push({
            title: '百科影响力核验',
            confidence: 'Low Confidence',
            source: 'Wikipedia/百度百科',
            method: '公共词条匹配',
            desc: '未检索到任何百科记录',
            claimText: resume_claims_text,
            evidence: [],
            score: 0,
            status: 'manual_review',
            experienceId: 'wiki_impact'
          });
          sendResult(ctrl, { factItems, rawData: null });
          return;
        }

        // AI 比对
        if (resume_claims_text) {
          sendLog(ctrl, 'info', `[4] 对比简历声明描述与百科真实客观描述...`);
          const client = getOpenAIClient();
          const prompt = `
            你是一个严谨的人才背景审查员。
            这是简历中声称的定性描述/荣誉/成就：
            "${resume_claims_text}"

            这是通过 百科 获取的客观人物摘要：
            ${wikiText ? '【Wikipedia】' + wikiText : ''}
            ${baikeText ? '【百度百科】' + baikeText : ''}
            
            请检查是否存在：
            1. 简历声称的头衔或定性描述（如“XX领域奠基人”）在客观百科中明确证实或明确矛盾。
            2. 如果百科根本未提及该声明，必须标为 needs_review，禁止标为 match。
            
            请输出 JSON 格式：
            {
              "factItems": [
                {
                  "title": "定性成就核验 (百科)",
                  "confidence": "High Confidence",
                  "source": "Wikipedia/Baike",
                  "method": "百科摘要语义验证",
                  "desc": "百科记录与声明相符" 或 "百科中未提及此极高定性评价，需人工复核" 或 "与客观事实矛盾",
                  "claimText": "简历声称的成就",
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
              factItems.push(...aiResult.factItems);
              sendLog(ctrl, 'success', `[5] 交叉验证完成，生成了 ${aiResult.factItems.length} 条 FactItem`);
            }
          } catch (e: any) {
             sendLog(ctrl, 'error', `[5] AI 交叉验证执行失败: ${e.message}`);
          }
        } else {
          sendLog(ctrl, 'info', `[4] 未提供声明描述，直接输出抓取结论`);
          factItems.push({
            title: '百科词条验证',
            confidence: 'High Confidence',
            source: 'OSINT',
            method: '存在性匹配',
            desc: `该学者存在公开的百科词条，具有一定的社会公共知名度。`,
            claimText: name_cn || name_en,
            evidence: [],
            score: 100,
            status: 'match'
          });
        }

        if (rawData.wikipedia || rawData.baike) {
          try {
            sendLog(ctrl, 'info', `[6] 🔄 写入人才日志...`);
            await talentJournal.saveTalentData(
              name_cn || name_en,
              '',
              { wikipedia: { biography: rawData.wikipedia?.extract || '' }, baike: { biography: rawData.baike?.extract || '' } },
              '',
              token,
              'tool-wiki-baike-search',
              { wikipedia: rawData.wikipedia, baike: rawData.baike }
            );
            sendLog(ctrl, 'success', `[6a] ✅ 人才日志写入成功`);
          } catch (e: any) {
            sendLog(ctrl, 'error', `[6a] ✖ 人才日志写入失败: ${e.message}`);
          }
        }

        sendResult(ctrl, { factItems, rawData });
      } catch (err: any) {
        sendLog(ctrl, 'error', `[Error] ${err.message}`);
      } finally {
        ctrl.close();
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
