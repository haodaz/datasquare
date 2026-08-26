import { NextRequest, NextResponse } from 'next/server';
import { mcpTools } from '@/lib/mcp/generated-tools';

export async function POST(request: NextRequest) {
  try {
    const { mobile, areaCode } = await request.json();
    const phone = String(mobile || '').trim();

    if (!phone) {
      return NextResponse.json({ ok: false, error: '请输入手机号' }, { status: 400 });
    }

    const payload: any = { phone };
    if (areaCode) payload.area_code = String(areaCode);

    const data = await mcpTools.userSendLoginSmsCode(payload);

    if (data?.status !== 200) {
      const rr = data?.error || data?.remoteResponse;
      const msg = (typeof rr === 'string' ? rr : ((rr as Record<string, unknown>)?.message || (rr as Record<string, unknown>)?.msg || (rr as Record<string, unknown>)?.error)) || '';
      return NextResponse.json({ ok: false, error: msg || '短信发送失败' });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[API-SMS-SEND] Error:', err);
    return NextResponse.json({ ok: false, error: err.message || '内部服务器错误' }, { status: 500 });
  }
}
