/**
 * 政策日志 (Policy Journal) — 服务端逻辑
 *
 * 设计理念：用户通过 AI 检索政策时，工具已经从平方库和互联网获取了数据。
 * 本模块将这些数据按「每条政策一条记录」保存下来，方便分析热搜方向和积累外部数据。
 * 同一条政策被多次检索时，自动去重并增加 search_count。
 *
 * 存储：复用 ZhiJiCompanionConfig 模型 + flora_external_id 前缀 pj_ 隔离
 */

import { mcpTools } from '@/lib/mcp/generated-tools';
import type { PolicyJournalEntry } from './policy-journal-shared';

export type { PolicyJournalEntry } from './policy-journal-shared';
export { formatPolicyDataSources } from './policy-journal-shared';

// ── 辅助函数 ─────────────────────────────────────────────────────────────

function getServiceToken(): string {
  return process.env.VISIONSQUARE_AUTH_BEARER || process.env.FLORA_AUTH_BEARER || '';
}

/** 生成去重用的 flora_external_id */
function buildExternalId(policyName: string, publishOrg?: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 60);
  const base = `pj_${clean(policyName)}`;
  return publishOrg ? `${base}_${clean(publishOrg)}` : base;
}

// ── 核心 Manager ─────────────────────────────────────────────────────────

class PolicyJournalManager {
  private readonly MODEL = 'ZhiJiCompanionConfig';
  private readonly PREFIX = 'pj_';

  /**
   * 保存一条政策记录（fire-and-forget，不影响用户体验）
   */
  async savePolicyData(
    policyName: string,
    publishOrg: string,
    rawFields: Partial<PolicyJournalEntry>,
    searchTopic: string,
    triggerTool?: string,
  ): Promise<void> {
    const token = getServiceToken();
    if (!policyName || !token) {
      console.log(`[PolicyJournal] Skip: missing policyName or token`);
      return;
    }

    // 政策名称太短的跳过（避免垃圾数据）
    if (policyName.length < 4) {
      console.log(`[PolicyJournal] Skip: policy name too short: "${policyName}"`);
      return;
    }

    const externalId = buildExternalId(policyName, publishOrg);

    // 查找已有记录
    let existingEntry: PolicyJournalEntry | null = null;
    let existingMcpId: number | null = null;

    try {
      const existing = await mcpTools.dashGenericGetByFloraExternalId({
        model: this.MODEL,
        floraExternalID: externalId,
        fields: ['id', 'data', 'name'],
      }, token) as unknown as { item?: { id: number; data?: string; name?: string } };

      if (existing?.item?.id && existing.item.name !== '__DELETED__') {
        try {
          existingEntry = JSON.parse(existing.item.data || '{}');
          existingMcpId = existing.item.id;
        } catch { /* parse error */ }
      }
    } catch { /* not found */ }

    let entryToSave: PolicyJournalEntry;

    if (existingEntry) {
      // 合并已有记录
      entryToSave = { ...existingEntry };
      entryToSave.search_count += 1;
      entryToSave.last_searched_at = new Date().toISOString();

      // 合并搜索关键词（去重）
      const topicSet = new Set(entryToSave.search_topics || []);
      if (searchTopic) topicSet.add(searchTopic);
      entryToSave.search_topics = Array.from(topicSet);

      // 合并数据来源
      if (rawFields.data_sources?.length) {
        const srcSet = new Set(entryToSave.data_sources || []);
        rawFields.data_sources.forEach(s => srcSet.add(s));
        entryToSave.data_sources = Array.from(srcSet);
      }

      // 合并触发工具
      if (triggerTool) {
        const toolSet = new Set(entryToSave.trigger_tools || []);
        toolSet.add(triggerTool);
        entryToSave.trigger_tools = Array.from(toolSet);
      }

      // 补充空字段
      if (!entryToSave.content_summary && rawFields.content_summary) entryToSave.content_summary = rawFields.content_summary;
      if (!entryToSave.official_link && rawFields.official_link) entryToSave.official_link = rawFields.official_link;
      if (!entryToSave.publish_date && rawFields.publish_date) entryToSave.publish_date = rawFields.publish_date;
      if (!entryToSave.region && rawFields.region) entryToSave.region = rawFields.region;
      if (!entryToSave.policy_level && rawFields.policy_level) entryToSave.policy_level = rawFields.policy_level;
      if (!entryToSave.policy_type && rawFields.policy_type) entryToSave.policy_type = rawFields.policy_type;
      if (!entryToSave.theme && rawFields.theme) entryToSave.theme = rawFields.theme;

      // 合并关键词
      if (rawFields.policy_keywords?.length) {
        const kwSet = new Set(entryToSave.policy_keywords || []);
        rawFields.policy_keywords.forEach(k => kwSet.add(k));
        entryToSave.policy_keywords = Array.from(kwSet);
      }
    } else {
      // 创建新记录
      entryToSave = {
        policy_name: policyName,
        publish_organization: publishOrg || undefined,
        policy_level: rawFields.policy_level,
        policy_type: rawFields.policy_type,
        region: rawFields.region,
        publish_date: rawFields.publish_date,
        official_link: rawFields.official_link,
        content_summary: rawFields.content_summary,
        policy_keywords: rawFields.policy_keywords || [],
        theme: rawFields.theme,
        search_count: 1,
        first_searched_at: new Date().toISOString(),
        last_searched_at: new Date().toISOString(),
        data_sources: rawFields.data_sources || [],
        search_topics: searchTopic ? [searchTopic] : [],
        trigger_tools: triggerTool ? [triggerTool] : [],
        verified: false,
      };
    }

    // 保存到 MCP
    const valuesObj: Record<string, any> = {
      name: `[PJ] ${policyName}`,
      flora_external_id: externalId,
      data: JSON.stringify(entryToSave),
    };
    if (existingMcpId) valuesObj.id = existingMcpId;

    try {
      const result = await mcpTools.dashGenericSave({
        model: this.MODEL,
        values: JSON.stringify(valuesObj),
      }, token) as unknown as { status?: number | string; error?: string; id?: number };

      if (result?.error) {
        console.error(`[PolicyJournal] Save FAILED for "${policyName}":`, result.error);
      } else {
        console.log(`[PolicyJournal] ${existingMcpId ? 'Updated' : 'Created'}: "${policyName}" (count=${entryToSave.search_count})`);
      }
    } catch (e: any) {
      console.error(`[PolicyJournal] Save error for "${policyName}":`, e.message);
    }
  }

