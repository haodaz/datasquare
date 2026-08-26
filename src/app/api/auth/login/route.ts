import { NextRequest, NextResponse } from 'next/server';
import { mcpTools } from '@/lib/mcp/generated-tools';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ ok: false, error: '请填写用户名和密码' }, { status: 400 });
    }

    const data = await mcpTools.authRequestLoginToken({ 
      account: String(username), 
      password: String(password) 
    });

    const status = data?.status;
    const token = data?.token;

    if (status === 200 && token) {
      const cookieStore = await cookies();
      cookieStore.set('zhiji_token', String(token), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60, // 30 days
        path: '/',
      });
      return NextResponse.json({ ok: true, displayName: username });
    }

    const rr = (data as Record<string, unknown>)?.error || (data as Record<string, unknown>)?.remoteResponse;
    const remoteMsg = (typeof rr === 'string' ? rr : ((rr as Record<string, unknown>)?.message || (rr as Record<string, unknown>)?.msg || (rr as Record<string, unknown>)?.error)) || '';
    const friendlyMsg = (!remoteMsg || remoteMsg === 'request failed') ? '用户名或密码不正确' : remoteMsg;
    return NextResponse.json({ ok: false, error: friendlyMsg });
  } catch (err: any) {
    console.error('[API-LOGIN] Error:', err);
    return NextResponse.json({ ok: false, error: err.message || '内部服务器错误' }, { status: 500 });
  }
}
