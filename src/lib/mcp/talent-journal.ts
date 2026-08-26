/**
 * 人才日志 (Talent Journal) — 用户意图驱动的人才数据积累模块
 * 
 * 设计理念：用户在一答查人才时，AI 已经消耗了 token 从多渠道（平方/Scholar/Wiki/互联网）
 * 收集了数据。本模块将这些数据"零额外成本"地保存下来，形成需求驱动的人才数据库。
 * 同一个人被多次查询时，自动去重并 append 新字段，越查越完善。
 * 
 * 存储：复用 ZhiJiCompanionConfig 模型 + flora_external_id 前缀隔离
 * 
 * ⚠️ 共享类型 / 数据来源映射常量（前端也要用）已抽到 talent-journal-shared.ts，
 *    此文件保持纯服务端专用，可随意依赖 generated-tools / mcp 客户端。
 */

import { mcpTools } from '@/lib/mcp/generated-tools';
import type { TalentJournalEntry } from './talent-journal-shared';
import { DATA_SOURCE_LABEL, TRIGGER_TOOL_LABEL } from './talent-journal-shared';

export type { TalentJournalEntry } from './talent-journal-shared';
export { DATA_SOURCE_LABEL, formatDataSources as dataSourcesToLabel } from './talent-journal-shared';

/** 兼容旧调用：从本文件暴露相同的命名（之前是 dataSourcesToLabel，共享文件里已经叫 formatDataSources，兼容导出） */
import { formatDataSources } from './talent-journal-shared';
export { formatDataSources };

// ── 辅助函数 ─────────────────────────────────────────────────────────────

/** 服务端/系统级 Token：人才日志写入和查询不依赖当前调用者权限，避免普通用户
 *  因无 ZhiJiCompanionConfig 写权限而丢失日志记录。
 *  FLORA_AUTH_BEARER 在 cloud-config 中已用于公共配置读写，权限完备。
 */
function getServiceToken(): string {
  return process.env.VISIONSQUARE_AUTH_BEARER || process.env.FLORA_AUTH_BEARER || '';
}

/** 生成去重用的 flora_external_id */
function buildExternalId(name: string, institution?: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 60);
  const base = `tj_${clean(name)}`;
  return institution ? `${base}_${clean(institution)}` : base;
}

/** 从 allGatheredData 中提取结构化字段 */
function extractStructuredFields(raw: Record<string, any>): Partial<TalentJournalEntry> {
  const fields: Partial<TalentJournalEntry> = {};
  const sources: string[] = [];

  // 平方数据
  if (raw.pingfang && typeof raw.pingfang === 'object') {
    sources.push('pingfang');
    fields.pingfang_id = raw.pingfang.id;
    fields.talent_name_en = raw.pingfang.name_en || undefined;
    fields.workplace = raw.pingfang.workplace_current || raw.pingfang.school_current || undefined;
    if (raw.pingfang.research_field) {
      fields.research_fields = Array.isArray(raw.pingfang.research_field)
        ? raw.pingfang.research_field
        : [raw.pingfang.research_field];
    }
  }

  // Google Scholar
  if (raw.scholar && typeof raw.scholar === 'object') {
    sources.push('google_scholar');
    // 优先用顶层 h_index（新 Google Scholar 格式），兜底 summary_stats（兼容旧数据）
    const stats = raw.scholar.summary_stats;
    fields.h_index = raw.scholar.h_index ?? stats?.h_index;
    fields.cited_by_count = raw.scholar.cited_by_count ?? stats?.cited_by_count;
    fields.works_count = raw.scholar.works_count ?? stats?.works_count;
    if (!fields.talent_name_en && raw.scholar.display_name) {
      fields.talent_name_en = raw.scholar.display_name;
    }
  }

  // Wikipedia（英文维基百科）
  if (raw.wikipedia && typeof raw.wikipedia === 'object' && raw.wikipedia.biography) {
    sources.push('wikipedia');
    if (!fields.bio_snippet) fields.bio_snippet = raw.wikipedia.biography.substring(0, 500);
  }

  // 百度百科（Wikipedia 失败后降级抓取）
  if (raw.baike && typeof raw.baike === 'object' && raw.baike.biography) {
    sources.push('baike');
    if (!fields.bio_snippet) fields.bio_snippet = raw.baike.biography.substring(0, 500);
  }

  // 互联网
  if (raw.internet && typeof raw.internet === 'string' && raw.internet.length > 30) {
    sources.push('internet');
  }

  // ORCID
  if (raw.orcid && typeof raw.orcid === 'object') {
    sources.push('orcid');
    if (raw.orcid.employments?.length) {
      if (!fields.workplace) fields.workplace = raw.orcid.employments[0]?.org;
    }
    if (!fields.talent_name_en && raw.orcid.englishName) {
      fields.talent_name_en = raw.orcid.englishName;
    }
    fields.orcid_data = raw.orcid;
  }

  // 平方论文检索（pingfang-paper-search）
  if (raw.pingfang_papers && Array.isArray(raw.pingfang_papers) && raw.pingfang_papers.length > 0) {
    sources.push('pingfang_papers');
    if (!fields.works_count) fields.works_count = raw.pingfang_papers.length;
  }

  // ORCID 论文（works 也累加 works_count）
  if (raw.orcid?.works && Array.isArray(raw.orcid.works) && raw.orcid.works.length > 0) {
    if (!fields.works_count) fields.works_count = raw.orcid.works.length;
  }

  // 验真流水线标识
  if (raw.audit_summary) {
    sources.push('audit');
  }

  // 原始检索文档 (可能较大)
  if (Array.isArray(raw.texts) && raw.texts.length > 0) {
    fields.texts = raw.texts;
  }

  fields.data_sources = sources;
  return fields;
}

