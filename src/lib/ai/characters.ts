import { getToken } from '@/lib/auth';
import { Character } from './types';
import { mcpTools } from '@/lib/mcp/generated-tools';
import { cacheGetOrSet, cacheDel, registerPrefetch } from '@/lib/redis';

const MCP_FIELDS = ['id', 'name', 'description', 'flora_external_id', 'data', 'public', 'avatar_ids.id', 'repository_ids.id'];
const CACHE_KEY_PUBLIC = 'characters:public';
const CACHE_TTL = 300; // 5 分钟

/**
 * 猫秘书团硬编码兑底数据。
 * 当 prod 上 还没有对应的 ZhiJiCompanion 云端记录时，始终对用户可见。
 * 云端记录存在时以云端为准（它们会覆盖这里的展示）。
 */
const HARDCODED_CATS: Character[] = [
  {
    id: 'yida_main', name: '一答',
    description: 'Hi，我是一答，你的专属政务 AI 智能助理。专注于人才查询、政策解读、数据分析和公文撰写，为政府工作人员提供专业、准确的辅助。',
    tagline: '查人才 | 查政策 | 找数据 | 写材料 | 找资源', intro: '',
    ai_type: 'official', slug: 'yida_main', public: true, is_cloud: false,
    avatar: '/assets/characters/yida_main/avatar.png',
    assets: { idle: '/assets/characters/yida_main/idle.png', avatar: '/assets/characters/yida_main/avatar.png' },
    skills_preview: ['查人才', '人才检测', '查政策', '找数据', '写材料', '找资源'],
    topic_tags: ['政务辅助', '产业洞察', '公文生成'], visit_count: 0, persona: '你是「一答」政务AI助手，专注于人才查询、政策解读、数据分析和公文撰写，为政府工作人员提供专业、准确的智能辅助。', 
    extra_prompt: `【找资源/匹配供应商交互规则】
当用户表达找资源、找供应商的需求时（如“我需要科研仪器试剂资源”、“我需要软件供应商”等），你必须：
1. **优先追问背景（强制规则）**：了解用户的当前情况（例如：您所在的组织类型是什么？在什么具体情境或项目下需要这些资源？），必须先明确需求背景再给出建议，不要在信息不足时直接查询或胡乱推荐。
2. **定向查询实体（使用 dash_search）**：在明确背景后，使用 dash_search 工具去平方数据工作台查验相关实体：
   - 找软件/硬件商、培训服务、通用供应商 -> 查 \`CRMCompany\`
   - 找科研仪器试剂、具体设备产品 -> 查 \`VSDResearchMaterial\`（科研物资库），或结合 \`CRMCompany\`
   - 找智库资源、科研支持 -> 查 \`CRMInstitute\` 或 \`CRMTalentPerson\`
3. **VSDResearchMaterial 检索与字段解析规则（重要）**：
   - **type（资源类型）**：搜索时必须使用英文枚举值，展示时再映射为中文：
     - "research_consumables": "科研耗材"
     - "research_instruments": "科研仪器"
     - "research_reagents": "科研试剂"
   - **关键词拆分/宽搜策略**：当用户提到具体产品（如"低温冰箱""高速离心机"）时，数据库里可能只存了"冰箱""冷藏箱""保存箱"等变体词，必须拆关键词做 OR 搜索，不得只把整句丢进 name 字段。
     - 拆 2~4 个子词（如"低温冰箱"拆成：低温冰箱、冰箱、冷藏箱、低温箱、冰柜）
     - 在 name / brand_name / specification 三个字段做 OR 模糊匹配
     - 常见同义词：冰箱↔冷藏箱/低温箱/冰柜；离心机↔离心；培养箱↔恒温箱/孵化器；显微镜↔显微
   - **mid_category / real_category / sub_category（多级分类）**：这些是多选关联字段，存储的是 SelectionOptions 的 ID（格式如 {1,2}）。
     - 必须提取 ID 列表，通过 \`dash_search\` 查询 \`SelectionOptions\` 表获取对应的 name。
     - 查询条件：\`dash_search model="SelectionOptions" {...}\`
     - 将获取到的 name 用"，"拼接展示。
4. 根据查询到的真实数据整理为 Markdown 表格，并结合用户背景给出精准建议。
5. **输出卡片（非常重要）**：如果你通过工具检索了“企业库” (CRMCompany) 并提及某家企业或供应商，请在回答末尾输出以下 XML 标签（前端会自动挂载组件并展示核心卡片）：
   <zj_company_card query="企业名称" />

【人才查询交互规则】
当用户需要查询特定个体人才（例如：帮我查一下XXX）时，你必须输出极其翔实的专业报告，同时在回复末尾输出以下 XML 标签（前端会自动挂载组件并展示核心卡片）：
<zj_talent_card query="姓名或关键词" />

即使你已经通过 dash_search 工具查到了该人才的数据并输出了长篇分析报告，**也必须在回复末尾附上 <zj_talent_card /> 标签**，让用户可以点击查看完整的人才档案抽屉。

当用户需要查询某类人群列表（例如：人工智能领域的顶尖科学家）时：
1. 如果范围很大或要求不明确，你应该先追问用户（例如：请问您更看重理论科研输出，还是产业商业落地经验？国内还是国外？）
2. 如果条件已经相对具体，**不得自己编写文字名单**，必须输出以下 XML 标签（前端会自动渲染可滑动的人才卡片列表）：
<zj_talent_list query="具体要求关键词" />
3. 即使通过 dash_search 已查到多个人才，**也必须在回复末尾附上 <zj_talent_list /> 标签**，让用户通过卡片交互查看每位人才的详情，而不是只看文字。

【实体引用规则】
当你通过工具检索了“院校库” (CRMInstitute) 并在回答中提及某所院校实体时，为了给用户提供结构化的卡片展示，请在你的回答末尾输出以下 XML 标签：
<zj_institute_card query="院校名称" />
当你检索了“案例库” (CRMCase) 并在回答中提及某个案例时，输出：
<zj_case_card query="案例名称" />
当你检索了“项目库” (CRMProgram) 并在回答中提及某个项目时，输出：
<zj_project_card query="项目名称" />

【知识检索优先级（最高指令）】
你在回答用户问题时，必须严格遵守以下检索优先级：
1. 优先在平方数据工作台找数据和知识（通过你具备的图谱检索工具进行查询）。
2. 找不到对应数据或知识时，才允许去互联网查询，或者根据你的预训练模型知识库进行回答。
3. 如果你使用了互联网查询或依靠自身的知识库（即非平方数据库内容），你**必须向用户明确说明**信息来源（例如：“根据互联网搜索结果...”或“基于公开资料...”），并**提醒用户注意甄别数据准确性**。

【多跳查询示例（重要）】
当用户说找上海医学领域的顶尖教授时，正确流程：
步骤1：直接用 dash_search 查 CRMTalentPerson，条件：research_field 包含医学且 school_current 或 workplace_current 包含上海，limit=10。
步骤2：如步骤1无结果，查 CRMInstitute 找机构ID（如上海交大=102），再查 CRMPeWorkExperiences（school_id = 102）找在职人才。
⚠️ 严禁：有数据库但用暂无数据放弃查询，然后自行编造人才名单！
【产研转化分析工具（必须主动使用）】
你可以主动引导用户进入「产业需求分析」或「匹配度分析」测评。这是你内置的两个核心工具。
- 当用户表达有技术需求、寻找科研团队时，推荐「产业需求分析」。
- 当用户已经有目标科研团队，想评估合作可能性时，推荐「匹配度分析」。`,
    state_labels: {}, context_files: {}, linked_entities: [],
    theme_id: '一答主干',
    quick_prompts: [
      '如何制定有效的地方产业人才引进与激励政策？',
      '写一份关于低空经济产业发展的调研报告提纲...',
      '对比北上广深的高层次人才落户门槛与补贴标准...',
      '帮我分析一下这个研究团队和我们业务的匹配程度'
    ],
    skills: [], repository_ids: [], avatar_ids: [],
  },
  {
    id: 'hc_cat_butler', name: '猫管家·生涯报考',
    description: '你好呀，我是负责生涯报考的猫管家，我诞生于平方多年积累的生涯规划、报考辅导与大中衔接能力。作为你长期的生涯伙伴，可以为你做严谨的生涯测评、提供基于官方数据的报考建议，并随时为你寻找合适的教育资源。',
    tagline: '猫猫是你一个人的生涯顾问', intro: '',
    ai_type: 'official', slug: 'cat_butler', public: true, is_cloud: false,
    avatar: '/assets/characters/cat_butler/avatar.png',
    assets: { idle: '/assets/characters/cat_butler/idle.png', avatar: '/assets/characters/cat_butler/avatar.png', talking: '/assets/characters/cat_butler/talking.png', thinking: '/assets/characters/cat_butler/thinking.png', working: '/assets/characters/cat_butler/working.png' },
    skills_preview: ['生涯测评', '志愿规划', '报考建议', '教育资源'],
    topic_tags: [], visit_count: 0, persona: '', extra_prompt: '【线索收集与服务对接】当用户明确表达需要人工服务、线下联系、找顾问或机构等需求时，必须引导用户留下联系方式。在你的回复末尾必须包含 `[SHOW_LEAD_FORM]` 标签以唤起前端表单，并可提醒用户直接添加官方微信助手：Zhmin_1113。',
    state_labels: {}, context_files: {}, linked_entities: [],
    theme_id: 'theme_team',
    quick_prompts: [
      '帮我测一下我适合什么专业方向',
      '我今年考了X分，在X省，能上哪些学校？',
      '计算机和电子信息工程怎么选？',
      '帮我制定一个从现在到报考的规划',
    ],
    skills: [], repository_ids: [], avatar_ids: [],
  },
  {
    id: 'hc_cat_career', name: '猫管家·校招实习',
    description: '你好呀，我是负责校招实习的猫管家，我诞生于平方多年积累的职业规划、校招辅导与就业研究能力。作为你长期的职业伙伴，可以为你做求职竞争力测评、提供基于真实岗位数据的求职建议，并随时为你推荐合适的实习和校招资源。',
    tagline: '猫猫在呢，求职不慌', intro: '',
    ai_type: 'official', slug: 'cat_career', public: true, is_cloud: false,
    avatar: '/assets/characters/cat_career/avatar.png',
    assets: { idle: '/assets/characters/cat_career/idle.png', avatar: '/assets/characters/cat_career/avatar.png', talking: '/assets/characters/cat_career/talking.png', thinking: '/assets/characters/cat_career/thinking.png', working: '/assets/characters/cat_career/working.png' },
    skills_preview: ['求职测评', '简历诊断', '校招备考', '实习资源'],
    topic_tags: [], visit_count: 0, persona: '', extra_prompt: '【线索收集与服务对接】当用户明确表达需要人工服务、线下联系、找顾问或机构等需求时，必须引导用户留下联系方式。在你的回复末尾必须包含 `[SHOW_LEAD_FORM]` 标签以唤起前端表单，并可提醒用户直接添加官方微信助手：Zhmin_1113。',
    state_labels: {}, context_files: {}, linked_entities: [],
    theme_id: 'theme_team',
    quick_prompts: [
      '帮我测一下我现在的求职竞争力',
      '互联网大厂实习什么时候招、怎么投？',
      '我是X专业，适合投哪类岗位？',
      '帮我诊断一下我的简历',
    ],
    skills: [], repository_ids: [], avatar_ids: [],
  },
  {
    id: 'hc_cat_intl', name: '猫管家·国际教育',
    description: '你好呀，我是负责国际教育的猫管家，我诞生于平方多年积累的留学规划、选校申请与海外教育研究能力。作为你长期的留学伙伴，可以为你做留学竞争力测评、提供基于真实录取数据的选校建议，并随时为你寻找合适的留学准备资源。',
    tagline: '猫猫在呢，留学路上不迷路', intro: '',
    ai_type: 'official', slug: 'cat_intl', public: true, is_cloud: false,
    avatar: '/assets/characters/cat_intl/avatar.png',
    assets: { idle: '/assets/characters/cat_intl/idle.png', avatar: '/assets/characters/cat_intl/avatar.png', talking: '/assets/characters/cat_intl/talking.png', thinking: '/assets/characters/cat_intl/thinking.png', working: '/assets/characters/cat_intl/working.png' },
    skills_preview: ['留学测评', '选校规划', '申请策略', '留学资源'],
    topic_tags: [], visit_count: 0, persona: '', extra_prompt: '【线索收集与服务对接】当用户明确表达需要人工服务、线下联系、找顾问或机构等需求时，必须引导用户留下联系方式。在你的回复末尾必须包含 `[SHOW_LEAD_FORM]` 标签以唤起前端表单，并可提醒用户直接添加官方微信助手：Zhmin_1113。',
    state_labels: {}, context_files: {}, linked_entities: [],
    theme_id: 'theme_team',
    quick_prompts: [
      '帮我测一下我现在的留学竞争力',
      'GPA 3.5、托福100，能申请哪些美国硕士？',
      '英国和美国读研有什么关键区别？',
      '帮我制定一个留学申请时间规划',
    ],
    skills: [], repository_ids: [], avatar_ids: [],
  },
  {
    id: 'hc_cat_research', name: '猫管家·产研转化',
    description: '你好，我是猫管家·产研转化，你在产研转化路上的长期伙伴。我诞生于方略研究院在政产研合作领域的多年积累，专注于帮助企业和机构将产业需求与科研力量精准对接。\n\n无论你有具体的企业场景想寻找合适的科研团队，还是已有一支研究团队想评估与产业需求的匹配程度，我都可以为你做系统性分析，并随时对接方略研究院的人工咨询团队，提供更深度的战略支持。',
    tagline: '联接企业与科研，长期陪伴你的产研转化伙伴', intro: '',
    ai_type: 'official', slug: 'cat_research', public: true, is_cloud: false,
    avatar: '/assets/characters/cat_research/avatar.png',
    assets: { idle: '/assets/characters/cat_research/idle.png', avatar: '/assets/characters/cat_research/avatar.png', talking: '/assets/characters/cat_research/talking.png', thinking: '/assets/characters/cat_research/thinking.png', working: '/assets/characters/cat_research/working.png' },
    skills_preview: ['产业需求分析', '科研团队匹配', '转化路径规划', '方略研究院咨询'],
    topic_tags: [], visit_count: 0, persona: '', extra_prompt: `【产研转化猫管家专属指令】

你是一个面向企业、政府和科研机构的产研转化专家管家，不是学生的科研启蒙导师。

**核心定位：**
- 帮助有产业需求的企业/机构分析所需科研成果，推荐科研团队方向
- 帮助已有研究团队的用户评估与企业需求的匹配度，给出合作转化建议
- 对接方略研究院的人工专家团队，提供工作台及战略咨询支持

**两个核心工具（测评）：**
1. 产业需求分析：用户提供产业/企业信息（企业介绍、业务、产品等），AI 分析所需科研成果，并推荐合适的科研团队/研究领域
2. 匹配度分析：用户提供产业/企业信息与研究团队信息，AI 分析双方匹配程度，给出开展转化的具体建议

**人工团队对接（必须硬编码）：**
- 当用户表达需要深度战略咨询、工作台支持、正式合作等需求时
- 在回复末尾包含 [SHOW_LEAD_FORM] 标签
- 同时明确告知：如需产研转化工作台及战略咨询，可联系方略研究院执行院长胡博士，邮箱：huwanqi@squareedu.com

**对话风格：**
- 专业、务实，面向企业/机构决策者
- 不用科研学术启蒙的语气，而是产业合作顾问的口吻
- 可以主动引导用户进入「产业需求分析」或「匹配度分析」测评`,
    state_labels: {}, context_files: {}, linked_entities: [],
    theme_id: 'theme_team',
    quick_prompts: [
      '我们企业有具体的技术需求，想找合适的科研团队对接',
      '帮我分析一下这个研究团队和我们业务的匹配程度',
      '产研转化合作一般怎么推进，有哪些关键步骤？',
      '我想联系方略研究院的专家做深度咨询',
    ],
    skills: [], repository_ids: [], avatar_ids: [],
  },
] as unknown as Character[];

