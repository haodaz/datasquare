/**
 * 人才审计简历解析工具函数
 * 从 route handler 中抽离纯函数，便于测试和复用
 */

// ── 常量 ──────────────────────────────────────────────────────────────────

/** 送入模型的每段文本长度上限（字符数） */
export const PARSE_CHUNK_SIZE = 15_000;

/** 模型输出 token 上限，避免延迟过大同时确保完整 JSON */
export const PARSE_MAX_TOKENS = 8_192;

// ── 输入预处理 ────────────────────────────────────────────────────────────

export type PreparedText = {
  text: string;
  truncated: boolean;
  originalLength: number;
  /** 文本中 U+FFFD（PDF 乱码）的数量 */
  replacementCharCount: number;
};

/**
 * 预处理单段文本：trim、统计乱码字符。
 */
export function prepareResumeText(
  raw: string,
  maxChars: number = PARSE_CHUNK_SIZE,
): PreparedText {
  const text = (raw || '').trim();
  const originalLength = text.length;
  const effectiveText = originalLength <= maxChars ? text : text.slice(0, maxChars);
  const replacementCharCount = (effectiveText.match(/\uFFFD/g) || []).length;

  return {
    text: effectiveText,
    truncated: originalLength > maxChars,
    originalLength,
    replacementCharCount,
  };
}

/**
 * 将超长文本按段落边界切分为多个 chunk。
 * 每个 chunk 不超过 maxChars，尽量在换行处切分避免截断句子。
 */
export function splitTextIntoChunks(
  raw: string,
  maxChars: number = PARSE_CHUNK_SIZE,
): string[] {
  const text = (raw || '').trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // 在 maxChars 范围内找最后一个段落分隔符
    let cutPoint = maxChars;
    const searchRange = remaining.slice(Math.floor(maxChars * 0.8), maxChars);
    const lastNewline = searchRange.lastIndexOf('\n\n');
    if (lastNewline !== -1) {
      cutPoint = Math.floor(maxChars * 0.8) + lastNewline + 2;
    } else {
      const lastSingleNewline = searchRange.lastIndexOf('\n');
      if (lastSingleNewline !== -1) {
        cutPoint = Math.floor(maxChars * 0.8) + lastSingleNewline + 1;
      }
    }

    chunks.push(remaining.slice(0, cutPoint).trim());
    remaining = remaining.slice(cutPoint).trim();
  }

  return chunks;
}

// ── 分段解析结果合并 ─────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

/**
 * 合并多段解析结果。
 * 第一段作为基础（包含姓名、title 等基本信息），
 * 后续段的数组字段（education、experience 等）追加合并，去重。
 */
export function mergeResumeResults(results: AnyRecord[]): AnyRecord {
  if (results.length === 0) return {};
  if (results.length === 1) return results[0];

  const base = JSON.parse(JSON.stringify(results[0])) as AnyRecord;
  const baseResume = (base.resume as AnyRecord) || base;

  const arrayFields = [
    'education', 'experience', 'publications', 'patents',
    'projects', 'skills', 'exams', 'awards', 'affiliations',
  ];

  for (let i = 1; i < results.length; i++) {
    const extra = (results[i] as AnyRecord).resume as AnyRecord || results[i] as AnyRecord;

    for (const field of arrayFields) {
      const baseArr = Array.isArray(baseResume[field]) ? baseResume[field] as unknown[] : [];
      const extraArr = Array.isArray(extra[field]) ? extra[field] as unknown[] : [];

      if (extraArr.length > 0) {
        // 简单去重：对于 object 数组，按核心字段判断是否重复
        const existingKeys = new Set(
          baseArr.map(item => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
              const r = item as AnyRecord;
              // 用 name/title/school/company 等核心字段做去重 key
              return String(r.name || r.title || r.school || r.company || r.role || JSON.stringify(r)).toLowerCase().trim();
            }
            return String(item);
          }),
        );

        for (const newItem of extraArr) {
          let key: string;
          if (typeof newItem === 'string') {
            key = newItem;
          } else if (typeof newItem === 'object' && newItem !== null) {
            const r = newItem as AnyRecord;
            key = String(r.name || r.title || r.school || r.company || r.role || JSON.stringify(r)).toLowerCase().trim();
          } else {
            key = String(newItem);
          }
          if (!existingKeys.has(key)) {
            baseArr.push(newItem);
            existingKeys.add(key);
          }
        }

        baseResume[field] = baseArr;
      }
    }

    // 补充基本信息：如果第一段缺失，用后续段补充
    const stringFields = ['name', 'chineseName', 'englishName', 'title', 'subtitle', 'primaryInstitution', 'personalStatement'];
    for (const field of stringFields) {
      if (!baseResume[field] && extra[field]) {
        baseResume[field] = extra[field];
      }
    }
  }

  return base;
}

