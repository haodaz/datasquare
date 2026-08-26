import { NextResponse } from 'next/server';
import { getToken, checkIsAdmin } from '@/lib/auth';
import { talentJournal } from '@/lib/mcp/talent-journal';
import { mcpTools } from '@/lib/mcp/generated-tools';
import { TalentJournalEntry } from '@/lib/mcp/talent-journal-shared';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const token = await getToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await checkIsAdmin(token);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { mcpId } = await req.json();
    if (!mcpId) return NextResponse.json({ error: 'Missing mcpId' }, { status: 400 });

    // 1. 读取原数据
    const existing = await mcpTools.dashGenericSearch({
      model: 'ZhiJiCompanionConfig',
      fields: ['id', 'data'],
      condition: JSON.stringify({ logic_operator: '&', children: [{ leaf: { field: 'id', comparator: '=', value: Number(mcpId) } }] }),
      limit: 1,
    }, token) as unknown as { items?: any[] };

    const item = existing?.items?.[0];
    if (!item) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const entry: TalentJournalEntry = JSON.parse(item.data || '{}');

    // 2. 组装送给 Deepseek 的信息
    const sourceInfo = `
名字: ${entry.talent_name}
英文名: ${entry.talent_name_en || ''}
机构: ${entry.institution || ''}
就职单位: ${entry.workplace || ''}
AI分析报告: ${entry.ai_report || ''}
百科简介: ${entry.bio_snippet || ''}
ORCID数据: ${JSON.stringify(entry.orcid_data || {})}
研究领域: ${(entry.research_fields || []).join('、')}
学术指标: H-Index=${entry.h_index || ''}, 引用=${entry.cited_by_count || ''}, 论文=${entry.works_count || ''}
`;

    // 3. 构造 Prompt
    const prompt = `你是一个专业的人才数据提取助手。请根据下方提供的人才源信息，提取并输出标准的结构化 JSON 数据。
    
要求：
1. 必须输出合法的 JSON，不要输出任何 Markdown 标记，不要包裹在 \`\`\`json 中。
2. JSON 必须且只能包含以下 Key，如果源信息中没有对应内容，请填 "" (空字符串)：
   - "姓名" (中文名)
   - "英文名"
   - "ORCID ID" (如果是完整的URL，请提取最后那段数字格式如 0000-0000-0000-0000)
   - "H-Index" (提取数字)
   - "现任机构" (大学或公司名)
   - "职称" (如教授、研究员等)
   - "主要研究领域" (用顿号、逗号隔开)
   - "联系邮箱"
   - "教育背景" (简述本科到博士等教育经历)
   - "工作经历" (简述历任职位)
   - "其他" (将无法归入上述字段的长文本、荣誉履历、专利等以标准文本形式塞入这里，保留关键信息，可稍微精简)

【人才源信息】：
${sourceInfo}
`;

    // 4. 调用 Deepseek (复用 Dashscope 接口)
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
      throw new Error(`Deepseek API Error: ${errText}`);
    }

    const aiData = await res.json();
    let jsonStr = aiData.choices[0].message.content.trim();
    if (jsonStr.startsWith('\`\`\`json')) {
      jsonStr = jsonStr.replace(/^\`\`\`json\n/, '').replace(/\n\`\`\`$/, '');
    }
    
    let structured_data = {};
    try {
      structured_data = JSON.parse(jsonStr);
    } catch(e) {
      throw new Error('AI 返回的格式不是合法的 JSON');
    }

    // 5. 保存到数据库
    await talentJournal.updateEntry(mcpId, { structured_data }, token);

    return NextResponse.json({ ok: true, structured_data });
  } catch (e: any) {
    console.error('Translation error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
