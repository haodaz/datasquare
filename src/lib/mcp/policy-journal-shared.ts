/**
 * 政策日志 (Policy Journal) — 前后端共享的类型 & 数据来源映射常量
 *
 * ⚠️ 纯 TypeScript：不能 import Node 原生模块 / MCP 客户端。
 *    前端页面组件也会直接 import 此文件的映射常量。
 */

// ── 类型 ─────────────────────────────────────────────────────────────────

export interface PolicyJournalEntry {
  // 去重键
  policy_name: string;
  publish_organization?: string;

  // 政策核心字段
  policy_level?: string;         // country / region
  policy_type?: string;          // policy_interpretation / management_regulation / planning_document / notice
  region?: string;               // 适用地区
  publish_date?: string;
  official_link?: string;
  content_summary?: string;      // 截取前 500 字
  policy_keywords?: string[];
  theme?: string;

  // 元数据
  search_count: number;
  first_searched_at: string;
  last_searched_at: string;
  data_sources: string[];        // pingfang_industry / pingfang_institute / internet
  search_topics: string[];       // 用户搜索时用的关键词（热搜分析）

  // 触发场景
  trigger_tools?: string[];      // chat / tools_tester

  // 管理字段
  verified: boolean;
  verified_at?: string;
  notes?: string;

  // 内部 ID
  _mcp_id?: number;
}

// ── 数据来源 key → 中文友好名 & 颜色 ──────────────────────────────────────

export const POLICY_DATA_SOURCE_LABEL: Record<string, string> = {
  pingfang_industry: '平方·产业政策',
  pingfang_institute: '平方·高校政策',
  internet: '互联网',
};

export const POLICY_DATA_SOURCE_COLORS: Record<string, string> = {
  pingfang_industry: '#6055f5',
  pingfang_institute: '#8b5cf6',
  internet: '#d97706',
};

export const POLICY_TRIGGER_TOOL_LABEL: Record<string, string> = {
  chat: '智能体对话',
  tools_tester: '工具测试台',
};

export const POLICY_TRIGGER_TOOL_COLORS: Record<string, string> = {
  chat: '#6055f5',
  tools_tester: '#10b981',
};

export const POLICY_LEVEL_LABEL: Record<string, string> = {
  country: '国家级',
  region: '地方级',
};

export function formatPolicyDataSources(sources: string[] | undefined): string {
  if (!Array.isArray(sources) || sources.length === 0) return '—';
  return sources.map(s => POLICY_DATA_SOURCE_LABEL[s] || s).join('、');
}
