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
    const { tasks } = body;

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
      body: JSON.stringify({ batch_id: job.id }),
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
