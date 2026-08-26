/**
 * 一键AI扫描 — Prompt 工程
 * 
 * 三阶段流水线：
 * Stage 1: Router（人才池分类器）
 * Stage 2: 6 维度并行评审团
 * Stage 3: 总编 Synthesizer
 * 
 * 从 DT 项目 competitivenessPrompts.ts 移植，
 * 适配人才引进场景的 5 级人才池和 6 个评估维度。
 */

import type { TalentPool } from './talentClassification';
import { TALENT_CLASSIFICATION_DB } from './talentClassification';

// ── 权重矩阵 ──────────────────────────────────────────────────────
export const WEIGHT_MATRICES: Record<TalentPool, Record<string, number>> = {
  '潜力人才': {
    education: 0.30,
    research: 0.15,
    industry: 0.10,
    leadership: 0.05,
    innovation: 0.25,
    social: 0.15,
  },
  '青年人才': {
    education: 0.20,
    research: 0.25,
    industry: 0.15,
    leadership: 0.10,
    innovation: 0.20,
    social: 0.10,
  },
  '优秀人才': {
    education: 0.15,
    research: 0.25,
    industry: 0.20,
    leadership: 0.15,
    innovation: 0.15,
    social: 0.10,
  },
  '杰出人才': {
    education: 0.10,
    research: 0.25,
    industry: 0.20,
    leadership: 0.15,
    innovation: 0.15,
    social: 0.15,
  },
  '领军人才': {
    education: 0.05,
    research: 0.15,
    industry: 0.25,
    leadership: 0.25,
    innovation: 0.15,
    social: 0.15,
  },
};

// ── 池子乘数：高级别人才总分自然高于低级别 ────────────────
// 设计意图：最差的领军人才也应超过普通的优秀人才
// 领军×1.20 vs 优秀×1.00 → 领军70分 = 84 > 优秀80分 = 80
export const POOL_MULTIPLIER: Record<TalentPool, number> = {
  '潜力人才': 0.90,
  '青年人才': 0.95,
  '优秀人才': 1.00,
  '杰出人才': 1.05,
  '领军人才': 1.12,
};

// ── 维度定义 ──────────────────────────────────────────────────────
export const EVALUATOR_DIMENSIONS = [
  { key: 'education', title: '学术与教育底蕴', icon: '🎓' },
  { key: 'research', title: '科研与学术影响力', icon: '📊' },
  { key: 'industry', title: '产业与实践价值', icon: '💼' },
  { key: 'leadership', title: '领导与团队管理', icon: '👥' },
  { key: 'innovation', title: '创新与前沿探索', icon: '🚀' },
  { key: 'social', title: '社会与行业影响力', icon: '🌐' },
] as const;

export type DimensionKey = typeof EVALUATOR_DIMENSIONS[number]['key'];

