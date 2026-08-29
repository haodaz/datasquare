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
      .select('talent_entry_id, structured_data')
      .in('talent_entry_id', mcpIds);

    if (fetchErr) {
      console.error('获取待导入数据失败:', fetchErr);
      return NextResponse.json({ error: '获取待导入数据失败' }, { status: 500 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ error: '未找到可导入的数据' }, { status: 404 });
    }

    // 2. 将数据组装为实体库格式
    const entitiesToInsert = profiles.map(p => {
      const s = p.structured_data || {};
      return {
        // 源关联ID，用于追溯
        source_journal_id: p.talent_entry_id,
        
        // 映射所有的平面文本字段
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
        
        // 子实体映射 (确保是数组)
        educations: Array.isArray(s.educations) ? s.educations : [],
        work_experiences: Array.isArray(s.work_experiences) ? s.work_experiences : [],
        awards: Array.isArray(s.awards) ? s.awards : [],
        patents: Array.isArray(s.patents) ? s.patents : [],
        papers: Array.isArray(s.papers) ? s.papers : [],
        
        // 初始状态
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    // 3. 批量插入到独立的人才实体库表 'talent_db_entities'
    const { data: insertedRows, error: insertErr } = await supabase
      .from('talent_db_entities')
      .insert(entitiesToInsert)
      .select('id, source_journal_id');

    if (insertErr) {
      console.error('插入实体库失败:', insertErr);
      return NextResponse.json({ error: '插入实体库失败。请确认数据库中已创建 talent_db_entities 表。' }, { status: 500 });
    }

    // 4. 更新关联表状态
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

    return NextResponse.json({ ok: true, importedCount: entitiesToInsert.length });
  } catch (error: any) {
    console.error('Import DB error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