/** 合并两份 entry：新字段只补不覆盖（已有的保留） */
function mergeEntries(existing: TalentJournalEntry, incoming: Partial<TalentJournalEntry>): TalentJournalEntry {
  const merged = { ...existing };

  // 只补空字段
  if (!merged.talent_name_en && incoming.talent_name_en) merged.talent_name_en = incoming.talent_name_en;
  if (!merged.pingfang_id && incoming.pingfang_id) merged.pingfang_id = incoming.pingfang_id;
  if (!merged.h_index && incoming.h_index) merged.h_index = incoming.h_index;
  if (!merged.cited_by_count && incoming.cited_by_count) merged.cited_by_count = incoming.cited_by_count;
  if (!merged.works_count && incoming.works_count) merged.works_count = incoming.works_count;
  if (!merged.workplace && incoming.workplace) merged.workplace = incoming.workplace;
  if (!merged.bio_snippet && incoming.bio_snippet) merged.bio_snippet = incoming.bio_snippet;
  // institution：优先使用 incoming（可能是从数据源补充的更准确值）
  if (incoming.institution) merged.institution = incoming.institution;
  if (!merged.orcid_data && incoming.orcid_data) merged.orcid_data = incoming.orcid_data;

  // 合并研究领域（去重）
  if (incoming.research_fields?.length) {
    const existingSet = new Set(merged.research_fields || []);
    incoming.research_fields.forEach(f => existingSet.add(f));
    merged.research_fields = Array.from(existingSet);
  }

  merged.texts = []; // Clear raw texts to save space

  // 合并数据来源（去重）
  if (incoming.data_sources?.length) {
    const srcSet = new Set(merged.data_sources || []);
    incoming.data_sources.forEach(s => srcSet.add(s));
    merged.data_sources = Array.from(srcSet);
  }

  // 合并 source 级原始数据：按 top-level key 保留（pingfang/scholar/orcid 各存各的，不互相覆盖）
  if (incoming.structured_data && typeof incoming.structured_data === 'object') {
    merged.structured_data = merged.structured_data || {};
    for (const [k, v] of Object.entries(incoming.structured_data)) {
      if (v !== undefined && v !== null) {
        merged.structured_data[k] = v;
      }
    }
  }

  // 更新元数据
  merged.search_count += 1;
  merged.last_searched_at = new Date().toISOString();

  // AI 报告取最新版（覆盖）
  if (incoming.ai_report) merged.ai_report = incoming.ai_report;

  // 合并触发工具（去重）
  if (incoming.trigger_tools?.length) {
    const toolSet = new Set(merged.trigger_tools || []);
    incoming.trigger_tools.forEach(t => toolSet.add(t));
    merged.trigger_tools = Array.from(toolSet);
  }

  return merged;
}

// ── 核心 Manager ─────────────────────────────────────────────────────────

class TalentJournalManager {
  private readonly MODEL = 'ZhiJiCompanionConfig';
  private readonly PREFIX = 'tj_';

