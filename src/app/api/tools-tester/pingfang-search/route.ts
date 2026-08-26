import { NextResponse } from 'next/server';
import { ToolUsageLogger } from '@/lib/supabase/tool-usage-logger';
import { talentAuditService } from '@/lib/mcp/talent';
import { talentJournal } from '@/lib/supabase/talent-journal';
import { getToken } from '@/lib/auth';
import OpenAI from "openai";
import {
  runPingfangDisambiguationV2,
  generatePinyinVariants,
  splitWpValues,
} from '@/lib/tools/disambiguation';

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
    const { name_cn, name_en, institution, research_field } = body;

    const queryName = name_cn || name_en;
    if (!queryName) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    const stream = makeStream(async (ctrl) => {
        const logger = new ToolUsageLogger('pingfang-search', queryName || name_cn || '');
      try {
        const factItems: any[] = [];

        sendLog(ctrl, 'info', `[1] 开始检索平方库学者: ${queryName}${institution ? ` (机构线索: ${institution})` : ''}${research_field ? ` (研究领域: ${research_field})` : ''}`);
        let candidates = await talentAuditService.searchTalents(queryName, 10, token);
        sendLog(ctrl, 'info', `[1a] 中文/原名命中 ${candidates.length} 条候选`);

        // 拼音兜底：中文名没搜到，或搜到但全机构未命中
        const isPureChinese = /^[\u4e00-\u9fa5]+$/.test(queryName.trim());
        if (isPureChinese) {
          let needPinyin = candidates.length === 0;
          if (!needPinyin && institution) {
            const pre = await runPingfangDisambiguationV2(candidates, { queryName, institution });
            if (!pre.allScores.some(s => s.instScore > 0.3)) needPinyin = true;
          }
          if (needPinyin) {
            const variants = generatePinyinVariants(queryName);
            sendLog(ctrl, 'info', `[1b] 中文检索${candidates.length === 0 ? '无结果' : '有结果但机构未命中'}，尝试 ${variants.length} 个拼音变体: ${variants.join(', ')}`);
            const existingIds = new Set(candidates.map((c: any) => c.id));
            for (const v of variants) {
              try {
                const alt = await talentAuditService.searchTalents(v, 10, token);
                if (alt.length > 0) {
                  const newOnes = alt.filter((c: any) => !existingIds.has((c as any).id));
                  if (newOnes.length > 0) {
                    newOnes.forEach((c: any) => existingIds.add((c as any).id));
                    sendLog(ctrl, 'info', `  ↳ "${v}" 命中 ${alt.length} 条 (新增 ${newOnes.length} 条)`);
                    candidates = [...candidates, ...newOnes];
                  } else {
                    sendLog(ctrl, 'info', `  ↩ "${v}" 命中但无新增`);
                  }
                }
              } catch { /* 单个变体失败继续 */ }
            }
            sendLog(ctrl, 'info', `[1c] 拼音扩展后共 ${candidates.length} 条候选`);
          }
        }

        if (!candidates || candidates.length === 0) {
          sendLog(ctrl, 'error', `[2] 未找到任何匹配的人才`);
          factItems.push({
            title: '高层次人才身份核验',
            confidence: 'Low Confidence',
            source: '平方学者库',
            method: '精准身份匹配',
            desc: '未检索到记录',
            claimText: queryName,
            evidence: [],
            matchedFields: [],
            mismatchedFields: [],
            internetData: '数据访问权限未开放或该人才尚未入库',
            score: 0,
            status: 'manual_review',
            experienceId: 'pingfang_identity'
          });
          sendResult(ctrl, { factItems, rawData: null, disambiguation: null });
          return;
        }

        // ── V2 消歧：LCS机构 + Embedding领域 + 合作者Jaccard + 乘法排序 ──
        sendLog(ctrl, 'info', `[2] 找到 ${candidates.length} 个同名学者，开始 V2 消歧 (姓名+LCS机构+Embedding领域+合作者网络)...`);
        sendLog(ctrl, 'info', `    公式: (Name^0.3) × (Inst[有机构]^0.4) × (Field[有机构]^0.25 / [无机构]^0.4) × (Coauth^0.2) + 0.03×Softmax(Richness)`);
        const disResult = await runPingfangDisambiguationV2(candidates, {
          queryName,
          institution: institution?.trim(),
          researchField: research_field?.trim(),
        });

        // 输出每个候选的 V2 评分明细
        for (let i = 0; i < disResult.allScores.length; i++) {
          const s = disResult.allScores[i];
          const c = s.candidate;
          const cName = (c.name as string) || '';
          const cInst = splitWpValues(c.workplace_current).join('、') || '无机构';
          const marker = i === 0 ? '⬅️ 选中' : '   ';
          const nameIcon = s.nameScore >= 0.9 ? '✅' : s.nameScore >= 0.5 ? '⚠️' : '❌';
          sendLog(ctrl, 'info',
            `   ${marker} [${s.score.toFixed(3)}] ${cName}(${nameIcon}${s.nameScore.toFixed(2)}) | ${cInst}` +
            `${s.coauthorScore > 0 ? ` | coauth=${s.coauthorScore.toFixed(2)}` : ''}`
          );
          if (i === 0) {
            for (const b of s.breakdown) {
              sendLog(ctrl, 'info', `      └ ${b}`);
            }
          }
        }

        const confLabel = disResult.confidence === 'high' ? '🟢 高置信度' : disResult.confidence === 'low' ? '🟡 低置信度(机构未命中)' : '⚪ 兜底';
        sendLog(ctrl, disResult.confidence === 'high' ? 'success' : 'warn',
          `[3] 消歧完成: ${confLabel} → ${disResult.top.name} (${splitWpValues(disResult.top.workplace_current).join('、') || '无机构'})`);

        const selectedTalent = disResult.top;

        // ── 写入 talentJournal（同步执行，确保结果能回写到 SSE 日志） ──
        sendLog(ctrl, 'info', `[4] 🔄 正在将该学者数据 [${selectedTalent.name}] 写入人才日志...`);
        const journalName = selectedTalent.name_en || selectedTalent.name || queryName;
        const journalInst = splitWpValues(selectedTalent.workplace_current)[0] || '';
        try {
          // rawData 走 extractStructuredFields 提取扁平标签；sourceRaw 直接存完整嵌套到 structured_data
          await talentJournal.saveTalentData(
            journalName,
            journalInst,
            { pingfang: selectedTalent } as unknown as Record<string, any>,
            '',
            token,
            'tool-pingfang-search',
            { pingfang: selectedTalent } as unknown as Record<string, any>,
          );
          sendLog(ctrl, 'success', `[4a] ✅ 已写入人才日志: ${journalName}@${journalInst}`);
        } catch (err: any) {
          sendLog(ctrl, 'warn', `[4b] ⚠️ 写入人才日志失败: ${err?.message || err}`);
        }

        // ── 组装 factItems ──
        const confidenceLabel =
          disResult.confidence === 'high' ? 'High Confidence'
          : disResult.confidence === 'low' ? 'Medium Confidence'
          : 'Low Confidence';

        factItems.push({
          title: '高层次人才身份核验',
          confidence: confidenceLabel,
          source: '平方学者库',
          method: '5维度加权消歧',
          desc: `匹配学者 ${selectedTalent.name}，机构 ${splitWpValues(selectedTalent.workplace_current).join('、') || '未知'}`,
          claimText: queryName,
          evidence: [],
          matchedFields: disResult.confidence === 'high' ? ['name', 'institution'] : ['name'],
          mismatchedFields: disResult.confidence === 'low' ? ['institution'] : [],
          score: disResult.allScores[0]?.score || 0,
          status: disResult.confidence === 'high' ? 'match' : disResult.confidence === 'low' ? 'manual_review' : 'mismatch',
          experienceId: 'pingfang_identity'
        });

        sendLog(ctrl, 'success', `[5] ✅ 检索完毕，共 ${candidates.length} 条候选，选中 ${selectedTalent.name}`);

        sendResult(ctrl, {
          factItems,
          rawData: selectedTalent,
          disambiguation: {
            version: 'V2',
            formula: '(Inst^0.5)×(Field^0.3)×(Coauth^0.2) + 0.1×Softmax(Richness)',
            confidence: disResult.confidence,
            usedFallback: disResult.usedFallback,
            totalCandidates: candidates.length,
            topScore: Number(disResult.allScores[0]?.score.toFixed(3)) || 0,
            allScores: disResult.allScores.map(s => ({
              name: (s.candidate as any).name || (s.candidate as any).name_en || '',
              score: Number(s.score.toFixed(3)),
              nameScore: Number(s.nameScore.toFixed(2)),
              instScore: Number(s.instScore.toFixed(2)),
              fieldScore: Number(s.fieldScore.toFixed(2)),
              coauthorScore: Number(s.coauthorScore.toFixed(2)),
              richnessScore: Number(s.richnessScore.toFixed(2)),
              breakdown: s.breakdown,
            })),
          },
        });
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
