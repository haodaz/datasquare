import pinyin from 'pinyin';

// ------------------------------------------------
// 平方库同名消歧工具函数 —— 公共模块
// 决策流程文档: docs/ai/knowledge/talent-deep-search-disambiguation.md
// 从 talentDeepSearch.ts 抽离，供 tool-pingfang-search / tool-scholar-search 等复用
// ------------------------------------------------

export const WEIGHTS = {
  INST_CURRENT: 30,
  INST_HISTORY_WORK: 25,
  INST_HISTORY_EDU: 20,
  RESEARCH_FIELD: 15,
  DATA_RICHNESS: 10,
} as const;

export const ABBREV_MAP: Record<string, string> = {
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

export const CN_ABBREV_MAP: Record<string, string> = {
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

// ------------------------------------------------
// 中文姓名 → 英文拼音变体生成
// ------------------------------------------------

export function generatePinyinVariants(chineseName: string): string[] {
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
// 机构名标准化 & 缩写展开
// ------------------------------------------------

export function normalizeInstName(s: string): string {
  return s.toLowerCase().replace(/[\s,、\-()（）··]/g, '').replace(/university/gi, 'uni').replace(/institute/gi, 'inst');
}

export function tokenizeInst(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,、\-()（）·]+/)
    .filter(w => w.length >= 2);
}

export function expandAbbrev(s: string): string {
  if (!s) return s;
  const lower = s.toLowerCase();
  if (CN_ABBREV_MAP[s]) return CN_ABBREV_MAP[s];
  if (ABBREV_MAP[lower]) return ABBREV_MAP[lower];
  return s;
}

// ------------------------------------------------
// 机构匹配评分
// ------------------------------------------------

export function splitWpValues(raw: any): string[] {
  if (!raw) return [];
  const s = String(raw);
  return s.split(/[、,，|;；]/).map(v => v.trim()).filter(Boolean);
}

export function calcInstMatchScore(query: string, target: string): number {
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

export function calcWpMatchScore(query: string, rawWp: any): number {
  const values = splitWpValues(rawWp);
  if (values.length === 0) return 0;
  return Math.max(...values.map(v => calcInstMatchScore(query, v)));
}

// ------------------------------------------------
// 文本/关键词匹配
// ------------------------------------------------

export function tokenizeKeywords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,、\-，。；;：:·\/\\&]+/)
    .filter(w => w.length >= 2);
}

