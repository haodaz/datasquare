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
        bachelor_duration: s.bachelor_duration || '',
        bachelor_school: s.bachelor_school || '',
        bachelor_major: s.bachelor_major || '',
        master_duration: s.master_duration || '',
        master_school: s.master_school || '',
        master_major: s.master_major || '',
        phd_duration: s.phd_duration || '',
        phd_school: s.phd_school || '',
        phd_major: s.phd_major || '',
        work_current: s.work_current || '',
        work_experiences: s.work_experiences || '',
        award_experiences: s.award_experiences || '',
        
        // 初始状态
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    // 3. 批量插入到独立的人才实体库表 'talent_db_entities'
    const { error: insertErr } = await supabase
      .from('talent_db_entities')
      .insert(entitiesToInsert);

    if (insertErr) {
      console.error('插入实体库失败:', insertErr);
      // NOTE: 如果表不存在，这里会报错。请确保在 Supabase 创建了 talent_db_entities 表
      return NextResponse.json({ error: '插入实体库失败。请确认数据库中已创建 talent_db_entities 表。' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, importedCount: entitiesToInsert.length });
  } catch (error: any) {
    console.error('Import DB error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
