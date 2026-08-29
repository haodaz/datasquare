import { TalentAuditService } from '@/lib/mcp/talent';
import { searchWeb } from '@/lib/search';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from "openai";
import pinyin from 'pinyin';

const talentService = new TalentAuditService();

function getOpenAIClient() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');
  return new OpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  });
}


// --- ORCID Functions Copied from verify/route.ts ---
let _orcidTokenCache: { token: string; expiresAt: number } | null = null;

async function getOrcidToken(): Promise<string | null> {
  // 检查缓存（Token 有效期 ~20 年，基本永不过期）
  if (_orcidTokenCache && Date.now() < _orcidTokenCache.expiresAt) {
    return _orcidTokenCache.token;
  }

  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://orcid.org/oauth/token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials&scope=/read-public`,
    });
    if (!res.ok) return null;
    const data = await res.json();
    _orcidTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 600000) * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * ORCID 三步降级搜索：精准 → 去机构 → 全文
 * 每步正序 + 反序都搜一遍，取合集去重
 */
async function orcidSearch(
  token: string,
  givenNames: string,
  familyName: string,
  institution?: string
): Promise<Array<{ path: string }>> {
  const BASE = 'https://pub.orcid.org/v3.0/search/';
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

  const doSearch = async (q: string): Promise<Array<{ path: string }>> => {
    try {
      const res = await fetch(`${BASE}?q=${encodeURIComponent(q)}&rows=5`, { headers });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.result || []).map((r: any) => ({ path: r['orcid-identifier']?.path })).filter((r: any) => r.path);
    } catch { return []; }
  };

  const dedupe = (arr: Array<{ path: string }>): Array<{ path: string }> => {
    const seen = new Set<string>();
    return arr.filter(r => { if (seen.has(r.path)) return false; seen.add(r.path); return true; });
  };

  // Step 1: 精准搜（正序 + 反序 + 机构）
  if (institution) {
    const q1 = `given-names:${givenNames} AND family-name:${familyName} AND affiliation-org-name:${institution}`;
    const q2 = `given-names:${familyName} AND family-name:${givenNames} AND affiliation-org-name:${institution}`;
    const [r1, r2] = await Promise.all([doSearch(q1), doSearch(q2)]);
    const results = dedupe([...r1, ...r2]);
    if (results.length > 0) return results;
  }

  // Step 2: 去掉机构（正序 + 反序）
  const q3 = `given-names:${givenNames} AND family-name:${familyName}`;
  const q4 = `given-names:${familyName} AND family-name:${givenNames}`;
  const [r3, r4] = await Promise.all([doSearch(q3), doSearch(q4)]);
  const step2 = dedupe([...r3, ...r4]);
  if (step2.length > 0 && step2.length <= 20) return step2.slice(0, 5);

  // Step 3: 全文搜索（杀手锏）
  const fullName = `${givenNames} ${familyName}`;
  const q5 = institution
    ? `text:"${fullName}" AND text:${institution}`
    : `text:"${fullName}"`;
  const r5 = await doSearch(q5);
  if (r5.length > 0) return r5;

  // Step 2 结果太多但 Step 3 没结果，返回 Step 2 前 5 个
  return step2.slice(0, 5);
}

/**
 * 从 ORCID 拉取学者的 employments，用于消歧
 */
async function orcidGetEmployments(token: string, orcidId: string): Promise<Array<{ org: string; role: string; dept: string }>> {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/employments`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data['affiliation-group'] || []).map((g: any) => {
      const s = g.summaries?.[0]?.['employment-summary'] || {};
      return {
        org: s.organization?.name || '',
        role: s['role-title'] || '',
        dept: s['department-name'] || '',
      };
    });
  } catch { return []; }
}

/**
 * 从 ORCID 拉取教育经历
 */
async function orcidGetEducations(token: string, orcidId: string): Promise<Array<{ org: string; role: string; dept: string }>> {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/educations`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data['affiliation-group'] || []).map((g: any) => {
      const s = g.summaries?.[0]?.['education-summary'] || {};
      return {
        org: s.organization?.name || '',
        role: s['role-title'] || '',
        dept: s['department-name'] || '',
      };
    });
  } catch { return []; }
}

/**
 * 从 ORCID 拉取论文（前 N 篇）
 */