export function ngramOverlapScore(keyword: string, text: string): number {
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

export function calcTextFieldMatch(queryKeywords: string, text: string): number {
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

// ------------------------------------------------
// 类型定义
// ------------------------------------------------

export interface DisambiguationOptions {
  institution?: string;
  researchField?: string;
}

export interface CandidateScore {
  candidate: any;
  score: number;
  instScore: number;
  breakdown: string[];
}

export interface DisambiguationResult {
  top: any;
  allScores: CandidateScore[];
  confidence: 'high' | 'low' | 'fallback';
  usedFallback: boolean;
}

// ------------------------------------------------
// 核心打分 & 消歧
// ------------------------------------------------

export function scoreCandidate(candidate: any, opts: DisambiguationOptions): CandidateScore {
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
  breakdown.push(`数据完整度 +${richnessScore} (专利${patentCount} + 论文${paperCount} + 工作${workExpCount})`);
  total += richnessScore;

  return { candidate, score: total, instScore, breakdown };
}

export function runPingfangDisambiguation(candidates: any[], opts: DisambiguationOptions): DisambiguationResult {
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
// 主体一致性校验（用 Pingfang 锚点人交叉验证 Scholar/ORCID 候选）
// ------------------------------------------------

export function subjectConsistencyCheck(anchor: any, candidate: any, pfConfidence: 'high' | 'low' | 'none'): { pass: boolean; score: number; reasons: string[] } {
  if (pfConfidence !== 'high' || !anchor || !candidate) {
    return { pass: true, score: 0, reasons: ['pfConfidence !== high, skip check'] };
  }

  const reasons: string[] = [];
  let score = 0;

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

  const anchorEn = String(anchor.name_en || '').toLowerCase().replace(/[^a-z]/g, '');
  const candName = String(candidate.display_name || candidate.name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (anchorEn && candName && (anchorEn === candName || anchorEn.includes(candName) || candName.includes(anchorEn))) {
    score += 20;
    reasons.push(`名字高度相似 (${anchorEn} ≈ ${candName})`);
  }

  const pass = score >= 30;
  return { pass, score, reasons };
}

// ============================================================
// V2 消歧引擎 —— 乘法主导 + Embedding + 合作者网络
// 权重：Inst 25 | Field 20 | Coauthor 25 | History 20 | Richness 10
// 排序公式：(Inst^0.5) * (Field^0.3) * (Coauthor^0.2) + 0.1*Softmax(Richness)
// ============================================================

// ── LCS (最长公共子序列) ──
function lcsLen(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function lcsScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = normalizeInstName(a);
  const nb = normalizeInstName(b);
  if (!na || !nb) return 0;
  const L = lcsLen(na, nb);
  const denom = Math.max(na.length, nb.length);
  return denom === 0 ? 0 : L / denom;
}

// ── V2 机构匹配：LCS 替代 includes + 历史延续性验证 ──
export function calcInstScoreV2(query: string, candidate: any): number {
  if (!query) return 0;
  let score = 0;
  const breakdown: string[] = [];

  const wpValues = splitWpValues(candidate.workplace_current);
  const schoolValues = splitWpValues(candidate.school_current);
  const allCurrent = [...wpValues, ...schoolValues].filter(Boolean);

  // 1. 当前机构 LCS (0~1)，权重 0.5
  let bestCurrent = 0;
  for (const curr of allCurrent) {
    const l = lcsScore(query, curr);
    const inc = calcInstMatchScore(query, curr);
    const combined = Math.max(l, inc);
    if (combined > bestCurrent) bestCurrent = combined;
  }
  score += 0.5 * bestCurrent;

  // 2. 历史延续性验证 (历史工作/教育中是否出现查询机构)
  const workList = (candidate.work_experiences as any[]) || [];
  const eduList = (candidate.education_backgrounds as any[]) || [];
  const historyOrgs: string[] = [];
  for (const w of workList) if (w?.employer) historyOrgs.push(String(w.employer));
  for (const e of eduList) {
    if (e?.school_name_cn) historyOrgs.push(String(e.school_name_cn));
    if (e?.school_name_en) historyOrgs.push(String(e.school_name_en));
  }

  let historyHit = 0;
  for (const h of historyOrgs) {
    const l = lcsScore(query, h);
    const inc = calcInstMatchScore(query, h);
    if (Math.max(l, inc) > 0.7) { historyHit++; break; }
  }
  const continuityBonus = historyHit > 0 ? 0.5 : 0;
  score += continuityBonus;

  return Math.min(1, score);
}

// ── 合作者网络提取 + Jaccard ──
function extractCoauthors(candidate: any): Set<string> {
  const set = new Set<string>();
  // papers.authors: 逗号分隔
  const papers = (candidate.papers as any[]) || [];
  for (const p of papers.slice(0, 30)) {
    if (p?.authors) {
      for (const a of String(p.authors).split(/[,，;；]/)) {
        const name = a.trim();
        if (name.length >= 2) set.add(name.toLowerCase());
      }
    }
  }
  // patents.inventors: 分号分隔
  const patents = (candidate.patents as any[]) || [];
  for (const pt of patents.slice(0, 15)) {
    if (pt?.inventors) {
      for (const a of String(pt.inventors).split(/[;；,，]/)) {
        const name = a.trim();
        if (name.length >= 2) set.add(name.toLowerCase());
      }
    }
  }
  return set;
}

export function calcCoauthorScore(candidate: any, anchor: any): number {
  if (!anchor) return 0;
  const aAuthors = extractCoauthors(anchor);
  const cAuthors = extractCoauthors(candidate);
  if (aAuthors.size === 0 || cAuthors.size === 0) return 0;

  let inter = 0;
  for (const a of aAuthors) if (cAuthors.has(a)) inter++;
  const union = aAuthors.size + cAuthors.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ── DASHSCOPE Embedding 批量调用 ──
let _embedCache = new Map<string, number[][]>();
let _embedPending = false;

async function batchEmbed(texts: string[]): Promise<number[][]> {
  const cacheKey = texts.join('|||');
  if (_embedCache.has(cacheKey)) return _embedCache.get(cacheKey)!;
  if (!process.env.DASHSCOPE_API_KEY) return texts.map(() => []);

  try {
    const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-v3',
        input: { texts },
      }),
    });
    if (!res.ok) return texts.map(() => []);
    const data = await res.json();
    const embs: number[][] = (data?.output?.embeddings || []).map((e: any) => e.embedding);
    if (embs.length === texts.length) {
      _embedCache.set(cacheKey, embs);
      return embs;
    }
    return texts.map(() => []);
  } catch {
    return texts.map(() => []);
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const na = Math.sqrt(normA), nb = Math.sqrt(normB);
  if (na === 0 || nb === 0) return 0;
  return (dot / (na * nb) + 1) / 2; // normalize to [0, 1]
}

// ── 数据完整度 softmax ──
function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => sum === 0 ? 0 : e / sum);
}

