import { mcpToolsDataPlatform } from './generated-tools';

export interface CRMTalentPerson {
  id: number;
  name: string;
  name_en?: string;
  birth_date?: string;
  gender?: string;
  nationality?: string;
  is_chinese?: string;
  province?: string;
  email?: string;
  profile_link?: string;
  research_field?: string;
  talent_source_category?: string;
  talent_type?: string;
  introduction?: string;
  notes?: string;
  country_current?: string;
  admin_position?: string;
  position_current?: string;
  school_current?: string;
  workplace_current?: string;

  // 新增四个维度的关联表数据
  education_backgrounds?: Record<string, unknown>[];
  work_experiences?: Record<string, unknown>[];
  award_experiences?: Record<string, unknown>[];
  pro_fun_experiences?: Record<string, unknown>[];
  // 专利和论文
  patents?: Record<string, unknown>[];
  papers?: Record<string, unknown>[];

  // 兼容老代码的旧字段，可不删除
  avatar_url?: string;
  description?: string;
  expertise?: string[];
  institution?: string;
  title?: string;
  education?: Array<{
    school: string;
    degree: string;
    start_year: string;
    end_year: string;
  }>;
  work_experience?: Array<{
    company: string;
    title: string;
    start_year: string;
    end_year?: string;
  }>;
  scores?: {
    overall?: number;
    academic?: number;
    industry?: number;
  };
}

export interface VSDPaper {
  id: number;
  name: string;
  authors: string[];
  impact_factor_publish_year?: string;
  indexed_by?: string[];
  journal_included?: string;
  journal_source?: string;
  journal_id?: string;

  // 老字段兼容
  venue?: string;
  year?: number;
  citations?: number;
  doi?: string;
  abstract?: string;
  url?: string;
  total_citation_wos?: number;
}

export class TalentAuditService {
  /**
   * Search Data Platform Talent Database (CRMTalentPerson) and its relations
   */
  async searchTalents(query: string, limit: number = 10, userToken?: string): Promise<CRMTalentPerson[]> {
    const client = mcpToolsDataPlatform;
    const token = userToken || process.env.VISIONSQUARE_AUTH_BEARER;

    let cleanQuery = query.trim();
    // 移除常见的称谓前缀和学位后缀，避免在查库时因为带有 'Dr.' 等而匹配不到
    cleanQuery = cleanQuery.replace(/^(?:Dr\.|Dr|Prof\.|Prof|Professor|Mr\.|Mr|Ms\.|Ms|Mrs\.|Mrs)\s+/i, '').trim();
    cleanQuery = cleanQuery.replace(/,\s*(?:Ph\.D\.|PhD|M\.D\.|MD|B\.S\.|BS|M\.S\.|MS)$/i, '').trim();
    
    const isEnglish = /[a-zA-Z]/.test(cleanQuery);
    
    let childrenConditions: any[] = [];

    // 区分"多人列表逗号"和"姓,名格式逗号"：
    // 姓,名格式：split 后恰好 2 段、都短（≤15 char）、纯英文字母（无中文）
    // 多人列表：否则
    const rawSplit = cleanQuery.split(/[,，、]/).map(n => n.trim()).filter(Boolean);
    const looksLikeFamilyGivenFormat = (
      rawSplit.length === 2
      && rawSplit.every(p => p.length <= 15 && /^[a-zA-Z\s\-]+$/.test(p))
    );

    const names = looksLikeFamilyGivenFormat ? [cleanQuery] : rawSplit;

    if (names.length > 1) {
      for (const n of names) {
        let singleClean = n.replace(/^(?:Dr\.|Dr|Prof\.|Prof|Professor|Mr\.|Mr|Ms\.|Ms|Mrs\.|Mrs)\s+/i, '').trim();
        singleClean = singleClean.replace(/,\s*(?:Ph\.D\.|PhD|M\.D\.|MD|B\.S\.|BS|M\.S\.|MS)$/i, '').trim();
        childrenConditions.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${singleClean}%` } });
        if (/[a-zA-Z]/.test(singleClean)) {
          childrenConditions.push({ leaf: { field: 'name_en', comparator: 'ilike', value: `%${singleClean}%` } });
        }
      }
    } else {
      childrenConditions.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${cleanQuery}%` } });