/**
 * 根据乱码检测结果生成 user prompt 附加修复提示。
 */
export function buildRepairHint(replacementCharCount: number): string {
  if (replacementCharCount === 0) return '';
  return `\n\nNOTE: The source text contains ${replacementCharCount} Unicode replacement character(s) (U+FFFD), usually from failed PDF glyph/font extraction. Reconstruct those spans from surrounding technical context; do NOT copy U+FFFD into the JSON output.`;
}

/**
 * 构建截断提示（用于多段中的非首段）。
 */
export function buildChunkNote(chunkIndex: number, totalChunks: number): string {
  if (totalChunks <= 1) return '';
  return ` (chunk ${chunkIndex + 1} of ${totalChunks})`;
}

// ── 简历内容特征检测 ──────────────────────────────────────────────────────

const RESUME_KEYWORDS_ZH = [
  '教育', '学历', '工作经历', '实习', '项目经验', '技能', '获奖', '论文', '专利',
  '大学', '学士', '硕士', '博士', '毕业', '简历', '求职', '自我评价', '联系方式',
  '邮箱', '电话', '职位', '任职', '研究方向', '工程师', '教授', '研究员', '主任',
  '院士', '学术兼职', '课题', '基金', '中科院', '清华', '北大',
];
const RESUME_KEYWORDS_EN = [
  'education', 'experience', 'skills', 'university', 'bachelor', 'master', 'phd',
  'resume', 'curriculum vitae', 'publications', 'awards', 'honors', 'employment',
  'position', 'professor', 'engineer', 'research', 'degree', 'gpa', 'certification',
  'postdoc', 'fellow', 'ieee', 'acm',
];

export function detectResumeContent(text: string): {
  isLikelyResume: boolean;
  confidence: number;
  hint: string;
} {
  const lower = text.toLowerCase();
  let matchCount = 0;

  for (const kw of RESUME_KEYWORDS_ZH) {
    if (text.includes(kw)) matchCount++;
  }
  for (const kw of RESUME_KEYWORDS_EN) {
    if (lower.includes(kw)) matchCount++;
  }

  // 日期模式（简历常见）
  const dateMatches = text.match(
    /(\d{4}[.\-/年]\s*\d{1,2}|\d{4}\s*[-–~至]\s*(present|至今|\d{4}))/gi,
  );
  if (dateMatches && dateMatches.length >= 2) matchCount += 2;

  // 邮箱/电话
  if (/[\w.-]+@[\w.-]+\.\w+/.test(text)) matchCount += 1;
  if (/\d{3}[-.\s]?\d{4}[-.\s]?\d{4}|\d{11}|\+\d{1,3}\s?\d{6,}/.test(text)) matchCount += 1;

  const confidence = Math.min(matchCount / 5, 1);

  if (matchCount >= 3) {
    return { isLikelyResume: true, confidence, hint: '' };
  } else if (matchCount >= 1) {
    return {
      isLikelyResume: true,
      confidence,
      hint: '输入内容的简历特征较弱，解析结果可能不够完整。建议提供更详细的简历信息。',
    };
  } else {
    return {
      isLikelyResume: false,
      confidence: 0,
      hint: '输入内容不太像简历/CV，缺少教育背景、工作经历等关键信息。仍将尝试解析，但结果可能不理想。',
    };
  }
}

// ── JSON 提取 ─────────────────────────────────────────────────────────────

/**
 * 从模型输出中提取 JSON 对象。
 * 处理模型可能附带的 markdown fences 或多余文本。
 */
export function extractJsonObject(content: string): Record<string, unknown> {
  const startIndex = content.indexOf('{');
  const endIndex = content.lastIndexOf('}');
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    return JSON.parse(content.substring(startIndex, endIndex + 1));
  }
  return JSON.parse(content);
}

// ── 后处理规范化 ──────────────────────────────────────────────────────────

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

/**
 * 确保输出格式统一为 { resume: {...} }，
 * 无论模型输出嵌套还是扁平结构。
 */
export function normalizeParseResult(jsonResult: unknown): { resume: AnyRecord } {
  const root = asRecord(jsonResult);
  if (!root) throw new Error('Parse result is not an object');

  const nested = asRecord(root.resume);
  if (nested) return { resume: nested };

  // 模型输出了扁平结构：把整个 root 当作 resume
  return { resume: root };
}

