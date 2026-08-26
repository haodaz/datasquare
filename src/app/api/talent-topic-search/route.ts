import { NextResponse } from 'next/server';
import { runFindTalentsStream } from '@/lib/tools/findTalents';
import { getToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { topic, expandedTopics, institution, honors, limit } = body;
    if (!topic && !institution && !honors) {
      return NextResponse.json({ error: 'Missing search criteria' }, { status: 400 });
    }

    const token = await getToken(request);
    const stream = await runFindTalentsStream(topic, expandedTopics, institution, honors, parseInt(limit) || 10, token || undefined);

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });

  } catch (error: any) {
    console.error('[FindTalents] Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
