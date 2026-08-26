import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { runTalentWebSearchStream } from '@/lib/tools/talentWebSearch';
import { talentJournal } from '@/lib/supabase/talent-journal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Vercel Pro: 最多 120 秒

/**
 * 链式处理核心：处理批次中下一条 pending 任务
 * 完成后 fire-and-forget 调用自己处理下一条
 */
export async function POST(request: Request) {
  try {
    const { batch_id } = await request.json();
    if (!batch_id) {
      return NextResponse.json({ error: 'Missing batch_id' }, { status: 400 });
    }

    // 1. 查找下一个 pending 任务
    const { data: nextTask, error: findErr } = await supabase
      .from('batch_search_tasks')
      .select('*')
      .eq('batch_id', batch_id)
      .eq('status', 'pending')
      .order('seq', { ascending: true })
      .limit(1)
      .single();

    if (findErr || !nextTask) {
      // 没有更多 pending 任务 → 标记批次完成
      await supabase.from('batch_search_jobs').update({
        status: 'done',
        completed_at: new Date().toISOString(),
      }).eq('id', batch_id);
      console.log(`[BatchSearch] Batch ${batch_id} 全部完成`);
      return NextResponse.json({ ok: true, done: true });
    }

    // 2. 标记任务为 running
    await supabase.from('batch_search_tasks').update({
      status: 'running',
      started_at: new Date().toISOString(),
    }).eq('id', nextTask.id);

    // 同步更新批次状态为 running
    await supabase.from('batch_search_jobs').update({
      status: 'running',
    }).eq('id', batch_id);

    console.log(`[BatchSearch] 开始处理: batch=${batch_id}, task=${nextTask.id}, name="${nextTask.talent_name}"`);

    // 3. 执行检索（直接调用函数，在内存中消费流）
    const logs: { step: string; message: string }[] = [];
    let aiReport = '';
    let rawData: Record<string, any> | null = null;

    try {
      const stream = await runTalentWebSearchStream(
        nextTask.talent_name,
        nextTask.institution || '',
      );

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.substring(6));
            if (data.type === 'log') {
              logs.push({ step: data.data.step, message: data.data.message });
            } else if (data.type === 'ai_chunk') {
              aiReport += (typeof data.data === 'string' ? data.data : '');
            } else if (data.type === 'raw_data') {
              rawData = data.data;
            }
          } catch { /* ignore */ }
        }
      }

      // 4. 保存到人才日志（复用现有逻辑）
      if (rawData?.gatheredData) {
        try {
          await talentJournal.saveTalentData(
            rawData.talentName || nextTask.talent_name,
            rawData.institution || nextTask.institution || '',
            rawData.gatheredData,
            aiReport,
            undefined, // no user token
            'batch_web_search',
          );
        } catch (e) {
          console.error(`[BatchSearch] 人才日志保存失败:`, e);
        }
      }

      // 5. 标记任务完成
      await supabase.from('batch_search_tasks').update({
        status: 'done',
        logs: JSON.stringify(logs),
        ai_report: aiReport,
        completed_at: new Date().toISOString(),
      }).eq('id', nextTask.id);

      // 更新批次完成计数（直接查已完成数）
      const { count } = await supabase
        .from('batch_search_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch_id)
        .in('status', ['done', 'failed']);

      await supabase.from('batch_search_jobs')
        .update({ completed_count: count || nextTask.seq })
        .eq('id', batch_id);

      console.log(`[BatchSearch] 完成: task=${nextTask.id}, name="${nextTask.talent_name}", report=${aiReport.length}字`);

    } catch (taskErr: any) {
      // 单条失败：标记失败但不中断批次
      console.error(`[BatchSearch] 任务失败: task=${nextTask.id}`, taskErr);
      await supabase.from('batch_search_tasks').update({
        status: 'failed',
        logs: JSON.stringify(logs),
        error_message: taskErr.message || String(taskErr),
        completed_at: new Date().toISOString(),
      }).eq('id', nextTask.id);

      // 仍然递增完成计数
      await supabase.from('batch_search_jobs')
        .update({ completed_count: nextTask.seq })
        .eq('id', batch_id);
    }

    // 6. Fire-and-forget: 调用自己处理下一条
    const selfUrl = new URL('/api/batch-web-search/process', request.url);
    fetch(selfUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id }),
    }).catch(e => console.error('[BatchSearch] 链式调用失败:', e));

    return NextResponse.json({ ok: true, processed: nextTask.id });

  } catch (error: any) {
    console.error('[BatchSearch/process] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
