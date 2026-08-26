import { NextResponse } from 'next/server';
import { getToken, checkIsAdmin } from '@/lib/auth';
import { talentJournal } from '@/lib/supabase/talent-journal';

export async function POST(req: Request) {
  const token = await getToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = await checkIsAdmin(token);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { entry } = body;
  if (!entry || !entry.talent_name) {
    return NextResponse.json({ error: 'Invalid entry data' }, { status: 400 });
  }

  try {
    // 直接通过 Supabase 保存（不再走 MCP/平方）
    await talentJournal.saveTalentData(
      entry.talent_name,
      entry.institution || '',
      entry, // rawData
      entry.ai_report || '',
      token,
      'manual_merge',
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[TalentJournal] Merge save error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const token = await getToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = await checkIsAdmin(token);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const search = searchParams.get('search') || undefined;
  const sort = (searchParams.get('sort') as 'search_count' | 'last_searched' | 'name' | 'institution') || undefined;
  const sortOrder = (searchParams.get('sortOrder') as 'ascend' | 'descend') || 'descend';
  const verifiedOnly = searchParams.get('verified') === '1';
  const includeStats = searchParams.get('includeStats') === '1';

  try {
    const result = await talentJournal.listEntries({ token, offset, limit, search, sort, sortOrder, verifiedOnly });
    
    if (!includeStats) {
      return NextResponse.json({ ok: true, ...result });
    }
    const stats = await talentJournal.getGlobalStats({ token, search });
    return NextResponse.json({ ok: true, ...result, stats });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const token = await getToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = await checkIsAdmin(token);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { mcpId, verified, notes } = body;
  if (!mcpId) return NextResponse.json({ error: 'Missing mcpId' }, { status: 400 });

  try {
    const ok = await talentJournal.updateEntry(mcpId, { verified, notes }, token);
    return NextResponse.json({ ok });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const token = await getToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = await checkIsAdmin(token);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const mcpId = parseInt(searchParams.get('id') || '0', 10);
  if (!mcpId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const ok = await talentJournal.deleteEntry(mcpId, token);
    return NextResponse.json({ ok });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
