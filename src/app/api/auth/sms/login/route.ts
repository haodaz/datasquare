import { NextRequest, NextResponse } from 'next/server';
import { mcpTools } from '@/lib/mcp/generated-tools';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const { mobile, code } = await request.json();
    const phone = String(mobile || '').trim();
    const c = String(code || '').trim();

    if (!phone || !c) {
      return NextResponse.json({ ok: false, error: '请输入手机号和验证码' }, { status: 400 });
    }

    const d = await mcpTools.userLoginByPhone({ 
      phone, 
      code: c, 
      autoRegister: true, 
      returnToken: true 
    });
    const token = d?.token
      || (d?.data as Record<string, unknown>)?.token
      || (d?.remoteResponse as Record<string, unknown>)?.token
      || (d?.result as Record<string, unknown>)?.token;

    if (!token || d?.error) {
      const rawErr = d?.error || (d?.remoteResponse as Record<string, unknown>)?.error || (d?.remoteResponse as Record<string, unknown>)?.message || '';
      const friendlyMsg = (!rawErr || rawErr === 'request failed') 
        ? '验证码错误或已过期，请重新获取' 
        : String(rawErr);
      
      return NextResponse.json({ ok: false, error: friendlyMsg });
    }

    const cookieStore = await cookies();
    cookieStore.set('zhiji_token', String(token), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    return NextResponse.json({ ok: true, displayName: phone });
  } catch (err: unknown) {
    console.error('[API-SMS-LOGIN] Error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg || '内部服务器错误' }, { status: 500 });
  }
}
