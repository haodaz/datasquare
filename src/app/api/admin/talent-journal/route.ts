import { NextResponse } from 'next/server';
import { getToken, checkIsAdmin } from '@/lib/auth';
import { talentJournal } from '@/lib/mcp/talent-journal';
import { mcpTools } from '@/lib/mcp/generated-tools';

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
    const svcToken = process.env.VISIONSQUARE_AUTH_BEARER || process.env.FLORA_AUTH_BEARER || '';
    if (!svcToken) {
      return NextResponse.json({ error: '服务端 Token 未配置' }, { status: 500 });
    }
    
    // 生成一个独特的 external_id 避免覆盖普通查询
    const clean = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 60);
    const externalId = `tj_merged_${clean(entry.talent_name)}_${Date.now()}`;
    
    // 清除内部大字段，防止 JSON 序列化问题（与 saveTalentData 保持一致）
    delete entry._mcp_id;
    delete entry._raw;
    delete entry.id;  // 防止意外更新现有记录
    delete entry.merged;  // 前端标记字段，不需要保存
    if (entry.texts) {
      entry.texts = [];  // 清空原始搜索文本
    }
    
    // 记录保存前的数据大小
    const dataStr = JSON.stringify(entry);
    console.log(`[TalentJournal] Merge data size: ${dataStr.length} chars for "${entry.talent_name}"`);
    console.log(`[TalentJournal] Merge entry keys:`, Object.keys(entry));
    // 检查每个字段的类型
    for (const key of Object.keys(entry)) {
      const val = (entry as any)[key];
      const type = Array.isArray(val) ? `array(${val.length})` : typeof val;
      const size = typeof val === 'string' ? val.length : JSON.stringify(val)?.length || 0;
      console.log(`[TalentJournal] Merge field "${key}": type=${type}, size=${size}`);
    }

    // 使用用户 token 保存（与 saveTalentData 保持一致，用户 token 能确保数据隔离正确）
    const result = await mcpTools.dashGenericSave({
      model: 'ZhiJiCompanionConfig',
      values: JSON.stringify({
        flora_external_id: externalId,
        name: entry.talent_name,
        data: dataStr,
      }),
    }, token) as unknown as { status?: number | string; error?: string; id?: number };

    console.log('[TalentJournal] Merge save raw result:', JSON.stringify(result));

    // 校验保存结果（与 saveTalentData 保持一致）
    const statusNum = typeof result?.status === 'string' ? parseInt(result.status, 10) : result?.status;
    if (result?.error) {
      console.error('[TalentJournal] Merge save FAILED:', result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    if (statusNum !== undefined && statusNum !== 200) {
      console.error('[TalentJournal] Merge save FAILED: status=', statusNum);
      return NextResponse.json({ error: `保存失败 (status=${statusNum})` }, { status: 500 });
    }

    console.log('[TalentJournal] Merge save SUCCESS:', entry.talent_name, 'id:', result?.id);
    
    // 验证保存结果：使用相同的用户 token 查询刚创建的记录
    try {
      const verifyResult = await mcpTools.dashGenericSearch({
        model: 'ZhiJiCompanionConfig',
        fields: ['id', 'flora_external_id', 'name', 'data'],
        condition: JSON.stringify({
          logic_operator: '&',
          children: [
            { leaf: { field: 'flora_external_id', comparator: 'eq', value: externalId } },
          ],
        }),
        limit: 1,
        offset: 0,
      }, token) as unknown as { items?: any[]; total?: number };
      console.log('[TalentJournal] Merge verify result:', JSON.stringify({
        total: verifyResult?.total,
        itemsCount: verifyResult?.items?.length,
        firstItem: verifyResult?.items?.[0] ? {
          id: verifyResult.items[0].id,
          name: verifyResult.items[0].name,
          flora_external_id: verifyResult.items[0].flora_external_id,
        } : null,
      }));
    } catch (verifyErr) {
      console.error('[TalentJournal] Merge verify FAILED:', verifyErr);
    }
    
    return NextResponse.json({ ok: true, id: result?.id });
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
    
    // DEBUG LOG
    console.log(`[DEBUG ADMIN API] search=${search}, returned items:`, result.items.map(i => i.talent_name));
    
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
