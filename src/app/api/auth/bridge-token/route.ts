import { NextResponse } from 'next/server';
import { getToken } from '@/lib/auth';

export async function GET(req: Request) {
  const token = await getToken(req);
  
  if (!token) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  
  return NextResponse.json({ ok: true, token });
}