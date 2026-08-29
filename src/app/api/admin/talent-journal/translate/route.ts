import { NextResponse } from 'next/server';
import { getToken, checkIsAdmin } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import { MODEL_OPTIONS } from '@/lib/models';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const token = await getToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await checkIsAdmin(token);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { mcpId, modelId } = await req.json();
    if (!mcpId) return NextResponse.json({ error: 'Missing mcpId' }, { status: 400 });

    const config = MODEL_OPTIONS.find(m => m.id === modelId) || MODEL_OPTIONS[0];
    const apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing ${config.apiKeyEnv} environment variable for model ${config.label}`);

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

    // 3. 构造 Prompt — 结构化输出，严格对齐 Excel 字段
    const prompt = `你是一个专业的人才数据提取助手。请根据下方提供的人才源信息，提取并输出标准的结构化 JSON 数据。

要求：
1. 必须输出合法的 JSON，不要输出任何 Markdown 标记。
2. JSON 必须且只能包含以下 Key。如果源信息中没有对应内容，字符串填 ""，数字填 null。
3. 请将所有经历（如工作、教育、获奖）转换成简单的长文本格式，各段经历之间用分号 ";" 分隔。

{
  "first_name": "First Name (英文名名)",
  "last_name": "Last Name (英文名姓)",
  "name": "姓名 - 中文",
  "name_en": "姓名 - 英文",
  "gender": "性别 (男/女)",
  "birth_date": "出生日期 (YYYY-MM-DD)",
  "nationality": "国籍",
  "is_chinese": "是否华裔 (是/否)",
  "province": "籍贯 (省份)",
  "email": "电子邮箱",
  "brid": "BRID (基础研究科研人员标识)",
  "orcid": "ORCID",
  "researcher_id": "ResearcherID",
  "profile_link": "人才主页链接",
  "introduction": "简介 (一段精炼的个人介绍文本)",
  "research_field": "研究领域 / 突出贡献 (文本)",
  "bachelor_duration": "本科阶段时间 (开始年份-结束年份)",
  "bachelor_school": "本科院校",
  "bachelor_major": "本科专业",
  "master_duration": "硕士阶段时间",
  "master_school": "硕士院校",
  "master_major": "硕士专业",
  "phd_duration": "博士阶段时间",
  "phd_school": "博士院校",
  "phd_major": "博士专业",
  "work_current": "当前工作经历 (开始时间，单位名称，任职岗位)",
  "work_experiences": "过往工作经历 (每段返回：开始时间-结束时间，单位名称，任职岗位，工作内容。多段用;分隔)",
  "award_experiences": "获奖经历 (时间，奖项名称。多段用;分隔)"
}

【人才源信息】：
${sourceInfo}
`;

    // 4. 调用 AI
    const res = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: [{ role: 'user', content: prompt }],
        ...(config.supportsJsonMode ? { response_format: { type: 'json_object' } } : {})
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

    // 不再深度映射各个独立列（因为日志库不是最终库，结构化数据全部存进 structured_data JSONB 中）
    // 但保留基础标识列的更新，比如 ORCID、name_en 方便在日志列表展示
    if (structured_data.name) profileUpdate.name_cn = structured_data.name;
    if (structured_data.name_en) profileUpdate.name_en = structured_data.name_en;
    if (structured_data.gender) profileUpdate.gender = structured_data.gender;
    if (structured_data.orcid) profileUpdate.orcid_id = structured_data.orcid;
    if (structured_data.email) profileUpdate.email = structured_data.email;
    if (structured_data.profile_link) profileUpdate.homepage_url = structured_data.profile_link;
    if (structured_data.introduction) profileUpdate.bio_snippet = structured_data.introduction;

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
