import { NextResponse } from 'next/server';
import { getToken, checkIsAdmin } from '@/lib/auth';
import { talentJournal } from '@/lib/mcp/talent-journal';

export async function GET(req: Request) {
  const token = await getToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = await checkIsAdmin(token);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  // 批量导出：逗号分隔的 mcp id 列表
  const idsParam = searchParams.get('ids');
  const ids = idsParam
    ? idsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
    : undefined;

  try {
    const csv = await talentJournal.exportCSV({ token, search, ids });
    const suffix = ids && ids.length > 0 ? `selected_${ids.length}` : 'all';
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="talent_journal_${suffix}_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
