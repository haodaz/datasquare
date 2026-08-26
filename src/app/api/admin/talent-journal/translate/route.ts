import { NextResponse } from 'next/server';
import { getToken, checkIsAdmin } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const token = await getToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await checkIsAdmin(token);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { mcpId } = await req.json();
    if (!mcpId) return NextResponse.json({ error: 'Missing mcpId' }, { status: 400 });

    // 1. 从 Supabase 读取人才数据（entry + profile + source_data）
    const { data: entry, error: dbErr } = await supabase
      .from('talent_entries')
      .select('*, talent_profiles(*), talent_source_data(*)')
      .eq('id', Number(mcpId))
      .single();

    if (dbErr || !entry) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }

    // 提取 profile 和 source data
    const profile = Array.isArray(entry.talent_profiles) ? entry.talent_profiles[0] : entry.talent_profiles;
    const sourceData = entry.talent_source_data || [];

    // 2. 组装送给 AI 的信息
    const sourceInfo = `
姓名: ${entry.talent_name || ''}
英文名: ${entry.talent_name_en || profile?.name_en || ''}
机构: ${entry.institution || profile?.current_employer || ''}
就职单位: ${profile?.current_employer || ''}
职位: ${profile?.position || ''}
院系: ${profile?.department || ''}

AI分析报告:
${entry.ai_report || '(无)'}

百科简介: ${profile?.bio_snippet || ''}

ORCID ID: ${profile?.orcid_id || ''}

研究领域: ${(profile?.research_fields || []).join('、')}

学术指标: H-Index=${profile?.h_index || ''}, 引用数=${profile?.cited_by_count || ''}, 论文数=${profile?.works_count || ''}

数据来源: ${(entry.data_sources || []).join(', ')}

${sourceData.map((sd: any) => `--- ${sd.source_key} 原始数据 ---\n${JSON.stringify(sd.raw_data || {}, null, 2).substring(0, 1500)}`).join('\n\n')}
`;

    // 3. 构造 Prompt — 结构化输出，教育/工作经历为 list
    const prompt = `你是一个专业的人才数据提取助手。请根据下方提供的人才源信息，提取并输出标准的结构化 JSON 数据。

要求：
1. 必须输出合法的 JSON，不要输出任何 Markdown 标记。
2. JSON 必须且只能包含以下 Key。如果源信息中没有对应内容，字符串填 ""，数组填 []，数字填 null：

{
  "name_cn": "中文名",
  "name_en": "英文名（拼音或英文原名）",
  "gender": "性别（男/女/未知）",
  "nationality": "国籍",
  "orcid_id": "ORCID ID (格式 0000-0000-0000-0000)",
  "h_index": null,
  "institution": "当前所属机构（大学/公司名）",
  "position": "职称/职位（如教授、研究员等）",
  "department": "所属院系/部门",
  "research_fields": ["研究领域1", "研究领域2"],
  "email": "联系邮箱",
  "homepage_url": "个人主页链接",
  "bio_summary": "人物简介（100-200字精炼概括）",
  "education": [
    {
      "degree": "学位（博士/硕士/本科）",
      "school": "学校名称",
      "school_en": "学校英文名",
      "major": "专业",
      "start_year": null,
      "end_year": null
    }
  ],
  "work_history": [
    {
      "employer": "雇主/单位名称",
      "employer_en": "单位英文名",
      "position": "职位",
      "department": "部门",
      "start_year": null,
      "end_year": null,
      "is_current": false
    }
  ],
  "awards": ["获奖1", "获奖2"],
  "other_info": "其他重要信息（荣誉、专利、社会职务等，以文本形式汇总）"
}

注意：
- education 和 work_history 必须是数组，每条经历是一个对象
- 按时间倒序排列（最近的在前）
- start_year / end_year 是整数年份，未知填 null
- is_current 标记是否为当前职位
- bio_summary 请从 AI 报告和百科中提炼，不要直接复制，200字以内精准概括

【人才源信息】：
${sourceInfo}
`;

    // 4. 调用 AI
    const deepseekKey = process.env.DASHSCOPE_API_KEY;
    if (!deepseekKey) throw new Error('Missing DASHSCOPE_API_KEY');

    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deepseekKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI API Error: ${errText}`);
    }

    const aiData = await res.json();
    let jsonStr = aiData.choices[0].message.content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json\n/, '').replace(/\n```$/, '');
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    
    let structured_data: Record<string, any> = {};
    try {
      structured_data = JSON.parse(jsonStr);
    } catch(e) {
      throw new Error('AI 返回的格式不是合法的 JSON');
    }

    // 5. 写回 talent_profiles（映射新格式的字段）
    const profileUpdate: Record<string, any> = {
      talent_entry_id: Number(mcpId),
      updated_at: new Date().toISOString(),
    };

    // 直接映射字段
    if (structured_data.name_cn) profileUpdate.name_cn = structured_data.name_cn;
    if (structured_data.name_en) profileUpdate.name_en = structured_data.name_en;
    if (structured_data.gender) profileUpdate.gender = structured_data.gender;
    if (structured_data.nationality) profileUpdate.nationality = structured_data.nationality;
    if (structured_data.orcid_id) profileUpdate.orcid_id = structured_data.orcid_id;
    if (structured_data.h_index) profileUpdate.h_index = structured_data.h_index;
    if (structured_data.institution) profileUpdate.current_employer = structured_data.institution;
    if (structured_data.position) profileUpdate.position = structured_data.position;
    if (structured_data.department) profileUpdate.department = structured_data.department;
    if (structured_data.email) profileUpdate.email = structured_data.email;
    if (structured_data.homepage_url) profileUpdate.homepage_url = structured_data.homepage_url;
    if (structured_data.bio_summary) profileUpdate.bio_snippet = structured_data.bio_summary;
    if (structured_data.other_info) profileUpdate.other_info = structured_data.other_info;

    // 数组字段
    if (Array.isArray(structured_data.research_fields) && structured_data.research_fields.length > 0) {
      profileUpdate.research_fields = structured_data.research_fields;
    }
    if (Array.isArray(structured_data.awards) && structured_data.awards.length > 0) {
      profileUpdate.awards = JSON.stringify(structured_data.awards);
    }

    // 子实体（以 JSONB 形式存储）
    if (Array.isArray(structured_data.education) && structured_data.education.length > 0) {
      profileUpdate.education_raw = JSON.stringify(structured_data.education);
    }
    if (Array.isArray(structured_data.work_history) && structured_data.work_history.length > 0) {
      profileUpdate.work_history = JSON.stringify(structured_data.work_history);
    }

    const { error: profileErr } = await supabase
      .from('talent_profiles')
      .upsert(profileUpdate, { onConflict: 'talent_entry_id' });

    if (profileErr) {
      console.error('[Translate] Profile upsert error:', profileErr.message);
    }

    return NextResponse.json({ ok: true, structured_data });
  } catch (e: any) {
    console.error('[Translate] Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