function calcRichness(candidate: any): number {
  const patents = (candidate.patents as any[])?.length || 0;
  const papers = (candidate.papers as any[])?.length || 0;
  const works = (candidate.work_experiences as any[])?.length || 0;
  return patents * 2 + papers * 2 + works;
}

// ── V2 类型 ──
export interface DisambiguationOptionsV2 {
  queryName?: string;
  institution?: string;
  researchField?: string;
  anchorCandidate?: any;
}

export interface CandidateScoreV2 {
  candidate: any;
  score: number;
  nameScore: number;
  instScore: number;
  fieldScore: number;
  coauthorScore: number;
  richnessScore: number;
  breakdown: string[];
}

export interface DisambiguationResultV2 {
  top: any;
  allScores: CandidateScoreV2[];
  confidence: 'high' | 'low' | 'fallback';
  usedFallback: boolean;
}

// ── 姓名一致性比对 ──
function normalizeName(s: string): string {
  return String(s || '').trim().toLowerCase().replace(/[\s·\-·]+/g, '');
}
function normalizeWords(s: string): string[] {
  return String(s || '').trim().toLowerCase().split(/[\s·\-·]+/).filter(Boolean);
}
function isAscii(s: string): boolean {
  return /^[\x00-\x7F]+$/.test(s);
}
function pinyinOf(s: string): string {
  if (!s || !/[一-龥]/.test(s)) return s; // 全是ASCII → 不转
  return ((pinyin as any)(s, { style: 'normal' }) as string[][]).map((a: string[]) => a[0]).join('');
}
function sortedChars(s: string): string {
  return s.split('').sort().join('');
}

export function calcNameScore(queryName: string, candidate: any): number {
  const q = normalizeName(queryName);
  if (!q) return 0.6;
  const rawCandName = String(candidate?.name || '');
  const rawCandNameEn = String(candidate?.name_en || '');
  const c = normalizeName(rawCandName) || normalizeName(rawCandNameEn);
  if (!c) return 0.3;

  if (q === c) return 1;

  // ── 路径1: 英文姓名 —— 词序不敏感 ──
  // "Bin Wang" ≈ "Wang Bin" — 同一组词换序
  const qWords = normalizeWords(queryName);
  const cWords = normalizeWords(rawCandNameEn || rawCandName);
  if (qWords.length >= 2 && cWords.length >= 2) {
    const qSet = new Set(qWords);
    const cSet = new Set(cWords);
    const intersection = [...qSet].filter(w => cSet.has(w));
    if (intersection.length === qSet.size && intersection.length === cSet.size && qSet.size === cSet.size) {
      // 同一组词，顺序可能不同
      const qJoined = qWords.join('');
      const cJoined = cWords.join('');
      if (qJoined !== cJoined) return 0.9; // 顺序不同 → 0.9
    }
  }

  // ── 路径2: 拼音比对 ──
  const qPinyin = pinyinOf(q);
  const cPinyin = pinyinOf(c);

  if (qPinyin && cPinyin && qPinyin !== q && cPinyin !== c) {
    // 两边都是中文 → 已转换成拼音，可以比对
    if (qPinyin === cPinyin) return 0.8; // 同拼音不同写法
    if (sortedChars(qPinyin) === sortedChars(cPinyin) && qPinyin !== cPinyin) {
      return 0.75; // 同音节但顺序不同，如 "binwang" vs "wangbin"
    }
    if (qPinyin.startsWith(cPinyin) || cPinyin.startsWith(qPinyin)) return 0.3;
  } else if (qPinyin !== cPinyin) {
    // 一边是拼音/英文，另一边是中文 —— 用拼音的一方去匹配
    // query="bin wang" → qPinyin="binwang", candidate="王斌" → cPinyin="wangbin"
    // 这时候 sorted 比较能识别出来
    if (qPinyin && cPinyin && sortedChars(qPinyin) === sortedChars(cPinyin) && qPinyin !== cPinyin) {
      return 0.75; // 同音节但顺序不同
    }
    if (qPinyin && cPinyin && qPinyin.startsWith(cPinyin)) return 0.3;
    if (qPinyin && cPinyin && cPinyin.startsWith(qPinyin)) return 0.3;
  }

  // ── 路径3: 原文前缀/包含 ──
  // query="刘翔" candidate="刘翔宇" → query ⊂ candidate → 扣分重
  if (c.startsWith(q) && c.length > q.length) return 0.25;
  if (q.startsWith(c) && q.length > c.length) return 0.4;
  if (q.includes(c) && q !== c) return 0.3;
  if (c.includes(q) && c !== q) return 0.25;

  return 0.1; // 完全不沾边
}

