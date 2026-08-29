/**
 * 人才日志 (Talent Journal) — Supabase 版
 * 
 * 替代原来基于 MCP/平方 ZhiJiCompanionConfig 的实现。
 * 数据存入 Supabase 的 talent_entries / talent_source_data / talent_profiles 表。
 * 
 * 对外接口保持不变：saveTalentData / listEntries / updateEntry / deleteEntry / exportCSV / getGlobalStats
 */

import { supabase } from '@/lib/supabase/client';
import type { TalentJournalEntry } from '@/lib/mcp/talent-journal-shared';
import { DATA_SOURCE_LABEL, formatDataSources, TRIGGER_TOOL_LABEL } from '@/lib/mcp/talent-journal-shared';

export type { TalentJournalEntry } from '@/lib/mcp/talent-journal-shared';
export { DATA_SOURCE_LABEL, formatDataSources, formatDataSources as dataSourcesToLabel } from '@/lib/mcp/talent-journal-shared';

// ── 辅助函数 ─────────────────────────────────────────────────────────────

/** 生成去重用的 external_id */
function buildExternalId(name: string, institution?: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 60);
  const base = `tj_${clean(name)}`;
  return institution ? `${base}_${clean(institution)}` : base;
}

/** 从各信源 rawData 中提取结构化字段（与旧版逻辑一致） */
function extractStructuredFields(raw: Record<string, any>): {
  fields: Partial<TalentJournalEntry>;
  sourceContributions: Record<string, { rawData: any; fieldsContributed: string[] }>;
} {
  const fields: Partial<TalentJournalEntry> = {};
  const sources: string[] = [];
  const sourceContributions: Record<string, { rawData: any; fieldsContributed: string[] }> = {};

  // 平方数据
  if (raw.pingfang && typeof raw.pingfang === 'object') {
    sources.push('pingfang');
    const contributed: string[] = [];
    fields.pingfang_id = raw.pingfang.id;
    if (raw.pingfang.id) contributed.push('pingfang_id');
    fields.talent_name_en = raw.pingfang.name_en || undefined;
    if (raw.pingfang.name_en) contributed.push('talent_name_en');
    fields.workplace = raw.pingfang.workplace_current || raw.pingfang.school_current || undefined;
    if (fields.workplace) contributed.push('workplace');
    if (raw.pingfang.research_field) {
      fields.research_fields = Array.isArray(raw.pingfang.research_field)
        ? raw.pingfang.research_field : [raw.pingfang.research_field];
      contributed.push('research_fields');
    }
    sourceContributions.pingfang = { rawData: raw.pingfang, fieldsContributed: contributed };
  }

  // Google Scholar
  if (raw.scholar && typeof raw.scholar === 'object') {
    sources.push('google_scholar');
    const contributed: string[] = [];
    const stats = raw.scholar.summary_stats;
    fields.h_index = raw.scholar.h_index ?? stats?.h_index;
    if (fields.h_index) contributed.push('h_index');
    fields.cited_by_count = raw.scholar.cited_by_count ?? stats?.cited_by_count;
    if (fields.cited_by_count) contributed.push('cited_by_count');
    fields.works_count = raw.scholar.works_count ?? stats?.works_count;
    if (fields.works_count) contributed.push('works_count');
    if (!fields.talent_name_en && raw.scholar.display_name) {
      fields.talent_name_en = raw.scholar.display_name;
      contributed.push('talent_name_en');
    }
    sourceContributions.google_scholar = { rawData: raw.scholar, fieldsContributed: contributed };
  }

  // Wikipedia
  if (raw.wikipedia && typeof raw.wikipedia === 'object' && raw.wikipedia.biography) {
    sources.push('wikipedia');
    const contributed: string[] = ['bio_snippet'];
    if (!fields.bio_snippet) fields.bio_snippet = raw.wikipedia.biography.substring(0, 500);
    sourceContributions.wikipedia = { rawData: raw.wikipedia, fieldsContributed: contributed };
  }

  // 百度百科
  if (raw.baike && typeof raw.baike === 'object' && raw.baike.biography) {
    sources.push('baike');
    const contributed: string[] = [];
    if (!fields.bio_snippet) { fields.bio_snippet = raw.baike.biography.substring(0, 500); contributed.push('bio_snippet'); }
    sourceContributions.baike = { rawData: raw.baike, fieldsContributed: contributed };
  }

  // 互联网
  if (raw.internet && typeof raw.internet === 'string' && raw.internet.length > 30) {
    sources.push('internet');
    sourceContributions.internet = { rawData: { text: raw.internet }, fieldsContributed: [] };
  }

  // ORCID
  if (raw.orcid && typeof raw.orcid === 'object') {
    sources.push('orcid');
    const contributed: string[] = [];
    if (raw.orcid.employments?.length) {
      if (!fields.workplace) { fields.workplace = raw.orcid.employments[0]?.org; contributed.push('workplace'); }
    }
    if (!fields.talent_name_en && raw.orcid.englishName) {
      fields.talent_name_en = raw.orcid.englishName;
      contributed.push('talent_name_en');
    }
    fields.orcid_data = raw.orcid;
    contributed.push('orcid_data');
    sourceContributions.orcid = { rawData: raw.orcid, fieldsContributed: contributed };
  }

  // 平方论文
  if (raw.pingfang_papers && Array.isArray(raw.pingfang_papers) && raw.pingfang_papers.length > 0) {
    sources.push('pingfang_papers');
    if (!fields.works_count) fields.works_count = raw.pingfang_papers.length;
    sourceContributions.pingfang_papers = { rawData: raw.pingfang_papers, fieldsContributed: ['works_count'] };
  }

  // ORCID works
  if (raw.orcid?.works && Array.isArray(raw.orcid.works) && raw.orcid.works.length > 0) {
    if (!fields.works_count) fields.works_count = raw.orcid.works.length;
  }

  // 验真
  if (raw.audit_summary) {
    sources.push('audit');
    sourceContributions.audit = { rawData: raw.audit_summary, fieldsContributed: [] };
  }

  if (Array.isArray(raw.texts) && raw.texts.length > 0) {
    fields.texts = raw.texts;
  }

  fields.data_sources = sources;
  return { fields, sourceContributions };
}

