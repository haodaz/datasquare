import { talentAuditService } from '@/lib/mcp/talent';
import { searchWeb } from '@/lib/search';
import OpenAI from 'openai';

function getOpenAIClient() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');
  return new OpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
}

export async function runFindTalentsStream(
  topic: string, 
  expandedTopics: string = '', 
  institution: string = '', 
  honors: string = '', 
  limit: number = 20, 
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
        let gatheredData: any = { pingfang: [] };
        let webFallbackResults: any = null;

        // --- 阶段 1: 核心词检索 ---
        const cleanTopic = topic.trim();
        const primaryKeywords = cleanTopic ? cleanTopic.split(/[,，\s]+/).filter(k => k.trim().length > 0) : [];
        const criteriaParts = [];
        if (topic) criteriaParts.push(`领域:${topic}`);
        if (institution) criteriaParts.push(`机构:${institution}`);
        if (honors) criteriaParts.push(`荣誉/标签:${honors}`);
        const criteriaStr = criteriaParts.join(' | ');

        sendEvent('log', { step: '🔍 [第一阶段] 正在检索平方库底座...', message: `查询条件: ${criteriaStr}` });
        
        const start1 = Date.now();
        let talents = await talentAuditService.searchTalentsByConditions(primaryKeywords, institution, honors, limit, token || undefined);
        const elapsed1 = Date.now() - start1;

        let finalExpandedTopics = expandedTopics;

        if (talents.length >= 3 || (!expandedTopics.trim() && !topic.trim())) {
          sendEvent('log', { step: '✅ [第一阶段完成]', message: `耗时 ${elapsed1}ms。找到 ${talents.length} 名匹配专家。` });
        } else {
          sendEvent('log', { step: '⚠️ [第一阶段不足]', message: `核心词仅命中 ${talents.length} 人，准备触发扩展检索...` });
          
          // --- 智能扩展词生成 ---
          if (!finalExpandedTopics.trim() && topic.trim()) {
            sendEvent('log', { step: '🧠 [智能扩展]', message: `未提供扩展词，系统正在调用大模型自动联想与 [${topic}] 相关的扩展概念...` });
            const aiClient = getOpenAIClient();
            try {
              const expRes = await aiClient.chat.completions.create({
                model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
                messages: [{ role: 'user', content: `请你根据核心概念 "${topic}"，联想出 3-5 个最相关的专业领域、近义词或子方向，用逗号分隔，不要输出任何其他解释性文字。` }],
                temperature: 0.3,
              });
              finalExpandedTopics = (expRes.choices[0]?.message?.content || '').replace(/\n/g, '').trim();
              sendEvent('log', { step: '✅ [智能扩展完成]', message: `AI 生成扩展词: ${finalExpandedTopics}` });
            } catch (e) {
              sendEvent('log', { step: '⚠️ [智能扩展异常]', message: `AI 联想词生成失败，跳过扩展检索。` });
            }
          }

          if (finalExpandedTopics.trim()) {
            // --- 阶段 1.5: 扩展词检索 ---
            const fallbackKeywords = finalExpandedTopics.split(/[,，\s]+/).filter(k => k.trim().length > 0);
            sendEvent('log', { step: '🔍 [第一阶段.5] 正在应用扩展概念检索...', message: `扩展概念: ${finalExpandedTopics}` });
            
            const start15 = Date.now();
            const fallbackTalents = await talentAuditService.searchTalentsByConditions(fallbackKeywords, institution, honors, limit, token || undefined);
            const elapsed15 = Date.now() - start15;
            
            // 合并去重
            const seenIds = new Set(talents.map(t => String(t.id)));
            let added = 0;
            for (const ft of fallbackTalents) {
              if (!seenIds.has(String(ft.id))) {
                talents.push(ft);
                seenIds.add(String(ft.id));
                added++;
              }
            }
            sendEvent('log', { step: `✅ [第一阶段.5完成]`, message: `耗时 ${elapsed15}ms。通过扩展词额外找到 ${added} 名专家（去重后共 ${talents.length} 人）。` });
          }
        }

        gatheredData.pingfang = talents;

        // --- 阶段 2: 全网搜索（始终执行，与平方库结果互补） ---
        sendEvent('log', { step: '🌐 [第二阶段] 正在检索全网引擎 (Aliyun/Bocha)...', message: `查询条件: ${topic} ${institution} ${honors}` });
        
        try {
          const start2 = Date.now();
          const webQuery = `${topic} ${institution} ${honors} 领域 专家 教授 学者`.trim();
          const webRes = await searchWeb(webQuery);
          const elapsed2 = Date.now() - start2;

          if (webRes && (webRes.AbstractText || (webRes.RelatedTopics && webRes.RelatedTopics.length > 0))) {
            webFallbackResults = {
              heading: webRes.Heading,
              abstract: webRes.AbstractText,
              url: webRes.AbstractURL,
              related: webRes.RelatedTopics?.slice(0, 5) || []
            };
            gatheredData['internet_search'] = webFallbackResults;
            sendEvent('log', { step: '✅ [第二阶段完成]', message: `耗时 ${elapsed2}ms。成功从全网抓取到相关网页摘要。` });
          } else {
            sendEvent('log', { step: '⚠️ [第二阶段结束]', message: `全网检索未找到明显关联信息。` });
          }
        } catch (webErr: any) {
          sendEvent('log', { step: '❌ [第二阶段异常]', message: `全网检索失败: ${webErr.message}` });
        }

        // --- 阶段 3: AI 组装报告 ---
        sendEvent('log', { step: '🧠 [第三阶段] 数据收集完毕', message: `开始交由大模型评估与组装推荐候选人报告...` });

        const assemblePrompt = `
你是一个顶级的智库研究员与专家猎头助手。用户希望寻找与特定条件/主题相关的专家。
用户的核心条件：
- 核心研究领域/意图: "${topic}"
${expandedTopics ? `- 相关的语义扩展概念: "${expandedTopics}"` : ''}
${institution ? `- 限定机构: "${institution}"` : ''}
${honors ? `- 限定荣誉/标签: "${honors}"` : ''}

【数据源信息】
以下是我通过 **平方数据工作台（结构化人才库）** 和 **全网搜索引擎** 两个渠道检索到的潜在专家候选人数据（JSON格式）。
⚠️ 注意：平方库 pingfang 数组中的每个对象包含了该专家的详细字段，请你 **充分利用** 所有可用信息。
\`\`\`json
${JSON.stringify(gatheredData, null, 2)}
\`\`\`

【任务要求 — 综合排序与翔实推荐】
请你基于上述 **所有** 数据源的候选人数据，为用户输出一份 **信息翔实、内容丰富** 的专家推荐报告。

⚠️ **核心原则**
1. **综合排序，择优推荐**：不要按数据源分组输出，而是将所有候选人打散，按与用户需求的匹配度统一排序。
   - 排序优先级：① 研究领域与用户查询的直接相关性；② 学术影响力与成就显著度；③ 数据完整度。
   - 如果同一个人在两个数据源中都出现，合并信息，不要重复列出。
2. **信息翔实，杜绝敷衍**：每位专家的介绍必须详尽充实（至少 150 字以上），充分利用数据源中的所有字段。
   - **绝不允许**只写一两句话就跳到下一个人！
   - 如果数据源提供了 introduction（人物简介）、research_field（研究领域描述）、notes 等长文本信息，**必须完整引用并加工呈现**，不要省略或过度浓缩。

你需要对每个推荐的候选人提供以下内容（每一项都要认真填写，不能跳过）：
1. **基本信息**：姓名（中英文）、现任机构、职位/头衔、国籍/所在地区、邮箱（如有）。
2. **研究领域与方向**：详细列出其研究方向，不要只写一个关键词，而是要展开描述。如果数据中有 research_field 长文本，提取并呈现核心内容。
3. **人物简介**：如果数据中有 introduction 字段，请充分利用，完整呈现其学术背景、职业履历、重要贡献。如果 introduction 为空，则基于其他字段（research_field, notes, talent_type 等）组织一段介绍。
4. **荣誉与成就**：如有 talent_type（如院士、长江学者等）或 talent_source_category 信息，要明确标注。
5. **推荐理由**：结合用户的核心查询条件，用 2-3 句话解释为什么这位专家是强匹配。

【格式约束】
- **纯 Markdown 输出**，直接输出正文。
- **排版要求**：
  ### 1. [专家姓名（中文/英文）] — [所在机构]
  > **职位**：xxx | **领域**：xxx | **荣誉**：xxx
  
  **研究方向**：（详细展开）
  
  **人物简介**：（充分利用 introduction 字段，至少 2-3 句话）
  
  **推荐理由**：（结合用户需求解释匹配度）
  
  ---
- 如果所有检索渠道都没有找到任何实质性数据，请委婉地告知用户并建议放宽搜索条件。
`;

        const client = getOpenAIClient();
        const aiStream = await client.chat.completions.create({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
          messages: [{ role: 'user', content: assemblePrompt }],
          stream: true,
        });

        for await (const chunk of aiStream) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) {
            sendEvent('ai_chunk', text);
          }
        }

        sendEvent('raw_data', { gatheredData, searchCondition: topic });
        sendEvent('done', { message: '报告生成完毕' });
        controller.close();
      } catch (e: any) {
        sendEvent('error', { message: String(e.message || e) });
        controller.close();
      }
    }
  });
}