// ── V2 核心打分 ──
export async function scoreCandidateV2(candidate: any, opts: DisambiguationOptionsV2, queryEmb?: number[]): Promise<CandidateScoreV2> {
  const breakdown: string[] = [];
  const hasInst = !!opts.institution;
  const hasField = !!opts.researchField;

  // 0. 姓名一致性（第一维度，硬门槛）
  let nameScore = 0.6;
  if (opts.queryName) {
    nameScore = calcNameScore(opts.queryName, candidate);
    breakdown.push(`姓名匹配 ${nameScore.toFixed(2)}`);
  }

  // 1. 机构匹配 (0~1) —— 无线索时默认 1.0（中性，不占乘法预算）
  let instScore = hasInst ? calcInstScoreV2(opts.institution!, candidate) : 1.0;
  if (hasInst) breakdown.push(`机构匹配 ${instScore.toFixed(2)} (LCS+延续性)`);

  // 2. 研究领域 (0~1) —— Embedding 为主，Ngram 兜底加权
  let fieldScore = 1.0; // 无线索默认中性
  if (hasField) {
    const rf = String(candidate.research_field || '');
    const intro = String(candidate.introduction || '');
    const combined = `${rf} ${intro}`;
    const ngramBase = calcTextFieldMatch(opts.researchField!, combined);
    if (queryEmb && queryEmb.length > 0) {
      const candEmb = await batchEmbed([combined.length > 50 ? combined.substring(0, 500) : combined]);
      if (candEmb[0]?.length) {
        const embSim = cosine(queryEmb, candEmb[0]);
        fieldScore = 0.7 * embSim + 0.3 * ngramBase; // Embedding 主导，Ngram 辅助
        breakdown.push(`研究领域 ${fieldScore.toFixed(2)} (Embedding ${embSim.toFixed(2)} × 0.7 + Ngram ${ngramBase.toFixed(2)} × 0.3)`);
      } else {
        fieldScore = ngramBase;
        breakdown.push(`研究领域 ${fieldScore.toFixed(2)} (Ngram-only)`);
      }
    } else {
      fieldScore = ngramBase;
      breakdown.push(`研究领域 ${fieldScore.toFixed(2)} (Ngram-only)`);
    }
  }

  // 3. 合作者网络 Jaccard (0~1) —— 只有有机构线索时才启用（无机构时大家都不是同机构同行，合著者无意义）
  let coauthorScore = 0;
  if (hasInst && opts.anchorCandidate && opts.anchorCandidate !== candidate) {
    coauthorScore = calcCoauthorScore(candidate, opts.anchorCandidate);
    if (coauthorScore > 0) breakdown.push(`合作者重叠 ${coauthorScore.toFixed(2)} (Jaccard)`);
  } else if (hasInst && opts.anchorCandidate) {
    breakdown.push(`合作者重叠 — (anchor 自身跳过，待回填)`);
  }

  // 4. 数据完整度 (后面 softmax 归一化)
  const richness = calcRichness(candidate);

  // ── 动态幂次：有哪个线索，就给哪个更大权重 ──
  const namePow = opts.queryName ? Math.pow(Math.max(0.01, nameScore), 0.3) : 1;
  // inst: 0.4 有机构 / 0 (无线索时 instScore=1.0, 这个项自然消失)
  const instPow = Math.pow(Math.max(0.01, instScore), hasInst ? 0.4 : 0.01); // 无线索时幂次≈0，instPow≈1
  // field: 0.25 有机构辅助 / 0.4 无机构时让 field 主导
  const fieldPow = hasField ? Math.pow(Math.max(0.01, fieldScore), hasInst ? 0.25 : 0.4) : 1;
  const coauthPow = opts.anchorCandidate ? Math.pow(Math.max(0.01, coauthorScore), 0.2) : 1;
  const multiplicative = namePow * instPow * fieldPow * coauthPow;

  return {
    candidate,
    score: 0,
    nameScore,
    instScore,
    fieldScore,
    coauthorScore,
    richnessScore: richness,
    breakdown,
  };
}

