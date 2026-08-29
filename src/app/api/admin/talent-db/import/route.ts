import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export async function POST(request: Request) {
  try {
    const { mcpIds } = await request.json();

    if (!Array.isArray(mcpIds) || mcpIds.length === 0) {
      return NextResponse.json({ error: '无效的请求参数' }, { status: 400 });
    }

    // 1. 获取选中的人才日志及其转译数据
    const { data: profiles, error: fetchErr } = await supabase
      .from('talent_profiles')
      .select('talent_entry_id, structured_data, db_entity_id')
      .in('talent_entry_id', mcpIds);

    if (fetchErr) {
      console.error('获取待导入数据失败:', fetchErr);
      return NextResponse.json({ error: '获取待导入数据失败' }, { status: 500 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ error: '未找到可导入的数据' }, { status: 404 });
    }

    const toInsert: any[] = [];
    const toUpdate: any[] = [];

    // 2. 将数据组装为实体库格式
    profiles.forEach(p => {
      const s = p.structured_data || {};
      const entityData = {
        source_journal_id: p.talent_entry_id,
        first_name: s.first_name || '',
        last_name: s.last_name || '',
        name: s.name || '',
        name_en: s.name_en || '',
        gender: s.gender || '',
        birth_date: s.birth_date || null,
        nationality: s.nationality || '',
        is_chinese: s.is_chinese || '',
        province: s.province || '',
        email: s.email || '',
        brid: s.brid || '',
        orcid: s.orcid || '',
        researcher_id: s.researcher_id || '',
        profile_link: s.profile_link || '',
        introduction: s.introduction || '',
        research_field: s.research_field || '',
        work_current: s.work_current || '',
        educations: Array.isArray(s.educations) ? s.educations : [],
        work_experiences: Array.isArray(s.work_experiences) ? s.work_experiences : [],
        awards: Array.isArray(s.awards) ? s.awards : [],
        patents: Array.isArray(s.patents) ? s.patents : [],
        papers: Array.isArray(s.papers) ? s.papers : [],
        updated_at: new Date().toISOString()
      };

      if (p.db_entity_id) {
        toUpdate.push({ id: p.db_entity_id, ...entityData });
      } else {
        toInsert.push({ ...entityData, created_at: new Date().toISOString() });
      }
    });

    let insertedCount = 0;
    let updatedCount = 0;

    // 3. 批量插入新记录
    if (toInsert.length > 0) {
      const { data: insertedRows, error: insertErr } = await supabase
        .from('talent_db_entities')
        .insert(toInsert)
        .select('id, source_journal_id');

      if (insertErr) throw new Error('插入新实体失败: ' + insertErr.message);
      insertedCount = insertedRows?.length || 0;

      if (insertedRows && insertedRows.length > 0) {
        const entryIds = insertedRows.map(r => r.source_journal_id).filter(Boolean);
        if (entryIds.length > 0) {
          await supabase.from('talent_entries').update({ imported_to_db: true }).in('id', entryIds);
        }
        for (const row of insertedRows) {
          if (row.source_journal_id) {
            await supabase.from('talent_profiles').update({ db_entity_id: row.id }).eq('talent_entry_id', row.source_journal_id);
          }
        }
      }
    }

    // 4. 更新已有记录 (去重逻辑)
    if (toUpdate.length > 0) {
      for (const record of toUpdate) {
        const { id, ...updateData } = record;
        const { error: updateErr } = await supabase
          .from('talent_db_entities')
          .update(updateData)
          .eq('id', id);
        if (updateErr) console.error('更新实体失败:', updateErr);
        else updatedCount++;
      }
    }

    return NextResponse.json({ ok: true, importedCount: insertedCount + updatedCount, inserted: insertedCount, updated: updatedCount });
  } catch (error: any) {
    console.error('Import DB error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