// ── 按池子独立的评分标尺（解决「五池共用刻度」导致的标准串号问题）────
const POOL_SCORING_RUBRICS: Record<TalentPool, string> = {
  '潜力人才': `
【💯 潜力人才专属打分尺子 (0-100)】
- 90-100 (顶尖)：C9/常青藤/全球Top30名校 + 顶会一作或国际顶级竞赛金奖 + 顶级导师课题组核心成员。在同级别学生中属于万里挑一。
- 80-89 (优秀)：985/海外知名高校 + 有独立科研产出（如会议论文、专利申请）+ 省级竞赛获奖或GPA前10%。
- 60-79 (合格)：211/普通一本 + 基本学业完成 + 有初步科研接触或实习经历，中规中矩。
- <60 (不足)：学业表现平平 + 无科研/实践经历 + 缺乏成长亮点。
注意：这是评估「潜力」和「学术起点」，不要用资深学者的标准（如H-index、国家基金）来要求学生。`,

  '青年人才': `
【💯 青年人才专属打分尺子 (0-100)】
- 90-100 (顶尖)：Nature/Science/Cell 系列发表 + H-index同龄前5% + 国家优青/海外优青 + 独立PI或课题组长。
- 80-89 (优秀)：顶会/顶刊多篇 + 独立主持课题 + 省部级人才计划或奖项 + 有明确的学术成长轨迹。
- 60-79 (合格)：已取得博士学位 + 有基本科研产出 + 参与过正规研究项目，但缺乏突出亮点。
- <60 (不足)：科研产出匮乏 + 缺乏独立研究能力 + 学术轨迹不清晰。
注意：对标的是博士/博后/青年科研人员群体，不要用院士/Fellow的标准来要求。`,

  '优秀人才': `
【💯 优秀人才专属打分尺子 (0-100)】
- 90-100 (顶尖)：国家杰青/省部级一等奖 + 多项核心专利已转化 + 在细分领域排名前10% + 有标志性代表作系列。
- 80-89 (优秀)：国家基金中标 + 有代表性成果系列 + 受邀学术会议报告 + 初步建立学术声誉。
- 60-79 (合格)：有独立科研能力 + 常规学术产出 + 一般项目负责经历，但缺乏突破性成果。
- <60 (不足)：产出平庸 + 缺乏代表性成果 + 与「优秀人才」定位不匹配。`,

  '杰出人才': `
【💯 杰出人才专属打分尺子 (0-100)】
- 90-100 (卓越)：学会最高科技奖 + 开创子领域/学术流派 + H-index在领域Top5% + 学术谱系弟子成就突出。
- 80-89 (优秀)：国家重大项目首席 + 在领域内有较高知名度 + 跨方向交叉贡献 + 核心专利产业化。
- 60-79 (合格)：国家级项目参与 + 稳定高质量产出 + 有一定行业认可，但尚未达到引领级别。
- <60 (不足)：影响力与「杰出人才」定位存在明显落差。
注意：此级别更关注「影响力峰值」和「领域引领性」，而非简单的数量堆砌。`,

  '领军人才': `
【💯 领军人才专属打分尺子 (0-100)】
- 90-100 (卓越)：两院院士/国际顶级Fellow + 重新定义了一个领域或开创一个学科 + 全球范围内的标杆性影响力 + 引用量数万级。
- 80-89 (优秀)：学会会士/长江学者 + 国家战略科技项目领衔 + 建立了有影响力的研究机构或团队 + 培养出大批杰出弟子。
- 60-79 (合格)：有显著行业贡献 + 一定程度的公共影响力 + 参与过重大项目，但在全球影响力上仍有提升空间。
- <60 (不足)：领军头衔与实际学术/产业影响力存在明显落差。
注意：此级别不看初始学历等基础指标，纯粹以「全球影响力」「历史定位」「学术遗产」为标杆。数字分数仅供参考，定性判断更重要。`,
};

