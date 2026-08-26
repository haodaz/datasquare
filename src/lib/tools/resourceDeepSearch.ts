import { mcpToolsDataPlatform } from '@/lib/mcp/generated-tools';
import { ENTITY_FIELD_MAP } from '@/lib/mcp/entityContext';
import { searchWeb } from '@/lib/search';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

// ── 常量 ────────────────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  '科研耗材': 'research_consumables',
  '科研仪器': 'research_instruments',
  '科研试剂': 'research_reagents',
};

const TYPE_MAP_REVERSE: Record<string, string> = {
  research_consumables: '科研耗材',
  research_instruments: '科研仪器',
  research_reagents: '科研试剂',
};

/** 同义词表（硬编码，后续可考虑挪到管理后台配置） */
const SYNONYM_MAP: Record<string, string[]> = {
  '冰箱': ['冷藏箱', '冷藏柜', '低温箱', '冰柜', '保存箱'],
  '低温': ['冷冻', '冷藏'],
  '离心': ['离心机', '离心管'],
  '显微镜': ['显微'],
  '培养箱': ['孵化器', '恒温箱'],
  '检测': ['分析仪', '检测仪'],
  '加热': ['加热器', '水浴'],
  '光谱': ['光谱仪', '光度计'],
};

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function getOpenAIClient() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');
  return new OpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
}

/** 清洗温度符号和首尾 % */
function cleanValue(v: string): string {
  return v.replace(/℃|°C|°/g, '').replace(/^%|%$/g, '');
}

/** 智能改写：拆分子串 + 同义词，最多 5 个关键词 */
function smartRewrite(kws: string[]): string[] {
  const result = new Set<string>();
  for (const kw of kws) {
    const clean = kw.replace(/%/g, '');
    if (clean.length >= 2) result.add(clean);
    // 拆 2~3 字子串（最多取 4 个）
    const subs = new Set<string>();
    for (let len = Math.min(clean.length, 3); len >= 2; len--) {
      for (let i = 0; i + len <= clean.length; i++) {
        subs.add(clean.slice(i, i + len));
      }
    }
    Array.from(subs).slice(0, 4).forEach(s => result.add(s));
    // 同义词补全
    for (const [k, syns] of Object.entries(SYNONYM_MAP)) {
      if (clean.includes(k)) syns.forEach(s => result.add(s));
    }
  }
  return Array.from(result).slice(0, 5);
}

/**
 * 构建搜索条件
 * 按管理后台 entity-search 的方式：用 | (OR) 逻辑匹配 name 字段
 * 如果有 type/brand 过滤，用 & (AND) 包裹
 */
