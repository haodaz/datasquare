import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/lib/auth';
import { runResourceDeepSearchStream } from '@/lib/tools/resourceDeepSearch';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, resourceType, brand } = body;

    if (!query) {
      return NextResponse.json({ ok: false, error: 'Missing query' }, { status: 400 });
    }

    // 获取用户 token（和 entity-search 一致）
    const token = await getToken(request);

    const stream = await runResourceDeepSearchStream(query, resourceType, brand, token || undefined);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[ResourceDeepSearch] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