export async function runPingfangDisambiguationV2(candidates: any[], opts: DisambiguationOptionsV2): Promise<DisambiguationResultV2> {
  if (candidates.length === 0) throw new Error('No candidates');
  const hasInst = !!opts.institution;
  const hasField = !!opts.researchField;

  // 预热 query embedding（如果有 research_field）
  let queryEmb: number[] | undefined;
  if (opts.researchField) {
    const [emb] = await batchEmbed([opts.researchField]);
    queryEmb = emb;
  }

  // 选 anchor：第一个有较多 papers/patents 的候选（合作者计算的基准）
  let anchor = opts.anchorCandidate;
  if (!anchor) {
    anchor = candidates.reduce((best, c) => {
      const bc = ((best.papers?.length || 0) + (best.patents?.length || 0));
      const cc = ((c.papers?.length || 0) + (c.patents?.length || 0));
      return cc > bc ? c : best;
    }, candidates[0]);
  }

  // 所有候选并发打分
  const scored = await Promise.all(candidates.map(c => scoreCandidateV2(c, { ...opts, anchorCandidate: anchor }, queryEmb)));

  // ── Fix anchor 自身的 coauthScore（仅当有机构线索时才有意义） ──
  if (hasInst) {
    const anchorIdx = scored.findIndex(s => s.candidate === anchor);
    if (anchorIdx >= 0) {
      let anchorMaxCoauth = 0;
      for (let i = 0; i < scored.length; i++) {
        if (i === anchorIdx) continue;
        const sc = calcCoauthorScore(scored[i].candidate, anchor);
        if (sc > anchorMaxCoauth) anchorMaxCoauth = sc;
      }
      scored[anchorIdx].coauthorScore = anchorMaxCoauth;
      const bd = scored[anchorIdx].breakdown;
      const idx = bd.findIndex(b => b.includes('anchor 自身跳过'));
      if (idx >= 0) {
        if (anchorMaxCoauth > 0) {
          bd[idx] = `合作者重叠 ${anchorMaxCoauth.toFixed(2)} (与其他候选互比)`;
        } else {
          bd.splice(idx, 1);
        }
      }
    }
  }

  // richness softmax 归一化
  const richnessValues = scored.map(s => Math.log(1 + Math.max(0, s.richnessScore)));
  const sm = softmax(richnessValues);

  // 套乘法公式 + softmax richness（与 scoreCandidateV2 保持完全一致的动态幂次）
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i];
    const namePow = opts.queryName ? Math.pow(Math.max(0.01, s.nameScore), 0.3) : 1;
    const instPow = Math.pow(Math.max(0.01, s.instScore), hasInst ? 0.4 : 0.01);
    const fieldPow = hasField ? Math.pow(Math.max(0.01, s.fieldScore), hasInst ? 0.25 : 0.4) : 1;
    const coauthPow = hasInst && anchor ? Math.pow(Math.max(0.01, s.coauthorScore), 0.2) : 1;
    const multiplicative = namePow * instPow * fieldPow * coauthPow;
    s.score = multiplicative + 0.03 * sm[i];
    s.richnessScore = richnessValues[i];
    s.breakdown.push(`乘法值=${multiplicative.toFixed(3)}, softmax_rich=${sm[i].toFixed(3)} → score=${s.score.toFixed(3)}`);
  }

  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  let confidence: DisambiguationResultV2['confidence'] = 'high';
  let usedFallback = false;

  // 置信度判定：同时考虑姓名匹配和分差
  const topMargin = scored[0].score - (scored[1]?.score || 0);
  const nameHit = opts.queryName && top.nameScore >= 0.9;

  if (opts.queryName && !nameHit) {
    confidence = 'fallback';
    usedFallback = true;
  } else if (opts.institution) {
    const anyInstHit = scored.some(s => s.instScore > 0.3);
    if (!anyInstHit) {
      confidence = 'low';
      usedFallback = true;
    } else if (topMargin < 0.05) {
      confidence = 'low';
      usedFallback = true;
    }
  } else if (topMargin < 0.05) {
    confidence = 'low';
    usedFallback = true;
  }

  return { top: top.candidate, allScores: scored, confidence, usedFallback };
}