// ── 每维度 × 每池子的专属评估规则 ──────────────────────────────────
const EVALUATOR_RULES: Record<DimensionKey, Record<TalentPool, string>> = {
  education: {
    '潜力人才': '重点考察在读院校排名（QS/US News）、专业排名、GPA、学术竞赛（如ACM、数模）、导师背景。985/211/C9/常青藤等名校背景直接加分。90分以上需C9/常青藤+顶级导师。',
    '青年人才': '考察博士毕业院校+博后机构。加入"成长轨迹"评估：从硕士到博士是否有学术阶梯上升。',
    '优秀人才': '学历权重下降，更关注学术训练的系统性和跨学科背景。名校博士+海外博后加分。',
    '杰出人才': '学历已不是关键区分因素，考察学术谱系（师从谁、实验室影响力）和终身学习能力。',
    '领军人才': '几乎不看初始学历。考察其在学术机构中的荣誉头衔（讲座教授、荣誉博士等），以及对教育体系的反向影响力（如创建学科方向、命名奖项等）。',
  },
  research: {
    '潜力人才': '考察本科/研究生阶段的科研产出：是否有发表论文、参与科研项目、获得科研奖项。有顶会/顶刊论文直接90分以上。',
    '青年人才': '考察博士/博后阶段核心成果：顶会/顶刊论文数量、引用数、H-index（同龄对标）。有Nature/Science系列直接90+。',
    '优秀人才': '考察独立科研能力：是否有代表性成果系列、国家基金中标、学术会议受邀报告。',
    '杰出人才': '考察学术影响力峰值：H-index同领域排名、代表作引用量、是否开创子领域。',
    '领军人才': '考察学术遗产：是否有以其命名的理论/方法/数据集、学术谱系弟子成就，是否重新定义了一个领域、引用量是否达数万级。',
  },
  industry: {
    '潜力人才': '考察实习经历和产业接触：是否有企业实习、是否参与产学研项目、技术转化意识。',
    '青年人才': '考察产业技术能力：是否有专利、技术转化项目、企业合作研发经历。',
    '优秀人才': '考察产业落地成果：专利授权数量、技术转化金额、企业联合实验室负责经历。',
    '杰出人才': '考察产业影响力：是否有创业经历、担任企业CTO/首席科学家、主导过亿级产品。',
    '领军人才': '考察产业战略视野：是否主导过产业标准制定、大型产业联盟、百亿级业务，或创造了一个新行业/新赛道。',
  },
  leadership: {
    '潜力人才': '考察团队协作和组织能力：学生会、社团、科研小组组长等初级领导经验。无经验给50-60分。',
    '青年人才': '考察小团队带领能力：是否带过课题组学生、是否管理过研究项目。',
    '优秀人才': '考察中等规模团队管理：实验室PI、项目团队负责人、10人以上团队管理。',
    '杰出人才': '考察大团队管理和资源整合：系主任/院长级别、跨团队协调、大型科研项目首席。',
    '领军人才': '考察组织级领导力：是否创建过研究机构/实验室、是否领导过国家重大项目、是否影响了国家科技政策或创建了世界级机构。',
  },
  innovation: {
    '潜力人才': '考察创新潜质：是否有创新竞赛获奖、创业大赛参与、开源项目贡献。重视潜力而非成果。',
    '青年人才': '考察前沿方向敏锐度：是否研究前沿交叉领域、是否有方法论创新。',
    '优秀人才': '考察技术创新深度：是否有原创方法/算法、是否有核心专利。',
    '杰出人才': '考察范式创新：是否提出了新的研究范式、是否开创了交叉学科方向。',
    '领军人才': '考察颠覆性创新：是否有从0到1的突破性成果、是否改变了行业技术路线，或有定义时代的发明/发现。',
  },
  social: {
    '潜力人才': '考察公众参与：科普文章、社交媒体学术影响力、公益活动。有一定影响力即给高分。',
    '青年人才': '考察学术社区参与：学术审稿、会议组织、学会青年委员。',
    '优秀人才': '考察行业认可度：学会理事/委员、期刊编委、重要会议PC成员。',
    '杰出人才': '考察行业领导力：学会副主席/分会主席、顶刊副主编/主编、重要奖项评审委员。',
    '领军人才': '考察学术治理与全球公共影响力：学会会长/Fellow、国家科技咨询委员、国际组织职务、媒体频繁报道、公共政策影响力。',
  },
};