  /**
   * 查询所有政策日志（分页、搜索、排序）
   */
  async queryAll(opts: {
    offset?: number;
    limit?: number;
    search?: string;
    sort?: string;
    sortOrder?: string;
  }): Promise<{ items: PolicyJournalEntry[]; total: number; stats: any }> {
    const token = getServiceToken();
    if (!token) return { items: [], total: 0, stats: {} };

    const { offset = 0, limit = 20, search = '', sort = 'search_count', sortOrder = 'descend' } = opts;

    try {
      // 查询所有 pj_ 前缀记录
      const condition = JSON.stringify({
        logic_operator: '&',
        children: [
          { leaf: { field: 'flora_external_id', comparator: 'ilike', value: `${this.PREFIX}%` } },
          { leaf: { field: 'name', comparator: '!=', value: '__DELETED__' } },
        ],
      });

      const res = await mcpTools.dashGenericSearch({
        model: this.MODEL,
        condition,
        fields: ['id', 'flora_external_id', 'name', 'data'],
        limit: 500,  // 取所有，前端分页
      }, token) as unknown as { items?: any[] };

      let entries: PolicyJournalEntry[] = [];
      for (const item of (res?.items || [])) {
        try {
          const entry: PolicyJournalEntry = JSON.parse(item.data || '{}');
          entry._mcp_id = item.id;
          entries.push(entry);
        } catch { /* skip invalid */ }
      }

      // 搜索过滤
      if (search) {
        const q = search.toLowerCase();
        entries = entries.filter(e =>
          e.policy_name?.toLowerCase().includes(q) ||
          e.publish_organization?.toLowerCase().includes(q) ||
          e.region?.toLowerCase().includes(q) ||
          e.search_topics?.some(t => t.toLowerCase().includes(q)) ||
          e.policy_keywords?.some(k => k.toLowerCase().includes(q))
        );
      }

      const total = entries.length;

      // 统计
      const stats = {
        total,
        highFreqCount: entries.filter(e => e.search_count >= 3).length,
        verifiedCount: entries.filter(e => e.verified).length,
        internetCount: entries.filter(e => e.data_sources?.includes('internet')).length,
      };

      // 排序
      entries.sort((a, b) => {
        let cmp = 0;
        if (sort === 'search_count') cmp = (a.search_count || 0) - (b.search_count || 0);
        else if (sort === 'last_searched') cmp = (a.last_searched_at || '').localeCompare(b.last_searched_at || '');
        else if (sort === 'policy_name') cmp = (a.policy_name || '').localeCompare(b.policy_name || '');
        return sortOrder === 'descend' ? -cmp : cmp;
      });

      // 分页
      const paged = entries.slice(offset, offset + limit);

      return { items: paged, total, stats };
    } catch (e: any) {
      console.error('[PolicyJournal] Query failed:', e.message);
      return { items: [], total: 0, stats: {} };
    }
  }

  /**
   * 更新验证状态/备注
   */
  async updateEntry(mcpId: number, partial: { verified?: boolean; notes?: string }): Promise<void> {
    const token = getServiceToken();
    if (!token || !mcpId) return;

    try {
      const existing = await mcpTools.dashGenericGet({
        model: this.MODEL,
        id: mcpId,
        fields: ['id', 'data', 'flora_external_id'],
      }, token) as unknown as { item?: { id: number; data?: string; flora_external_id?: string } };

      if (!existing?.item?.data) return;

      const entry: PolicyJournalEntry = JSON.parse(existing.item.data);
      if (partial.verified !== undefined) {
        entry.verified = partial.verified;
        entry.verified_at = partial.verified ? new Date().toISOString() : undefined;
      }
      if (partial.notes !== undefined) entry.notes = partial.notes;

      await mcpTools.dashGenericSave({
        model: this.MODEL,
        values: JSON.stringify({
          id: mcpId,
          flora_external_id: existing.item.flora_external_id,
          data: JSON.stringify(entry),
        }),
      }, token);
    } catch (e: any) {
      console.error('[PolicyJournal] Update failed:', e.message);
    }
  }

  /**
   * 删除记录（软删除：将 name 标记为 __DELETED__）
   */
  async deleteEntry(mcpId: number): Promise<void> {
    const token = getServiceToken();
    if (!token || !mcpId) return;

    try {
      await mcpTools.dashGenericSave({
        model: this.MODEL,
        values: JSON.stringify({ id: mcpId, name: '__DELETED__' }),
      }, token);
    } catch (e: any) {
      console.error('[PolicyJournal] Delete failed:', e.message);
    }
  }
}

export const policyJournal = new PolicyJournalManager();
