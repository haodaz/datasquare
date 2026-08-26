import { NextResponse } from 'next/server';

/**
 * GET /api/model — 返回当前使用的模型
 * POST /api/model — 前端设置模型（存到 cookie 供 SSR 读取）
 */
export async function POST(req: Request) {
  const { model } = await req.json();
  if (!model) return NextResponse.json({ error: 'Missing model' }, { status: 400 });

  const res = NextResponse.json({ ok: true, model });
  res.cookies.set('datasquare_model', model, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: false,
  });
  return res;
}

export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/datasquare_model=([^;]+)/);
  const model = match?.[1] || process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp';
  return NextResponse.json({ model });
}
