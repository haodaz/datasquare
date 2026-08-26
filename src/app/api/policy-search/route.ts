import { NextResponse } from 'next/server';
import { runPolicySearchStream } from '@/lib/tools/findPolicies';
import { getToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { topic, region, policyLevel, policyType, userProfile, limit } = body;
    if (!topic && !region) {
      return NextResponse.json({ error: 'Missing search criteria (topic or region required)' }, { status: 400 });
    }

    const token = await getToken(request);
    const stream = await runPolicySearchStream(topic, region, policyLevel, policyType, userProfile || '', parseInt(limit) || 15, token || undefined);

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });

  } catch (error: any) {
    console.error('[PolicySearch] Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