      if (isEnglish) {
        // 生成常见的英文名变体进行精确词组的模糊匹配
        const variations = new Set<string>();
        variations.add(cleanQuery); // Fei-Fei Li
        variations.add(cleanQuery.replace(/-/g, ' ')); // Fei Fei Li
        variations.add(cleanQuery.replace(/[- ]/g, '')); // FeifeiLi
      
      // 尝试首尾颠倒 (如果只有两部分，比如 Feifei Li -> Li Feifei)
      const spaceParts = cleanQuery.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
      if (spaceParts.length === 2) {
        variations.add(`${spaceParts[1]} ${spaceParts[0]}`); // Li Feifei
        variations.add(`${spaceParts[1]}${spaceParts[0]}`); // LiFeifei
      } else if (spaceParts.length === 3) {
        // e.g. Fei Fei Li -> Li Fei Fei
        variations.add(`${spaceParts[2]} ${spaceParts[0]} ${spaceParts[1]}`);
        variations.add(`${spaceParts[2]} ${spaceParts[0]}${spaceParts[1]}`); // Li Feifei
      }

      for (const v of variations) {
        childrenConditions.push({ leaf: { field: 'name_en', comparator: 'ilike', value: `%${v}%` } });
      }
      }
    }

    const conditionStr = JSON.stringify({
      logic_operator: '|',
      children: childrenConditions
    });

    // 1. 先查基础人才表
    const res = await client.dashGenericSearch({
      model: 'CRMTalentPerson',
      condition: conditionStr,
      fields: ['id', 'name', 'name_en', 'birth_date', 'gender', 'nationality', 'is_chinese', 'province', 'email', 'profile_link', 'research_field', 'talent_source_category', 'talent_type', 'introduction', 'notes', 'country_current', 'admin_position', 'position_current', 'school_current', 'workplace_current', 'photo_id.download_url'],
      limit,
    }, token);

    const talents = (res.items || []) as Record<string, unknown>[];
    if (talents.length > 0) {
      console.log('TALENT KEYS:', Object.keys(talents[0]));
    }
    if (talents.length === 0) return [];

    // 1.5 查询国籍/国家选项映射 (SelectionOptions, selection_id=3)
    const selectionOptRes = await client.dashGenericSearch({
      model: 'SelectionOptions',
      condition: JSON.stringify({
        logic_operator: '&',
        children: [{ leaf: { field: 'selection_id', comparator: '=', value: 3 } }]
      }),
      fields: ['id', 'name', 'value'],
      limit: 500,
    }, token).catch(() => ({ items: [] })) as { items?: Array<{ value: string; name: string }> };

    const selectionMap = new Map<string, string>();
    for (const opt of selectionOptRes.items || []) {
      if (opt.value != null) selectionMap.set(String(opt.value), opt.name);
    }

    // textarray 拆分辅助函数：PostgreSQL textarray 格式如 {a,b,c} 或 ["a","b"]
    function splitTextArray(val: any): string[] {
      if (val == null) return [];
      if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
      const s = String(val).trim();
      // 去掉 { } 或 [ ] 包裹
      const cleaned = s.replace(/^\[?{?\s*|\s*}?\]?$/g, '');
      if (!cleaned) return [];
      return cleaned.split(',').map(v => v.replace(/^"|"$/g, '').trim()).filter(Boolean);
    }

    // 转换 nationality: 将原始 value 映射为 SelectionOptions.name
    for (const t of talents) {
      const rawNation = t.nationality as string | number | undefined;
      if (rawNation != null) {
        const mapped = selectionMap.get(String(rawNation));
        if (mapped) t.nationality = mapped;
      }
    }

    // 转换 country_current: textarray 类型，拆分后逐个映射 SelectionOptions.name
    for (const t of talents) {
      const rawCountries = t.country_current;
      if (rawCountries != null) {
        const codes = splitTextArray(rawCountries);
        if (codes.length > 0) {
          const mapped = codes.map(c => selectionMap.get(c) || c);
          t.country_current = mapped.join('、') as any;
        }
      }
    }

    // 1.6 查询学校映射 (CRMInstitute, slug → name)
    // 收集所有 talents 的 school_current slug 值
    const allSchoolSlugs = new Set<string>();
    for (const t of talents) {
      const slugs = splitTextArray(t.school_current);
      slugs.forEach(s => allSchoolSlugs.add(s));
    }

    const instituteMap = new Map<string, string>();
    if (allSchoolSlugs.size > 0) {
      // CRMInstitute 查询：slug in (...allSchoolSlugs)
      const slugConditions = Array.from(allSchoolSlugs).map(slug => ({
        leaf: { field: 'slug', comparator: 'ilike', value: slug }
      }));
      const instituteRes = await client.dashGenericSearch({
        model: 'CRMInstitute',
        condition: JSON.stringify({
          logic_operator: '|',
          children: slugConditions,
        }),
        fields: ['id', 'name', 'slug'],
        limit: 500,
      }, token).catch(() => ({ items: [] })) as { items?: Array<{ slug: string; name: string }> };

      for (const inst of instituteRes.items || []) {
        if (inst.slug) instituteMap.set(inst.slug, inst.name);
      }
    }

    // 转换 school_current: textarray 类型，拆分后逐个映射 CRMInstitute.name
    for (const t of talents) {
      const rawSchools = t.school_current;
      if (rawSchools != null) {
        const slugs = splitTextArray(rawSchools);
        if (slugs.length > 0) {
          const mapped = slugs.map(s => instituteMap.get(s) || s);
          t.school_current = mapped.join('、') as any;
        }
      }
    }

    // 2. 针对每个匹配的人才，并发拉取 6 个维度的关联表（含专利和论文）
    const enrichedTalents = await Promise.all(talents.map(async (t) => {
      const talentId = t.id;
      
      const [eduRes, workRes, awardRes, proFunRes, patentInventorRes, paperAuthorRes] = await Promise.all([
        client.dashGenericSearch({
          model: 'CRMPeEduBackgrounds',
          condition: JSON.stringify({
            logic_operator: '&',
            children: [{ leaf: { field: 'talent_person_id', comparator: '=', value: talentId } }]
          }),
          fields: ['degree', 'if_highest_degree', 'start_date', 'end_date', 'if_in_progress_vone', 'school_id', 'school_name_cn', 'school_name_en', 'major_name_cn', 'major_name_en', 'highschool_id', 'highschool_area', 'talent_person_id'],
          limit: 100,
        }, token).catch(() => ({ items: [] })),

        client.dashGenericSearch({
          model: 'CRMPeWorkExperiences',
          condition: JSON.stringify({
            logic_operator: '&',
            children: [{ leaf: { field: 'talent_person_id', comparator: '=', value: talentId } }]
          }),
          fields: ['name', 'employer', 'department', 'company_id', 'school_id', 'country', 'start_date', 'end_date', 'is_current_work', 'job_type', 'position', 'work_contents', 'talent_person_id'],
          limit: 100,
        }, token).catch(() => ({ items: [] })),

        client.dashGenericSearch({
          model: 'CRMAwardExperiences',
          condition: JSON.stringify({
            logic_operator: '&',
            children: [{ leaf: { field: 'talent_person_id', comparator: '=', value: talentId } }]
          }),
          fields: ['award_id', 'description', 'level', 'pe_work_experiences_id', 'program_name', 'session', 'sub_award', 'talent_person_id', 'year'],
          limit: 100,
        }, token).catch(() => ({ items: [] })),

        client.dashGenericSearch({
          model: 'CRMPeProFunExperiences',
          condition: JSON.stringify({
            logic_operator: '&',
            children: [{ leaf: { field: 'talent_person_id', comparator: '=', value: talentId } }]
          }),
          fields: ['if_first_person', 'pe_work_experiences_id', 'program_funding_id', 'program_name', 'program_number', 'talent_person_id', 'type', 'year'],
          limit: 100,
        }, token).catch(() => ({ items: [] })),

        client.dashGenericSearch({
          model: 'VSDPatentInventor',
          condition: JSON.stringify({
            logic_operator: '&',
            children: [
              { leaf: { field: 'talent_id', comparator: '=', value: talentId } },
              { leaf: { field: 'if_delete', comparator: '=', value: false } }
            ]
          }),
          fields: ['id', 'first_inventor', 'position'],
          limit: 100,
        }, token).catch(() => ({ items: [] })),

        client.dashGenericSearch({
          model: 'VSDPaperAuthor',
          condition: JSON.stringify({
            logic_operator: '&',
            children: [
              { leaf: { field: 'talent_id', comparator: '=', value: talentId } },
              { leaf: { field: 'if_delete', comparator: '=', value: false } }
            ]
          }),
          fields: ['id', 'position'],
          limit: 500,
        }, token).catch(() => ({ items: [] }))
      ]);

      // 通过关系查询获取完整专利信息（patent_id是关系字段，需用dashGenericRelationModelSearch）
      let patents: Record<string, unknown>[] = [];
      if (patentInventorRes.items?.length) {
        console.log(`[TALENT-SERVICE] 查询到 ${patentInventorRes.items.length} 条 VSDPatentInventor 记录，talent_id=${talentId}`);
        const patentMap = new Map<number, Record<string, unknown>>();
        for (const inv of patentInventorRes.items) {
          try {
            const relRes = await client.dashGenericRelationModelSearch({
              currentModel: 'VSDPatentInventor',
              currentID: inv.id,
              currentRelationField: 'patent_id',
              fields: ['id', 'name', 'abstract', 'appl_date', 'applicant', 'application_number', 'assignee', 'grant_date', 'inventors', 'patent_type', 'pub_date', 'pub_no'],
              limit: 1,
              offset: 0,
              searchType: 'associated',
            }, token);
            if (relRes?.items?.length) {
              const p = relRes.items[0] as Record<string, unknown>;
              const pid = p.id as number;
              const isFirstInventor = inv.first_inventor === true || inv.first_inventor === 'true';
              if (!patentMap.has(pid) || isFirstInventor) {
                patentMap.set(pid, { ...p, _first_inventor: isFirstInventor, _position: inv.position });
              }
            }
          } catch (e) {
            // ignore single relation failure
          }
        }
        patents = Array.from(patentMap.values());
        console.log(`[TALENT-SERVICE] 最终查询到 ${patents.length} 条 VSDPatent 详情`);
      } else {
        console.log(`[TALENT-SERVICE] 未查询到 VSDPatentInventor 记录，talent_id=${talentId}`);
      }

      // 通过关系查询获取完整论文信息（paper_id是关系字段，需用dashGenericRelationModelSearch）
      let papers: Record<string, unknown>[] = [];
      if (paperAuthorRes.items?.length) {
        console.log(`[TALENT-SERVICE] 查询到 ${paperAuthorRes.items.length} 条 VSDPaperAuthor 记录，talent_id=${talentId}`);
        const paperMap = new Map<number, Record<string, unknown>>();
        for (const auth of paperAuthorRes.items) {
          try {
            const relRes = await client.dashGenericRelationModelSearch({
              currentModel: 'VSDPaperAuthor',
              currentID: auth.id,
              currentRelationField: 'paper_id',
              fields: ['id', 'name', 'authors', 'impact_factor_publish_year', 'indexed_by', 'journal_included', 'journal_source'],
              limit: 1,
              offset: 0,
              searchType: 'associated',
            }, token);
            if (relRes?.items?.length) {
              const p = relRes.items[0] as Record<string, unknown>;
              const pid = p.id as number;
              if (!paperMap.has(pid)) {
                paperMap.set(pid, { ...p, _position: auth.position });
              }
            }
          } catch (e) {
            // ignore single relation failure
          }
        }
        papers = Array.from(paperMap.values());
        console.log(`[TALENT-SERVICE] 最终查询到 ${papers.length} 条 VSDPaper 详情`);
      }

      return {
        ...t,
        education_backgrounds: eduRes.items || [],
        work_experiences: (workRes.items || []).map(w => {
          // 转换工作经历中的 country 字段（与主表 country_current 同逻辑）
          const rawCountry = w.country;
          if (rawCountry != null) {
            const codes = splitTextArray(rawCountry);
            if (codes.length > 0) {
              w.country = codes.map(c => selectionMap.get(c) || c).join('、');
            }
          }
          return w;
        }),
        award_experiences: awardRes.items || [],
        pro_fun_experiences: proFunRes.items || [],
        patents,
        papers,
      } as CRMTalentPerson;
    }));

    return enrichedTalents;
  }

  /**
   * 按"研究领域/会议主题"模糊搜索人才。
   * 用于会议邀约模式：根据会议主题（如"具身智能"）匹配 CRMTalentPerson.research_field，
   * 返回多个候选人才（与"按姓名搜索"的 searchTalents 不同）。
   *
   * @param topic   会议主题/研究方向（如"具身智能"、"量子计算"）
   * @param limit   返回数量上限
   * @param userToken 用户 token
   */
  async searchTalentsByTopic(topic: string, limit: number = 10, userToken?: string): Promise<CRMTalentPerson[]> {
    const client = mcpToolsDataPlatform;
    const token = userToken || process.env.VISIONSQUARE_AUTH_BEARER;
    const cleanTopic = topic.trim();
    if (!cleanTopic) return [];

    // 1. 先按 research_field 模糊搜索
    const res = await client.dashGenericSearch({
      model: 'CRMTalentPerson',
      condition: JSON.stringify({
        logic_operator: '|',
        children: [
          { leaf: { field: 'research_field', comparator: 'ilike', value: `%${cleanTopic}%` } },
          // 兜底：部分数据可能写在 introduction/notes 中
          { leaf: { field: 'introduction', comparator: 'ilike', value: `%${cleanTopic}%` } },
        ],
      }),
      fields: [
        'id', 'name', 'name_en', 'research_field', 'workplace_current', 'school_current',
        'position_current', 'admin_position', 'email', 'profile_link', 'photo_id.download_url',
        'talent_type', 'country_current',
      ],
      limit: Math.min(limit, 30),
    }, token);

    const talents = (res.items || []) as Record<string, unknown>[];
    if (talents.length === 0) return [];

    // 2. 不为每个候选并发拉关联数据，保持轻量（前端卡片需要时再按需懒加载）
    return talents.map((t) => ({ ...t } as unknown) as CRMTalentPerson);
  }

  /**
   * Search Paper Database (VSDPaper) — 支持多级 fallback
   * 原因: 平方库 ES 分词器对"中英/数字混排开头"的 ilike 失效
   *       (如 "X箍缩背光照相" 搜不到, 但 "箍缩背光照相" 能命中)
   * Fallback 链: 原标题 → 去英文/数字前缀 → 提取最长连续中文片段 → 关键词拆分
   */
  async searchPapers(query: string, limit: number = 10, userToken?: string): Promise<VSDPaper[]> {
    const client = mcpToolsDataPlatform;
    const token = userToken || process.env.VISIONSQUARE_AUTH_BEARER;

    const trimmed = (query || '').trim();
    if (!trimmed) return [];

    // 构建候选 search terms（按优先级排序）
    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushTerm = (t: string) => {
      const s = t.trim();
      if (s.length >= 2 && !seen.has(s)) { seen.add(s); candidates.push(s); }
    };

    // L0: 原始标题
    pushTerm(trimmed);

    // L1: 去掉开头的英文/数字/符号前缀（解决 "X箍缩..." / "2D-Gaussian..." 问题）
    const stripped = trimmed.replace(/^[A-Za-z0-9\-_·\s]+/, '').trim();
    if (stripped && stripped !== trimmed) pushTerm(stripped);

    // L2: 提取最长的连续中文片段
    const cnMatches = trimmed.match(/[\u4e00-\u9fff]{2,}/g);
    if (cnMatches) {
      cnMatches.sort((a, b) => b.length - a.length);
      for (const seg of cnMatches) pushTerm(seg);
    }

    // L3: 如果有多个中文片段，组合前两个（如 "箍缩" + "背光照相" → 分别搜后取并集）
    // 这一步在调用方已经循环 10 条候选了，这里只做 L0~L2 足够

    // 逐个尝试，取最先命中的结果
    let lastRes: any = null;
    for (const term of candidates) {
      const res = await client.dashGenericSearch({
        model: 'VSDPaper',
        condition: JSON.stringify({
          logic_operator: '&',
          children: [
            { leaf: { field: 'name', comparator: 'ilike', value: `%${term}%` } }
          ]
        }),
        fields: ['id', 'name', 'authors', 'impact_factor_publish_year', 'indexed_by', 'journal_included', 'journal_source', 'journal_id'],
        limit,
      }, token);
      if (res.items && res.items.length > 0) {
        if (term !== candidates[0]) {
          console.log(`[TALENT-SERVICE] searchPapers fallback hit: "${trimmed}" → "${term}" (${res.items.length} results)`);
        }
        return res.items as unknown as VSDPaper[];
      }
      lastRes = res;
    }

    return (lastRes?.items || []) as unknown as VSDPaper[];
  }

  /**
   * Search Patent Database (VSDPatent)
   */
  async searchPatents(query: string, limit: number = 5, userToken?: string): Promise<any[]> {
    const client = mcpToolsDataPlatform;
    const token = userToken || process.env.VISIONSQUARE_AUTH_BEARER;

    const res = await client.dashGenericSearch({
      model: 'VSDPatent',
      condition: JSON.stringify({
        logic_operator: '&',
        children: [
          { leaf: { field: 'name', comparator: 'ilike', value: `%${query.trim()}%` } }
        ]
      }),
      fields: ['id', 'abstract', 'appl_date', 'applicant', 'application_number', 'assignee', 'grant_date', 'inventors', 'name', 'patent_type', 'pub_date', 'pub_no'],
      limit,
    }, token);
    return res.items || [];
    return res.items || [];
  }

  /**
   * Search Research Project Results Database (VSDResearchProjectResults)
   */
  async searchResearchProjectResults(query: string, limit: number = 5, userToken?: string): Promise<any[]> {
    const client = mcpToolsDataPlatform;
    const token = userToken || process.env.VISIONSQUARE_AUTH_BEARER;

    const res = await client.dashGenericSearch({
      model: 'VSDResearchProjectResults',
      condition: JSON.stringify({
        logic_operator: '&',
        children: [
          { leaf: { field: 'name', comparator: 'ilike', value: `%${query.trim()}%` } }
        ]
      }),
      fields: ['id', 'name', 'keywords', 'research_field', 'status'],
      limit,
    }, token);
    return res.items || [];
  }


  /**
   * 按给定的核心关键词及"机构"、"荣誉"等多条件精确执行一次模糊搜索。
   * 不包含内部降级兜底逻辑，交由上层 Agent 编排。
   *
   * ⚠️ 平方库数据特征（影响搜索策略）：
   *   - name 字段：大量为空，很多人只有 name_en
   *   - research_field：中英文混存，部分存的是长文介绍而非关键词
   *   - school_current / workplace_current：存的是机构 slug（如 "tsinghua-university"），不是中文名
   *   - introduction / notes：有些关键信息存在这里
   *   - API 对条件叶子数有隐式上限，超过约 30 个 OR 叶子时可能返回空结果
   *
   * @param keywords 核心研究方向/主题的关键词数组
   * @param institution 限定机构（如"清华大学"）
   * @param honors 限定荣誉标签（如"院士"）
   * @param limit 返回数量上限
   * @param userToken 用户 token
   */
  async searchTalentsByConditions(
    keywords: string[],
    institution: string = '', 
    honors: string = '', 
    limit: number = 10, 
    userToken?: string
  ): Promise<CRMTalentPerson[]> {
    const instKws = institution.split(/[,，\s]+/).filter(k => k.trim());
    const honorKws = honors.split(/[,，\s]+/).filter(k => k.trim());
    const hasTopic = keywords && keywords.length > 0;
    const hasInst = instKws.length > 0;
    const hasHonor = honorKws.length > 0;

    if (!hasTopic && !hasInst && !hasHonor) return [];

    const client = mcpToolsDataPlatform;
    const token = userToken || process.env.VISIONSQUARE_AUTH_BEARER;

    // ── 1. Topic 条件（仅当有关键词时添加）──
    // 核心策略：只搜文本内容字段（research_field / introduction / notes / talent_type / name / name_en）
    // ⚠️ 限制 keywords 最多取前 4 个，避免叶子数爆炸（6字段 × 4词 = 24叶子，安全范围内）
    const rootChildren: any[] = [];

    if (hasTopic) {
      const effectiveKeywords = keywords.slice(0, 4);
      const topicLeaves: any[] = [];
      for (const kw of effectiveKeywords) {
        topicLeaves.push({ leaf: { field: 'research_field', comparator: 'ilike', value: `%${kw}%` } });
        topicLeaves.push({ leaf: { field: 'introduction', comparator: 'ilike', value: `%${kw}%` } });
        topicLeaves.push({ leaf: { field: 'notes', comparator: 'ilike', value: `%${kw}%` } });
        topicLeaves.push({ leaf: { field: 'talent_type', comparator: 'ilike', value: `%${kw}%` } });
        topicLeaves.push({ leaf: { field: 'name', comparator: 'ilike', value: `%${kw}%` } });
        topicLeaves.push({ leaf: { field: 'name_en', comparator: 'ilike', value: `%${kw}%` } });
      }
      console.log(`[TalentSearch] Topic 条件叶子数: ${topicLeaves.length}, keywords(截断后): [${effectiveKeywords.join(', ')}]`);
      rootChildren.push({ logic_operator: '|', children: topicLeaves });
    }

    // ── 2. 机构限定条件 ──
    // 字段存储格式探测结论：
    //   - workplace_current: 存机构中文名文本（如 "清华大学、...大学"）
    //   - school_current: 存机构 slug 数组（如 ["cn.tsinghua", ""]）
    // ⚠️ 关键：VisionSquare 数据平台在同一 OR 组混合"数组字段"和"普通文本字段"时会返回空集！
    //   所以这里只匹配文本字段（workplace_current / introduction / notes），绝对不能碰 school_current
    if (institution.trim()) {
      const instLeaves: any[] = [];
      for (const kw of instKws) {
        instLeaves.push({ leaf: { field: 'workplace_current', comparator: 'ilike', value: `%${kw}%` } });
        instLeaves.push({ leaf: { field: 'introduction', comparator: 'ilike', value: `%${kw}%` } });
        instLeaves.push({ leaf: { field: 'notes', comparator: 'ilike', value: `%${kw}%` } });
      }
      if (instLeaves.length > 0) {
        rootChildren.push({ logic_operator: '|', children: instLeaves });
      }
    }

    // ── 3. 荣誉/标签限定条件 ──
    if (honors.trim()) {
      const honorLeaves: any[] = [];
      for (const kw of honorKws) {
        honorLeaves.push({ leaf: { field: 'talent_type', comparator: 'ilike', value: `%${kw}%` } });
        honorLeaves.push({ leaf: { field: 'talent_source_category', comparator: 'ilike', value: `%${kw}%` } });
        honorLeaves.push({ leaf: { field: 'introduction', comparator: 'ilike', value: `%${kw}%` } });
      }
      if (honorLeaves.length > 0) {
        rootChildren.push({ logic_operator: '|', children: honorLeaves });
      }
    }

    const conditionJson = JSON.stringify({
      logic_operator: '&',
      children: rootChildren,
    });
    const totalLeaves = rootChildren.reduce((acc, g) => acc + (g.children?.length || 0), 0);
    console.log(`[TalentSearch] 最终 condition 叶子总数: ${totalLeaves}, JSON长度: ${conditionJson.length}`);

    const res = await client.dashGenericSearch({
      model: 'CRMTalentPerson',
      condition: conditionJson,
      fields: [
        'id', 'name', 'name_en', 'research_field', 'workplace_current', 'school_current',
        'position_current', 'admin_position', 'email', 'profile_link', 'photo_id.download_url',
        'talent_type', 'talent_source_category', 'country_current', 'introduction',
      ],
      limit: Math.min(limit, 30),
    }, token);

    const items = (res.items || []) as Record<string, unknown>[];
    const finalKeywords = hasTopic ? keywords.slice(0, 4) : [];
    console.log(`[TalentSearch] 搜索结果: ${items.length} 条 (keywords=[${finalKeywords.join(',')}] institution="${institution}" honors="${honors}")`);
    return items.map((t) => ({ ...t } as unknown) as CRMTalentPerson);
  }
}

export const talentAuditService = new TalentAuditService();