// ── 简历转文本 ──────────────────────────────────────────────────────
export function resumeToText(resume: any): string {
  const lines: string[] = [];
  if (resume.name) lines.push(`姓名：${resume.name}`);
  if (resume.name_en || resume.english_name) lines.push(`英文名：${resume.name_en || resume.english_name}`);
  if (resume.title) lines.push(`头衔：${resume.title}`);
  if (resume.subtitle) lines.push(`副标题：${resume.subtitle}`);
  if (resume.summary) lines.push(`\n个人简介：${resume.summary}`);

  if (resume.education?.length) {
    lines.push('\n【教育背景】');
    resume.education.forEach((e: any) => {
      lines.push(`- ${e.school || ''}，${e.degree || ''}，${e.major || ''}（${e.startDate || ''}-${e.endDate || ''}）`);
    });
  }
  if (resume.experience?.length) {
    lines.push('\n【工作经历】');
    resume.experience.forEach((e: any) => {
      lines.push(`- ${e.company || ''}，${e.title || e.position || ''}（${e.startDate || ''}-${e.endDate || ''}）${e.description ? '：' + e.description : ''}`);
    });
  }
  if (resume.publications?.length) {
    lines.push('\n【代表性论文/出版物】');
    resume.publications.forEach((p: any) => {
      lines.push(`- ${p.title || ''}`);
    });
  }
  if (resume.patents?.length) {
    lines.push('\n【专利】');
    resume.patents.forEach((p: any) => {
      lines.push(`- ${p.name || p.title || ''}`);
    });
  }
  if (resume.awards?.length) {
    lines.push('\n【荣誉与奖项】');
    resume.awards.forEach((a: any) => {
      lines.push(`- ${a.name || a.title || ''}`);
    });
  }
  if (resume.projects?.length) {
    lines.push('\n【科研项目】');
    resume.projects.forEach((p: any) => {
      lines.push(`- ${p.name || p.title || ''}`);
    });
  }
  return lines.join('\n') || '（简历内容为空）';
}

