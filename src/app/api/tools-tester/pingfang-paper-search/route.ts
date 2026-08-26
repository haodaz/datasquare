import { NextResponse } from 'next/server';
import { talentAuditService } from '@/lib/mcp/talent';
import { talentJournal } from '@/lib/supabase/talent-journal';
import { getToken } from '@/lib/auth';

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
    const token = await getToken(req);
    const body = await req.json();
    const { name_cn, name_en, target_papers } = body;

    const queryName = name_cn || name_en;
    if (!queryName || !target_papers || target_papers.length === 0) {
      return NextResponse.json({ error: 'Missing name or target_papers' }, { status: 400 });
    }

    const stream = makeStream(async (ctrl) => {
      try {
        const factItems: any[] = [];
        const rawData: any = { matchedPapers: [] };
        
        sendLog(ctrl, 'info', `[1] 开始检索该学者的代表作...`);

        // 辅助：从 VSDPaper 提取作者字符串（兼容 string / [{name}] / object 三种结构）
        const extractAuthorsStr = (p: any): string => {
          const raw = p?.authors;
          if (Array.isArray(raw)) {
            return raw
              .map((a: any) => (typeof a === 'string' ? a : a?.name || a?.name_en || ''))
              .filter(Boolean)
              .join(', ');
          }
          if (typeof raw === 'string') return raw;
          if (raw && typeof raw === 'object') {
            return Object.values(raw).flat().filter(Boolean).join(', ');
          }
          return '';
        };
        const norm = (s: string) => s.toLowerCase().replace(/[\s,·。、\-]+/g, '').trim();

        for (const paper of target_papers) {
          sendLog(ctrl, 'info', `  - 正在检索论文: ${paper.title}`);
          const paperResults = await talentAuditService.searchPapers(paper.title, 10, token);

          if (paperResults && paperResults.length > 0) {
            // 在候选里找第一个作者命中的（不再只取 top1）
            const qs = norm(queryName || '');
            const qe = norm(name_en || '');
            let matchedPaper: any = null;
            let matchedAuthorsStr = '';
            let firstPaper: any = null;
            let firstAuthorsStr = '';

            for (const p of paperResults) {
              const authorsStr = extractAuthorsStr(p);
              if (!firstPaper) { firstPaper = p; firstAuthorsStr = authorsStr; }
              const normAuthors = norm(authorsStr);
              const hit =
                (qs && normAuthors.includes(qs)) ||
                (qe && normAuthors.includes(qe));
              if (hit) { matchedPaper = p; matchedAuthorsStr = authorsStr; break; }
            }

            if (matchedPaper) {
              sendLog(ctrl, 'success', `    ✅ 找到论文且作者匹配: ${matchedPaper.name}`);
              rawData.matchedPapers.push(matchedPaper);
              factItems.push({
                title: `出版物核验 - ${paper.title.substring(0, 20)}`,
                confidence: 'High Confidence',
                source: '平方论文库',
                method: '精准标题与作者匹配',
                desc: '成功匹配到论文及作者信息',
                claimText: paper.title,
                evidence: [],
                matchedFields: [paper.title],
                mismatchedFields: [],
                internetData: `平方库记录: ${matchedPaper.name} | 期刊: ${matchedPaper.journal_source || '-'} | 作者: ${matchedAuthorsStr}`,
                score: 100,
                status: 'match',
                experienceId: `paper_${paper.idx}`
              });
            } else {
              sendLog(ctrl, 'warn', `    ⚠️ 找到 ${paperResults.length} 条论文，但作者列表均不包含候选人（取首条: ${firstPaper?.name}）`);
              factItems.push({
                title: `出版物核验 - ${paper.title.substring(0, 20)}`,
                confidence: 'Medium Confidence',
                source: '平方论文库',
                method: '标题匹配但作者不符',
                desc: `找到 ${paperResults.length} 条候选，作者均不匹配`,
                claimText: paper.title,
                evidence: [],
                matchedFields: [],
                mismatchedFields: [paper.title],
                internetData: `候选1: ${firstPaper?.name} | 实际作者: ${firstAuthorsStr}`,
                score: 30,
                status: 'manual_review',
                experienceId: `paper_${paper.idx}`
              });
            }
          } else {
            sendLog(ctrl, 'error', `    ❌ 未找到该论文（已尝试多级 fallback 检索）`);
            factItems.push({
              title: `出版物核验 - ${paper.title.substring(0, 20)}`,
              confidence: 'Low Confidence',
              source: '平方论文库',
              method: '精确标题检索 + Fallback',
              desc: '多级 fallback 后仍未找到匹配记录',
              claimText: paper.title,
              evidence: [],
              matchedFields: [],
              mismatchedFields: [paper.title],
              internetData: '数据库中无此记录',
              score: 0,
              status: 'mismatch',
              experienceId: `paper_${paper.idx}`
            });
          }
        }

        sendLog(ctrl, 'info', `[2] 所有代表作检索完毕。`);

          if (rawData.matchedPapers.length > 0) {
            sendLog(ctrl, 'info', `[3] 🔄 正在将论文匹配数据 [${queryName}] 写入人才日志...`);
            try {
              await talentJournal.saveTalentData(
                queryName,
                name_en || '',
                { pingfang_papers: rawData.matchedPapers } as unknown as Record<string, any>,
                '',
                token,
                'tool-pingfang-paper-search',
                { pingfang_papers: rawData.matchedPapers } as unknown as Record<string, any>,
              );
              sendLog(ctrl, 'success', `[3a] ✅ 已写入人才日志: ${queryName} (${rawData.matchedPapers.length} 篇论文)`);
            } catch (tjErr: any) {
              sendLog(ctrl, 'warn', `[3a] ⚠️ 人才日志写入失败: ${tjErr?.message || tjErr}`);
            }
          } else {
            sendLog(ctrl, 'info', `[3] 无匹配论文，跳过人才日志写入`);
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