// ── 核心 Manager ─────────────────────────────────────────────────────────

class TalentJournalManagerSupabase {

  /**
   * 保存人才检索数据
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
    console.log(`[TalentJournal/SB] saveTalentData: name="${talentName}", institution="${institution || ''}"`);
    if (!talentName) return;

    const externalId = buildExternalId(talentName, institution);
    const { fields: extracted, sourceContributions } = extractStructuredFields(rawData);
    extracted.ai_report = aiReport;

    // 人才特征门卫
    const hasTalentFeatures =
      extracted.pingfang_id || extracted.h_index || extracted.cited_by_count ||
      extracted.works_count || extracted.bio_snippet || extracted.workplace || extracted.orcid_data;

    // 查已有记录
    const { data: existing } = await supabase
      .from('talent_entries')
      .select('*')
      .eq('external_id', externalId)
      .maybeSingle();

    // 没有 fallback
    let fallbackEntry = null;
    if (!existing && institution) {
      const fallbackId = buildExternalId(talentName);
      const { data } = await supabase.from('talent_entries').select('*').eq('external_id', fallbackId).maybeSingle();
      if (data) fallbackEntry = data;
    }

    const existingEntry = existing || fallbackEntry;

    if (!hasTalentFeatures && !existingEntry && triggerTool !== 'talent_audit') {
      console.log(`[TalentJournal/SB] Skip: "${talentName}" has no talent features`);
      return;
    }

    if (existingEntry) {
      // 更新已有记录
      const newSources = new Set([...(existingEntry.data_sources || []), ...(extracted.data_sources || [])]);
      const newTools = new Set([...(existingEntry.trigger_tools || []), ...(triggerTool ? [triggerTool] : [])]);

      const { error } = await supabase
        .from('talent_entries')
        .update({
          talent_name_en: extracted.talent_name_en || existingEntry.talent_name_en,
          institution: institution || existingEntry.institution,
          ai_report: aiReport || existingEntry.ai_report,
          search_count: (existingEntry.search_count || 1) + 1,
          data_sources: Array.from(newSources),
          trigger_tools: Array.from(newTools),
          last_searched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingEntry.id);

      if (error) { console.error('[TalentJournal/SB] Update error:', error.message); return; }
      console.log(`[TalentJournal/SB] Updated entry: ${talentName} (id=${existingEntry.id}, search_count=${(existingEntry.search_count || 1) + 1})`);

      // 更新 source data
      await this.upsertSourceData(existingEntry.id, sourceContributions);
      // 自动写入 talent_profiles（从提取的字段）
      await this.autoUpsertProfile(existingEntry.id, extracted);
      // 更新 structured_data
      if (sourceRaw) await this.upsertStructuredData(existingEntry.id, sourceRaw);

    } else {
      // 创建新记录
      const { data: newEntry, error } = await supabase
        .from('talent_entries')
        .insert({
          external_id: externalId,
          talent_name: talentName,
          talent_name_en: extracted.talent_name_en,
          institution: institution || null,
          ai_report: aiReport,
          search_count: 1,
          data_sources: extracted.data_sources || [],
          trigger_tools: triggerTool ? [triggerTool] : [],
          first_searched_at: new Date().toISOString(),
          last_searched_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error || !newEntry) { console.error('[TalentJournal/SB] Insert error:', error?.message); return; }
      console.log(`[TalentJournal/SB] Created entry: ${talentName} (id=${newEntry.id})`);

      // 保存 source data
      await this.upsertSourceData(newEntry.id, sourceContributions);
      // 自动写入 talent_profiles（从提取的字段）
      await this.autoUpsertProfile(newEntry.id, extracted);
      // 保存 structured_data
      if (sourceRaw) await this.upsertStructuredData(newEntry.id, sourceRaw);
    }
  }

  /** 写入/更新各信源的原始数据 */
  private async upsertSourceData(
    entryId: number,
    contributions: Record<string, { rawData: any; fieldsContributed: string[] }>,
  ) {
    for (const [sourceKey, { rawData, fieldsContributed }] of Object.entries(contributions)) {
      const { error } = await supabase
        .from('talent_source_data')
        .upsert({
          talent_entry_id: entryId,
          source_key: sourceKey,
          raw_data: rawData,
          fields_contributed: fieldsContributed,
          collected_at: new Date().toISOString(),
        }, { onConflict: 'talent_entry_id,source_key' });

      if (error) console.error(`[TalentJournal/SB] upsert source ${sourceKey} error:`, error.message);
    }
  }