function buildCondition(
  query: string,
  resourceType?: string,
  brandFilter?: string,
): string {
  const nameClean = cleanValue(query.trim());
  const children: any[] = [];

  // name 模糊搜索（核心条件）
  children.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${nameClean}%` } });

  // type 精确匹配（可选）
  if (resourceType) {
    const enumVal = TYPE_MAP[resourceType] || resourceType;
    children.push({ leaf: { field: 'type', comparator: '=', value: enumVal } });
  }

  // brand_name 模糊匹配（可选）
  if (brandFilter) {
    children.push({ leaf: { field: 'brand_name', comparator: 'ilike', value: `%${cleanValue(brandFilter)}%` } });
  }

  // 只有 name 时用 |，有多条件时用 &
  return JSON.stringify({
    logic_operator: children.length > 1 ? '&' : '|',
    children,
  });
}

/**
 * 构建智能改写的 OR 条件（宽搜）
 */
function buildRewriteCondition(keywords: string[]): string {
  return JSON.stringify({
    logic_operator: '|',
    children: keywords.map(kw => ({
      leaf: { field: 'name', comparator: 'ilike', value: `%${kw}%` },
    })),
  });
}

// ── 主函数 ────────────────────────────────────────────────────────────────────

/**
 * 资源深度检索流式函数
 * @param query        用户输入的自然语言查询，如"低温冰箱"
 * @param resourceType 可选：科研仪器/科研耗材/科研试剂（中文）
 * @param brandFilter  可选：品牌过滤
 * @param token        可选：用户 bearer token（不传则用 mcpToolsDataPlatform 默认 token）
 */
export async function runResourceDeepSearchStream(
  query: string,
  resourceType?: string,
  brandFilter?: string,
  token?: string,
): Promise<ReadableStream> {
  if (!query) throw new Error('Missing query');

  const modelConfig = ENTITY_FIELD_MAP['VSDResearchMaterial'];
  if (!modelConfig) throw new Error('VSDResearchMaterial 未在 ENTITY_FIELD_MAP 中注册');

  return new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: any) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, data })}\n\n`));
      };

      try {
        // ── Stage 1：VSDResearchMaterial 主检索 ──────────────────────────────
        sendEvent('log', { step: 'search', message: `🔍 [第一阶段] 正在检索科研物资库: "${query}"...` });

        const conditionStr = buildCondition(query, resourceType, brandFilter);
        sendEvent('log', { step: 'search', message: `📋 搜索条件: ${conditionStr}` });

        // 用 dot notation 一步取完所有数据（包括供应商名称）
        // ⚠️ 注意：正确字段名是 supplier_id（不是 suppluer_id！之前 entityContext 里是拼写错误）
        const SEARCH_FIELDS = [
          'id', 'name', 'type', 'brand_name', 'specification',
          'supplier_id.name', 'supplier_id.city', 'supplier_id.official_website',
        ];

        // 多拉一些（50条），后续按数据丰富度排序挑最优的呈现
        let searchRes = await Promise.race([
          mcpToolsDataPlatform.dashGenericSearch({
            model: 'VSDResearchMaterial',
            condition: conditionStr,
            limit: 50,
            offset: 0,
            fields: SEARCH_FIELDS,
          }, token),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('VSDResearchMaterial 检索超时(15s)')), 15000)),
        ]).catch((e: any) => {
          sendEvent('log', { step: 'search', message: `⚠️ ${e.message}` });
          return null;
        });

        const initialCount = (searchRes as any)?.items?.length || 0;
        const initialTotal = (searchRes as any)?.total;
        sendEvent('log', { step: 'search', message: initialCount > 0
          ? `✅ 首次检索命中 ${initialCount} 条数据${initialTotal ? `（总计 ${initialTotal} 条）` : ''}`
          : `❌ 首次检索未命中任何数据` });

        // ── Stage 1.5：智能改写重试（0 条时） ──────────────────────────────
        let didRewrite = false;
        let rewriteKeywords: string[] = [];

        if (!searchRes || !(searchRes as any)?.items?.length) {
          const smartKws = smartRewrite([cleanValue(query)]);

          if (smartKws.length) {
            didRewrite = true;
            rewriteKeywords = smartKws;
            sendEvent('log', { step: 'rewrite', message: `🔄 [智能改写] 原始词未命中，扩展关键词: ${smartKws.join('、')}` });

            const rewriteRes = await mcpToolsDataPlatform.dashGenericSearch({
              model: 'VSDResearchMaterial',
              condition: buildRewriteCondition(smartKws),
              limit: 50,
              offset: 0,
              fields: SEARCH_FIELDS,
            }, token).catch(() => null);

            if ((rewriteRes as any)?.items?.length) {
              sendEvent('log', { step: 'rewrite', message: `✅ 智能改写命中 ${(rewriteRes as any).items.length} 条` });
              searchRes = rewriteRes;
            } else {
              sendEvent('log', { step: 'rewrite', message: `❌ 智能改写仍未命中` });
            }
          }
        }

        const allDetailItems: any[] = (searchRes as any)?.items || [];

        if (allDetailItems.length === 0) {
          sendEvent('log', { step: 'search', message: `⚠️ 最终未找到匹配的科研物资，跳过后续阶段。` });
          sendEvent('log', { step: 'ai_assemble', message: `🧠 [最终整合] 将通知大模型未找到数据...` });

          const client = getOpenAIClient();
          const aiStream = await client.chat.completions.create({
            model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
            messages: [{ role: 'user', content: `用户在科研物资库中搜索"${query}"${resourceType ? `（类型：${resourceType}）` : ''}${brandFilter ? `（品牌：${brandFilter}）` : ''}，但未找到匹配结果。${didRewrite ? `系统尝试了智能扩展搜索（关键词：${rewriteKeywords.join('、')}），仍未命中。` : ''}请用自然对话的语气告知用户结果，并给出建议（如换个关键词、缩小范围等）。简短即可，2-3 句话。` }],
            stream: true,
          });
          for await (const chunk of aiStream) {
            const text = chunk.choices[0]?.delta?.content || '';
            if (text) sendEvent('ai_chunk', text);
          }
          sendEvent('done', { message: '检索完毕' });
          controller.close();
          return;
        }

        // ── Stage 2：按丰富度排序 ──────────────────────────────────────────
        sendEvent('log', { step: 'relations', message: `🔗 [第二阶段] 对 ${allDetailItems.length} 条数据按字段完整度排序...` });

        // 按字段非空数评分排序（包含供应商字段）
        const RICHNESS_FIELDS = ['name', 'type', 'brand_name', 'specification', 'supplier_id.name'];
        const scoreItem = (item: any): number => {
          let filled = 0;
          for (const f of RICHNESS_FIELDS) {
            if (item[f] !== null && item[f] !== undefined && item[f] !== '') filled++;
          }
          return filled;
        };

        allDetailItems.sort((a: any, b: any) => scoreItem(b) - scoreItem(a));

        // 取丰富度最高的前 8 条
        const topItems = allDetailItems.slice(0, 8);
        const maxScore = topItems.length ? scoreItem(topItems[0]) : 0;
        const minScore = topItems.length ? scoreItem(topItems[topItems.length - 1]) : 0;
        const withSupplier = topItems.filter((i: any) => i['supplier_id.name']).length;
        sendEvent('log', { step: 'relations', message: `🏆 按字段完整度排序（满分 ${RICHNESS_FIELDS.length}），取前 ${topItems.length} 条（最高 ${maxScore}/${RICHNESS_FIELDS.length}，最低 ${minScore}/${RICHNESS_FIELDS.length}，${withSupplier} 条有供应商）` });

        // 附加中文类型
        for (const item of topItems) {
          item._type_cn = TYPE_MAP_REVERSE[item.type] || item.type || '';
        }

        // ── Stage 3：供应商深度检索（平方数据库 + 全网搜）──────────────────────
        // 3a. 提取去重供应商名称
        const uniqueSuppliers = [...new Set(
          topItems
            .map((i: any) => i['supplier_id.name'])
            .filter((n: any) => n && typeof n === 'string' && n.length > 1)
        )] as string[];

        const supplierDetails: Record<string, { crm?: any; web?: string }> = {};

        if (uniqueSuppliers.length > 0) {
          sendEvent('log', { step: 'supplier', message: `🏢 [第三阶段] 发现 ${uniqueSuppliers.length} 个供应商，正在深度检索...` });

          // 3b. 并行：平方 CRMCompany 查 + 全网搜
          await Promise.all(uniqueSuppliers.map(async (supplierName) => {
            supplierDetails[supplierName] = {};

            // ---- 平方数据库 CRMCompany 查询 ----
            try {
              const crmRes = await mcpToolsDataPlatform.dashGenericSearch({
                model: 'CRMCompany',
                condition: JSON.stringify({
                  logic_operator: '|',
                  children: [
                    { leaf: { field: 'name', comparator: 'ilike', value: `%${supplierName}%` } },
                    { leaf: { field: 'brief_name', comparator: 'ilike', value: `%${supplierName}%` } },
                  ],
                }),
                limit: 1,
                offset: 0,
                fields: ['id', 'name', 'brief_name', 'city', 'province', 'country', 'info_email', 'info_phone',
                         'official_website', 'business_range', 'legal_representative', 'registered_capital',
                         'one_sentence', 'introduction', 'kind'],
              }, token);
              if ((crmRes as any)?.items?.[0]) {
                supplierDetails[supplierName].crm = (crmRes as any).items[0];
                sendEvent('log', { step: 'supplier', message: `  ✅ ${supplierName}: 平方数据库命中` });
              }
            } catch { /* skip */ }

            // ---- 全网搜（Gemini Search Grounding → 降级 searchWeb/阿里云/Bocha）----
            try {
              let webFound = false;
              const geminiKey = process.env.GEMINI_API_KEY;
              if (geminiKey) {
                sendEvent('log', { step: 'supplier', message: `  🚀 ${supplierName}: 启动 Gemini Search Grounding...` });
                const genAI = new GoogleGenerativeAI(geminiKey);
                const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash', tools: [{ googleSearch: {} }] as any });
                const prompt = `请用 Google 搜索查找中国公司"${supplierName}"的信息。用中文回答，简要提供：主营业务、注册地、联系方式（如有）、在科研设备/耗材领域的口碑或特色。控制在 150 字以内。`;
                const result = await model.generateContent(prompt);
                const text = result.response.text();
                if (text && text.length > 20) {
                  supplierDetails[supplierName].web = text;
                  sendEvent('log', { step: 'supplier', message: `  ✅ ${supplierName}: Gemini 全网检索成功` });
                  webFound = true;
                }
              }

              if (!webFound) {
                sendEvent('log', { step: 'supplier', message: `  ⚠️ ${supplierName}: ${geminiKey ? 'Gemini 结果不足' : '未配置 Gemini'}，降级使用 阿里云/Bocha 综合检索...` });
                const webRes = await searchWeb(`${supplierName} 公司 科研设备 供应商`);
                if (webRes?.AbstractText && webRes.AbstractText.length > 20) {
                  supplierDetails[supplierName].web = webRes.AbstractText;
                  sendEvent('log', { step: 'supplier', message: `  ✅ ${supplierName}: 综合全网检索成功` });
                } else {
                  sendEvent('log', { step: 'supplier', message: `  ❌ ${supplierName}: 全网检索无有效信息` });
                }
              }
            } catch (e) {
              sendEvent('log', { step: 'supplier', message: `  ⚠️ ${supplierName}: Gemini 异常，降级 阿里云/Bocha...` });
              try {
                const webRes = await searchWeb(`${supplierName} 公司 科研设备 供应商`);
                if (webRes?.AbstractText && webRes.AbstractText.length > 20) {
                  supplierDetails[supplierName].web = webRes.AbstractText;
                  sendEvent('log', { step: 'supplier', message: `  ✅ ${supplierName}: Bocha 降级检索成功` });
                } else {
                  sendEvent('log', { step: 'supplier', message: `  ❌ ${supplierName}: 降级检索也无有效信息` });
                }
              } catch {
                sendEvent('log', { step: 'supplier', message: `  ❌ ${supplierName}: 全部检索渠道失败` });
              }
            }
          }));

          const crmHits = Object.values(supplierDetails).filter(d => d.crm).length;
          const webHits = Object.values(supplierDetails).filter(d => d.web).length;
          sendEvent('log', { step: 'supplier', message: `📊 供应商检索完成：${crmHits}/${uniqueSuppliers.length} 条有平方数据，${webHits}/${uniqueSuppliers.length} 条有全网数据` });
        } else {
          sendEvent('log', { step: 'supplier', message: `⏩ [第三阶段] 跳过（无关联供应商）` });
        }

        // 将供应商详情附加到 items 上
        for (const item of topItems) {
          const sn = item['supplier_id.name'];
          if (sn && supplierDetails[sn]) {
            item._supplierDetail = supplierDetails[sn];
          }
        }

        // ── Stage +1：AI Assemble 对话汇报 ──────────────────────────────────
        sendEvent('log', { step: 'ai_assemble', message: `🧠 [最终整合] 数据收集完毕，开始交由大模型组装汇报...` });

        const client = getOpenAIClient();

        const assemblePrompt = `你是一个科研物资检索助手。我已通过平方数据库和全网检索获得了以下科研物资数据及其供应商信息，请将它们整理为**自然对话风格的汇报**回应给用户。

【用户搜索】"${query}"${resourceType ? `（类型：${resourceType}）` : ''}${brandFilter ? `（品牌：${brandFilter}）` : ''}
${didRewrite ? `\n【搜索说明】原始搜索词"${query}"未精确命中，系统自动扩展搜索词为：${rewriteKeywords.join('、')}。请在回应开头自然地提示用户这一点。` : ''}

【输出格式要求（严格遵守）】

**Part 1：资源条目列表**
每条资源按条目卡片式呈现：
1. 主标题用 ### + emoji，格式为 SKU 特征（品牌-型号-资源名），例如：### 🧊 Thermo Fisher Digital 超低温冰箱
2. 下方用 **加粗字段名** + 冒号列举，一行一个字段：
   - **名称**：xxx
   - **类型**：xxx（用中文：research_instruments=科研仪器, research_consumables=科研耗材, research_reagents=科研试剂）
   - **品牌**：xxx
   - **规格/型号**：xxx
   - **供应商**：xxx（只写名称，详情在 Part 2）
3. 每条资源之间用 --- 分隔
4. 如果某个字段为空或无数据，直接跳过该字段，不要写"暂无"
5. 开头用一句话总结（如"为您找到以下 X 条相关低温冰箱资源："）

**Part 2：供应商档案（必须输出！不能省略！）**
在所有资源条目列完后，用 ## 🏢 供应商档案 作为标题，为每个涉及的供应商**单独写一个小节**：
- 标题格式：### 供应商名称
- 下方逐行列出（有什么写什么，从 _supplierDetail.crm 和 _supplierDetail.web 中提取）：
  - **公司全称**：xxx
  - **所在地**：xxx（省份+城市）
  - **官方网站**：xxx
  - **联系方式**：xxx（电话/邮箱）
  - **法定代表人**：xxx
  - **注册资本**：xxx
  - **经营范围**：xxx
  - **公司简介**：2-3 句话介绍（优先用 CRM 的 introduction/one_sentence，辅以全网检索摘要 _supplierDetail.web）
- ⚠️ 禁止只写一句"该供应商可信"之类的空话！必须给出具体信息！

**Part 3：结尾**
留一句引导语（如"如需进一步了解某个产品的详细参数或供应商报价，请告诉我。"）

【原始物资数据 JSON】
${JSON.stringify(topItems, null, 2)}

${uniqueSuppliers.length > 0 ? `【供应商深度数据 JSON（⚠️ 必须在 Part 2 中完整呈现这些数据！）】\n${JSON.stringify(supplierDetails, null, 2)}` : ''}

🚨 只输出纯 Markdown。字段映射：supplier_id.name=供应商名称，supplier_id.city=供应商城市，_supplierDetail.crm=平方数据库详情，_supplierDetail.web=全网检索摘要。`;

        const aiStream = await client.chat.completions.create({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
          messages: [{ role: 'user', content: assemblePrompt }],
          stream: true,
        });

        for await (const chunk of aiStream) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) sendEvent('ai_chunk', text);
        }

        sendEvent('log', { step: 'ai_assemble', message: `✅ 汇报生成完毕` });
        sendEvent('done', { message: '检索完毕' });
        controller.close();
      } catch (e) {
        sendEvent('error', { message: String(e) });
        controller.close();
      }
    },
  });
}