async function orcidGetWorks(token: string, orcidId: string, limit = 10): Promise<Array<{ title: string; type: string }>> {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/works`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.group || []).slice(0, limit).map((g: any) => {
      const s = g['work-summary']?.[0] || {};
      return {
        title: s.title?.title?.value || 'N/A',
        type: s.type || '',
      };
    });
  } catch { return []; }
}

// ------------------------------------------------
// 中文姓名 → 英文拼音变体生成
// ------------------------------------------------

function generatePinyinVariants(chineseName: string): string[] {
  const chars = chineseName.replace(/[^一-龥]/g, '');
  if (chars.length < 2) return [];
  const py = (pinyin as any)(chars, { style: 'normal' }) as string[][];
  const flat = py.map((arr: string[]) => arr[0]);
  const variants = new Set<string>();
  const family = flat[0].charAt(0).toUpperCase() + flat[0].slice(1);
  const givenParts = flat.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1));
  const givenConcat = givenParts.join('');
  const givenSpaced = givenParts.join(' ');

  variants.add(`${family} ${givenConcat}`);          // Li Feifei
  variants.add(`${family} ${givenSpaced}`);          // Li Fei Fei
  variants.add(`${family},${givenConcat}`);          // Li,Feifei ← 平方库 name_en 常见格式
  variants.add(`${family}, ${givenConcat}`);         // Li, Feifei
  variants.add(`${givenConcat} ${family}`);          // Feifei Li
  variants.add(`${givenConcat}${family}`);           // FeifeiLi
  variants.add(`${givenConcat}, ${family}`);         // Feifei, Li
  variants.add(flat.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')); // Lifeifei

  return Array.from(variants);
}

// ------------------------------------------------
// 平方库同名消歧工具函数
// 决策流程文档: docs/ai/knowledge/talent-deep-search-disambiguation.md
// ------------------------------------------------

const WEIGHTS = {
  INST_CURRENT: 30,
  INST_HISTORY_WORK: 25,
  INST_HISTORY_EDU: 20,
  RESEARCH_FIELD: 15,
  DATA_RICHNESS: 10,
} as const;

const ABBREV_MAP: Record<string, string> = {
  mit: 'massachusetts institute of technology',
  ucla: 'university of california los angeles',
  ucsf: 'university of california san francisco',
  ucb: 'university of california berkeley',
  cmu: 'carnegie mellon university',
  caltech: 'california institute of technology',
  oxford: 'university of oxford',
  cambridge: 'university of cambridge',
  tsinghua: 'tsinghua university',
  peking: 'peking university',
};

const CN_ABBREV_MAP: Record<string, string> = {
  '中科院': '中国科学院',
  '社科院': '中国社会科学院',
  '中科大': '中国科学技术大学',
  '中科院大学': '中国科学院大学',
  '央财': '中央财经大学',
  '央财大': '中央财经大学',
  '北航': '北京航空航天大学',
  '北理工': '北京理工大学',
  '北邮': '北京邮电大学',
  '北医': '北京医科大学',
  '北师': '北京师范大学',
  '北外': '北京外国语大学',
  '北体': '北京体育大学',
  '北化工': '北京化工大学',
  '北交大': '北京交通大学',
  '北科大': '北京科技大学',
  '北林大': '北京林业大学',
  '北民大': '北京民族大学',
  '北大': '北京大学',
  '清华': '清华大学',
  '复旦': '复旦大学',
  '上交': '上海交通大学',
  '交沪': '上海交通大学',
  '华科': '华中科技大学',
  '武大': '武汉大学',
  '中大': '中山大学',
  '川大': '四川大学',
  '浙大': '浙江大学',
  '南大': '南京大学',
  '天大': '天津大学',
  '哈工大': '哈尔滨工业大学',
  '西工大': '西北工业大学',
  '西交大': '西安交通大学',
  '同济': '同济大学',
  '厦大': '厦门大学',
  '山大': '山东大学',
  '吉大': '吉林大学',
  '兰大': '兰州大学',
  '中南大': '中南大学',
  '湖大': '湖南大学',
  '云大': '云南大学',
  '贵大': '贵州大学',
  '重大': '重庆大学',
  '暨大': '暨南大学',
  '华师大': '华东师范大学',
  '东师大': '华东师范大学',
};

function normalizeInstName(s: string): string {
  return s.toLowerCase().replace(/[\s,、\-()（）··]/g, '').replace(/university/gi, 'uni').replace(/institute/gi, 'inst');
}

function tokenizeInst(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,、\-()（）·]+/)
    .filter(w => w.length >= 2);
}

function expandAbbrev(s: string): string {
  if (!s) return s;
  const lower = s.toLowerCase();
  if (CN_ABBREV_MAP[s]) return CN_ABBREV_MAP[s];
  if (ABBREV_MAP[lower]) return ABBREV_MAP[lower];
  return s;
}

// workplace_current 可能是 "value1、value2" 多值，拆成数组统一处理
// 主体一致性校验：用锚点人（anchor, 来自 Pingfang 高置信度消歧）验证候选数据
// 是否指向同一个学者。返回 { pass: boolean, score: number, reasons: string[] }。
// 校验维度（任一命中即通过，因为单个数据源可能缺某维度）：
//   1. 机构重叠：candidate 的机构列表 与 anchor 的 workplace/history 有交叉
//   2. 研究领域重叠：candidate 的 concepts/fields 与 anchor 的 research_field 有语义关键词交叉
//   3. 名字高度相似：candidate 名字 与 anchor 的 name_en/拼音 有 >=80% 相似度
// 当 pfConfidence !== 'high' 时，不做一致性校验（锚点本身就不可信）。
function subjectConsistencyCheck(anchor: any, candidate: any, pfConfidence: 'high' | 'low' | 'none'): { pass: boolean; score: number; reasons: string[] } {
  if (pfConfidence !== 'high' || !anchor || !candidate) {
    return { pass: true, score: 0, reasons: ['pfConfidence !== high, skip check'] };
  }

  const reasons: string[] = [];
  let score = 0;

  // ── 1. 机构重叠 ──
  const anchorInsts: string[] = [];
  splitWpValues(anchor.workplace_current).forEach((v: string) => anchorInsts.push(v));
  if (anchor.work_experiences?.length) {
    anchor.work_experiences.forEach((w: any) => { if (w?.employer) anchorInsts.push(String(w.employer)); });
  }
  if (anchor.education_backgrounds?.length) {
    anchor.education_backgrounds.forEach((e: any) => {
      if (e?.school_name_en) anchorInsts.push(String(e.school_name_en));
      if (e?.school_name_cn) anchorInsts.push(String(e.school_name_cn));
    });
  }

  let candidateInsts: string[] = [];
  if (Array.isArray(candidate.last_known_institutions)) {
    candidateInsts = candidate.last_known_institutions.map((i: any) => i?.display_name || '').filter(Boolean);
  } else if (Array.isArray(candidate.employments)) {
    candidateInsts = candidate.employments.map((e: any) => e?.org || '').filter(Boolean);
  } else if (candidate.current_org) {
    candidateInsts = [String(candidate.current_org)];
  }

  let bestInstMatch = 0;
  for (const ai of anchorInsts) {
    for (const ci of candidateInsts) {
      const m = calcInstMatchScore(ai, ci);
      if (m > bestInstMatch) bestInstMatch = m;
    }
  }
  if (bestInstMatch > 0.5) {
    score += 50;
    reasons.push(`机构重叠 (最高匹配=${bestInstMatch.toFixed(2)})`);
  }

  // ── 2. 研究领域重叠 ──
  const anchorFields = String(anchor.research_field || anchor.introduction || '')
    .toLowerCase().split(/[^a-z一-龥]+/).filter((w: string) => w.length >= 2);

  let candidateFields: string[] = [];
  if (Array.isArray(candidate.concepts)) {
    candidateFields = candidate.concepts.map((c: any) => c?.display_name || c?.name || '').filter(Boolean);
  } else if (Array.isArray(candidate.fields)) {
    candidateFields = candidate.fields.map((f: any) => typeof f === 'string' ? f : f?.name || '').filter(Boolean);
  }
  candidateFields = candidateFields.map((s: string) => s.toLowerCase());

  let fieldHit = 0;
  for (const af of anchorFields) {
    for (const cf of candidateFields) {
      if (cf.includes(af) || af.includes(cf)) { fieldHit++; break; }
    }
  }
  if (fieldHit > 0) {
    score += 30;
    reasons.push(`研究领域重叠 (命中 ${fieldHit} 个关键词)`);
  }

  // ── 3. 名字高度相似 ──
  const anchorEn = String(anchor.name_en || '').toLowerCase().replace(/[^a-z]/g, '');
  const candName = String(candidate.display_name || candidate.name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (anchorEn && candName && (anchorEn === candName || anchorEn.includes(candName) || candName.includes(anchorEn))) {
    score += 20;
    reasons.push(`名字高度相似 (${anchorEn} ≈ ${candName})`);
  }

  const pass = score >= 30; // 任一维度中等以上命中即通过
  return { pass, score, reasons };
}

function splitWpValues(raw: any): string[] {
  if (!raw) return [];
  const s = String(raw);
  return s.split(/[、,，|;；]/).map(v => v.trim()).filter(Boolean);
}

// 对一个可能多值的 workplace_current 跑 calcInstMatchScore，取最高分
function calcWpMatchScore(query: string, rawWp: any): number {
  const values = splitWpValues(rawWp);
  if (values.length === 0) return 0;
  return Math.max(...values.map(v => calcInstMatchScore(query, v)));
}

function calcInstMatchScore(query: string, target: string): number {
  if (!query || !target) return 0;
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase().trim();

  if (q.length > 0 && t.includes(q)) return 1.0;
  if (t.length > 0 && q.includes(t)) return 1.0;

  const qExpanded = expandAbbrev(q);
  if (qExpanded !== q) {
    if (t.includes(qExpanded)) return 1.0;
    if (qExpanded.includes(t)) return 1.0;
  }
  const tExpanded = expandAbbrev(t);
  if (tExpanded !== t) {
    if (tExpanded.includes(q)) return 1.0;
    if (q.includes(tExpanded)) return 1.0;
  }

  const qTokens = tokenizeInst(q);
  if (qTokens.length === 0) return 0;

  let hit = 0;
  for (const tok of qTokens) {
    if (t.includes(tok)) { hit++; continue; }
    const abbrevFull = ABBREV_MAP[tok] || CN_ABBREV_MAP[tok];
    if (abbrevFull && t.includes(abbrevFull)) { hit++; continue; }
    const nTok = normalizeInstName(tok);
    const nT = normalizeInstName(t);
    if (nTok.length >= 3 && nT.includes(nTok)) { hit++; continue; }
  }

  return hit / qTokens.length;
}

function tokenizeKeywords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,、\-，。；;：:·\/\\&]+/)
    .filter(w => w.length >= 2);
}

function ngramOverlapScore(keyword: string, text: string): number {
  if (!keyword || keyword.length < 2) return 0;
  const k = keyword.toLowerCase();
  const t = text.toLowerCase().replace(/[\s,、\-()（）··]/g, '');

  if (t.includes(k)) return 1.0;

  const kBigrams = new Set<string>();
  for (let i = 0; i < k.length - 1; i++) kBigrams.add(k.slice(i, i + 2));
  if (kBigrams.size === 0) return 0;

  const tBigrams = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) tBigrams.add(t.slice(i, i + 2));

  let overlap = 0;
  for (const bg of kBigrams) if (tBigrams.has(bg)) overlap++;
  return overlap / kBigrams.size;
}

function calcTextFieldMatch(queryKeywords: string, text: string): number {
  if (!queryKeywords || !text) return 0;
  const kws = tokenizeKeywords(queryKeywords);
  if (kws.length === 0) return 0;
  let totalScore = 0;
  for (const kw of kws) {
    const ov = ngramOverlapScore(kw, text);
    if (ov >= 0.6) totalScore += 1;
    else if (ov >= 0.3) totalScore += 0.5;
  }
  return totalScore / kws.length;
}

interface DisambiguationOptions {
  institution?: string;
  researchField?: string;
}

interface CandidateScore {
  candidate: any;
  score: number;
  instScore: number;
  breakdown: string[];
}

function scoreCandidate(candidate: any, opts: DisambiguationOptions): CandidateScore {
  const breakdown: string[] = [];
  let total = 0;
  let instScore = 0;

  const instQuery = opts.institution?.trim();
  const fieldQuery = opts.researchField?.trim();

  // ── 1. 机构-当前命中 (30) ──
  if (instQuery) {
    let instCurrentScore = 0;
    const s1 = calcWpMatchScore(instQuery, candidate.workplace_current);
    instCurrentScore = Math.round(WEIGHTS.INST_CURRENT * s1);
    if (instCurrentScore > 0) breakdown.push(`当前机构命中 +${instCurrentScore} (workplace match=${s1.toFixed(2)})`);
    total += instCurrentScore;
    instScore += instCurrentScore;

    // ── 2. 机构-历史工作 (25) ──
    let instWorkHistScore = 0;
    const workList = (candidate.work_experiences as any[]) || [];
    if (workList.length > 0) {
      let maxMatch = 0;
      for (const w of workList) {
        const employer = (w?.employer as string) || '';
        if (!employer) continue;
        const m = calcInstMatchScore(instQuery, employer);
        if (m > maxMatch) maxMatch = m;
      }
      instWorkHistScore = Math.round(WEIGHTS.INST_HISTORY_WORK * maxMatch);
      if (instWorkHistScore > 0) breakdown.push(`历史工作命中 +${instWorkHistScore} (最高匹配=${maxMatch.toFixed(2)})`);
    }
    total += instWorkHistScore;
    instScore += instWorkHistScore;

    // ── 3. 机构-历史教育 (20) ──
    let instEduHistScore = 0;
    const eduList = (candidate.education_backgrounds as any[]) || [];
    if (eduList.length > 0) {
      let maxMatch = 0;
      for (const e of eduList) {
        const cn = (e?.school_name_cn as string) || '';
        const en = (e?.school_name_en as string) || '';
        const m = Math.max(calcInstMatchScore(instQuery, cn), calcInstMatchScore(instQuery, en));
        if (m > maxMatch) maxMatch = m;
      }
      instEduHistScore = Math.round(WEIGHTS.INST_HISTORY_EDU * maxMatch);
      if (instEduHistScore > 0) breakdown.push(`历史教育命中 +${instEduHistScore} (最高匹配=${maxMatch.toFixed(2)})`);
    }
    total += instEduHistScore;
    instScore += instEduHistScore;
  }

  // ── 4. 研究领域关键词重叠 (15) ──
  if (fieldQuery) {
    const rf = (candidate.research_field as string) || '';
    const intro = (candidate.introduction as string) || '';
    const combined = `${rf} ${intro}`;
    const fieldMatch = calcTextFieldMatch(fieldQuery, combined);
    const fieldScore = Math.round(WEIGHTS.RESEARCH_FIELD * fieldMatch);
    if (fieldScore > 0) breakdown.push(`研究领域命中 +${fieldScore} (重叠度=${fieldMatch.toFixed(2)})`);
    total += fieldScore;
  }

  // ── 5. 数据完整度 (10) ──
  const patentCount = (candidate.patents as any[])?.length || 0;
  const paperCount = (candidate.papers as any[])?.length || 0;
  const workExpCount = (candidate.work_experiences as any[])?.length || 0;
  const richness = patentCount + paperCount + workExpCount;
  const richnessScore = Math.min(WEIGHTS.DATA_RICHNESS, Math.floor(richness / 5));
  if (richnessScore > 0) breakdown.push(`数据完整度 +${richnessScore} (专利${patentCount} + 论文${paperCount} + 工作${workExpCount})`);
  else breakdown.push(`数据完整度 +${richnessScore} (专利${patentCount} + 论文${paperCount} + 工作${workExpCount})`);
  total += richnessScore;

  return { candidate, score: total, instScore, breakdown };
}

interface DisambiguationResult {
  top: any;
  allScores: CandidateScore[];
  confidence: 'high' | 'low' | 'fallback';
  usedFallback: boolean;
}

function runPingfangDisambiguation(candidates: any[], opts: DisambiguationOptions): DisambiguationResult {
  const scored = candidates.map(c => scoreCandidate(c, opts));
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  let confidence: DisambiguationResult['confidence'] = 'high';
  let usedFallback = false;

  if (opts.institution) {
    const anyInstHit = scored.some(s => s.instScore > 0);
    if (!anyInstHit) {
      confidence = 'low';
      usedFallback = true;
    }
  }

  return { top: top.candidate, allScores: scored, confidence, usedFallback };
}

// ------------------------------------------------

export async function runTalentWebSearchStream(query: string, institution: string, en_name?: string, cn_name?: string) {
    if (!query) {
      throw new Error('Missing query');
    }

    let cleanQuery = query.trim().replace(/(?:特聘|客座|兼职|荣誉|终身|资深|首席)?(?:教授|副教授|助理教授|讲师|博士|硕士|研究员|副研究员|助理研究员|院士|博士生导师|硕士生导师|博导|硕导|主任医师|副主任医师|主治医师|先生|女士|同学|老师|主任|副主任|所长|副所长|院长|副院长|校长|副校长)$/g, '').trim();
    let searchName = cn_name || en_name || cleanQuery;

    return new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, data: any) => {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        };

        try {
          const allGatheredData: Record<string, any> = {};

          // [网络搜索模式] 跳过平方数据底座，直接从学术搜索开始
          sendEvent('log', { step: 'start', message: `🌐 [网络搜索模式] 跳过平方数据，直接检索互联网学术/百科源: ${searchName}...` });
          const isPureChinese = /^[\u4e00-\u9fa5]+$/.test(searchName.trim());
          const topPingfangRecord: Record<string, any> | null = null; // 兼容后续代码引用
          let pfConfidence: 'high' | 'low' | 'none' = 'none'; // 网络模式下始终为 none

          // Stage 1: Scholar (原第二阶段，现为第一步)
          let topScholarInstScore = 0;
          let scholarQuery: string = en_name || searchName;
          // 纯中文时用拼音
          if (!en_name && isPureChinese) {
            const pyVars = generatePinyinVariants(searchName);
            if (pyVars.length > 0) {
              scholarQuery = pyVars[0]; // Li Feifei 格式
            }
          }
          sendEvent('log', { step: 'scholar', message: `🔍 [第一阶段] 正在检索 Google Scholar 学术主页: ${scholarQuery}...` });
          const serpApiKey = process.env.SERPAPI_KEY;
          if (!serpApiKey) {
            sendEvent('log', { step: 'scholar', message: `⚠️ 未配置 SERPAPI_KEY，跳过 Google Scholar 检索。` });
          } else {
          try {
            // 使用 SerpAPI Google Scholar Profiles
            const gsSearchQuery = institution ? `${scholarQuery} ${institution}` : scholarQuery;
            const gsProfileUrl = `https://serpapi.com/search.json?engine=google_scholar_profiles&mauthors=${encodeURIComponent(gsSearchQuery)}&api_key=${serpApiKey}`;
            const scholarRes = await fetch(gsProfileUrl);
            if (scholarRes.ok) {
              const scholarData = await scholarRes.json();
              const gsProfiles = scholarData?.profiles || [];
              if (gsProfiles.length > 0) {

                // 构造交叉验证线索
                const clueInsts: string[] = [];
                const clueFields: string[] = [];
                if (institution) clueInsts.push(institution);
                // Pingfang top 的机构字段——只有高置信度才纳入，避免错误线索
                if (pfConfidence === 'high') {
                  const pfWpValues = splitWpValues(topPingfangRecord?.workplace_current);
                  pfWpValues.forEach(v => clueInsts.push(v));
                  const pfField = (topPingfangRecord?.research_field as string) || '';
                  if (pfField) clueFields.push(pfField);
                }

                // 对每个 Google Scholar Profile 打分
                const scholarScored = gsProfiles.map((s: any) => {
                  const breakdown: string[] = [];
                  let score = 0;
                  let scholarInstScore = 0;

                  // 机构匹配（30分）— Google Scholar 的 affiliations 是学者自填的单字符串
                  const gsAffiliation = (s.affiliations || '').toLowerCase();
                  if (clueInsts.length > 0 && gsAffiliation) {
                    let maxInstMatch = 0;
                    for (const clue of clueInsts) {
                      if (!clue) continue;
                      const m = calcInstMatchScore(clue, gsAffiliation);
                      if (m > maxInstMatch) maxInstMatch = m;
                    }
                    scholarInstScore = Math.round(30 * maxInstMatch);
                    score += scholarInstScore;
                    if (scholarInstScore > 0) breakdown.push(`机构交叉命中 +${scholarInstScore}`);
                  }

                  // 研究方向匹配（15分）— interests 数组
                  const gsInterests: string = (s.interests || []).map((i: any) => i.title || i).join(' ');
                  if (clueFields.length > 0 && gsInterests) {
                    const fieldQuery = clueFields.join(' ');
                    const fm = calcTextFieldMatch(fieldQuery, gsInterests);
                    const fieldScore = Math.round(15 * fm);
                    score += fieldScore;
                    if (fieldScore > 0) breakdown.push(`领域交叉命中 +${fieldScore}`);
                  }

                  // 引用量加成（最多5分）
                  const citedBy = s.cited_by || 0;
                  score += Math.min(5, Math.floor(citedBy / 5000));

                  // 标准化为兼容下游的结构
                  const normalized = {
                    display_name: s.name || '',
                    cited_by_count: citedBy,
                    affiliations: s.affiliations || '',
                    last_known_institutions: s.affiliations ? [{ display_name: s.affiliations }] : [],
                    interests: (s.interests || []).map((i: any) => ({ title: i.title || i })),
                    summary_stats: { h_index: null as number | null },
                    works_count: 0,
                    author_id: s.author_id || '',
                    scholar_url: s.link || '',
                  };

                  return { scholar: normalized, score, scholarInstScore, breakdown };
                });

                scholarScored.sort((a: any, b: any) => b.score - a.score);
                const topScholar = scholarScored[0];
                topScholarInstScore = topScholar.scholarInstScore;

                // 如果有 author_id，拉取详细信息（h-index）
                if (topScholar.scholar.author_id) {
                  try {
                    const authorDetailUrl = `https://serpapi.com/search.json?engine=google_scholar_author&author_id=${topScholar.scholar.author_id}&api_key=${serpApiKey}&num=5`;
                    const detailRes = await fetch(authorDetailUrl);
                    if (detailRes.ok) {
                      const detailData = await detailRes.json();
                      const citedByTable = detailData?.cited_by?.table;
                      if (citedByTable) {
                        for (const row of citedByTable) {
                          if (row.citations) topScholar.scholar.cited_by_count = row.citations.all || topScholar.scholar.cited_by_count;
                          if (row.h_index) topScholar.scholar.summary_stats.h_index = row.h_index.all;
                        }
                      }
                      topScholar.scholar.works_count = (detailData?.articles || []).length;
                    }
                  } catch { /* h-index 拉取失败不影响主流程 */ }
                }

                // 日志：展示消歧过程
                if (scholarScored.length > 1) {
                  sendEvent('log', { step: 'scholar', message: `⚠️ Google Scholar 返回 ${scholarScored.length} 条候选，用 Pingfang/用户线索消歧...` });
                  for (let i = 0; i < Math.min(scholarScored.length, 3); i++) {
                    const sc = scholarScored[i];
                    const marker = i === 0 ? '⬅️ 选中' : '   ';
                    sendEvent('log', {
                      step: 'scholar',
                      message: `   ${marker} [${sc.score}分 机构${sc.scholarInstScore}] ${sc.scholar.display_name} | affil=${sc.scholar.affiliations || '?'} | h=${sc.scholar.summary_stats?.h_index ?? '?'} | cited=${sc.scholar.cited_by_count}`,
                    });
                    if (sc.breakdown.length > 0 && i === 0) {
                      sendEvent('log', { step: 'scholar', message: `      ${sc.breakdown.join('; ')}` });
                    }
                  }
                }

                // 用独立 scholarInstScore 判定机构命中
                const anyInstHit = scholarScored.some((s: any) => s.scholarInstScore > 0);
                if (!anyInstHit && clueInsts.length > 0) {
                  sendEvent('log', { step: 'scholar', message: `⚠️ 无 Scholar 候选命中机构线索，可能拿错人，谨慎参考` });
                }

                // ── 主体一致性校验：pfConfidence='high' 时用 Pingfang 锚点人验证 Scholar 是否同一人 ──
                if (pfConfidence === 'high') {
                  const consistency = subjectConsistencyCheck(topPingfangRecord, topScholar.scholar, pfConfidence);
                  if (consistency.pass) {
                    sendEvent('log', { step: 'scholar', message: `✅ 成功定位学术档案 (H-index: ${topScholar.scholar.summary_stats?.h_index || '未知'}) — 主体一致性校验通过 (得分=${consistency.score}, ${consistency.reasons.join('; ') || '名字匹配'})` });
                    allGatheredData['scholar'] = topScholar.scholar;
                  } else {
                    sendEvent('log', { step: 'scholar', message: `❌ Scholar 主体一致性校验失败 (得分=${consistency.score}，阈值 30)，疑似同名不同人，丢弃 Scholar 数据。详情: ${consistency.reasons.join('; ') || '机构/领域均未命中'}` });
                    topScholarInstScore = 0;
                  }
                } else {
                  sendEvent('log', { step: 'scholar', message: `✅ 成功定位学术档案 (H-index: ${topScholar.scholar.summary_stats?.h_index || '未知'})` });
                  allGatheredData['scholar'] = topScholar.scholar;
                }
              } else {
                 sendEvent('log', { step: 'scholar', message: `❌ Google Scholar Profiles 未找到匹配结果。` });
              }
            }
          } catch (e) {
            sendEvent('log', { step: 'scholar', message: `⚠️ Google Scholar 检索失败: ${e}` });
          }
          }

          // Stage 2.5: ORCID
          // ── 提取 Scholar 的 orcid URL（短路路径用）──
          const scholarOrcidUrl: string | undefined = allGatheredData['scholar']?.orcid
            || allGatheredData['scholar']?.ids?.orcid;
          const scholarOrcidId = scholarOrcidUrl ? scholarOrcidUrl.replace(/^https?:\/\/orcid\.org\//, '').trim() : '';

          // ── 构造机构线索（考虑 pfConfidence）──
          let orcidInstClue = institution || '';
          if (pfConfidence === 'high') {
            const pfWpFirst = splitWpValues(topPingfangRecord?.workplace_current)[0] || '';
            orcidInstClue = orcidInstClue
              || pfWpFirst
              || (allGatheredData['scholar']?.last_known_institutions?.[0]?.display_name as string)
              || '';
          }

          try {
            const orcidToken = await getOrcidToken();
            if (!orcidToken) {
              sendEvent('log', { step: 'orcid', message: `⚠️ 未配置 ORCID API 密钥。` });
            } else {

              // ══════════════════════════════════════════
              // 【短路路径 A】Scholar 有 orcid + pfConfidence='high'
              // 直接用，跳过早搜和消歧
              // ══════════════════════════════════════════
              if (scholarOrcidId && pfConfidence === 'high' && topScholarInstScore > 0) {
                sendEvent('log', { step: 'orcid', message: `🔍 [第二阶段.5] 检测到 Scholar 已有 ORCID (高置信度)，直接复用: ${scholarOrcidId}` });
                const [employments, educations, works] = await Promise.all([
                  orcidGetEmployments(orcidToken, scholarOrcidId),
                  orcidGetEducations(orcidToken, scholarOrcidId),
                  orcidGetWorks(orcidToken, scholarOrcidId, 10),
                ]);
                sendEvent('log', { step: 'orcid', message: `✅ 成功定位 ORCID 档案（Scholar 复用）: ${scholarOrcidId}` });
                allGatheredData['orcid'] = {
                  orcid_id: scholarOrcidId, employments, educations, works,
                  url: `https://orcid.org/${scholarOrcidId}`,
                };

              // ══════════════════════════════════════════
              // 【短路路径 B】Scholar 有 orcid + pfConfidence='low'
              // 做交叉验证，机构不匹配则降级为完整搜索
              // ══════════════════════════════════════════
              } else if (scholarOrcidId && pfConfidence !== 'none' && topScholarInstScore > 0 && orcidInstClue) {
                sendEvent('log', { step: 'orcid', message: `⚠️ [第二阶段.5] Scholar 提供了 ORCID 但置信度低，做交叉验证...` });
                const empCheck = await orcidGetEmployments(orcidToken, scholarOrcidId);
                let instMatch = 0;
                for (const e of empCheck) {
                  const m = calcInstMatchScore(orcidInstClue, e.org);
                  if (m > instMatch) instMatch = m;
                }
                if (instMatch > 0.5) {
                  sendEvent('log', { step: 'orcid', message: `✅ 交叉验证通过（机构匹配度 ${instMatch.toFixed(2)}），接受 Scholar ORCID: ${scholarOrcidId}` });
                  const [educations, works] = await Promise.all([
                    orcidGetEducations(orcidToken, scholarOrcidId),
                    orcidGetWorks(orcidToken, scholarOrcidId, 10),
                  ]);
                  allGatheredData['orcid'] = {
                    orcid_id: scholarOrcidId, employments: empCheck, educations, works,
                    url: `https://orcid.org/${scholarOrcidId}`,
                  };
                } else {
                  sendEvent('log', { step: 'orcid', message: `❌ Scholar ORCID 与机构线索不匹配（匹配度 ${instMatch.toFixed(2)}），降级为完整搜索` });
                  // 降级 → 走下面的完整搜索路径
                  await runOrcidFullSearch(orcidToken, {
                    pfConfidence, orcidInstClue, institution,
                    topPingfangRecord, en_name, searchName, scholarName: allGatheredData['scholar']?.display_name,
                  }).then(result => {
                    if (result) allGatheredData['orcid'] = result;
                  });
                }

              // ══════════════════════════════════════════
              // 【完整搜索路径】Scholar 无 orcid / pfConfidence='none'
              // ══════════════════════════════════════════
              } else {
                sendEvent('log', { step: 'orcid', message: `🔍 [第二阶段.5] 未检测到可复用的 ORCID，执行完整搜索` });
                const result = await runOrcidFullSearch(orcidToken, {
                  pfConfidence, orcidInstClue, institution,
                  topPingfangRecord, en_name, searchName, scholarName: allGatheredData['scholar']?.display_name,
                });
                if (result) allGatheredData['orcid'] = result;
              }
            }
          } catch (e) {
            sendEvent('log', { step: 'orcid', message: `⚠️ ORCID 检索失败: ${e}` });
          }

          // ── 完整搜索的内部实现（抽出来避免 Stage 2.5 块太长）──
          async function runOrcidFullSearch(
            token: string,
            ctx: {
              pfConfidence: 'high' | 'low' | 'none';
              orcidInstClue: string;
              institution: string;
              topPingfangRecord: any;
              en_name?: string;
              searchName: string;
              scholarName?: string;
            },
          ): Promise<any> {
            const { pfConfidence, orcidInstClue, en_name, searchName, scholarName } = ctx;

            // Step 1: 构造 orcidQuery（考虑 pfConfidence）
            let orcidQuery: string;
            if (pfConfidence === 'high') {
              orcidQuery = (ctx.topPingfangRecord?.name_en as string) || scholarName || en_name || searchName;
            } else {
              orcidQuery = en_name || searchName;
            }
            // 中文 → 统一用 generatePinyinVariants
            if (/^[\u4e00-\u9fa5]+$/.test(orcidQuery.trim())) {
              const pyVars = generatePinyinVariants(orcidQuery);
              if (pyVars.length > 0) {
                orcidQuery = pyVars[0];
                sendEvent('log', { step: 'orcid', message: `   中文名自动转为拼音: ${orcidQuery}` });
              }
            }

            // Step 2: 拆 given + family
            let englishName = orcidQuery.replace(/^(?:Dr\.|Dr|Prof\.|Prof|Professor|Mr\.|Mr|Ms\.|Ms|Mrs\.|Mrs)\s+/i, '').trim();
            englishName = englishName.replace(/,\s*(?:Ph\.D\.|PhD|M\.D\.|MD|B\.S\.|BS|M\.S\.|MS)$/i, '').trim();
            const nameParts = englishName.split(/\s+/);
            const givenNames = nameParts.slice(0, -1).join(' ') || nameParts[0];
            const familyName = nameParts[nameParts.length - 1];

            // Step 3: 机构关键词
            const instKeyword = orcidInstClue
              ? (orcidInstClue.split(/\s+/).find((w: string) => w.length > 3 && /^[A-Z]/.test(w))
                 || orcidInstClue.split(' ')[0] || '')
              : '';

            sendEvent('log', { step: 'orcid', message: `   查询: ${givenNames} ${familyName}${instKeyword ? ' | 机构: ' + instKeyword : ''}` });

            const candidates = await orcidSearch(token, givenNames, familyName, instKeyword || undefined);
            if (candidates.length === 0) {
              sendEvent('log', { step: 'orcid', message: `❌ 未找到匹配的 ORCID 记录。` });
              return null;
            }

            let bestOrcidId = candidates[0].path;
            let bestEmployments: any[] = [];

            // Step 4: 多候选消歧（用 calcInstMatchScore）
            if (candidates.length > 1 && orcidInstClue) {
              sendEvent('log', { step: 'orcid', message: `⚠️ ORCID 返回 ${candidates.length} 条候选，用机构线索消歧...` });
              const empResults = await Promise.all(
                candidates.slice(0, 3).map(async (c: any) => ({
                  path: c.path,
                  employments: await orcidGetEmployments(token, c.path),
                })),
              );
              let bestScore = 0;
              for (const r of empResults) {
                let maxMatch = 0;
                for (const e of r.employments) {
                  const m = calcInstMatchScore(orcidInstClue, e.org);
                  if (m > maxMatch) maxMatch = m;
                }
                if (maxMatch > bestScore) {
                  bestScore = maxMatch;
                  bestOrcidId = r.path;
                  bestEmployments = r.employments;
                }
              }
              sendEvent('log', {
                step: 'orcid',
                message: `   ⬅️ 选中 [机构匹配度 ${bestScore.toFixed(2)}] ${bestOrcidId}${bestEmployments[0]?.org ? ' | ' + bestEmployments[0].org : ''}`,
              });
              if (bestEmployments.length === 0) bestEmployments = await orcidGetEmployments(token, bestOrcidId);
            } else {
              bestEmployments = await orcidGetEmployments(token, bestOrcidId);
            }

            // Step 5: 拉详情
            sendEvent('log', { step: 'orcid', message: `✅ 成功定位 ORCID 档案: ${bestOrcidId}` });
            const [educations, works] = await Promise.all([
              orcidGetEducations(token, bestOrcidId),
              orcidGetWorks(token, bestOrcidId, 10),
            ]);
            return {
              orcid_id: bestOrcidId, employments: bestEmployments, educations, works,
              url: `https://orcid.org/${bestOrcidId}`,
            };
          }


          // [网络搜索模式] 根据 Scholar + ORCID 结果推导置信度
          // 避免已经找到正确人时仍触发纠错
          if (allGatheredData['scholar'] && allGatheredData['orcid']) {
            pfConfidence = 'high';
            sendEvent('log', { step: 'confidence', message: `✅ Scholar + ORCID 双源命中，置信度: 高` });
          } else if (allGatheredData['scholar'] || allGatheredData['orcid']) {
            pfConfidence = 'low';
            sendEvent('log', { step: 'confidence', message: `🟡 Scholar/ORCID 单源命中，置信度: 中` });
          }

          // Stage 3: Wikipedia / 百度百科
          // ── 【修复 1】osintQuery 加 pfConfidence ──
          let osintQuery: string;
          if (pfConfidence === 'high') {
            osintQuery = (topPingfangRecord?.name_en as string) || en_name || searchName;
          } else {
            osintQuery = en_name || searchName;
          }
          const bkQuery = cn_name || searchName;

          // ── 机构线索（用于交叉验证）──
          const clueInsts: string[] = [];
          if (institution) clueInsts.push(institution);
          if (pfConfidence === 'high') {
            splitWpValues(topPingfangRecord?.workplace_current).forEach(v => clueInsts.push(v));
          }
          const scholarInsts = allGatheredData['scholar']?.last_known_institutions;
          if (scholarInsts?.length > 0) {
            scholarInsts.slice(0, 3).forEach((s: any) => clueInsts.push(s.display_name));
          }
          // 补充 ORCID employments 作为机构线索（ORCID 在 Wiki 之前已完成）
          const orcidEmps = allGatheredData['orcid']?.employments;
          if (Array.isArray(orcidEmps)) {
            orcidEmps.slice(0, 3).forEach((e: any) => { if (e.org) clueInsts.push(e.org); });
          }
          const uniqueClueInsts = [...new Set(clueInsts.filter(Boolean))];

          // 暂存 Wiki 候选，供后续阶段用更多线索重新打分
          let pendingWikiCandidates: Array<{ pageid: number; title: string; url: string; biography: string; score: number; instScore: number }> = [];

          // 加人才限定词，避免搜到历史人物、文艺角色等不相关同名人
          const wikiSearchQuery = institution
            ? `${osintQuery} ${institution}`
            : `${osintQuery} scholar OR professor OR researcher OR scientist OR engineer OR executive`;
          sendEvent('log', { step: 'wikipedia', message: `🔍 [第三阶段] 正在检索维基百科 (Wikipedia): ${wikiSearchQuery}...` });
          let foundWiki = false;
          try {
            const wikiQueryUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(wikiSearchQuery)}&srlimit=5&utf8=&format=json&origin=*`;
            const wikiRes = await fetch(wikiQueryUrl);
            if (wikiRes.ok) {
              const wikiData = await wikiRes.json();
              if (wikiData.query?.search?.length > 0) {
                const wikiResults = wikiData.query.search;

                // ── 【修复 3】多条候选 → 拉 extract + 机构交叉验证 ──
                const wikiScored: Array<{ pageid: number; title: string; url: string; biography: string; score: number; instScore: number }> = [];
                for (const w of wikiResults) {
                  const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${w.pageid}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
                  try {
                    const contentRes = await fetch(contentUrl);
                    if (!contentRes.ok) continue;
                    const contentData = await contentRes.json();
                    const pageObj = contentData.query?.pages?.[w.pageid];
                    if (!pageObj?.extract) continue;
                    const bio = pageObj.extract.substring(0, 2000);

                    // 机构交叉验证：extract 里搜 clueInsts
                    let instScore = 0;
                    for (const clue of uniqueClueInsts) {
                      if (bio.toLowerCase().includes(clue.toLowerCase())) {
                        instScore += 1;
                      } else {
                        // 尝试关键词重叠
                        const clueWords = clue.split(/\s+/).filter(ww => ww.length > 2);
                        const hitWords = clueWords.filter(ww => bio.toLowerCase().includes(ww.toLowerCase()));
                        if (hitWords.length > 0) instScore += 0.3 * hitWords.length;
                      }
                    }

                    wikiScored.push({
                      pageid: w.pageid,
                      title: w.title,
                      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(w.title.replace(/ /g, '_'))}`,
                      biography: bio.substring(0, 1500),
                      score: instScore,
                      instScore,
                    });
                  } catch { /* skip one failed page */ }
                }

                if (wikiScored.length > 0) {
                  wikiScored.sort((a, b) => b.score - a.score);
                  const topWiki = wikiScored[0];

                  if (topWiki.instScore > 0) {
                    sendEvent('log', { step: 'wikipedia', message: `✅ 成功提取维基百科词条 (机构匹配 ${topWiki.instScore.toFixed(1)}): ${topWiki.title}` });
                    allGatheredData['wikipedia'] = {
                      biography: topWiki.biography,
                      url: topWiki.url,
                      _wikiScore: topWiki.instScore,
                    };
                    foundWiki = true;
                  } else {
                    // 机构匹配分为 0 → 暂存候选，等后续阶段积累更多线索后重新打分
                    pendingWikiCandidates = wikiScored;
                    sendEvent('log', { step: 'wikipedia', message: `⚠️ Wikipedia 返回 ${wikiResults.length} 条候选，暂无机构匹配，已暂存等待后续重新验证: ${topWiki.title}` });
                  }
                }
              }
            }
          } catch (e) {
            sendEvent('log', { step: 'wikipedia', message: `⚠️ Wiki检索失败: ${e}` });
          }

          // [网络搜索模式] 无论 Wikipedia 是否找到，都同时检索百度百科
          {
            sendEvent('log', { step: 'baike', message: `🔍 [第三阶段b] 同时检索百度百科: ${bkQuery}...` });
            const bkVariants = [bkQuery];
            if (institution) bkVariants.push(`${bkQuery} ${institution.split(' ')[0]}`);
            bkVariants.push(`${bkQuery} 教授`);
            bkVariants.push(`${bkQuery} 学者`);

            let bkAccepted = false;
            for (const bkV of bkVariants) {
              if (bkAccepted) break;
              try {
                const bkUrl = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(bkV)}&bk_length=1500`;
                const bkRes = await fetch(bkUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const bkData = await bkRes.json();
                if (bkData && bkData.id && bkData.abstract) {
                  const bio = bkData.abstract.replace(/<[^>]+>/g, '').substring(0, 1500);
                  let bkInstScore = 0;
                  for (const clue of uniqueClueInsts) {
                    if (bio.toLowerCase().includes(clue.toLowerCase())) { bkInstScore += 1; break; }
                  }
                  allGatheredData['baike'] = {
                    biography: bio,
                    url: bkData.url || `https://baike.baidu.com/item/${encodeURIComponent(bkV)}`,
                    _bkScore: bkInstScore,
                  };
                  sendEvent('log', { step: 'baike', message: `✅ 成功提取百度百科词条${bkInstScore > 0 ? ' (机构匹配)' : ''}。` });
                  bkAccepted = true;
                }
              } catch (e) { /* skip one variant */ }
            }
            if (!bkAccepted) {
              sendEvent('log', { step: 'baike', message: `⚠️ 百度百科未找到匹配词条。` });
            }
          }

          // Stage 4: Internet
          sendEvent('log', { step: 'internet', message: `🔍 [第四阶段] 正在执行全网深度检索 (Search Internet)...` });
          const queryCN = cn_name || searchName;
          // ── 【修复】queryEN 加 pfConfidence ──
          let queryEN: string;
          if (pfConfidence === 'high') {
            queryEN = en_name || (topPingfangRecord?.name_en as string) || (allGatheredData['scholar']?.display_name as string) || '';
          } else {
            queryEN = en_name || (allGatheredData['scholar']?.display_name as string) || '';
          }
          try {
            const searchQueries = [queryCN, queryEN].filter(Boolean);
            let internetFound = false;

            const geminiKey = process.env.GEMINI_API_KEY;
            if (geminiKey) {
              sendEvent('log', { step: 'internet', message: `🚀 启动 Gemini Search Grounding (Google 搜索直连)...` });
              const genAI = new GoogleGenerativeAI(geminiKey);
              const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash', tools: [{ googleSearch: {} }] as any });
              const query = `Please use Google Search to find detailed biography and academic achievements for "${searchQueries.join(' OR ')}" ${institution ? 'at ' + institution : ''}. Provide a detailed summary in Chinese.`;
              
              const result = await model.generateContent(query);
              const text = result.response.text();
              if (text && text.length > 50) {
                 sendEvent('log', { step: 'internet', message: `✅ Gemini 全网检索成功。` });
                 allGatheredData['internet'] = text;
                 internetFound = true;
              }
            }
            
            if (!internetFound) {
              sendEvent('log', { step: 'internet', message: `⚠️ ${geminiKey ? 'Gemini 结果不足' : '未配置 Gemini'}，降级使用 阿里云/Bocha 综合检索...` });
              const query1 = queryEN ? `${queryCN} OR ${queryEN}` : queryCN;
              const webRes = await searchWeb(`${query1} ${institution || ''}`.trim());
              if (webRes && webRes.AbstractText && webRes.AbstractText.length > 20) {
                 sendEvent('log', { step: 'internet', message: `✅ 综合全网检索获得数据补充。` });
                 allGatheredData['internet'] = webRes.AbstractText;
              } else {
                 sendEvent('log', { step: 'internet', message: `❌ 全网检索无有效信息。` });
                 allGatheredData['internet'] = '无额外有效信息';
              }
            }
          } catch (e) {
            sendEvent('log', { step: 'internet', message: `⚠️ 全网检索失败: ${e}` });
            sendEvent('log', { step: 'internet', message: `⚠️ Gemini 检索异常，降级使用 阿里云/Bocha 综合检索...` });
            try {
              const query1 = queryEN ? `${queryCN} OR ${queryEN}` : queryCN;
              const webRes = await searchWeb(`${query1} ${institution || ''}`.trim());
              if (webRes && webRes.AbstractText && webRes.AbstractText.length > 20) {
                 sendEvent('log', { step: 'internet', message: `✅ 综合全网检索获得数据补充。` });
                 allGatheredData['internet'] = webRes.AbstractText;
              } else {
                 sendEvent('log', { step: 'internet', message: `❌ 全网检索无有效信息。` });
                 allGatheredData['internet'] = '无额外有效信息';
              }
            } catch (fallbackError) {
               sendEvent('log', { step: 'internet', message: `⚠️ Bocha 降级检索也失败: ${fallbackError}` });
               allGatheredData['internet'] = '检索异常';
            }
          }

                    // ── Stage 4.5: 人名纠错回退 ──────────────────────────────────────
          // 当 pfConfidence !== 'high' 时触发纠错：
          //   - pfConfidence === 'none' → 平方和 Scholar 都没找到任何数据
          //   - pfConfidence === 'low'  → 平方和 Scholar 找到了但消歧置信度低（搜偏了人名）
          // 这两种情况都极有可能是用户打错了名字，尝试 AI 纠错。
          if (pfConfidence !== 'high') {
            sendEvent('log', { step: 'name_correction', message: `🔎 [纠错阶段] 核心学术库置信度不足，正在尝试人名纠错...` });
            try {
              // 1. 用 searchWeb（阿里云 qwen-plus + enable_search）搜一次纠错
              const correctionQuery = `"${searchName}" ${institution || ''} 教授 学者 "你是不是要找"`.trim();
              const correctionRes = await searchWeb(correctionQuery);
              const correctionText = correctionRes?.AbstractText || '';

              // 2. 用已有的 DashScope AI 从搜索结果中提取可能的正确人名
              if (correctionText.length > 20) {
                const correctionClient = getOpenAIClient();
                const correctionAIRes = await correctionClient.chat.completions.create({
                  model: process.env.DEEPSEEK_MODEL || 'deepseek-v3.2-exp',
                  messages: [{
                    role: 'user',
                    content: `用户搜索了学者"${searchName}"${institution ? `（${institution}相关）` : ''}，但在平方数据库、Google Scholar、Wikipedia、百度百科和全网搜索中均未找到此人。

以下是全网搜索返回的参考信息：
${correctionText.substring(0, 2000)}

请判断：是否存在一位姓名与"${searchName}"非常相似（同音不同字、少一个字、错别字等）且确实存在的知名学者/教授？

回答规则：
- 如果找到了姓名相似且其他要素（研究领域、所属机构等）也吻合的学者，请只返回纠正后的正确姓名（纯文本，不加任何多余解释）
- 如果没有找到、或找到的人其他要素完全不同（比如不是同一领域、不是同一类型的人），请只返回空字符串
- 绝对不要为了给出答案而胡乱推荐名字仅仅相似但完全不相关的人`
                  }],
                  max_tokens: 50,
                });

                const correctedName = (correctionAIRes.choices[0]?.message?.content || '').trim();
                
                // 3. 如果 AI 给出了纠正后的人名，且确实和原名不同，用纠正后的人名重跑四阶段
                if (correctedName && correctedName.length >= 2 && correctedName.length <= 20 && correctedName !== searchName) {
                  sendEvent('log', { step: 'name_correction', message: `✅ 系统推测您可能要找的是「${correctedName}」，正在重新检索...` });

                  // 标记纠错信息，供 AI Assemble 在报告开头提示用户
                  allGatheredData['_name_correction'] = {
                    original: searchName,
                    corrected: correctedName,
                  };

                  // 用纠正后的名字重新执行 Stage 1-3（使用完整消歧 + 覆盖旧数据）
                  const correctedClean = correctedName.trim().replace(/(?:特聘|客座|兼职|荣誉|终身|资深|首席)?(?:教授|副教授|助理教授|讲师|博士|硕士|研究员|副研究员|助理研究员|院士|博士生导师|硕士生导师|博导|硕导|主任医师|副主任医师|主治医师|先生|女士|同学|老师|主任|副主任|所长|副所长|院长|副院长|校长|副校长)$/g, '').trim();

                  sendEvent('log', { step: 'name_correction', message: `🔍 [纠错重跑] 正在用纠正后的名字重跑核心阶段...` });

                  // ── [网络搜索模式] 跳过 Stage 1 平方库重跑 ──
                  let corrTopPf: any = null;
                  sendEvent('log', { step: 'name_correction', message: `   Stage 1 ⏭️ 跳过平方库（网络搜索模式）` });

                  // ── Stage 2 Scholar（Google Scholar 完整消歧）──
                  let corrScholarHit = false;
                  const corrSerpApiKey = process.env.SERPAPI_KEY;
                  if (corrSerpApiKey) {
                  try {
                    const corrScholarQuery = corrTopPf?.name_en || correctedClean;
                    const corrGsQuery = institution ? `${corrScholarQuery} ${institution}` : corrScholarQuery;
                    const corrScholarRes = await fetch(`https://serpapi.com/search.json?engine=google_scholar_profiles&mauthors=${encodeURIComponent(corrGsQuery)}&api_key=${corrSerpApiKey}`);
                    if (corrScholarRes.ok) {
                      const corrScholarData = await corrScholarRes.json();
                      const corrGsProfiles = corrScholarData?.profiles || [];
                      if (corrGsProfiles.length > 0) {
                        // 完整 Scholar 消歧（用修正后的线索）
                        const corrClueInsts = [institution].filter(Boolean);
                        const corrClueFields = (corrTopPf?.research_field as string) ? [corrTopPf.research_field as string] : [];
                        const corrScored = corrGsProfiles.map((o: any) => {
                          let instScore = 0;
                          const gsAffil = (o.affiliations || '').toLowerCase();
                          for (const inst of corrClueInsts) {
                            if (gsAffil) {
                              const m = calcInstMatchScore(inst, gsAffil);
                              if (m > instScore) instScore = m;
                            }
                          }
                          let fieldScore = 0;
                          const gsInterests = (o.interests || []).map((i: any) => i.title || i).join(' ');
                          if (corrClueFields.length > 0 && gsInterests) {
                            fieldScore = calcTextFieldMatch(corrClueFields.join(' '), gsInterests);
                          }
                          const score = instScore * 30 + fieldScore * 15 + Math.min(5, Math.floor((o.cited_by || 0) / 5000));
                          // 标准化为兼容下游的结构
                          return {
                            display_name: o.name || '',
                            cited_by_count: o.cited_by || 0,
                            affiliations: o.affiliations || '',
                            last_known_institutions: o.affiliations ? [{ display_name: o.affiliations }] : [],
                            interests: (o.interests || []).map((i: any) => ({ title: i.title || i })),
                            summary_stats: { h_index: null },
                            works_count: 0,
                            author_id: o.author_id || '',
                            scholar_url: o.link || '',
                            score, instScore,
                          };
                        });
                        corrScored.sort((a: any, b: any) => b.score - a.score);
                        allGatheredData['scholar'] = corrScored[0]; // 【修复】强制覆盖
                        corrScholarHit = true;
                        sendEvent('log', { step: 'name_correction', message: `   Stage 2 ✅ Google Scholar 消歧完成（覆盖旧数据）` });
                      }
                    }
                  } catch { /* skip */ }
                  }

                  // ── Stage 3 百度百科（快速覆盖，不走完整 Wiki 流程省时间）──
                  try {
                    const corrBkUrl = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(correctedClean)}&bk_length=1500`;
                    const corrBkRes = await fetch(corrBkUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const corrBkData = await corrBkRes.json();
                    if (corrBkData?.id && corrBkData.abstract) {
                      allGatheredData['baike'] = {
                        biography: corrBkData.abstract.replace(/<[^>]+>/g, '').substring(0, 1500),
                        url: corrBkData.url || `https://baike.baidu.com/item/${encodeURIComponent(correctedClean)}`
                      };
                      // 清掉旧的 Wikipedia 数据（纠正后大概率不适用）
                      delete allGatheredData['wikipedia'];
                      sendEvent('log', { step: 'name_correction', message: `   Stage 3 ✅ 百科重跑完成（覆盖旧数据）` });
                    }
                  } catch { /* skip */ }

                  // 不重跑 Stage 4（全网搜索耗时最长，大模型总结对名字微调不敏感）
                  // 不重跑 Stage 2.5 ORCID（省时间，而且纠正后数据 pfConfidence 重置后续也能走短路）

                  // 【修复】pfConfidence 重置：纠正后如果 Scholar 命中 → 高置信度
                  if (corrTopPf && corrScholarHit) {
                    pfConfidence = 'high';
                  } else if (corrTopPf || corrScholarHit) {
                    pfConfidence = 'low';
                  }

                  // 更新 searchName 以便 AI Assemble 使用纠正后的名字
                  searchName = correctedClean;

                  sendEvent('log', { step: 'name_correction', message: `✅ 纠正完成，所有核心数据已刷新。` });
                } else {
                  sendEvent('log', { step: 'name_correction', message: `❌ 未找到可信的近似学者，保持原始结果。` });
                }
              } else {
                sendEvent('log', { step: 'name_correction', message: `❌ 联网纠错也无有效信息。` });
              }
            } catch (corrErr) {
              sendEvent('log', { step: 'name_correction', message: `⚠️ 纠错阶段异常: ${corrErr}` });
            }
          }

          // ── Wiki 候选延迟重新打分 ──────────────────────────────────────
          // 如果 Stage 3 时 Wiki 因缺少机构线索暂存了候选，现在用全部已积累的线索重新打分
          if (pendingWikiCandidates.length > 0 && !allGatheredData['wikipedia']) {
            const laterClues: string[] = [...uniqueClueInsts];
            // 补充纠错阶段可能新增的 Scholar 机构
            const laterScholarInsts = allGatheredData['scholar']?.last_known_institutions;
            if (laterScholarInsts?.length > 0) {
              laterScholarInsts.slice(0, 3).forEach((s: any) => { if (s.display_name) laterClues.push(s.display_name); });
            }
            // 补充 ORCID 的最新 employments
            const laterOrcidEmps = allGatheredData['orcid']?.employments;
            if (Array.isArray(laterOrcidEmps)) {
              laterOrcidEmps.slice(0, 3).forEach((e: any) => { if (e.org) laterClues.push(e.org); });
            }
            // 补充百度百科里可能出现的机构线索
            const baikeBio = allGatheredData['baike']?.biography || '';
            const uniqueLaterClues = [...new Set(laterClues.filter(Boolean))];

            if (uniqueLaterClues.length > uniqueClueInsts.length) {
              // 有新线索了，重新打分
              sendEvent('log', { step: 'wikipedia', message: `🔄 [延迟验证] 用后续阶段积累的 ${uniqueLaterClues.length} 条机构线索重新验证 Wiki 候选...` });
              for (const candidate of pendingWikiCandidates) {
                let newInstScore = 0;
                for (const clue of uniqueLaterClues) {
                  if (candidate.biography.toLowerCase().includes(clue.toLowerCase())) {
                    newInstScore += 1;
                  } else {
                    const clueWords = clue.split(/\s+/).filter(ww => ww.length > 2);
                    const hitWords = clueWords.filter(ww => candidate.biography.toLowerCase().includes(ww.toLowerCase()));
                    if (hitWords.length > 0) newInstScore += 0.3 * hitWords.length;
                  }
                }
                candidate.instScore = newInstScore;
                candidate.score = newInstScore;
              }
              pendingWikiCandidates.sort((a, b) => b.score - a.score);
              const retryTop = pendingWikiCandidates[0];
              if (retryTop.instScore > 0) {
                sendEvent('log', { step: 'wikipedia', message: `✅ [延迟验证] Wiki 候选通过重新验证 (机构匹配 ${retryTop.instScore.toFixed(1)}): ${retryTop.title}` });
                allGatheredData['wikipedia'] = {
                  biography: retryTop.biography,
                  url: retryTop.url,
                  _wikiScore: retryTop.instScore,
                };
              } else {
                sendEvent('log', { step: 'wikipedia', message: `⚠️ [延迟验证] 重新打分后仍无机构匹配，最终丢弃 Wiki 候选。` });
              }
            } else {
              sendEvent('log', { step: 'wikipedia', message: `⚠️ [延迟验证] 后续阶段未积累到新的机构线索，最终丢弃 Wiki 候选。` });
            }
          }

          // ── ORCID 延迟交叉验证 ──────────────────────────────────────────
          // ORCID 也可能搜错人（尤其是没有机构线索时取了第一个结果）
          // 用所有已积累的多源线索做 double check
          if (allGatheredData['orcid'] && allGatheredData['orcid'].employments) {
            const orcidData = allGatheredData['orcid'];
            const orcidOrgs: string[] = (orcidData.employments || []).map((e: any) => e.org).filter(Boolean);
            const orcidEdus: string[] = (orcidData.educations || []).map((e: any) => e.org).filter(Boolean);
            const orcidAllOrgs = [...orcidOrgs, ...orcidEdus];

            // 收集所有非 ORCID 来源的机构/人物线索
            const crossCheckClues: string[] = [];
            if (institution) crossCheckClues.push(institution);
            // Scholar 机构
            const scInsts = allGatheredData['scholar']?.last_known_institutions;
            if (scInsts?.length > 0) {
              scInsts.slice(0, 3).forEach((s: any) => { if (s.display_name) crossCheckClues.push(s.display_name); });
            }
            // Scholar affiliations 文本
            if (allGatheredData['scholar']?.affiliations) {
              crossCheckClues.push(allGatheredData['scholar'].affiliations);
            }
            // 百度百科传记（提取可能包含的机构名）
            const bkBio = allGatheredData['baike']?.biography || '';
            // Wikipedia 传记
            const wkBio = allGatheredData['wikipedia']?.biography || '';

            const uniqueCrossClues = [...new Set(crossCheckClues.filter(Boolean))];

            // 交叉验证：ORCID 的 employments/educations 是否和任何其他来源有交集
            let orcidCrossScore = 0;

            if (uniqueCrossClues.length > 0 && orcidAllOrgs.length > 0) {
              for (const org of orcidAllOrgs) {
                for (const clue of uniqueCrossClues) {
                  // 完整包含
                  if (org.toLowerCase().includes(clue.toLowerCase()) || clue.toLowerCase().includes(org.toLowerCase())) {
                    orcidCrossScore += 2;
                  } else {
                    // 关键词重叠
                    const orgWords = org.split(/[\s,]+/).filter(w => w.length > 2);
                    const clueWords = clue.split(/[\s,]+/).filter(w => w.length > 2);
                    const overlap = orgWords.filter(w => clueWords.some(c => c.toLowerCase() === w.toLowerCase()));
                    if (overlap.length > 0) orcidCrossScore += 0.5 * overlap.length;
                  }
                }
              }
              // 也检查百科传记是否提及 ORCID 的机构
              for (const org of orcidAllOrgs) {
                const orgWords = org.split(/[\s,]+/).filter(w => w.length > 3);
                for (const w of orgWords) {
                  if (bkBio.toLowerCase().includes(w.toLowerCase())) { orcidCrossScore += 0.3; break; }
                  if (wkBio.toLowerCase().includes(w.toLowerCase())) { orcidCrossScore += 0.3; break; }
                }
              }
            }

            if (orcidCrossScore > 0) {
              sendEvent('log', { step: 'orcid', message: `✅ [延迟验证] ORCID 交叉验证通过 (匹配度 ${orcidCrossScore.toFixed(1)})` });
            } else if (uniqueCrossClues.length > 0 || bkBio.length > 50 || wkBio.length > 50) {
              // 有其他来源的线索但 ORCID 完全不匹配 → 大概率搜错人了
              sendEvent('log', { step: 'orcid', message: `⚠️ [延迟验证] ORCID 与其他数据源零交叉，大概率搜错人，已丢弃: ${orcidData.orcid_id}` });
              delete allGatheredData['orcid'];
              // 重新评估置信度
              if (pfConfidence === 'high' && !allGatheredData['scholar']) {
                pfConfidence = 'low';
              }
            } else {
              // 没有其他来源可以交叉验证，保留但标记
              sendEvent('log', { step: 'orcid', message: `🟡 [延迟验证] 无其他来源可交叉验证 ORCID，暂时保留` });
            }
          }

          // Stage +1: AI Assemble
          sendEvent('log', { step: 'ai_assemble', message: `🧠 [最终整合] 数据收集完毕，开始交由大模型组装合并报告...` });

          const client = getOpenAIClient();
          const sourcesFound = Object.keys(allGatheredData).filter(k => !k.startsWith('_')).join('、') || '暂无结构化数据';

          // ── 构造数据源可信度说明 ──
          // pingfang 永远可信（它是主体锚点，通过了消歧）
          // scholar/orcid 如果存在，说明通过了 subjectConsistencyCheck（与锚点人一致）
          // 只有 wikipedia/baike/internet 可能是"同名不同人"的噪音
          const trustedList: string[] = [];
          const suspectList: string[] = [];
          if (allGatheredData['pingfang']) trustedList.push('pingfang');
          if (allGatheredData['scholar']) trustedList.push('scholar');
          if (allGatheredData['orcid']) trustedList.push('orcid');
          if (allGatheredData['wikipedia'] || allGatheredData['baike']) suspectList.push('wikipedia/baike (可能同名不同人)');
          if (allGatheredData['internet'] || allGatheredData['search_internet']) suspectList.push('internet (可能同名不同人)');
          const trustedNote = trustedList.length > 0
            ? `

【数据源可信度】以下数据源与平方库锚点人确认为同一个学者，可以自由合并使用：${trustedList.join('、')}。`
            : '';
          const suspectNote = suspectList.length > 0 && pfConfidence === 'high'
            ? `
【🚨 人一致性警告】以下数据源**很可能包含同名但不同的学者**，**绝对禁止**与可信数据源互相补充或合并：${suspectList.join('、')}。对于这些可疑数据源中的人物简介、论文、机构信息，如果与可信数据源存在任何差异（如研究领域完全不同、供职机构不在同一机构），请**完全丢弃**可疑数据源的该条信息。如果可疑数据源的简介与可信数据源明显对不上，也请丢弃整个可疑数据源。`
            : '';

          const nameCorrectionNote = allGatheredData['_name_correction']
            ? `\n\n【⚠️ 人名纠错提示】用户原始搜索的是"${allGatheredData['_name_correction'].original}"，但未找到此人。系统根据多渠道数据推测用户可能要找的是"${allGatheredData['_name_correction'].corrected}"。请在报告最开头用一句话自然地提示用户（例如："您搜索的'${allGatheredData['_name_correction'].original}'未找到精确匹配，根据检索结果，为您匹配到相似学者**${allGatheredData['_name_correction'].corrected}**，以下是相关信息："），然后正常输出报告。`
            : '';

          const lowConfidenceNote = (pfConfidence === 'low' || pfConfidence === 'none')
            ? `

【🚨 置信度警告】系统检索时使用了机构线索"${institution || '（未提供）'}"，但**平方库和 Scholar/OpenAlex 中没有任何一个候选的机构命中该线索**。这意味着：
- 当前 JSON 中的数据极有可能来自**与搜索目标同名但不同的人**
- 不同数据源的人可能互相矛盾（如研究领域、供职机构完全不同）
- **绝对禁止**将来自不同人的数据互相补充、强行合并成"完整履历"

请在报告最顶部用醒目方式（如 3-5 个 ⚠️）明确告诉用户：**"⚠️ 本次检索置信度极低，极可能未找到您要找的学者。以下数据来自多位同名但可能不同的学者，仅供参考，请勿直接使用。"** 然后仅按数据源分别列出各自的结果，**不要合并**。如果 JSON 中还有 internet 或 search_internet 的线索，也请列出。`
            : '';          const assemblePrompt = `
你是一个专门整理学者和高端人才简历信息的智能报告引擎。
我已经通过多种独立的检索渠道拿到了关于学者 "${searchName}" 的碎片化数据（实际获取到数据的渠道：${sourcesFound}）。
请你不要去浓缩、删减这些信息，而是把它们**有条理地合并与组装**成一份 Markdown 报告，供用户直接阅读。
${nameCorrectionNote}
${trustedNote}
${suspectNote}
${lowConfidenceNote}

【整合规则】
1. **冲突处理**：如果不同来源的数据有冲突（如就职机构），请以「平方学者库」或「权威API (Scholar/Wiki)」为准。如果某一项内容为空，则谁有信息就用谁的。
2. **标明来源**：对于你在报告中呈现的每一块核心信息（如每段教育经历、荣誉、H-index等），都必须在括号里加上真实的数据来源标注，类似 footnote，例如：(来源：pingfang) 或 (来源：scholar)。🚨 如果原始JSON中没有 pingfang 数据，你**绝对禁止**伪造或标注“平方数据”或“平方学者库”的来源角标！
3. **结构化呈现**：请包括以下部分：
   - 核心档案（姓名、现任职位、学术指标等）
   - 百科简介（如果有）
   - 教育经历（请尽量包含学位、学校、专业、起止时间）
   - 工作经历（请尽量包含工作单位、部门、职务、起止时间）
   - 重点学术成果（如存在，请尽可能详细提取）：
     - 论文：发表时间、论文标题、期刊/会议名称、**作者列表**、**收录情况(如SCI/EI/CCF-A)**、**影响因子**。
     - 专利：申请/授权时间、专利名称、**专利类型(发明/实用新型)**、**申请号/公开号**、**所有发明人**、本人角色、**摘要**。
   - 荣誉与基金（请尽量包含获奖时间、奖项名称、**奖项级别(如国际级/国家级/省部级)**、**获奖理由/描述**）

【以下是各渠道返回的原始数据JSON】：
${JSON.stringify(allGatheredData, null, 2)}

🚨 特别注意：你只需输出纯 Markdown 文本，**绝对禁止**将内容包裹在 <zj_report> 或任何其他 XML 标签中。不需要写标题，直接从正文开始。
`;

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

          // 将四阶段原始数据传给 route.ts，供人才日志 (Talent Journal) 保存
          sendEvent('raw_data', { gatheredData: allGatheredData, talentName: searchName, institution: institution || '' });

          sendEvent('done', { message: '报告生成完毕' });
          controller.close();
        } catch (e) {
          sendEvent('error', { message: String(e) });
          controller.close();
        }
      }
    });
}