  /** 自动从 extractStructuredFields 的结果写入 talent_profiles */
  private async autoUpsertProfile(entryId: number, extracted: Partial<TalentJournalEntry>) {
    const profileRow: Record<string, any> = {
      talent_entry_id: entryId,
      updated_at: new Date().toISOString(),
    };

    if (extracted.talent_name_en) profileRow.name_en = extracted.talent_name_en;
    if (extracted.h_index) profileRow.h_index = extracted.h_index;
    if (extracted.cited_by_count) profileRow.cited_by_count = extracted.cited_by_count;
    if (extracted.works_count) profileRow.works_count = extracted.works_count;
    if (extracted.workplace) profileRow.current_employer = extracted.workplace;
    if (extracted.bio_snippet) profileRow.bio_snippet = extracted.bio_snippet;
    if (extracted.pingfang_id) profileRow.pingfang_id = extracted.pingfang_id;
    if (extracted.research_fields?.length) profileRow.research_fields = extracted.research_fields;
    if (extracted.orcid_data?.orcid_id) profileRow.orcid_id = extracted.orcid_data.orcid_id;

    // 只有有实际数据时才写入
    if (Object.keys(profileRow).length <= 2) return; // 只有 talent_entry_id 和 updated_at

    const { error } = await supabase
      .from('talent_profiles')
      .upsert(profileRow, { onConflict: 'talent_entry_id' });

    if (error) {
      console.error('[TalentJournal/SB] autoUpsertProfile error:', error.message);
    } else {
      console.log(`[TalentJournal/SB] autoUpsertProfile OK for entry ${entryId}`);
    }
  }