// ── 分类库摘要（注入 Router Prompt）──────────────────────────────────
function buildClassificationSummary(): string {
  const tiers = ['领军人才', '杰出人才', '优秀人才', '青年人才'] as const;
  const lines: string[] = [];
  for (const tier of tiers) {
    const entries = TALENT_CLASSIFICATION_DB.filter(e => e.tier.includes(tier)).slice(0, 8);
    if (entries.length) {
      lines.push(`${tier}标志：${entries.map(e => e.source).join('、')}`);
    }
  }
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════
// STAGE 1: Router（人才池分类器）
// ══════════════════════════════════════════════════════════════════
export function buildStage1RouterPrompt(resume: any, verifiedFacts?: any[], sourceContext?: string): string {
  const factsText = verifiedFacts?.length
    ? `\n\n【🔒 已验真数据项】\n${verifiedFacts.map(f => {
      const parts = [`- [${f.source || '未知来源'}] ${f.title || ''}: ${f.desc || ''}`];
      if (f.internetData) parts.push(`  补充数据: ${f.internetData.substring(0, 200)}`);
      if (f.evidence?.length) parts.push(`  证据: ${f.evidence.slice(0, 2).join(', ')}`);
      return parts.join('\n');
    }).join('\n')}`
    : '';

  const sourceSection = sourceContext
    ? `\n\n【📊 各渠道采集的全景数据（平方/ORCID/Scholar/百科等渠道的完整信息）】\n${sourceContext}`
    : '';
  
  return `你是一位专业的高级人才评审专家。你的任务是根据候选人的履历，判断其属于哪个人才基准池。

【重要规则】
- 你的主要信息来源是下方「📊 各渠道采集的全景数据」，这些数据来自平方学者库、ORCID、Google Scholar、Wikipedia/百度百科等权威渠道，全部可信可引用。
- 「验真比对结果」是辅助参考。
- 根据全景数据中有据可查的成就进行分类，大胆定级。

【分类标准（5 级人才池）】
1. "潜力人才"：本硕博在读或刚毕业，无全职工作经验，以学术潜力和教育背景为主。
2. "青年人才"：博士后/早期科研人员，已有独立科研产出但尚未达到国家级认可。
3. "优秀人才"：获得省部级奖项/海外高层次青年人才等认可，有一定行业影响力。
4. "杰出人才"：获得国家级基金/顶级学会奖项，在领域内有显著学术/产业贡献。
5. "领军人才"：两院院士/长江学者/国家顶级科技奖/学会会士/诺贝尔奖/图灵奖/菲尔兹奖/IEEE Fellow/ACM Fellow/美国国家科学院院士等顶层荣誉持有者，或在全球范围内定义了一个领域。

【参考分类库（部分典型标志）】
${buildClassificationSummary()}
${sourceSection}

【辅助参考：验真比对结果】
${factsText}

【候选人简历】
${resumeToText(resume)}

请输出一个合法的 JSON，不需要多余的 markdown：
{
  "pool": "潜力人才|青年人才|优秀人才|杰出人才|领军人才",
  "reason": "20字以内简短解释"
}
`;
}

// ══════════════════════════════════════════════════════════════════
// STAGE 2: 维度评审团（6 个并行）
// ══════════════════════════════════════════════════════════════════
export function buildStage2EvaluatorPrompt(
  resume: any,
  pool: TalentPool,
  dimension: DimensionKey,
  verifiedFacts?: any[],
  sourceContext?: string,
): string {
  const rule = EVALUATOR_RULES[dimension][pool];
  const dimTitle = EVALUATOR_DIMENSIONS.find(d => d.key === dimension)?.title;

  const factsText = verifiedFacts?.length
    ? verifiedFacts.map(f => {
      const parts = [`- [${f.source || ''}] ${f.title || ''}: ${f.desc || ''}`];
      if (f.internetData) parts.push(`  补充: ${f.internetData.substring(0, 200)}`);
      return parts.join('\n');
    }).join('\n')
    : '（无已验真数据）';

  const sourceSection = sourceContext
    ? `\n\n【📊 各渠道采集的原始数据（平方/ORCID/Scholar/百科等渠道的完整原始信息）】\n${sourceContext}`
    : '';

  return `你是一位专业的人才评估专家。你现在的任务是专门针对【${pool}】这一人才池，给候选人的【${dimTitle}】维度进行 0-100 的打分与评价。

【❗ 核心规则 — 必须严格遵守】
1. 你的主要信息来源是下方「📊 各渠道采集的全景数据」，这些数据来自平方学者库、ORCID、Google Scholar、Wikipedia/百度百科等权威渠道，全部可信可引用，等同于一手事实。
2. 「验真比对结果」是辅助交叉验证，不是唯一的事实来源。
3. 评分时必须引用全景数据中的具体事实和数字（如 H-Index、引用数、论文数、奖项名称、工作履历等）。
4. ⚠️ 绝对禁止以下措辞（违反即视为失败）：
   - "已验证数据中缺乏" / "在验证数据中未找到" / "已验证数据不足"
   - "在已验证数据中尚不充分" / "缺乏验证记录"
   - 任何暗示"因为没被验证所以不算数"的表述
5. 如果全景数据中有相关信息，直接作为事实引用打分。如果全景数据确实未覆盖某方面，可以说"现有全景数据未涉及此方面"，但不得因此大幅扣分。
6. 大胆给分！全景数据中呈现的每一项成就都是真实的事实，请据此慷慨评分。该维度如果有突出表现（如院士、H-index>100、顶级奖项），分数应在90以上。

【你的专属打分规则】
"${rule}"

${POOL_SCORING_RUBRICS[pool]}
${sourceSection}

【辅助参考：验真比对结果】
${factsText}

【候选人基本信息】
姓名：${resume.name || ''}
头衔：${resume.title || ''}

请输出一个合法的 JSON，不需要多余的 markdown。格式如下：
{
  "score": number,
  "grade": "A|A-|B+|B|B-|C+",
  "strength": "1句话总结该维度的优势",
  "weakness": "1句话总结该维度的不足（不要提'验证数据缺乏'，只提实际短板）",
  "detail": "2-3句话详细分析，必须引用全景数据中的具体事实来支撑打分。不得出现'验证''验真'等字眼。"${pool === '杰出人才' || pool === '领军人才' ? `,
  "positioning": "该维度的定位标签，如'全球Top10计算机视觉学者''中国AI芯片领域奠基人''IEEE Fellow级别影响力'等，用一个精准短语概括该维度的段位",
  "peerBenchmark": "同行对标参照，如'该维度影响力接近ACM Fellow门槛''与XXX领域顶尖学者处于同一梯队'，给出可感知的参照系",
  "fieldImpact": "对该维度所涉领域的定性影响评估，如'开创了深度学习在医学影像中的应用范式''重新定义了该领域的方法论基础'。如果影响有限可写'在该方向有稳定贡献但尚未达到范式级影响'"` : ''}
}
`;
}

// ══════════════════════════════════════════════════════════════════
// STAGE 3: 总编 Synthesizer
// ══════════════════════════════════════════════════════════════════
export function buildStage3SynthesizerPrompt(
  resume: any,
  pool: TalentPool,
  finalScore: number,
  dimensionReports: any,
  verifiedFacts?: any[],
  sourceContext?: string,
): string {
  const factsText = verifiedFacts?.length
    ? verifiedFacts.map(f => {
      const parts = [`- [${f.source || ''}] ${f.title || ''}: ${f.desc || ''}`];
      if (f.internetData) parts.push(`  补充: ${f.internetData.substring(0, 200)}`);
      if (f.evidence?.length) parts.push(`  证据: ${f.evidence.slice(0, 2).join(', ')}`);
      return parts.join('\n');
    }).join('\n')
    : '';

  const sourceSection = sourceContext
    ? `\n\n【📊 各渠道采集的原始数据（平方/ORCID/Scholar/百科等渠道的完整原始信息）】\n${sourceContext}`
    : '';

  return `你是一位顶级的人才战略顾问。我们已经通过 6 位细分专家的独立打分与代码级的权重加权，计算出了该候选人在【${pool}】池子中的最终得分。
现在的任务是：你需要作为"总编"，综合各渠道采集的全景数据与 6 大专家的分项评价，为这位人才撰写一份极具洞察力的"顶层总结报告"。

【❗ 核心规则 — 必须严格遵守】
1. 你的主要信息来源是下方「📊 各渠道采集的全景数据」，这些数据来自平方学者库、ORCID、Google Scholar、Wikipedia/百度百科等权威渠道，全部可信可引用，等同于一手事实。
2. 充分利用全景数据中的具体数字、履历、奖项等信息来支撑报告，展现你对候选人的深入洞察。
3. ⚠️ 绝对禁止以下措辞（违反即视为失败）：
   - "已验证数据中缺乏" / "验证数据未显示" / "已验证数据不足"
   - "在已验证数据中尚不充分" / "现有数据未显示" / "证据有限"
   - 任何暗示"因为没被验证所以不确定"的保守表述
4. 报告语气应积极自信、洞察深刻。直接基于全景数据描述候选人的成就与价值。
5. keyRisks 应关注实际引进风险（如竞争激烈、文化适配、薪酬期望等），而非"数据不足"。

【已知系统数据】
人才池定性：${pool}
加权最终总分：${finalScore} 分 (满分100)
6大维度专家评价明细：
${JSON.stringify(dimensionReports, null, 2)}
${sourceSection}

【辅助参考：验真比对结果】
${factsText}

【候选人基本信息】
姓名：${resume.name || ''}
头衔：${resume.title || ''}

请输出一个合法的 JSON，包含以下顶层字段，不需要多余的 markdown。格式严格如下：
{
  "headline": "string", // 一句话高度概括候选人定位，不要包含"简历"二字。例如 "全球计算机视觉领域奠基者" "深度学习产业化先驱"
  "summary": ["string"], // 数组，3-5条精炼评价，一针见血，展现洞察力
  "tags": ["string"], // 8-10个简短标签，如"两院院士候选", "AI+教育", "全球Top100引用"
  "topStrengths": ["string"], // 3条核心优势，每条15字内
  "keyRisks": ["string"], // 3条实际引进风险（如人才竞争、薪酬预期、文化适配等），每条15字内。不要写"数据不足"类的风险
  "cooperationSuggestions": ["string"], // 3-5条接触与合作建议。每条必须是2-3句话的具体建议（包含建议的合作模式、接触渠道、适合的项目类型等），不要写一句话敷衍
  "industryImpacts": [
    { "industry": "行业名", "match": 85, "reason": "适合理由（一句话说明匹配原因）" }
  ], // 必须给出 5 个推荐合作领域，match 值区分优先级
  "suitableRoles": [
    { "name": "合作角色", "match": 85, "reason": "适合理由（一句话说明匹配原因）" }
  ] // 必须给出 5 个推荐合作角色/模式
}
`;
}