/** 根据 slug 或 id 查找硬编码兆底猫角色 */
function getHardcodedCat(slugOrId: string): Character | null {
  return HARDCODED_CATS.find(c => c.slug === slugOrId || c.id === slugOrId) ?? null;
}

/** 从 MCP 响应 item 构建 Character 对象 */
function buildCharacterFromItem(item: Record<string, unknown>): Character | null {
  let dataFields: Record<string, unknown> = item.data as Record<string, unknown> || {};
  if (typeof dataFields === 'string') {
    try { dataFields = JSON.parse(dataFields); } catch { dataFields = {}; }
  }

  if (item.name === '__DELETED__' || dataFields.deleted) return null;

  return {
    id: String(item.id),
    name: item.name || dataFields.name,
    description: item.description || dataFields.description || '',
    tagline: dataFields.tagline || '',
    intro: dataFields.intro || dataFields.description || '',
    ai_type: dataFields.ai_type || 'custom',
    avatar: dataFields.avatar || '/assets/default-ai-robot.png',
    assets: dataFields.assets || {},
    skills_preview: dataFields.skills_preview || dataFields.skills || [],
    topic_tags: dataFields.topic_tags || [],
    visit_count: (dataFields.visit_count as number) || 0,
    persona: dataFields.persona || '',
    slug: String(dataFields.slug || dataFields.flora_external_id || item.flora_external_id || `Character_${item.id}` || ''),
    extra_prompt: String(dataFields.extra_prompt || ''),
    disable_handoff: !!dataFields.disable_handoff,
    state_labels: dataFields.state_labels || {},
    is_cloud: true,
    public: !!item.public,
    context_files: dataFields.context_files || {},
    linked_entities: dataFields.linked_entities || [],
    theme_id: (dataFields.theme_id || dataFields.collection || '') as string,
    quick_prompts: (dataFields.quick_prompts || []) as string[],
    skills: (dataFields.skills || []) as { name: string; content: string }[],
    repository_ids: item['repository_ids.id'] || item.repository_ids || [],
    avatar_ids: item['avatar_ids.id'] || item.avatar_ids || [],
    // A2A fields
    allow_a2a: !!dataFields.allow_a2a,
    a2a_topics: (dataFields.a2a_topics || []) as string[],
    a2a_instructions: (dataFields.a2a_instructions || '') as string,
  } as unknown as Character;
}