  /**
   * 保存人才检索数据到日志（fire-and-forget，不影响用户体验）
   * 
   * ⚠️ 权限说明：
   * 人才日志存放在 ZhiJiCompanionConfig 里，普通用户通常没有直接写入权限。
   * 因此内部采用服务端 Token（FLORA_AUTH_BEARER）写入，确保所有用户（包括非 admin）
   * 发起的人才检索结果都能被记录。参数 `token` 仅作兼容保留，不再使用。
   */
  async saveTalentData(
    talentName: string,
    institution: string,
    rawData: Record<string, any>,
    aiReport: string,
    _token?: string,
    triggerTool?: string,
    sourceRaw?: Record<string, any>,
  ): Promise<void> {
    const token = _token || getServiceToken();
    console.log(`[TalentJournal] saveTalentData called: name="${talentName}", institution="${institution || ''}", tokenAvailable=${!!token}`);
    if (!talentName || !token) {
      console.error('[TalentJournal] Abort save: missing talentName or token');
      return;
    }

    const externalId = buildExternalId(talentName, institution);
    const extracted = extractStructuredFields(rawData);
    extracted.ai_report = aiReport;

    let existingEntry: TalentJournalEntry | null = null;
    let existingMcpId: number | null = null;

    const tryFindExisting = async (idToTry: string): Promise<{ entry: TalentJournalEntry | null; mcpId: number | null }> => {
      try {
        const existing = await mcpTools.dashGenericGetByFloraExternalId({
          model: this.MODEL,
          floraExternalID: idToTry,
          fields: ['id', 'data', 'name'],
        }, token) as unknown as { item?: { id: number; data?: string; name?: string } };

        if (existing?.item?.id && existing.item.name !== '__DELETED__') {
          try {
            return { entry: JSON.parse(existing.item.data || '{}'), mcpId: existing.item.id };
          } catch {
            return { entry: null, mcpId: existing.item.id };
          }
        }
      } catch { /* 查询失败 */ }
      return { entry: null, mcpId: null };
    };

    ({ entry: existingEntry, mcpId: existingMcpId } = await tryFindExisting(externalId));
    console.log(`[TalentJournal] Lookup: externalId="${externalId}" → found=${!!existingEntry} mcpId=${existingMcpId}`);

    if (!existingEntry && institution) {
      const fallbackId = buildExternalId(talentName);
      const fallbackResult = await tryFindExisting(fallbackId);
      console.log(`[TalentJournal] Fallback: id="${fallbackId}" → found=${!!fallbackResult.entry}`);
      if (fallbackResult.entry) {
        existingEntry = fallbackResult.entry;
        existingMcpId = fallbackResult.mcpId;
      }
    }

    // 验证：只有包含真正人才特征的数据才保存（避免机构/关键词被误记为人才）
    // 人才特征：平方人才ID、学术指标（H-index/引用数/论文数）、百科简介、工作单位、ORCID数据
    // 如果已存在记录，则允许更新（增加查询次数）
    // ⚠️ talent_audit 直接放行：验真对象一定是真实人才，不需要特征门卫
    const hasTalentFeatures = 
      extracted.pingfang_id ||
      extracted.h_index ||
      extracted.cited_by_count ||
      extracted.works_count ||
      extracted.bio_snippet ||
      extracted.workplace ||
      extracted.orcid_data;

    if (!hasTalentFeatures && !existingEntry && triggerTool !== 'talent_audit') {
      console.log(`[TalentJournal] Skip save: "${talentName}" has no talent-specific data (not a person)`);
      return;
    }

    let entryToSave: TalentJournalEntry;

    if (existingEntry) {
      // 合并已有记录
      if (triggerTool) extracted.trigger_tools = [triggerTool];
      entryToSave = mergeEntries(existingEntry, extracted);
      // 额外合并 sourceRaw 到 structured_data（mergeEntries 只处理 incoming.structured_data）
      if (sourceRaw && typeof sourceRaw === 'object') {
        entryToSave.structured_data = entryToSave.structured_data || {};
        for (const [k, v] of Object.entries(sourceRaw)) {
          if (v !== undefined && v !== null) entryToSave.structured_data[k] = v;
        }
      }
    } else {
      // 创建新记录
      entryToSave = {
        talent_name: talentName,
        talent_name_en: extracted.talent_name_en,
        institution: institution || undefined,
        pingfang_id: extracted.pingfang_id,
        h_index: extracted.h_index,
        cited_by_count: extracted.cited_by_count,
        works_count: extracted.works_count,
        workplace: extracted.workplace,
        research_fields: extracted.research_fields || [],
        bio_snippet: extracted.bio_snippet,
        texts: [], // Clear raw texts to save space and prevent JSON serialization issues in MCP
        search_count: 1,
        first_searched_at: new Date().toISOString(),
        last_searched_at: new Date().toISOString(),
        data_sources: extracted.data_sources || [],
        trigger_tools: triggerTool ? [triggerTool] : [],
        ai_report: aiReport,
        verified: false,
        orcid_data: extracted.orcid_data,
        structured_data: sourceRaw || undefined,
      };
    }

    const valuesObj: Record<string, any> = {
      name: `[TJ] ${talentName}${institution ? ' @ ' + institution : ''}`,
      flora_external_id: externalId,
      data: JSON.stringify(entryToSave),
    };
    if (existingMcpId) valuesObj.id = existingMcpId;

    const result = await mcpTools.dashGenericSave({
      model: this.MODEL,
      values: JSON.stringify(valuesObj),
    }, token) as unknown as { status?: number | string; error?: string; id?: number };

    console.log(`[TalentJournal] RAW SAVE RESULT for ${talentName}:`, result);
    try {
      require('fs').appendFileSync('journal-debug.log', `[${new Date().toISOString()}] RAW SAVE RESULT for ${talentName}: ${JSON.stringify(result)}\n`);
    } catch (e) {}

    // MCP 返回格式不统一：创建可能返回 {id}, 更新可能返回 {status:200,id}
    // 只要没有显式 error 且 status 不是明确的错误码，就视为成功
    const statusNum = typeof result?.status === 'string' ? parseInt(result.status, 10) : result?.status;
    const _debugLog = (line: string) => {
      try { require('fs').appendFileSync('journal-debug.log', line); } catch {}
    };

    if (result?.error) {
      console.error(`[TalentJournal] Save FAILED for ${talentName}:`, result.error);
      _debugLog(`[${new Date().toISOString()}] ERROR saveTalentData for ${talentName}: ${result.error}\n`);
      throw new Error(result.error);
    }
    if (statusNum !== undefined && statusNum !== 200) {
      console.error(`[TalentJournal] Save FAILED for ${talentName}: status=${statusNum}`);
      _debugLog(`[${new Date().toISOString()}] ERROR saveTalentData for ${talentName}: status=${statusNum}\n`);
      throw new Error(`Save failed with status ${statusNum}`);
    }

    _debugLog(`[${new Date().toISOString()}] SUCCESS saveTalentData for ${talentName}\n`);

    console.log(`[TalentJournal] ${existingMcpId ? 'Updated' : 'Created'} entry: ${talentName} (search_count: ${entryToSave.search_count}, mcpId=${result?.id || 'unknown'})`);
  }

