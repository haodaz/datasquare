import { NextResponse } from 'next/server';
import { ToolUsageLogger } from '@/lib/supabase/tool-usage-logger';
import { getOrcidToken, orcidSearch, orcidGetEmployments, orcidGetEducations, orcidGetWorks, orcidGetProfileName, OrcidAffiliation, OrcidWork, OrcidProfileName } from '@/lib/tools/orcid_funcs';
import { talentJournal } from '@/lib/supabase/talent-journal';
import { getToken } from '@/lib/auth';
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
    const token = await getToken(req);
    const body = await req.json();
    const { name_cn, name_en, keywords, research_field, resume_timeline_text } = body;

    if (!name_en && !name_cn) {
      return NextResponse.json({ error: 'Missing name_en or name_cn' }, { status: 400 });
    }

    const stream = makeStream(async (ctrl) => {
        const logger = new ToolUsageLogger('orcid-search', queryName || name_cn || '');
      try {
        const factItems: any[] = [];
        const queryName = (name_en || name_cn || '').trim();

        sendLog(ctrl, 'info', `[1] 正在获取 ORCID API Token...`);
        const orcidToken = await getOrcidToken();
        if (!orcidToken) {
          sendLog(ctrl, 'error', `ORCID 未配置`);
          logger.save().catch(() => {}); ctrl.close();
          return;
        }

        const nameParts = queryName.split(/\s+/);
        let familyName = nameParts.length > 1 ? nameParts.pop() || '' : '';
        let givenNames = nameParts.join(' ');
        if (!familyName) { familyName = givenNames; givenNames = ''; }

        sendLog(ctrl, 'info', `[2] 搜索 ORCID, Given: ${givenNames}, Family: ${familyName}, Keyword: ${keywords || '(无)'}`);
        const candidates = await orcidSearch(orcidToken, givenNames, familyName, keywords);

        if (candidates.length === 0) {
          sendLog(ctrl, 'warn', `[3] 未找到匹配的 ORCID 记录`);
          factItems.push({
            title: 'ORCID 履历核验',
            confidence: 'Low Confidence',
            source: 'ORCID',
            method: '精准身份与机构匹配',
            desc: '未检索到记录，无法进行时间线比对',
            claimText: queryName,
            evidence: [],
            matchedFields: [],
            mismatchedFields: [],
            internetData: '数据库未收录该学者',
            score: 0,
            status: 'manual_review',
            experienceId: 'orcid_timeline'
          });
          sendResult(ctrl, { factItems, rawData: null });
          return;
        }

        sendLog(ctrl, 'info', `[3] 找到 ${candidates.length} 个候选 ORCID，开始多维度消歧 (姓名+机构)...`);

        // ── 为消歧拉所有候选的: name + employments + educations（带缓存） ──
        interface CachedData {
          profile: OrcidProfileName;
          employments: OrcidAffiliation[];
          educations: OrcidAffiliation[];
        }
        const fetchAllCached = (() => {
          const cache = new Map<string, CachedData>();
          return async (token: string, orcidId: string): Promise<CachedData> => {
            const hit = cache.get(orcidId);
            if (hit) return hit;
            const [profile, emps, edus] = await Promise.all([
              orcidGetProfileName(token, orcidId),
              orcidGetEmployments(token, orcidId),
              orcidGetEducations(token, orcidId),
            ]);
            const d = { profile, employments: emps, educations: edus };
            cache.set(orcidId, d);
            return d;
          };
        })();

        // 解析查询姓名为 given + family（支持 "Li, Jiang" 和 "Jiang Li"）
        const qLower = queryName.toLowerCase().trim();
        const qByComma = qLower.split(',').map((w: string) => w.trim()).filter(Boolean);
        let qGiven = '', qFamily = '';
        if (qByComma.length === 2) {
          qFamily = qByComma[0]; qGiven = qByComma[1];
        } else {
          const parts = qLower.split(/\s+/);
          if (parts.length >= 2) {
            qFamily = parts[parts.length - 1];
            qGiven = parts.slice(0, -1).join(' ');
          } else {
            qFamily = parts[0] || '';
          }
        }

        const kwLower = (keywords || '').toLowerCase();

        // ── 名字匹配打分: 精确 given+family +50, family 精确 + given 部分 +20, family 部分 +5, family 不匹配 -30 ──
        const scoreName = (profile: OrcidProfileName): { score: number; reasons: string[] } => {
          const reasons: string[] = [];
          let s = 0;
          const pGiven = profile.given.toLowerCase();
          const pFamily = profile.family.toLowerCase();
          if (!pGiven && !pFamily) return { score: 0, reasons };

          // family 维度
          if (qFamily && pFamily === qFamily) {
            s += 15;
            reasons.push('family=exact');
          } else if (qFamily && (pFamily.includes(qFamily) || qFamily.includes(pFamily))) {
            s += 5;
            reasons.push('family=partial');
          } else if (qFamily && pFamily && !pFamily.includes(qFamily)) {
            s -= 30;
            reasons.push('family=MISMATCH');
          }

          // given 维度
          if (qGiven) {
            if (pGiven === qGiven) {
              s += 35;
              reasons.push('given=exact');
            } else {
              // profile given 拆词（支持空格、连字符、点号分隔）
              const pWords = pGiven.split(/[\s.\-]+/).filter(Boolean);
              const qWords = qGiven.split(/[\s.\-]+/).filter(Boolean);
              const qFirst = qWords[0];
              const pFirst = pWords[0];

              // 主 given 名字（第一个词）精确匹配 → exact / word-exact
              if (pFirst === qFirst) {
                s += 35;
                reasons.push('given=word-exact(first)');
              } else if (qWords.every((w: string) => pWords.includes(w))) {
                // 所有查询词都在 profile 里，但不是首词（如 "Wan-Jiang" 含 "jiang" 但首词是 Wan） → 弱
                s += 5;
                reasons.push('given=contains(secondary)');
              } else if (pGiven.includes(qGiven)) {
                // 子串包含（更弱）
                s += 5;
                reasons.push('given=substring');
              } else {
                s -= 15;
                reasons.push('given=MISMATCH');
              }
            }
          }
          return { score: s, reasons };
        };

        interface ScoredCandidate {
          orcidId: string;
          data: CachedData;
          score: number;
          reasons: string[];
        }
        const scored: ScoredCandidate[] = [];

        for (const c of candidates) {
          const d = await fetchAllCached(orcidToken, c.path);
          const reasons: string[] = [];
          let score = 0;

          // ── 维度1: 姓名匹配（第一优先级，权重 50/-45） ──
          const nameScore = scoreName(d.profile);
          score += nameScore.score;
          reasons.push(`[name ${nameScore.score >= 0 ? '+' : ''}${nameScore.score}] ${nameScore.reasons.join(',') || 'n/a'}`);

          // ── 维度2: employments org 包含 keywords（+40） ──
          for (const emp of d.employments) {
            if (kwLower && emp.org.toLowerCase().includes(kwLower)) {
              score += 40;
              reasons.push(`employment@${emp.org}`);
            }
          }
          // ── 维度3: educations org 包含 keywords（+30） ──
          for (const edu of d.educations) {
            if (kwLower && edu.org.toLowerCase().includes(kwLower)) {
              score += 30;
              reasons.push(`education@${edu.org}`);
            }
          }
          // ── 维度4: 有 affiliation 数据本身（+10） ──
          const totalAffiliations = d.employments.length + d.educations.length;
          if (totalAffiliations > 0) score += 10;

          scored.push({ orcidId: c.path, data: d, score, reasons });
        }

        scored.sort((a, b) => b.score - a.score);

        // 每个候选的详细分数（用于 debug 日志）
        for (let i = 0; i < Math.min(scored.length, 5); i++) {
          const s = scored[i];
          sendLog(ctrl, 'debug', `  候选#${i + 1}: ${s.orcidId} | 名字="${s.data.profile.given} ${s.data.profile.family}" | score=${s.score} | ${s.reasons.join(' | ')}`);
        }

        const best = scored[0];
        const bestEmployments = best.data.employments;
        const bestEducations = best.data.educations;
        const bestProfile = best.data.profile;

        // 如果消歧分 > 0，说明至少有一个维度命中
        if (best.score > 0) {
          sendLog(ctrl, 'success', `[4] 消歧命中 (score=${best.score}) → ORCID ${best.orcidId} | "${bestProfile.given} ${bestProfile.family}" | reasons: ${best.reasons.join('; ')}`);
        } else {
          const allEmpty = candidates.every((_, i) => {
            const s = scored[i];
            return s.data.employments.length === 0 && s.data.educations.length === 0;
          });
          if (allEmpty) {
            sendLog(ctrl, 'warn', `[4] 所有 ${candidates.length} 个候选 ORCID 的履历数据都是空的（ORCID 可能未收录该学者），选中首位: ${best.orcidId}`);
          } else {
            sendLog(ctrl, 'warn', `[4] 总分偏低，使用首位候选: ${best.orcidId}`);
          }
        }

        // works 对最终选中的 ORCID 拉取（不缓存，只拉一次）
        const bestWorks = await orcidGetWorks(orcidToken, best.orcidId, 10);

        const rawData = {
          orcidId: best.orcidId,
          employments: bestEmployments,
          educations: bestEducations,
          works: bestWorks,
        };

        // ── 写入人才日志 ──
        sendLog(ctrl, 'info', `[5] 正在将该学者 ORCID 数据 (教育=${bestEducations.length}, 工作=${bestEmployments.length}, 论文=${bestWorks.length}) 并入人才日志...`);
        try {
          const journalName = name_cn || name_en || queryName;
          const journalInst = keywords || '';
          await talentJournal.saveTalentData(
            journalName,
            journalInst,
            { orcid: rawData } as unknown as Record<string, any>,
            '',
            token,
            'tool-orcid-search',
            { orcid: rawData } as unknown as Record<string, any>,
          );
          sendLog(ctrl, 'success', `[5a] ✅ 已写入人才日志: ${journalName}@ORCID ${best.orcidId}`);
        } catch (tjErr: any) {
          sendLog(ctrl, 'warn', `[5a] ⚠️ 人才日志写入失败（不影响主流程）: ${tjErr?.message || tjErr}`);
        }

        // ── AI 比对 / 直接输出 ──
        if (resume_timeline_text) {
          sendLog(ctrl, 'info', `[6] 存在简历声明时间线，进行严重重叠或造假交叉验证...`);
          const client = getOpenAIClient();
          const prompt = `
你是一个严谨的人才审计员。
这是用户在简历中声明的时间线及经历：
"${resume_timeline_text}"

这是从 ORCID 获取的真实客观经历（注意：ORCID 对中国学者覆盖率较低，若 ORCID 返回空数据，可能只是没收录，不能视为造假证据）：
【教育】${JSON.stringify(bestEducations)}
【工作】${JSON.stringify(bestEmployments)}
【已发表论文】${JSON.stringify(bestWorks)}

请判断用户的声明是否存在：
1. 时间线严重重叠（如同时在两个地方全职）。
2. 虚构机构或职位。
3. 论文列表与 ORCID 记录矛盾。

请输出 JSON 格式：
{
  "factItems": [
    {
      "title": "ORCID 履历时间线核验",
      "confidence": "High Confidence" 或 "Medium Confidence" 或 "Low Confidence",
      "source": "ORCID",
      "method": "时间线交叉比对",
      "desc": "未发现时间线冲突" 或 "发现时间线异常重叠/造假" 或 "ORCID 数据为空无法核验",
      "claimText": "简历时间线",
      "matchedFields": [],
      "mismatchedFields": [],
      "internetData": "简洁的 ORCID 证据摘要",
      "score": 100或50或0,
      "status": "match"或"manual_review"或"mismatch"
    }
  ]
}`;
          try {
            const aiResponse = await client.chat.completions.create({
              model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
              response_format: { type: "json_object" },
              messages: [{ role: 'user', content: prompt }]
            });
            const aiResult = JSON.parse(aiResponse.choices[0].message.content || '{}');
            if (aiResult.factItems) {
              factItems.push(...aiResult.factItems);
              sendLog(ctrl, 'success', `[7] 交叉验证完成，生成了 ${aiResult.factItems.length} 条 FactItem`);
            }
          } catch (e: any) {
            sendLog(ctrl, 'error', `[7] AI 交叉验证执行失败: ${e.message}`);
          }
        } else {
          sendLog(ctrl, 'info', `[6] 未提供简历声明时间线，跳过交叉验证`);
          factItems.push({
            title: 'ORCID 履历数据拉取',
            confidence: best.score > 0 ? 'High Confidence' : 'Medium Confidence',
            source: 'ORCID',
            method: '多维度消歧匹配',
            desc: best.score > 0
              ? `成功消歧到 ORCID ${best.orcidId}，命中: ${best.reasons.join('; ') || '基础匹配'}`
              : `未命中关键字机构，使用首位候选 ${best.orcidId}`,
            claimText: queryName,
            evidence: [],
            matchedFields: best.score > 0 ? ['affiliation'] : [],
            mismatchedFields: kwLower ? ['institution_keyword'] : [],
            internetData: `教育 ${bestEducations.length} 条 / 工作 ${bestEmployments.length} 条 / 论文 ${bestWorks.length} 篇`,
            score: best.score > 0 ? 100 : 60,
            status: best.score > 0 ? 'match' : 'manual_review',
            experienceId: 'orcid_timeline',
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