  /** 保存 AI 转译后的结构化数据到 talent_profiles */
  private async upsertStructuredData(entryId: number, updates: any): Promise<void> {
    const { structured_data, db_entity_id } = updates;
    const profileRow: Record<string, any> = { talent_entry_id: entryId, updated_at: new Date().toISOString() };
    
    if (structured_data) {
        // 映射 structured_data 的中文 key 到 talent_profiles 列名
        const mapping: Record<string, string> = {
          '姓名': 'name_cn', '英文名': 'name_en', '性别': 'gender',
          '联系邮箱': 'email', '出生日期': 'birth_date', '国籍': 'nationality',
          '本科院校': 'undergrad_school', '本科专业': 'undergrad_major',
          '硕士院校': 'masters_school', '硕士专业': 'masters_major',
          '博士院校': 'phd_school', '博士专业': 'phd_major',
          '教育背景': 'education_raw', '现任机构': 'current_employer',
          '所在院系': 'department', '所在国家': 'country',
          '现任职务': 'position', '职称': 'title',
          '工作经历': 'work_history', '所获奖项': 'awards',
          '主要研究领域': 'research_fields_text',
          'H-Index': 'h_index_text', 'ORCID ID': 'orcid_id',
          '人才主页链接': 'homepage_url', '简介': 'bio_snippet',
          '其他': 'other_info',
        };

        for (const [zhKey, enCol] of Object.entries(mapping)) {
          if (structured_data[zhKey] !== undefined && structured_data[zhKey] !== null) {
            if (enCol === 'h_index_text') {
              profileRow.h_index = parseInt(structured_data[zhKey], 10) || null;
            } else if (enCol === 'research_fields_text') {
              const val = structured_data[zhKey];
              profileRow.research_fields = typeof val === 'string' ? val.split(/[,;，；、]/).map((s: string) => s.trim()).filter(Boolean) : (Array.isArray(val) ? val : []);
            } else {
              profileRow[enCol] = structured_data[zhKey];
            }
          }
        }
    }
    if (db_entity_id !== undefined) profileRow.db_entity_id = db_entity_id;

    const { error } = await supabase
      .from('talent_profiles')
      .upsert(profileRow, { onConflict: 'talent_entry_id' });

    if (error) console.error('[TalentJournal/SB] upsert profile error:', error.message);
  }

  /**
   * 查询列表
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
    const limit = opts.limit || 50;
    const offset = opts.offset || 0;

    let query = supabase
      .from('talent_entries')
      .select('*, talent_profiles(*), talent_source_data(*)', { count: 'exact' });

    if (opts.search) {
      query = query.or(`talent_name.ilike.%${opts.search}%,institution.ilike.%${opts.search}%`);
    }
    if (opts.verifiedOnly) {
      query = query.eq('verified', true);
    }

    // 排序
    const asc = opts.sortOrder === 'ascend';
    if (opts.sort === 'search_count') {
      query = query.order('search_count', { ascending: asc });
    } else if (opts.sort === 'name') {
      query = query.order('talent_name', { ascending: !asc }); // 中文默认正序
    } else if (opts.sort === 'institution') {
      query = query.order('institution', { ascending: !asc });
    } else {
      query = query.order('last_searched_at', { ascending: asc });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) {
      console.error('[TalentJournal/SB] listEntries error:', error.message);
      return { items: [], total: 0 };
    }

    const items: TalentJournalEntry[] = (data || []).map((row: any) => this.rowToEntry(row));
    return { items, total: count || items.length };
  }

  /** DB row → TalentJournalEntry（兼容前端） */
  private rowToEntry(row: any): TalentJournalEntry {
    const profile = row.talent_profiles?.[0] || row.talent_profiles || {};
    return {
      talent_name: row.talent_name,
      talent_name_en: row.talent_name_en || profile.name_en,
      institution: row.institution,
      pingfang_id: profile.pingfang_id,
      h_index: profile.h_index,
      cited_by_count: profile.cited_by_count,
      works_count: profile.works_count,
      workplace: profile.current_employer,
      research_fields: profile.research_fields || [],
      bio_snippet: profile.bio_snippet,
      texts: [],
      orcid_data: profile.orcid_id ? { orcid_id: profile.orcid_id } : undefined,
      search_count: row.search_count || 1,
      first_searched_at: row.first_searched_at,
      last_searched_at: row.last_searched_at,
      data_sources: row.data_sources || [],
      trigger_tools: row.trigger_tools || [],
      ai_report: row.ai_report,
      verified: row.verified || false,
      verified_at: row.verified_at,
      notes: row.notes,
      structured_data: profile ? Object.fromEntries(
        Object.entries(profile).filter(([k]) => !['id', 'talent_entry_id', 'parsed_at', 'parsed_by', 'updated_at', 'field_provenance'].includes(k))
      ) : undefined,
      _mcp_id: row.id, // 复用 _mcp_id 字段存 Supabase id，前端兼容
      imported_to_db: row.imported_to_db || false,
      db_entity_id: profile.db_entity_id,
    };
  }