  /**
   * 查询日志列表（Admin 用）
   * 
   * 权限：API 路由层已校验调用者必须是 admin；
   * 内部统一使用服务端 Token 以保障查询权限稳定，不依赖 admin 用户个人 token。
   */
  async listEntries(opts: {
    token?: string;
    offset?: number;
    limit?: number;
    search?: string;
    sort?: 'search_count' | 'last_searched' | 'name' | 'institution';
    sortOrder?: 'ascend' | 'descend' | null;
    verifiedOnly?: boolean;
  }): Promise<{ items: TalentJournalEntry[]; total: number }> {
    const token = opts.token || getServiceToken() || '';
    if (!token) return { items: [], total: 0 };
    const children: any[] = [
      { leaf: { field: 'flora_external_id', comparator: 'ilike', value: `${this.PREFIX}%` } },
      { leaf: { field: 'name', comparator: '!=', value: '__DELETED__' } },
    ];
    console.log(`[TalentJournal] listEntries called: offset=${opts.offset || 0}, limit=${opts.limit || 50}, search="${opts.search || ''}"`);

    if (opts.search) {
      children.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${opts.search}%` } });
    }

    const condition = JSON.stringify({ logic_operator: '&', children });
    const PAGE_SIZE = 500;
    const requestedLimit = opts.limit || 50;

    const allItems: any[] = [];
    let fetchedTotal = 0;
    let cursor = opts.offset || 0;

    // 循环分页拉取：MCP 单次查询可能会被服务端限制 page_size，避免大 limit 被截断导致导出空数据。
    while (allItems.length < requestedLimit) {
      const thisLimit = Math.min(PAGE_SIZE, requestedLimit - allItems.length);
      const result = await mcpTools.dashGenericSearch({
        model: this.MODEL,
        fields: ['id', 'name', 'flora_external_id', 'data', 'write_date'],
        condition,
        limit: thisLimit,
        offset: cursor,
        sort: '[{"field":"write_date","order":"DESC"}]',
      }, token) as unknown as { items?: any[]; total?: number };

      const page = result?.items || [];
      if (typeof result?.total === 'number') fetchedTotal = result.total;
      if (page.length === 0) break;
      allItems.push(...page);
      if (page.length < thisLimit) break; // 末页
      cursor += page.length;
    }

    const items: TalentJournalEntry[] = allItems.map((item: any) => {
      try {
        const entry: TalentJournalEntry = JSON.parse(item.data || '{}');
        entry._mcp_id = item.id;
        // DEBUG: 检查每条记录的解析结果
        if (entry.talent_name && entry.talent_name.includes('合并')) {
          console.log(`[TalentJournal] Found merged entry: ${entry.talent_name}, id=${item.id}, dataLen=${item.data?.length || 0}`);
        }
        return entry;
      } catch (e) {
        console.error(`[TalentJournal] Failed to parse entry id=${item.id}:`, e);
        return null;
      }
    }).filter(Boolean) as TalentJournalEntry[];

    // DEBUG: 打印所有查到的记录名
    console.log(`[TalentJournal] Raw MCP items (${allItems.length}):`, allItems.map(i => {
      try {
        const d = JSON.parse(i.data || '{}');
        return `${d.talent_name || '?'} (id=${i.id}, extId=${i.flora_external_id || '?'})`;
      } catch {
        return `?(id=${i.id})`;
      }
    }));

    // 客户端排序（MCP 只能按 write_date 排序）
    const asc = opts.sortOrder === 'ascend';
    if (opts.sort === 'search_count') {
      items.sort((a, b) => asc ? (a.search_count || 0) - (b.search_count || 0) : (b.search_count || 0) - (a.search_count || 0));
    } else if (opts.sort === 'name') {
      items.sort((a, b) => asc ? b.talent_name.localeCompare(a.talent_name) : a.talent_name.localeCompare(b.talent_name));
    } else if (opts.sort === 'institution') {
      items.sort((a, b) => asc ? (b.institution || '').localeCompare(a.institution || '') : (a.institution || '').localeCompare(b.institution || ''));
    } else if (opts.sort === 'last_searched') {
      items.sort((a, b) => asc ? new Date(a.last_searched_at || 0).getTime() - new Date(b.last_searched_at || 0).getTime() : new Date(b.last_searched_at || 0).getTime() - new Date(a.last_searched_at || 0).getTime());
    }

    if (opts.verifiedOnly) {
      const filtered = items.filter(i => i.verified);
      console.log(`[TalentJournal] listEntries returned ${filtered.length} verified items (total=${fetchedTotal || filtered.length})`);
      return { items: filtered, total: fetchedTotal || filtered.length };
    }

    console.log(`[TalentJournal] listEntries returned ${items.length} items (total=${fetchedTotal || items.length})`);
    return { items, total: fetchedTotal || items.length };
  }

  /**
   * 更新管理字段（验证状态/备注）
   * 
   * 权限：API 路由层已校验调用者必须是 admin；
   * 内部统一使用服务端 Token 以保障写权限稳定。
   */
  async updateEntry(
    mcpId: number,
    updates: { verified?: boolean; notes?: string; structured_data?: Record<string, any> },
    token?: string,
  ): Promise<boolean> {
    const svcToken = token || getServiceToken();
    if (!svcToken) return false;
    // 先读取现有数据（name / flora_external_id 必须在 save 时一并传回，否则 MCP 更新静默失败）
    const existing = await mcpTools.dashGenericSearch({
      model: this.MODEL,
      fields: ['id', 'data', 'name', 'flora_external_id'],
      condition: JSON.stringify({ logic_operator: '&', children: [{ leaf: { field: 'id', comparator: '=', value: mcpId } }] }),
      limit: 1,
    }, svcToken) as unknown as { items?: any[] };

    const item = existing?.items?.[0];
    if (!item) {
      console.error(`[TalentJournal.updateEntry] Record not found for id=${mcpId}`);
      return false;
    }

    const entry: TalentJournalEntry = JSON.parse(item.data || '{}');
    if (updates.verified !== undefined) {
      entry.verified = updates.verified;
      entry.verified_at = updates.verified ? new Date().toISOString() : undefined;
    }
    if (updates.notes !== undefined) {
      entry.notes = updates.notes;
    }
    if (updates.structured_data !== undefined) {
      entry.structured_data = updates.structured_data;
    }

    const valuesObj: Record<string, any> = {
      id: mcpId,
      name: item.name,
      flora_external_id: item.flora_external_id,
      data: JSON.stringify(entry),
    };

    const result = await mcpTools.dashGenericSave({
      model: this.MODEL,
      values: JSON.stringify(valuesObj),
    }, svcToken) as unknown as { status?: number | string; error?: string };

    const statusNum = typeof result?.status === 'string' ? parseInt(result.status, 10) : result?.status;
    if (result?.error) {
      console.error(`[TalentJournal.updateEntry] Save FAILED id=${mcpId}:`, result.error);
      return false;
    }
    if (statusNum !== undefined && statusNum !== 200) {
      console.error(`[TalentJournal.updateEntry] Save FAILED id=${mcpId}: status=${statusNum}`);
      return false;
    }

    console.log(`[TalentJournal.updateEntry] OK id=${mcpId} (verified=${entry.verified}, notes=${!!entry.notes}, structured_data=${!!entry.structured_data})`);
    return true;
  }

  /**
   * 删除记录（软删除）
   * 
   * 权限：API 路由层已校验调用者必须是 admin；
   * 内部统一使用服务端 Token 以保障写权限稳定。
   */
  async deleteEntry(mcpId: number, token?: string): Promise<boolean> {
    const svcToken = token || getServiceToken();
    if (!svcToken) return false;
    await mcpTools.dashGenericSave({
      model: this.MODEL,
      values: JSON.stringify({ id: mcpId, name: '__DELETED__' }),
    }, svcToken);
    return true;
  }

  /**
   * 全库维度的指标统计（不受分页 offset/limit 影响）
   * 可传入 search 条件做条件统计（和列表同一口径）。
   *
   * 返回 4 项计数字段，全部基于「命中的人才条数」(人数/记录数)，而非查询次数。
   */
  async getGlobalStats(opts: {
    token?: string;
    search?: string;
  }): Promise<{
    total: number;             // 总查询人才数（命中记录总数）
    highFreqCount: number;     // 高频查询人数：search_count >= 5 的条数
    verifiedCount: number;     // 已验证人数：verified === true 的条数
    pingfangPendingCount: number; // 平方待新增人数：data_sources 中不含 pingfang 的条数
  }> {
    const token = opts.token || getServiceToken() || '';
    if (!token) return { total: 0, highFreqCount: 0, verifiedCount: 0, pingfangPendingCount: 0 };

    const children: any[] = [
      { leaf: { field: 'flora_external_id', comparator: 'ilike', value: `${this.PREFIX}%` } },
      { leaf: { field: 'name', comparator: '!=', value: '__DELETED__' } },
    ];
    if (opts.search) {
      children.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${opts.search}%` } });
    }
    const condition = JSON.stringify({ logic_operator: '&', children });

    // 500 条/页，循环直到把命中数据全拉完，再聚合计数。
    // 这里不依赖 MCP total，而是实打实地把每个 entry.data 解析出来做判断，
    // 保证和前端表格展示的条目完全一致。
    const PAGE_SIZE = 500;
    let cursor = 0;
    let total = 0;
    let highFreqCount = 0;
    let verifiedCount = 0;
    let pingfangPendingCount = 0;

    while (true) {
      const result = await mcpTools.dashGenericSearch({
        model: this.MODEL,
        fields: ['data'],
        condition,
        limit: PAGE_SIZE,
        offset: cursor,
        sort: '[]',
      }, token) as unknown as { items?: any[] };

      const page = result?.items || [];
      if (page.length === 0) break;

      for (const row of page) {
        let entry: TalentJournalEntry | null = null;
        try {
          entry = JSON.parse(row.data || '{}');
        } catch {
          continue;
        }
        if (!entry) continue;
        total += 1;
        if ((entry.search_count || 0) >= 5) highFreqCount += 1;
        if (entry.verified) verifiedCount += 1;
        if (!Array.isArray(entry.data_sources) || !entry.data_sources.includes('pingfang')) {
          pingfangPendingCount += 1;
        }
      }

      if (page.length < PAGE_SIZE) break;
      cursor += page.length;
    }

    return { total, highFreqCount, verifiedCount, pingfangPendingCount };
  }

  /**
   * 导出全部数据为 CSV 格式字符串
   *
   * @param options.token    用户/服务端 token
   * @param options.search   按姓名/机构过滤
   * @param options.ids      指定要导出的 mcp id 列表（批量导出选中条目用）
   */
  async exportCSV(options: { token?: string; search?: string; ids?: number[] } = {}): Promise<string> {
    const { token, search, ids } = options;
    let items: TalentJournalEntry[];

    if (Array.isArray(ids) && ids.length > 0) {
      // 批量导出选中条目：按 id 列表精确拉取
      items = await this.getEntriesByIds(ids, token);
    } else {
      // 全量导出：复用 listEntries 的循环分页
      const result = await this.listEntries({ token, limit: 5000, search });
      items = result.items;
    }

    const headers = [
      '姓名', '英文名', '机构', '平方ID', 'H-Index', '引用数', '论文数',
      '工作单位', '研究领域', '简介', 'AI 报告', '查询次数', '首次查询', '最近查询',
      '数据来源', '触发工具', '已验证', '验证时间', '备注',
      '职称(转译)', '联系邮箱(转译)', '教育背景(转译)', '工作经历(转译)', '其他(转译)', '转译完整JSON',
    ];

    const escape = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };

    const rows = items.map(e => {
      const sd = e.structured_data || {};
      return [
        escape(e.talent_name), escape(e.talent_name_en), escape(e.institution),
        escape(e.pingfang_id), escape(e.h_index), escape(e.cited_by_count), escape(e.works_count),
        escape(e.workplace), escape((e.research_fields || []).join('；')),
        escape(e.bio_snippet),
        escape(e.ai_report),
        escape(e.search_count),
        escape(e.first_searched_at), escape(e.last_searched_at),
        escape(formatDataSources(e.data_sources)),
        escape((e.trigger_tools || []).map(t => TRIGGER_TOOL_LABEL[t] || t).join('、')),
        escape(e.verified ? '是' : '否'), escape(e.verified_at), escape(e.notes),
        escape(sd['职称']), escape(sd['联系邮箱']),
        escape(sd['教育背景']), escape(sd['工作经历']), escape(sd['其他']),
        escape(JSON.stringify(sd)),
      ].join(',');
    });

    // BOM for Excel Chinese compatibility
    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
  }

  /**
   * 按 mcp id 列表批量拉取条目（用于「批量导出选中条目」功能）。
   * 用 IN 条件一次性查询，避免 N 次往返。
   */
  private async getEntriesByIds(ids: number[], token?: string): Promise<TalentJournalEntry[]> {
    const svcToken = token || getServiceToken() || '';
    if (!svcToken) return [];
    if (ids.length === 0) return [];

    const PAGE_SIZE = 500;
    const allItems: any[] = [];

    // IN 查询如果超长会被 MCP 截断，分批：每批最多 50 个 id
    const batches: number[][] = [];
    for (let i = 0; i < ids.length; i += 50) {
      batches.push(ids.slice(i, i + 50));
    }

    for (const batch of batches) {
      const children: any[] = [
        { leaf: { field: 'id', comparator: 'in', value: batch } },
        { leaf: { field: 'flora_external_id', comparator: 'ilike', value: `${this.PREFIX}%` } },
        { leaf: { field: 'name', comparator: '!=', value: '__DELETED__' } },
      ];
      const condition = JSON.stringify({ logic_operator: '&', children });

      let cursor = 0;
      while (true) {
        const result = await mcpTools.dashGenericSearch({
          model: this.MODEL,
          fields: ['id', 'name', 'flora_external_id', 'data', 'write_date'],
          condition,
          limit: PAGE_SIZE,
          offset: cursor,
        }, svcToken) as unknown as { items?: any[] };

        const page = result?.items || [];
        if (page.length === 0) break;
        allItems.push(...page);
        if (page.length < PAGE_SIZE) break;
        cursor += page.length;
      }
    }

    const entries: TalentJournalEntry[] = [];
    for (const item of allItems) {
      try {
        const entry: TalentJournalEntry = JSON.parse(item.data || '{}');
        entry._mcp_id = item.id;
        entries.push(entry);
      } catch { /* ignore */ }
    }
    return entries;
  }
}

export const talentJournal = new TalentJournalManager();