/** 原始回源函数：不依赖 cookies()，供后台预刷新使用。
 *  @param token - 可选，传入用户 token 则按用户权限回源（管理端），默认使用服务端 token */
async function rawFetchAllCharacters(token?: string): Promise<Character[]> {
  const authToken = token || process.env.FLORA_AUTH_BEARER || '';

  const PAGE_SIZE = 100;
  let offset = 0;
  const allItems: Character[] = [];

  // 添加 product 字段的搜索条件
  const condition = JSON.stringify({
    logic_operator: '&',
    children: [
      { leaf: { field: 'product', comparator: '=', value: '一答虚拟人' } },
    ],
  });

  while (true) {
    const searchResult = await mcpTools.dashGenericSearch({
      model: 'ZhiJiCompanion',
      fields: MCP_FIELDS,
      limit: PAGE_SIZE,
      offset,
      condition,
    }, authToken) as unknown as Record<string, unknown>;

    const sr = searchResult || {};
    type ItemRow = Record<string, unknown>;
    const items = (
      sr.items ||
      (((((sr.remoteResponse as Record<string, unknown> | undefined)
        ?.data as Record<string, unknown> | undefined)
        ?.dash as Record<string, unknown> | undefined)
        ?.generic as Record<string, unknown> | undefined)
        ?.search as Record<string, unknown> | undefined)
        ?.items ||
      []
    ) as ItemRow[];

    for (const item of items) {
      const character = buildCharacterFromItem(item);
      if (character) allItems.push(character);
    }

    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allItems;
}

/** 原始回源：仅获取公开角色（public=true）并合并兆底猫 */
async function rawFetchPublicCharacters(): Promise<Character[]> {
  const allChars = await rawFetchAllCharacters();
  const publicChars = allChars.filter(c => c.public);
  return mergeWithHardcodedCats(publicChars);
}

/** 合并硬编码兜底猫，同时按 slug 和名称关键词去重。
 *  - slug 精确匹配：云端有同 slug → 以云端为准，跳过兜底
 *  - 关键词去重：云端有以「生涯报考/校招实习/国际教育/科研启蒙」为关键词的角色
 *              且兜底猫已覆盖同一关键词 → 视为旧版本，从云端列表中移除
 */
function mergeWithHardcodedCats(cloudChars: Character[]): Character[] {
  // 每只兜底猫的「关键词」= 去掉「猫管家·」前缀后的主题名称
  const catKeywords = HARDCODED_CATS.map(c => c.name.replace('猫管家·', ''));
  // slug 去重：云端有对应 slug 的猫，兜底就不加
  const existingSlugs = new Set(cloudChars.map(c => c.slug));
  const extras = HARDCODED_CATS.filter(c => !existingSlugs.has(c.slug));

  // 关键词去重：如果云端角色的名称包含某个猫关键词（如「生涯报考」），
  // 且该关键词已有兜底猫（extras 里或 cloudChars 里 slug 完全匹配），
  // 则从 cloudChars 中排除该旧版云端记录
  const filteredCloud = cloudChars.filter(c => {
    const matchedKeyword = catKeywords.find(kw => c.name.includes(kw));
    if (!matchedKeyword) return true; // 不是猫管家，保留
    // 是猫管家：如果 slug 已精确匹配（handled above），保留；否则视为旧记录，过滤掉
    return existingSlugs.has(c.slug) && HARDCODED_CATS.some(h => h.slug === c.slug);
  });

  return [...filteredCloud, ...extras];
}

// 模块加载时自动注册后台预刷新（公开角色）
registerPrefetch(CACHE_KEY_PUBLIC, rawFetchPublicCharacters, CACHE_TTL);

class CharacterManager {
  /** 获取全部角色（直接回源，不加缓存）并合并硬编码兆底猫
   *  @param token - 可选，传入用户 zhiji_token 则按用户权限回源（管理端） */
  async getAllCharacters(token?: string): Promise<Character[]> {
    const cloudChars = await rawFetchAllCharacters(token);
    return mergeWithHardcodedCats(cloudChars);
  }

  /** 用户端：获取公开角色列表（只返回 public=true 的角色） */
  async getPublicCharacters(): Promise<Character[]> {
    return cacheGetOrSet(CACHE_KEY_PUBLIC, rawFetchPublicCharacters, CACHE_TTL);
  }

  async getCharacter(id: string): Promise<Character | null> {
    if (!id) return null;
    const isNumeric = Number.isInteger(Number(id)) && String(Number(id)) === id;
    const char = isNumeric
      ? await this.getCharacterByID(id)
      : await this.getCharacterBySlug(id);

    // 保底：云端都找不到，尝试硬编码的猫管家
    return char ?? getHardcodedCat(id);
  }

  /** 通过 MCP 数字 ID 精确获取单个角色（dash_generic_get） */
  async getCharacterByID(id: string): Promise<Character | null> {
    if (!id || !/^\d+$/.test(id)) return null;

    const token = await getToken() || process.env.FLORA_AUTH_BEARER;

    // 使用 search 而不是 get，以便应用 product 过滤
    const condition = JSON.stringify({
      logic_operator: '&',
      children: [
        { leaf: { field: 'id', comparator: '=', value: Number(id) } },
        { leaf: { field: 'product', comparator: '=', value: '一答虚拟人' } },
      ],
    });

    const result = await mcpTools.dashGenericSearch({
      model: 'ZhiJiCompanion',
      fields: MCP_FIELDS,
      limit: 1,
      offset: 0,
      condition,
    }, token) as unknown as Record<string, unknown>;

    const sr = result || {};
    type ItemRow = Record<string, unknown>;
    const items = (
      sr.items ||
      (((((sr.remoteResponse as Record<string, unknown> | undefined)
        ?.data as Record<string, unknown> | undefined)
        ?.dash as Record<string, unknown> | undefined)
        ?.generic as Record<string, unknown> | undefined)
        ?.search as Record<string, unknown> | undefined)
        ?.items ||
      []
    ) as ItemRow[];

    if (!items || items.length === 0) return null;

    return buildCharacterFromItem(items[0]);
  }

  /** 通过 slug（Flora 外部 ID）精确获取单个角色，如果云端不存在则尝试兆底硬编码数据 */
  async getCharacterBySlug(slug: string): Promise<Character | null> {
    if (!slug) return null;

    const token = await getToken() || process.env.FLORA_AUTH_BEARER;

    // 使用 search 而不是 getByFloraExternalId，以便应用 product 过滤
    const condition = JSON.stringify({
      logic_operator: '&',
      children: [
        { leaf: { field: 'flora_external_id', comparator: '=', value: slug } },
        { leaf: { field: 'product', comparator: '=', value: '一答虚拟人' } },
      ],
    });

    const result = await mcpTools.dashGenericSearch({
      model: 'ZhiJiCompanion',
      fields: MCP_FIELDS,
      limit: 1,
      offset: 0,
      condition,
    }, token) as unknown as Record<string, unknown>;

    const sr = result || {};
    type ItemRow = Record<string, unknown>;
    const items = (
      sr.items ||
      (((((sr.remoteResponse as Record<string, unknown> | undefined)
        ?.data as Record<string, unknown> | undefined)
        ?.dash as Record<string, unknown> | undefined)
        ?.generic as Record<string, unknown> | undefined)
        ?.search as Record<string, unknown> | undefined)
        ?.items ||
      []
    ) as ItemRow[];

    if (!items || items.length === 0) return null;

    return buildCharacterFromItem(items[0]);
  }

  /** 保存角色到 MCP 云端（dash_generic_save） */
  async saveCharacter(character: Character): Promise<string> {
    const token = await getToken() || process.env.FLORA_AUTH_BEARER;

    // 判断是否有slug，如果有slug且slug是纯数字，则增加 Character_ 前缀
    if (character.slug && /^\d+$/.test(character.slug)) {
      character.slug = `Character_${character.slug}`;
    }

    const dataFields: Record<string, unknown> = {
      tagline: character.tagline,
      intro: character.intro,
      description: character.description || '',
      ai_type: character.ai_type,
      avatar: character.avatar,
      assets: character.assets,
      skills_preview: character.skills_preview,
      topic_tags: character.topic_tags,
      visit_count: character.visit_count,
      persona: character.persona,
      id: character.id,
      slug: character.slug,
      extra_prompt: character.extra_prompt,
      disable_handoff: character.disable_handoff,
      state_labels: character.state_labels,
      context_files: character.context_files,
      linked_entities: character.linked_entities,
      theme_id: character.theme_id,
      quick_prompts: character.quick_prompts,
      skills: character.skills,
      // A2A fields
      allow_a2a: character.allow_a2a,
      a2a_topics: character.a2a_topics,
      a2a_instructions: character.a2a_instructions,
    };

    const values: Record<string, unknown> = {
      name: character.name,
      description: character.description,
      data: JSON.stringify(dataFields),
      public: character.public,
      product: '一答虚拟人',
    };

    if (character.id) {
      values.id = Number(character.id);
    }

    if (character.slug) {
      values.flora_external_id = character.slug;
    }

    if (character.avatar_ids) {
      values.avatar_ids = character.avatar_ids;
    }

    if (character.repository_ids) {
      values.repository_ids = character.repository_ids;
    }

    const result = await mcpTools.dashGenericSave({
      model: 'ZhiJiCompanion',
      values: JSON.stringify(values),
    }, token) as unknown as Record<string, unknown>;

    if (result.status !== 200 || result.error) {
      const msg = typeof result.error === 'string' ? result.error : JSON.stringify(result);
      throw new Error(msg);
    }
    const newId = result.id as number | undefined;
    if (!newId) throw new Error('保存成功但未返回 ID');
    // 写操作后清除公开角色缓存
    cacheDel(CACHE_KEY_PUBLIC);
    return String(newId);
  }

  /** 软删除角色（标记 __DELETED__） */
  async deleteCharacter(id: string): Promise<boolean> {
    const char = await this.getCharacter(id);
    if (!char) return false;

    const token = await getToken() || process.env.FLORA_AUTH_BEARER;

    const result = await mcpTools.dashGenericSave({
      model: 'ZhiJiCompanion',
      values: JSON.stringify({
        id: Number(char.id),
        name: '__DELETED__',
        data: JSON.stringify({ deleted: true }),
      }),
    }, token) as unknown as Record<string, unknown>;

    // 写操作后清除公开角色缓存
    cacheDel(CACHE_KEY_PUBLIC);
    return result.status === 200;
  }
}

export const characterManager = new CharacterManager();
