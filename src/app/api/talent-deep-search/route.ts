import { NextResponse } from 'next/server';
import { runTalentDeepSearchStream } from '@/lib/tools/talentDeepSearch';
import { talentJournal } from '@/lib/supabase/talent-journal';
import { ToolUsageLogger } from '@/lib/supabase/tool-usage-logger';
import { getToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, en_name, cn_name, institution } = body;
    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const stream = await runTalentDeepSearchStream(query, institution, en_name, cn_name);
    const token = await getToken(request);
    const logger = new ToolUsageLogger('talent-deep-search', query);

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    let talentRawData: Record<string, any> | null = null;
    let aiReportChunks: string[] = [];  // ← 收集 AI 报告 chunks

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const line of parts) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.type === 'raw_data') {
                talentRawData = data.data;
                logger.setResult(data.data);
              }
              if (data.type === 'ai_chunk') {
                // 收集 AI 输出用于保存
                const text = typeof data.data === 'string' ? data.data : '';
                if (text) aiReportChunks.push(text);
              }
              if (data.type === 'log') {
                logger.addLog(data.data?.step || '', data.data?.message || '');
              }
            } catch (e) { /* ignore incomplete json */ }
          }
          controller.enqueue(encoder.encode(line + '\n\n'));
        }
      },
      flush(controller) {
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.type === 'raw_data') {
                talentRawData = data.data;
                logger.setResult(data.data);
              }
              if (data.type === 'ai_chunk') {
                const text = typeof data.data === 'string' ? data.data : '';
                if (text) aiReportChunks.push(text);
              }
            } catch (e) { /* ignore */ }
          }
          controller.enqueue(encoder.encode(line + '\n\n'));
        }

        // 拼接完整 AI 报告
        const fullAiReport = aiReportChunks.join('');
        
        // 保存完整 AI 报告到 logger
        if (fullAiReport) {
          logger.setAiRenderedResult(fullAiReport);
        }

        // fire-and-forget 保存到人才日志
        if (talentRawData?.gatheredData) {
          talentJournal.saveTalentData(
            talentRawData.talentName || query,
            talentRawData.institution || institution || '',
            talentRawData.gatheredData,
            fullAiReport,  // ← 传入完整 AI 报告
            token,
            'deep_search',
          ).catch((e: any) => console.error('[DeepSearch] talentJournal save failed:', e));
        }
        // 保存工具使用日志
        logger.save().catch(() => {});
      }
    });

    const transformed = stream.pipeThrough(transformStream);

    return new Response(transformed, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });

  } catch (error: any) {
    console.error('[DeepSearch] Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: error.message === 'Missing query' ? 400 : 500 });
  }
}
