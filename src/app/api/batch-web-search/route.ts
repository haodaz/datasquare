import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { getToken, getUserIdFromToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST — 创建批量检索批次
 * Body: { tasks: [{ name: string, institution?: string }] }
 */
export async function POST(request: Request) {
  const token = await getToken(request);
  const userId = getUserIdFromToken(token) || 'anonymous';

  try {
    const body = await request.json();
    const { tasks, modelId } = body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return NextResponse.json({ error: '请至少添加一条检索任务' }, { status: 400 });
    }

    if (tasks.length > 100) {
      return NextResponse.json({ error: '单批次最多 100 条' }, { status: 400 });
    }

    // 1. 创建批次
    const { data: job, error: jobErr } = await supabase
      .from('batch_search_jobs')
      .insert({
        created_by: userId,
        status: 'pending',
        total_count: tasks.length,
        completed_count: 0,
      })
      .select('id')
      .single();

    if (jobErr || !job) {
      console.error('[BatchSearch] 创建批次失败:', jobErr);
      return NextResponse.json({ error: '创建批次失败' }, { status: 500 });
    }

    // 2. 创建任务
    const taskRows = tasks.map((t: { name: string; institution?: string }, i: number) => ({
      batch_id: job.id,
      seq: i + 1,
      talent_name: t.name.trim(),
      institution: (t.institution || '').trim(),
      status: 'pending',
    }));

    const { error: tasksErr } = await supabase
      .from('batch_search_tasks')
      .insert(taskRows);

    if (tasksErr) {
      console.error('[BatchSearch] 创建任务失败:', tasksErr);
      return NextResponse.json({ error: '创建任务失败' }, { status: 500 });
    }

    console.log(`[BatchSearch] 创建批次 ${job.id}，共 ${tasks.length} 条任务`);

    // 3. Fire-and-forget: 触发处理
    const processUrl = new URL('/api/batch-web-search/process', request.url);
    fetch(processUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id: job.id, modelId }),
    }).catch(e => console.error('[BatchSearch] 触发处理失败:', e));

    return NextResponse.json({ ok: true, batch_id: job.id });

  } catch (error: any) {
    console.error('[BatchSearch] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET — 查询批次状态
 * ?id=xxx → 单个批次详情（含所有任务）
 * 无 id → 该用户所有批次列表
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get('id');

  try {
    if (batchId) {
      // 查询单个批次 + 所有任务
      const { data: job, error: jobErr } = await supabase
        .from('batch_search_jobs')
        .select('*')
        .eq('id', parseInt(batchId))
        .single();

      if (jobErr || !job) {
        return NextResponse.json({ error: '批次不存在' }, { status: 404 });
      }

      const { data: tasks } = await supabase
        .from('batch_search_tasks')
        .select('*')
        .eq('batch_id', job.id)
        .order('seq', { ascending: true });

      // 实时计算完成数（而非依赖 completed_count 字段）
      const completedCount = (tasks || []).filter(t => t.status === 'done' || t.status === 'failed').length;

      return NextResponse.json({
        ok: true,
        job: { ...job, completed_count: completedCount },
        tasks: tasks || [],
      });
    } else {
      // 查询所有批次（最近 20 个）
      const { data: jobs } = await supabase
        .from('batch_search_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      return NextResponse.json({ ok: true, jobs: jobs || [] });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT — 批次操作
 * Body: { batch_id, action: 'terminate' | 'resume' | 'retry' }
 * - terminate: 终止卡住的批次（running → failed）
 * - resume: 从未成功的开始恢复（running + failed → pending，重新触发）
 * - retry: 仅重跑 failed 任务（向后兼容）
 */
export async function PUT(request: Request) {
  try {
    const { batch_id, action = 'retry' } = await request.json();
    if (!batch_id) {
      return NextResponse.json({ error: 'Missing batch_id' }, { status: 400 });
    }

    if (action === 'terminate') {
      // 终止：把所有 running 任务标记为 failed
      await supabase
        .from('batch_search_tasks')
        .update({
          status: 'failed',
          error_message: '用户手动终止',
          completed_at: new Date().toISOString(),
        })
        .eq('batch_id', batch_id)
        .eq('status', 'running');

      // 把所有 pending 也标记为 failed（停止后续执行）
      await supabase
        .from('batch_search_tasks')
        .update({
          status: 'failed',
          error_message: '批次已终止',
        })
        .eq('batch_id', batch_id)
        .eq('status', 'pending');

      // 更新批次状态
      const { count: failedCount } = await supabase
        .from('batch_search_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch_id)
        .eq('status', 'failed');

      const { count: totalCount } = await supabase
        .from('batch_search_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch_id);

      const finalStatus = (failedCount === totalCount) ? 'failed' : 'partial';

      await supabase.from('batch_search_jobs').update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
      }).eq('id', batch_id);

      console.log(`[BatchSearch] 终止批次 ${batch_id}`);
      return NextResponse.json({ ok: true, action: 'terminated' });
    }

    // resume: 重置 running + failed → pending
    // retry: 仅重置 failed → pending
    const statusesToReset = action === 'resume' ? ['running', 'failed'] : ['failed'];

    await supabase
      .from('batch_search_tasks')
      .update({
        status: 'pending',
        logs: '[]',
        ai_report: '',
        error_message: null,
        started_at: null,
        completed_at: null,
      })
      .eq('batch_id', batch_id)
      .in('status', statusesToReset);

    // 更新批次状态为 running
    await supabase.from('batch_search_jobs').update({
      status: 'running',
      completed_at: null,
    }).eq('id', batch_id);

    // 触发处理
    const processUrl = new URL('/api/batch-web-search/process', request.url);
    fetch(processUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id }),
    }).catch(e => console.error('[BatchSearch] 触发失败:', e));

    console.log(`[BatchSearch] ${action} 批次 ${batch_id}`);
    return NextResponse.json({ ok: true, action });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