/**
 * 数组安全化：确保关键数组字段存在且为数组（AI 有时返回 null 或 undefined）。
 */
export function sanitizeArrayFields(resume: AnyRecord): AnyRecord {
  const arrayFields = [
    'education', 'experience', 'publications', 'patents',
    'projects', 'skills', 'exams', 'awards', 'affiliations',
  ];

  for (const field of arrayFields) {
    if (!Array.isArray(resume[field])) {
      resume[field] = [];
    }
  }

  // 子数组安全化
  if (Array.isArray(resume.experience)) {
    for (const exp of resume.experience as AnyRecord[]) {
      if (exp && typeof exp === 'object') {
        // description 可能是 string 或 string[]，统一为 string
        if (Array.isArray(exp.description)) {
          exp.description = (exp.description as string[]).join('\n');
        }
      }
    }
  }

  if (Array.isArray(resume.education)) {
    for (const edu of resume.education as AnyRecord[]) {
      if (edu && typeof edu === 'object') {
        // 确保 major/degree 拆分
        normalizeMajorDegree(edu);
      }
    }
  }

  return resume;
}

// ── 教育背景 major/degree 智能拆分 ───────────────────────────────────────

const DEGREE_TOKENS = [
  '博士后', '博士', '博士研究生', '硕士', '硕士研究生', '研究生',
  '本科', '学士', '专科', '大专', '高职',
  'MBA', 'EMBA', 'MPA',
  'PhD', 'Ph.D', 'Doctor', 'Doctorate', 'Postdoc', 'Post-doc',
  'Master', "Master's", 'Bachelor', "Bachelor's", 'Associate',
];

function looksLikeDegree(token: string): boolean {
  const compact = (token || '').trim().replace(/\s+/g, '');
  if (!compact) return false;
  return DEGREE_TOKENS.some((d) => {
    const dc = d.replace(/\s+/g, '');
    return compact === dc || compact.includes(dc) || dc.includes(compact);
  });
}

/**
 * 如果 degree 中混入了专业信息（如 "计算机·本科"），拆分到 major/degree。
 * 只在 major 为空时才尝试拆分。
 */
export function normalizeMajorDegree(edu: AnyRecord): void {
  const major = String(edu.major || '').trim();
  const degree = String(edu.degree || '').trim();

  // major 已有值，不需要拆分
  if (major) return;
  if (!degree) return;

  // 尝试按 · • | 等分隔符拆分
  const normalized = degree
    .replace(/[·•|｜]/g, '·')
    .replace(/\s*[—–\-]\s*/g, '·')
    .trim();

  const parts = normalized.split('·').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0];
    const b = parts.slice(1).join(' · ');
    if (looksLikeDegree(a) && !looksLikeDegree(b)) {
      edu.major = b;
      edu.degree = a;
    } else if (looksLikeDegree(b) && !looksLikeDegree(a)) {
      edu.major = a;
      edu.degree = b;
    }
    // 都像 degree 或都不像，保持原样
    return;
  }

  // 无分隔符：尝试「博士 计算机」或「计算机本科」
  for (const token of DEGREE_TOKENS) {
    const escaped = token.replace('.', '\\\\.');
    // "博士 计算机"
    const m1 = normalized.match(new RegExp(`^${escaped}\\\\s+(.+)$`, 'i'));
    if (m1?.[1]) { edu.major = m1[1].trim(); edu.degree = token; return; }
    // "计算机 博士"
    const m2 = normalized.match(new RegExp(`^(.+?)\\\\s+${escaped}$`, 'i'));
    if (m2?.[1] && !looksLikeDegree(m2[1])) { edu.major = m2[1].trim(); edu.degree = token; return; }
    // "计算机本科"（无空格紧连）
    const m3 = normalized.match(new RegExp(`^(.+?)${escaped}$`, 'i'));
    if (m3?.[1] && m3[1].length >= 2 && !looksLikeDegree(m3[1])) {
      edu.major = m3[1].trim();
      edu.degree = token;
      return;
    }
  }
}

/**
 * 清理字符串中的 U+FFFD 字符（PDF 乱码残留）。
 * 递归处理 object/array 中所有 string 值。
 */
export function cleanReplacementChars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\uFFFD/g, '');
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanReplacementChars);
  }
  if (obj && typeof obj === 'object') {
    const result: AnyRecord = {};
    for (const [key, value] of Object.entries(obj as AnyRecord)) {
      result[key] = cleanReplacementChars(value);
    }
    return result;
  }
  return obj;
}
