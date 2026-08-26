import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { runTalentWebSearchStream } from '@/lib/tools/talentWebSearch';
import { talentJournal } from '@/lib/supabase/talent-journal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 并发模式需要更多时间

const CONCURRENCY = 2; // 每轮并发数

/**
 * 并发链式处理核心：每轮取 N 条 pending 任务并发执行
 * 全部完成后 fire-and-forget 调用自己处理下一轮
 */
export async function POST(request: Request) {
  try {
    const { batch_id } = await request.json();
    if (!batch_id) {
      return NextResponse.json({ error: 'Missing batch_id' }, { status: 400 });
    }

    // 1. 取下一批 pending 任务（最多 CONCURRENCY 条）
    const { data: pendingTasks, error: findErr } = await supabase
      .from('batch_search_tasks')
      .select('*')
      .eq('batch_id', batch_id)
      .eq('status', 'pending')
      .order('seq', { ascending: true })
      .limit(CONCURRENCY);

    if (findErr || !pendingTasks || pendingTasks.length === 0) {
      // 没有更多 pending 任务 → 判断最终状态
      // 先检查是否还有 running 的（其他并发 worker 还在跑）
      const { count: runningCount } = await supabase
        .from('batch_search_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch_id)
        .eq('status', 'running');

      if (runningCount && runningCount > 0) {
        // 还有别的 worker 在跑，不要结束批次
        console.log(`[BatchSearch] Batch ${batch_id}: 无 pending，但还有 ${runningCount} 条 running，跳过结束`);
        return NextResponse.json({ ok: true, waiting: true });
      }

      const { count: failedCount } = await supabase
        .from('batch_search_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch_id)
        .eq('status', 'failed');

      const { count: totalCount } = await supabase
        .from('batch_search_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch_id);

      let finalStatus = 'done';
      if (failedCount && failedCount > 0) {
        finalStatus = (failedCount === totalCount) ? 'failed' : 'partial';
      }

      await supabase.from('batch_search_jobs').update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
      }).eq('id', batch_id);
      console.log(`[BatchSearch] Batch ${batch_id} 完成, status=${finalStatus}, failed=${failedCount}/${totalCount}`);
      return NextResponse.json({ ok: true, done: true, status: finalStatus });
    }

    // 2. 标记所有取到的任务为 running
    const taskIds = pendingTasks.map(t => t.id);
    await supabase.from('batch_search_tasks').update({
      status: 'running',
      started_at: new Date().toISOString(),
    }).in('id', taskIds);

    await supabase.from('batch_search_jobs').update({
      status: 'running',
    }).eq('id', batch_id);

    console.log(`[BatchSearch] 并发启动 ${pendingTasks.length} 条: batch=${batch_id}, names=[${pendingTasks.map(t => t.talent_name).join(', ')}]`);

    // 3. 并发执行所有任务
    await Promise.allSettled(
      pendingTasks.map(task => processOneTask(task, batch_id))
    );

    // 4. 更新批次完成计数
    const { count: completedCount } = await supabase
      .from('batch_search_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batch_id)
      .in('status', ['done', 'failed']);

    await supabase.from('batch_search_jobs')
      .update({ completed_count: completedCount || 0 })
      .eq('id', batch_id);

    // 5. Fire-and-forget: 调用自己处理下一轮
    const selfUrl = new URL('/api/batch-web-search/process', request.url);
    fetch(selfUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id }),
    }).catch(e => console.error('[BatchSearch] 链式调用失败:', e));

    return NextResponse.json({ ok: true, processed: taskIds });

  } catch (error: any) {
    console.error('[BatchSearch/process] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * 处理单条任务（提取为独立函数，方便并发调用）
 */
async function processOneTask(task: any, batch_id: number) {
  const logs: { step: string; message: string }[] = [];
  let aiReport = '';
  let rawData: Record<string, any> | null = null;

  try {
    console.log(`[BatchSearch] 开始: task=${task.id}, name="${task.talent_name}"`);

    const stream = await runTalentWebSearchStream(
      task.talent_name,
      task.institution || '',
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

    // 保存到人才日志
    if (rawData?.gatheredData) {
      try {
        await talentJournal.saveTalentData(
          rawData.talentName || task.talent_name,
          rawData.institution || task.institution || '',
          rawData.gatheredData,
          aiReport,
          undefined,
          'batch_web_search',
        );
      } catch (e) {
        console.error(`[BatchSearch] 人才日志保存失败:`, e);
      }
    }

    // 标记完成
    await supabase.from('batch_search_tasks').update({
      status: 'done',
      logs: JSON.stringify(logs),
      ai_report: aiReport,
      completed_at: new Date().toISOString(),
    }).eq('id', task.id);

    console.log(`[BatchSearch] 完成: task=${task.id}, name="${task.talent_name}", report=${aiReport.length}字`);

  } catch (taskErr: any) {
    console.error(`[BatchSearch] 任务失败: task=${task.id}`, taskErr);
    await supabase.from('batch_search_tasks').update({
      status: 'failed',
      logs: JSON.stringify(logs),
      error_message: taskErr.message || String(taskErr),
      completed_at: new Date().toISOString(),
    }).eq('id', task.id);
  }
}
