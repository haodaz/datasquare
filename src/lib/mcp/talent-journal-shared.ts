/**
 * 人才日志 (Talent Journal) — 前后端共享的类型 & 数据来源映射常量
 * 
 * ⚠️ 此文件必须是"纯 TypeScript"：不能 import 任何 Node 原生模块、MCP 客户端、generated-tools。
 *    因为前端页面组件（浏览器端 SSR/Browser bundle）也会直接 import 此文件的映射常量。
 *    如果不小心引入了 child_process / fs / stream 等会导致 Next.js build 报错：
 *      "Module not found: Can't resolve 'child_process'"
 */

// ── 类型 ─────────────────────────────────────────────────────────────────

export interface TalentJournalEntry {
  // 去重键
  talent_name: string;
  talent_name_en?: string;
  institution?: string;

  // 从各数据源收集的结构化字段
  pingfang_id?: number;
  h_index?: number;
  cited_by_count?: number;
  works_count?: number;
  workplace?: string;
  research_fields?: string[];
  bio_snippet?: string;
  texts?: string[];
  orcid_data?: any;

  // 元数据
  search_count: number;
  first_searched_at: string;
  last_searched_at: string;
  data_sources: string[];
  ai_report?: string;
  trigger_tools?: string[];  // 触发工具：记录哪些工具向这条记录贡献过数据
  structured_data?: Record<string, any>; // 转译后的标准结构化数据

  // 管理字段
  verified: boolean;
  verified_at?: string;
  notes?: string;

  // 内部 ID（来自 MCP 记录）
  _mcp_id?: number;
}

// ── 数据来源 key → 中文友好名 & 颜色 ──────────────────────────────────────

/**
 * 5 个标准数据来源 key：
 *  - pingfang  : 平方学者库
 *  - google_scholar : Google Scholar 学术主页（学者本人维护的引用/h-index/论文数据）
 *  - wikipedia : 英文维基百科 API 真实命中
 *  - baike     : 百度百科（wikipedia 失败后降级抓取，独立归因，不再混到 wikipedia）
 *  - internet  : 全网深度检索拼接文本
 */
export const DATA_SOURCE_LABEL: Record<string, string> = {
  pingfang: '平方',
  google_scholar: 'Google Scholar',
  wikipedia: '维基百科',
  baike: '百度百科',
  internet: '互联网',
  orcid: 'ORCID',
  audit: '人才验真',
};

/**
 * 列表 Tag / 详情颜色（前端 page.tsx 使用；服务端一般不关心，但放在共享层保持唯一映射源）
 */
export const DATA_SOURCE_COLORS: Record<string, string> = {
  pingfang: '#6055f5',   // 紫
  google_scholar: '#059669',   // 绿
  wikipedia: '#0284c7',  // 蓝
  baike: '#0ea5e9',      // 天蓝（同色系区分维基）
  internet: '#d97706',   // 橙
  orcid: '#a6ce39',      // ORCID 绿
  audit: '#dc2626',      // 红（验真）
};

/**
 * 触发工具标签：标识数据由哪个产品工具触发获取
 */
export const TRIGGER_TOOL_LABEL: Record<string, string> = {
  chat: '智能体对话',
  deep_search: '人才检索',
  talent_audit: '人才验真',
};

export const TRIGGER_TOOL_COLORS: Record<string, string> = {
  chat: '#6055f5',
  deep_search: '#0284c7',
  talent_audit: '#dc2626',
};

/** 把 data_sources 原始 key 数组转成「中文标签串」（页面显示 / CSV 导出 / 抽屉统一使用） */
export function formatDataSources(sources: string[] | undefined): string {
  if (!Array.isArray(sources) || sources.length === 0) return '—';
  return sources.map(s => DATA_SOURCE_LABEL[s] || s).join('、');
}