  /**
   * 更新管理字段
   */
  async updateEntry(
    entryId: number,
    updates: { verified?: boolean; notes?: string; structured_data?: Record<string, any> },
    _token?: string,
  ): Promise<boolean> {
    const updateObj: Record<string, any> = { updated_at: new Date().toISOString() };
    if (updates.verified !== undefined) {
      updateObj.verified = updates.verified;
      updateObj.verified_at = updates.verified ? new Date().toISOString() : null;
    }
    if (updates.notes !== undefined) {
      updateObj.notes = updates.notes;
    }
    // We only update verified and notes here. imported_to_db is managed separately or we can add it here.
    if ('imported_to_db' in updates && updates.imported_to_db !== undefined) {
      updateObj.imported_to_db = updates.imported_to_db;
    }

    const { error } = await supabase
      .from('talent_entries')
      .update(updateObj)
      .eq('id', entryId);

    if (error) {
      console.error('[TalentJournal/SB] updateEntry error:', error.message);
      return false;
    }

    // 更新 structured_data → talent_profiles
    if (updates.structured_data || 'db_entity_id' in updates) {
      const profileUpdates: any = updates.structured_data ? { structured_data: updates.structured_data } : {};
      if ('db_entity_id' in updates) {
        profileUpdates.db_entity_id = (updates as any).db_entity_id;
      }
      await this.upsertStructuredData(entryId, profileUpdates);
    }

    console.log(`[TalentJournal/SB] updateEntry OK id=${entryId}`);
    return true;
  }

  /**
   * 删除记录
   */
  async deleteEntry(entryId: number, _token?: string): Promise<boolean> {
    const { error } = await supabase
      .from('talent_entries')
      .delete()
      .eq('id', entryId);

    if (error) {
      console.error('[TalentJournal/SB] deleteEntry error:', error.message);
      return false;
    }
    console.log(`[TalentJournal/SB] deleteEntry OK id=${entryId}`);
    return true;
  }

  /**
   * 全库统计
   */
  async getGlobalStats(opts: { token?: string; search?: string }): Promise<{
    total: number; highFreqCount: number; verifiedCount: number; pingfangPendingCount: number;
  }> {
    let query = supabase.from('talent_entries').select('search_count, verified, data_sources', { count: 'exact' });

    if (opts.search) {
      query = query.or(`talent_name.ilike.%${opts.search}%,institution.ilike.%${opts.search}%`);
    }

    const { data, count, error } = await query;
    if (error || !data) return { total: 0, highFreqCount: 0, verifiedCount: 0, pingfangPendingCount: 0 };

    let highFreqCount = 0, verifiedCount = 0, pingfangPendingCount = 0;
    for (const row of data) {
      if ((row.search_count || 0) >= 5) highFreqCount++;
      if (row.verified) verifiedCount++;
      if (!Array.isArray(row.data_sources) || !row.data_sources.includes('pingfang')) pingfangPendingCount++;
    }

    return { total: count || data.length, highFreqCount, verifiedCount, pingfangPendingCount };
  }

  /**
   * 导出 CSV
   */
  async exportCSV(options: { token?: string; search?: string; ids?: number[] } = {}): Promise<string> {
    let items: TalentJournalEntry[];

    if (Array.isArray(options.ids) && options.ids.length > 0) {
      const { data } = await supabase
        .from('talent_entries')
        .select('*, talent_profiles(*), talent_source_data(*)')
        .in('id', options.ids);
      items = (data || []).map((r: any) => this.rowToEntry(r));
    } else {
      const result = await this.listEntries({ search: options.search, limit: 5000 });
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
        escape(e.bio_snippet), escape(e.ai_report), escape(e.search_count),
        escape(e.first_searched_at), escape(e.last_searched_at),
        escape(formatDataSources(e.data_sources)),
        escape((e.trigger_tools || []).map(t => TRIGGER_TOOL_LABEL[t] || t).join('、')),
        escape(e.verified ? '是' : '否'), escape(e.verified_at), escape(e.notes),
        escape(sd['title']), escape(sd['email']),
        escape(sd['education_raw']), escape(sd['work_history']), escape(sd['other_info']),
        escape(JSON.stringify(sd)),
      ].join(',');
    });

    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
  }
}

export const talentJournal = new TalentJournalManagerSupabase();
