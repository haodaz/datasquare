import { mcpToolsDataPlatform } from '@/lib/mcp/generated-tools';
import { searchWeb } from '@/lib/search';
import { policyJournal } from '@/lib/mcp/policy-journal';
import OpenAI from 'openai';

function getOpenAIClient() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');
  return new OpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
}

/**
 * 政策检索流式引擎
 * 三阶段：平方库检索 → 全网搜索（始终执行）→ AI 组装报告
 *
 * ⚠️ 平方库数据特征（影响搜索策略）：
 *   - VSDIndustryPolicy: 产业政策（name, content, policy_keywords, theme, publish_organization 是安全文本字段）
 *   - VSDInstitutePolicy: 高校政策（name, content, source, school_department 是安全文本字段）
 *   - region / city / province 是数组字段 → 绝对不能在 condition 中使用
 *   - policy_level: 'region' | 'country' — 文本字段，可以精确匹配
 *   - type: 'policy_interpretation' | 'management_regulation' | 'planning_document' | 'notice' — 文本字段
 */
export async function runPolicySearchStream(
  topic: string,
  region: string = '',
  policyLevel: string = '',
  policyType: string = '',
  userProfile: string = '',
  limit: number = 15,
  userToken?: string
): Promise<ReadableStream> {
  const encoder = new TextEncoder();
  const token = userToken || process.env.VISIONSQUARE_AUTH_BEARER;

  return new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: any) => {
        controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type, data }) + '\n\n'));
      };

      try {
        let gatheredData: any = { industryPolicies: [], institutePolicies: [] };

        // --- 提取关键词 ---
        const cleanTopic = topic.trim();
        const primaryKeywords = cleanTopic ? cleanTopic.split(/[,，\s]+/).filter(k => k.trim().length > 0) : [];

        const criteriaParts = [];
        if (topic) criteriaParts.push(`主题:${topic}`);
        if (region) criteriaParts.push(`地区:${region}`);
        if (policyLevel) criteriaParts.push(`级别:${policyLevel}`);
        if (policyType) criteriaParts.push(`类型:${policyType}`);
        const criteriaStr = criteriaParts.join(' | ');

        // ═══════════════════════════════════════════════════════════════
        // 阶段 1: 平方库检索（VSDIndustryPolicy + VSDInstitutePolicy）
        // ═══════════════════════════════════════════════════════════════
        sendEvent('log', { step: '🔍 [第一阶段] 正在检索平方政策库...', message: `查询条件: ${criteriaStr}` });

        const start1 = Date.now();
        const effectiveKeywords = primaryKeywords.slice(0, 3); // 限制3个关键词，避免叶子爆炸

        // --- 1a. 搜 VSDIndustryPolicy（产业政策）---
        let industryPolicies: any[] = [];
        if (effectiveKeywords.length > 0 || region || policyLevel || policyType) {
          try {
            const rootChildren: any[] = [];

            // 主题关键词条件（OR 组）
            if (effectiveKeywords.length > 0) {
              const topicLeaves: any[] = [];
              for (const kw of effectiveKeywords) {
                topicLeaves.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${kw}%` } });
                topicLeaves.push({ leaf: { field: 'content', comparator: 'ilike', value: `%${kw}%` } });
                topicLeaves.push({ leaf: { field: 'policy_keywords', comparator: 'ilike', value: `%${kw}%` } });
                topicLeaves.push({ leaf: { field: 'theme', comparator: 'ilike', value: `%${kw}%` } });
                topicLeaves.push({ leaf: { field: 'publish_organization', comparator: 'ilike', value: `%${kw}%` } });
              }
              rootChildren.push({ logic_operator: '|', children: topicLeaves });
            }

            // 地区关键词（只能搜 publish_organization，因为 region/province/city 都是数组字段）
            if (region.trim()) {
              const regionKws = region.split(/[,，\s]+/).filter(k => k.trim());
              const regionLeaves: any[] = [];
              for (const kw of regionKws) {
                regionLeaves.push({ leaf: { field: 'publish_organization', comparator: 'ilike', value: `%${kw}%` } });
                regionLeaves.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${kw}%` } });
                regionLeaves.push({ leaf: { field: 'content', comparator: 'ilike', value: `%${kw}%` } });
              }
              rootChildren.push({ logic_operator: '|', children: regionLeaves });
            }

            // 政策级别（精确匹配）
            if (policyLevel.trim()) {
              rootChildren.push({ logic_operator: '|', children: [
                { leaf: { field: 'policy_level', comparator: '=', value: policyLevel.trim() } }
              ]});
            }

            // 政策类型（精确匹配）
            if (policyType.trim()) {
              rootChildren.push({ logic_operator: '|', children: [
                { leaf: { field: 'type', comparator: '=', value: policyType.trim() } }
              ]});
            }

            if (rootChildren.length > 0) {
              const conditionJson = JSON.stringify({ logic_operator: '&', children: rootChildren });
              console.log(`[PolicySearch] IndustryPolicy condition 叶子数: ${rootChildren.reduce((a, g) => a + (g.children?.length || 0), 0)}`);

              const res = await mcpToolsDataPlatform.dashGenericSearch({
                model: 'VSDIndustryPolicy',
                condition: conditionJson,
                fields: ['id', 'name', 'type', 'label', 'policy_level', 'publish_organization', 'publish_date', 'official_link', 'remarks', 'theme', 'policy_keywords', 'content'],
                limit: Math.min(limit, 20),
              }, token);
              industryPolicies = (res.items || []) as any[];
            }
          } catch (e: any) {
            console.warn('[PolicySearch] IndustryPolicy search failed:', e.message);
          }
        }

        // --- 1b. 搜 VSDInstitutePolicy（高校政策）---
        let institutePolicies: any[] = [];
        if (effectiveKeywords.length > 0) {
          try {
            const topicLeaves: any[] = [];
            for (const kw of effectiveKeywords) {
              topicLeaves.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${kw}%` } });
              topicLeaves.push({ leaf: { field: 'content', comparator: 'ilike', value: `%${kw}%` } });
              topicLeaves.push({ leaf: { field: 'source', comparator: 'ilike', value: `%${kw}%` } });
            }
            const conditionJson = JSON.stringify({ logic_operator: '&', children: [{ logic_operator: '|', children: topicLeaves }] });
            console.log(`[PolicySearch] InstitutePolicy condition 叶子数: ${topicLeaves.length}`);

            const res = await mcpToolsDataPlatform.dashGenericSearch({
              model: 'VSDInstitutePolicy',
              condition: conditionJson,
              fields: ['id', 'name', 'type', 'label', 'source', 'source_publish_date', 'official_link', 'school_department', 'content', 'gaokao_enrollment_rule'],
              limit: Math.min(limit, 10),
            }, token);
            institutePolicies = (res.items || []) as any[];
          } catch (e: any) {
            console.warn('[PolicySearch] InstitutePolicy search failed:', e.message);
          }
        }

        // 截断 content 字段，防止超过 AI 模型 131072 token 限制
        const truncateField = (items: any[], field: string, maxLen: number) => {
          for (const item of items) {
            if (item[field] && typeof item[field] === 'string' && item[field].length > maxLen) {
              item[field] = item[field].substring(0, maxLen) + '...(已截断)';
            }
          }
        };
        truncateField(industryPolicies, 'content', 500);
        truncateField(industryPolicies, 'remarks', 300);
        truncateField(institutePolicies, 'content', 500);

        gatheredData.industryPolicies = industryPolicies;
        gatheredData.institutePolicies = institutePolicies;
        const totalPingfang = industryPolicies.length + institutePolicies.length;
        const elapsed1 = Date.now() - start1;

        if (totalPingfang > 0) {
          sendEvent('log', { step: '✅ [第一阶段完成]', message: `耗时 ${elapsed1}ms。产业政策 ${industryPolicies.length} 条 + 高校政策 ${institutePolicies.length} 条，共 ${totalPingfang} 条。` });
        } else {
          sendEvent('log', { step: '⚠️ [第一阶段完成]', message: `耗时 ${elapsed1}ms。平方库未命中任何政策，将依赖互联网搜索。` });
        }

        // ═══════════════════════════════════════════════════════════════
        // 阶段 2: 全网搜索（始终执行，平方数据不全）
        // ═══════════════════════════════════════════════════════════════
        sendEvent('log', { step: '🌐 [第二阶段] 正在检索全网引擎...', message: `查询条件: ${topic} ${region} 政策` });

        try {
          const start2 = Date.now();
          const webQuery = userProfile
            ? `${topic} ${region} 人才补贴 引进政策 博士 申报条件 补贴标准`.trim()
            : `${topic} ${region} 政策 文件 通知 最新`.trim();
          const webRes = await searchWeb(webQuery);
          const elapsed2 = Date.now() - start2;

          if (webRes && (webRes.AbstractText || (webRes.RelatedTopics && webRes.RelatedTopics.length > 0))) {
            gatheredData['internet_search'] = {
              heading: webRes.Heading,
              abstract: webRes.AbstractText,
              url: webRes.AbstractURL,
              related: webRes.RelatedTopics?.slice(0, 8) || []
            };
            sendEvent('log', { step: '✅ [第二阶段完成]', message: `耗时 ${elapsed2}ms。成功从全网抓取到相关政策信息。` });
          } else {
            sendEvent('log', { step: '⚠️ [第二阶段结束]', message: `全网检索未找到明显关联信息。` });
          }
        } catch (webErr: any) {
          sendEvent('log', { step: '❌ [第二阶段异常]', message: `全网检索失败: ${webErr.message}` });
        }

        // ═══════════════════════════════════════════════════════════════
        // 阶段 3: AI 组装报告
        // ═══════════════════════════════════════════════════════════════
        sendEvent('log', { step: '🧠 [第三阶段] 数据收集完毕', message: `开始交由大模型评估与组装政策分析报告...` });

        const profileBlock = userProfile ? `\n【用户个人背景】\n${userProfile}\n⚠️ 重要：用户提供了个人背景信息，你必须基于这些背景做 **资格匹配分析**：\n- 分析用户是否符合每条政策的申报条件（年龄、学历、海外经历、成果等）\n- 明确标注"✅ 高度匹配""⚠️ 待确认""❌ 不符合"\n- 给出具体的补贴金额、落户条件等待遇数字` : '';

        const taskBlock = userProfile
          ? `⚠️ **核心原则：个性化匹配报告**
1. **分层推荐**：按"国家级人才项目（优先级最高）""一线城市政策""新一线/二线城市政策"三个层级组织输出。
2. **资格匹配分析**：对每条政策，必须列出关键门槛（年龄、学历、工作经历、海外经历等），并与用户背景逐项比对，标注匹配度。
3. **补贴明细**：每条政策必须列出具体的资金/补贴/落户等待遇数字。
4. **对比表格**：如果有多个城市的类似政策，请用表格对比各城市的政策差异（落户条件、补贴金额、政策特点等）。
5. **结论与建议**：最后给出综合建议，推荐用户优先关注哪些政策/城市。
【格式约束】
- 纯 Markdown 输出，可以使用表格。
- 每条政策必须标注匹配度：✅ 高度匹配 / ⚠️ 待确认 / ❌ 不符合
- 如果所有检索都没找到结果，委婉告知并建议调整关键词。`
          : `⚠️ **核心原则**
1. **综合排序，择优推荐**：将所有数据源的政策打散，按与用户需求的相关度统一排序。排序优先级：① 相关性；② 时效性；③ 政策级别。
2. **信息翔实，深度解读**：每条政策至少 200 字，充分利用 content、remarks、policy_keywords 等字段。如果有 content 字段，必须提取核心条款并深度解读。
每条政策需要提供：政策名称与基本信息、核心内容解读、适用对象与影响、关键词/主题标签、与用户查询的关联度说明。
【格式约束】
- 纯 Markdown 输出。
  ### 1. [政策名称]
  > **发布机构**：xxx | **发布日期**：xxx | **政策级别**：xxx
  **核心内容**：（深度解读）
  ---
- 如果所有检索都没找到结果，委婉告知并建议调整关键词。`;

        const assemblePrompt = `你是一位资深的政策研究分析师，擅长解读国家及地方政策文件${userProfile ? '，并能结合用户的个人背景做精准的资格匹配分析' : ''}。
用户的查询条件：
- 核心政策主题/关键词: "${topic}"
${region ? `- 限定地区: "${region}"` : ''}
${policyLevel ? `- 限定政策级别: "${policyLevel === 'country' ? '国家级' : '地方级'}"` : ''}
${policyType ? `- 限定政策类型: "${policyType}"` : ''}
${profileBlock}

【数据源信息】
以下是通过 **平方数据工作台（结构化政策库）** 和 **全网搜索引擎** 两个渠道检索到的政策数据（JSON 格式）。
⚠️ 注意：平方库数据可能不全，互联网搜索的数据同样重要，请 **平等对待** 两个数据源。
\`\`\`json
${JSON.stringify(gatheredData, null, 2)}
\`\`\`

【任务要求】
请你基于上述 **所有** 数据源，为用户输出一份 **信息翔实、结构清晰** 的政策分析报告。

${taskBlock}
`;

        const client = getOpenAIClient();
        const aiStream = await client.chat.completions.create({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
          messages: [{ role: 'user', content: assemblePrompt }],
          stream: true,
            max_tokens: 8192,
        });

        for await (const chunk of aiStream) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) {
            sendEvent('ai_chunk', text);
          }
        }

        sendEvent('raw_data', { gatheredData, searchCondition: topic });

        // ── 政策日志：fire-and-forget 保存每条政策 ──
        const pjTrigger = 'tools_tester';
        // 平方产业政策
        for (const p of (gatheredData.industryPolicies || [])) {
          if (!p.name) continue;
          policyJournal.savePolicyData(p.name, p.publish_organization || '', {
            policy_level: p.policy_level,
            policy_type: p.type,
            region: p.region || '',
            publish_date: p.publish_date,
            official_link: p.official_link,
            content_summary: (p.content || '').substring(0, 500),
            policy_keywords: p.policy_keywords ? (Array.isArray(p.policy_keywords) ? p.policy_keywords : [p.policy_keywords]) : [],
            theme: p.theme,
            data_sources: ['pingfang_industry'],
          }, cleanTopic, pjTrigger).catch(e => console.error('[PolicyJournal] save industry failed:', e.message));
        }
        // 平方高校政策
        for (const p of (gatheredData.institutePolicies || [])) {
          if (!p.name) continue;
          policyJournal.savePolicyData(p.name, p.source || '', {
            publish_date: p.source_publish_date,
            official_link: p.official_link,
            content_summary: (p.content || '').substring(0, 500),
            data_sources: ['pingfang_institute'],
          }, cleanTopic, pjTrigger).catch(e => console.error('[PolicyJournal] save institute failed:', e.message));
        }
        // 互联网搜索结果中提到的政策（从 related topics 提取）
        if (gatheredData.internet_search?.related) {
          for (const r of gatheredData.internet_search.related) {
            const text = r.Text || r.FirstURL || '';
            if (text.length > 10) {
              policyJournal.savePolicyData(text.substring(0, 100), '', {
                official_link: r.FirstURL || '',
                content_summary: text.substring(0, 500),
                data_sources: ['internet'],
              }, cleanTopic, pjTrigger).catch(e => console.error('[PolicyJournal] save internet failed:', e.message));
            }
          }
        }

        sendEvent('done', { message: '报告生成完毕' });
        controller.close();
      } catch (e: any) {
        sendEvent('error', { message: String(e.message || e) });
        controller.close();
      }
    }
  });
}
