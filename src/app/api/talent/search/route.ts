import { NextResponse } from 'next/server';
import { TalentAuditService } from '@/lib/mcp/talent';
import { executeToolCall } from '@/lib/tools';
import { talentJournal } from '@/lib/supabase/talent-journal';

const talentService = new TalentAuditService();

// ── 内部字段 → 用户可读映射 ──────────────────────────────────────────
const LABEL_MAP: Record<string, string> = {
  // talent_type
  'domestic_eminent_scholars': '国内知名学者',
  'international_eminent_scholars': '国际知名学者',
  'young_scholars': '青年学者',
  'industry_experts': '产业专家',
  'overseas_returnees': '海归人才',
  'government_officials': '政府人才',
  'emerging_talents': '新兴人才',
  'postdoctoral': '博士后',
  // talent_source_category
  'cn.situ': '平方学者库',
  'openalex': 'OpenAlex',
  'manual_import': '人工导入',
  'web_crawl': '网络采集',
  'partner_share': '合作伙伴共享',
  // talent_source_category - 英文描述类（完整匹配）
  'qs top universities': 'QS 百强院校',
  'international prestigious awards': '国际权威奖项',
  'international academicians': '国际院士',
  'domestic prestigious awards': '国内权威奖项',
  'domestic academicians': '国内院士',
  'other recognized talents': '其他认定人才',
};

const NATIONALITY_MAP: Record<string, string> = {
  '840': '美国', '156': '中国', '826': '英国', '392': '日本',
  '276': '德国', '250': '法国', '124': '加拿大', '036': '澳大利亚',
  '410': '韩国', '702': '新加坡', '380': '意大利', '756': '瑞士',
  '528': '荷兰', '752': '瑞典', '376': '以色列', '356': '印度',
};

/** 将内部标签映射为可读中文（支持逗号分隔多值） */
function humanize(raw: string): string {
  if (!raw) return '';
  return String(raw).split(/[,，]/).map(s => {
    const key = s.trim().toLowerCase();
    return LABEL_MAP[key] || LABEL_MAP[s.trim()] || s.trim().replace(/_/g, ' ');
  }).filter(Boolean).join('、');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let query = searchParams.get('q');
    const type = searchParams.get('type') || 'list';

    if (!query) {
      return NextResponse.json({ ok: false, error: 'Missing query' }, { status: 400 });
    }

    query = query.replace(/(教授|博士|研究员|院士|先生|女士|同学|老师)$/g, '').trim();

    if (type === 'list') {
      const dbTalents = await talentService.searchTalents(query, 10);

      const results: any[] = dbTalents.map(t => ({
        id: String(t.id),
        name: t.name,
        avatar: t.avatar_url || '',
        title: shortTitle(t.position_current || t.admin_position || t.title || ''),
        titleFull: t.position_current || t.admin_position || t.title || '',
        currentOrg: t.workplace_current || t.school_current || t.institution || '',
        currentOrgFull: t.workplace_current || t.school_current || t.institution || '',
        hasPingfangData: true,
        hasInternetData: false,
        highestDegree: extractDegree(t),
        experienceYears: '多年',
        rating: '暂无评级',
        tags: buildHumanTags(t),
        history: (t.work_experiences || []).map((w: any) => ({
          time: `${w.start_date || ''} - ${w.is_current_work ? '至今' : (w.end_date || '')}`,
          role: `${w.employer || ''} · ${w.position || ''}`
        })),
      }));

      // ── 人才日志保存：平方数据库命中的记录 ──
      if (dbTalents.length > 0) {
        const topTalent = dbTalents[0];
        talentJournal.saveTalentData(
          topTalent.name || query,
          topTalent.workplace_current || topTalent.school_current || '',
          { pingfang: topTalent },
          '',
          undefined,
          'deep_search',
        ).catch(e => console.error('[TalentSearch] saveTalentData failed:', e));
      }

      let webResultText = null;
      if (results.length === 0) {
        const webRes = await executeToolCall('search_internet', { query, num_results: '3' });
        if (typeof webRes === 'string' && !webRes.includes('未能检索到')) {
          webResultText = webRes;
          // ── 人才日志保存：互联网兜底结果 ──
          talentJournal.saveTalentData(
            query,
            '',
            { internet: webRes },
            '',
            undefined,
            'deep_search',
          ).catch(e => console.error('[TalentSearch] saveTalentData (internet) failed:', e));
        }
      }

      return NextResponse.json({ ok: true, data: results.slice(0, 10), webResultText });

    } else {
      // ── 单个人才卡片查询 ──────────────────────────────────────────────
      const dbTalents = await talentService.searchTalents(query, 1);
      const t = dbTalents[0];
      
      // 并发取互联网数据 + 人才日志
      const [internetData, journalData] = await Promise.all([
        (async () => {
          try {
            const webRes = await executeToolCall('search_internet', { query: `${query} 履历 科研成果`, num_results: '3' });
            if (typeof webRes === 'string' && !webRes.includes('未能检索到')) return webRes;
          } catch {}
          return '';
        })(),
        (async () => {
          try {
            const authHeader = request.headers.get('authorization') || request.headers.get('cookie') || '';
            const tokenMatch = authHeader.match(/fllt:[^\s;]+/);
            const token = tokenMatch?.[0];
            if (!token) return null;
            const { items } = await talentJournal.listEntries({ token, search: query, limit: 3 });
            return items.find(i => i.talent_name === query || i.talent_name_en === query) || items[0] || null;
          } catch { return null; }
        })(),
      ]);

      if (t) {
            // ── 人才日志保存：平方数据库命中的单个人才 ──
            talentJournal.saveTalentData(
              t.name || query,
              t.workplace_current || t.school_current || '',
              { pingfang: t },
              '',
              undefined,
              'deep_search',
            ).catch(e => console.error('[TalentSearch] saveTalentData (card) failed:', e));

            // ── 构建弹性字段列表：只有有值的才加入 ──
            // sections: { title, icon, items: {label, value, source}[] }[]
            const sections: Section[] = [];

            // --- 基本信息 ---
            const basicItems: SectionItem[] = [];
            if (t.name_en) basicItems.push({ label: '英文名', value: t.name_en, source: 'pingfang' });
            else if (journalData?.talent_name_en) basicItems.push({ label: '英文名', value: journalData.talent_name_en, source: 'journal' });
            if (t.position_current) basicItems.push({ label: '当前职位', value: t.position_current, source: 'pingfang' });
            if (t.admin_position && t.admin_position !== t.position_current) basicItems.push({ label: '行政职务', value: t.admin_position, source: 'pingfang' });
            if (t.workplace_current) basicItems.push({ label: '当前就职', value: t.workplace_current, source: 'pingfang' });
            if (t.school_current && t.school_current !== t.workplace_current) basicItems.push({ label: '毕业院校', value: t.school_current, source: 'pingfang' });
            if (t.nationality) basicItems.push({ label: '国籍', value: NATIONALITY_MAP[String(t.nationality)] || String(t.nationality), source: 'pingfang' });
            if (t.email) basicItems.push({ label: '邮箱', value: t.email, source: 'pingfang' });
            if (t.profile_link) basicItems.push({ label: '个人主页', value: t.profile_link, source: 'pingfang', isLink: true });
            if (t.research_field) basicItems.push({ label: '研究领域', value: t.research_field, source: 'pingfang' });
            else if (journalData?.research_fields?.length) basicItems.push({ label: '研究领域', value: journalData.research_fields.join('、'), source: 'journal' });
            // if (t.talent_type) basicItems.push({ label: '人才类型', value: humanize(String(t.talent_type)), source: 'pingfang' });
            // if (t.talent_source_category) basicItems.push({ label: '人才来源', value: humanize(String(t.talent_source_category)), source: 'pingfang' });
            if (basicItems.length) sections.push({ title: '基本信息', icon: 'user', items: basicItems });

            // --- 学术指标（来自日志/OpenAlex）---
            const metricItems: SectionItem[] = [];
            if (journalData?.h_index) metricItems.push({ label: 'H-Index', value: String(journalData.h_index), source: 'journal' });
            if (journalData?.cited_by_count) metricItems.push({ label: '总引用数', value: journalData.cited_by_count.toLocaleString(), source: 'journal' });
            if (journalData?.works_count) metricItems.push({ label: '论文总数', value: journalData.works_count.toLocaleString(), source: 'journal' });
            if (metricItems.length) sections.push({ title: '学术指标', icon: 'chart', items: metricItems });

            // --- 简介（合并平方 + 百科）---
            const bioItems: SectionItem[] = [];
            if (t.introduction) bioItems.push({ label: '个人简介', value: t.introduction, source: 'pingfang' });
            if (journalData?.bio_snippet) bioItems.push({ label: '百科简介', value: journalData.bio_snippet, source: 'journal' });
            if (bioItems.length) sections.push({ title: '个人简介', icon: 'bio', items: bioItems });

            // --- 教育经历 ---
            const eduList = (t.education_backgrounds || []).map((e: any) => ({
              school: e.school_name_cn || e.school_name_en || '未知院校',
              major: e.major_name_cn || e.major_name_en || '',
              degree: e.degree || '',
              period: `${e.start_date || '?'} – ${e.if_in_progress_vone ? '至今' : (e.end_date || '?')}`,
              isHighest: e.if_highest_degree === '是',
            }));

            // --- 获奖经历 ---
            const awardList = (t.award_experiences || []).map((a: any) => ({
              name: a.program_name || a.sub_award || '未知奖项',
              level: a.level || '',
              year: a.year || a.session || '',
              description: a.description || '',
            }));

            // --- 专利详情 ---
            const patentList = (t.patents || []).map((p: any) => ({
              name: p.name || '未知专利',
              patentNo: p.pub_no || p.application_number || '',
              date: p.pub_date || p.appl_date || '',
              inventors: p.inventors || '',
              isFirstInventor: p._first_inventor || false,
              type: p.patent_type || '',
            }));

            // --- 论文详情 ---
            const paperList = (t.papers || []).map((p: any) => ({
              name: p.name || '未知论文',
              authors: p.authors || '',
              journal: p.journal_source || p.journal_included || '',
              impactFactor: p.impact_factor_publish_year || '',
              indexedBy: p.indexed_by || '',
            }));

            // --- 科研项目 ---
            const projectList = (t.pro_fun_experiences || [])
              .filter((p: any) => p.program_name)
              .map((p: any) => ({
                name: p.program_name,
                year: p.year || '',
                type: p.type || '',
                isFirstPerson: p.if_first_person === '是' || p.if_first_person === true,
              }));

            // --- 职业履历 ---
            const history = (t.work_experiences || []).map((w: any) => ({
              time: `${w.start_date || ''} – ${w.is_current_work ? '至今' : (w.end_date || '')}`,
              role: `${w.employer || ''} · ${w.position || ''}`,
              department: w.department || '',
            }));

            // --- 关联群体 ---
            const groups = [
              t.workplace_current ? `🏢 ${t.workplace_current}` : null,
              t.school_current && t.school_current !== t.workplace_current ? `🎓 ${t.school_current}` : null,
            ].filter(Boolean);

            if (t.notes) {
              sections.push({ title: '备注', icon: 'note', items: [{ label: '', value: t.notes, source: 'pingfang' }] });
            }

            // --- 补充互联网深度信息 ---
            if (journalData?.ai_report) {
              sections.push({ title: 'AI 深度报告', icon: 'report', items: [{ label: '', value: journalData.ai_report.substring(0, 3000), source: 'journal' }] });
            }
            if (internetData) {
              sections.push({ title: '互联网信息', icon: 'web', items: [{ label: '', value: internetData, source: 'internet' }] });
            }
            
            // --- 补充 ORCID 信息 ---
            if (journalData?.orcid_data) {
              const oData = journalData.orcid_data;
              let orcidText = `**ORCID ID**: [${oData.orcid_id || oData.id}](https://orcid.org/${oData.orcid_id || oData.id})\n`;
              if (oData.employments?.length > 0) {
                orcidText += `\n**工作经历 (Employments)**:\n`;
                oData.employments.forEach((e: any) => {
                  orcidText += `- ${e.org} ${e.dept ? `(${e.dept})` : ''} - ${e.role}\n`;
                });
              }
              if (oData.works?.length > 0) {
                orcidText += `\n**近期发表 (Works)**:\n`;
                oData.works.forEach((w: any) => {
                  orcidText += `- ${w.title} [${w.type}]\n`;
                });
              }
              sections.push({ title: 'ORCID 档案', icon: 'web', items: [{ label: '', value: orcidText, source: 'orcid' }] });
            }
            
            return NextResponse.json({
              ok: true,
              data: {
                id: String(t.id),
                name: t.name,
                nameEn: t.name_en || journalData?.talent_name_en || '',
                avatar: (t as any)['photo_id.download_url'] || t.avatar_url || '',
                title: shortTitle(t.position_current || t.admin_position || t.title || ''),
                titleFull: t.position_current || t.admin_position || t.title || '',
                currentOrg: t.workplace_current || t.school_current || t.institution || '',
                currentOrgFull: t.workplace_current || t.school_current || t.institution || '',
                hasPingfangData: true,
                hasInternetData: !!(internetData || journalData?.internet || journalData?.ai_report),
                hasOrcidData: !!(journalData?.orcid_data),
                highestDegree: extractDegree(t),
                experienceYears: '多年',
                rating: journalData?.h_index ? `H-Index: ${journalData.h_index}` : '待评估',
                tags: buildHumanTags(t),
                // ── 弹性数据 ──
                sections,
                educationList: eduList.length > 0 ? eduList : undefined,
                awardList: awardList.length > 0 ? awardList : undefined,
                patentList: patentList.length > 0 ? patentList : undefined,
                paperList: paperList.length > 0 ? paperList : undefined,
                projectList: projectList.length > 0 ? projectList : undefined,
                history: history.length > 0 ? history : undefined,
                groups: groups.length > 0 ? groups : undefined,
                journalMeta: journalData ? {
                  searchCount: journalData.search_count,
                  dataSources: journalData.data_sources,
                  lastSearched: journalData.last_searched_at,
                } : null,
              }
            });
      } else {
        // ── 平方库无数据——人才日志 + 互联网 ──
        const sections: Section[] = [];
        
        if (journalData) {
          const metricItems: SectionItem[] = [];
          if (journalData.h_index) metricItems.push({ label: 'H-Index', value: String(journalData.h_index), source: 'journal' });
          if (journalData.cited_by_count) metricItems.push({ label: '总引用数', value: journalData.cited_by_count.toLocaleString(), source: 'journal' });
          if (journalData.works_count) metricItems.push({ label: '论文总数', value: journalData.works_count.toLocaleString(), source: 'journal' });
          if (journalData.talent_name_en) metricItems.push({ label: '英文名', value: journalData.talent_name_en, source: 'journal' });
          if (journalData.workplace) metricItems.push({ label: '工作单位', value: journalData.workplace, source: 'journal' });
          if (journalData.research_fields?.length) metricItems.push({ label: '研究领域', value: journalData.research_fields.join('、'), source: 'journal' });
          if (metricItems.length) sections.push({ title: '基本信息', icon: 'user', items: metricItems });
          
          if (journalData.bio_snippet) {
            sections.push({ title: '百科简介', icon: 'bio', items: [{ label: '', value: journalData.bio_snippet, source: 'journal' }] });
          }
          if (journalData.ai_report) {
            sections.push({ title: 'AI 深度报告', icon: 'report', items: [{ label: '', value: journalData.ai_report.substring(0, 3000), source: 'journal' }] });
          }
        }

        if (internetData) {
          sections.push({ title: '互联网信息', icon: 'web', items: [{ label: '', value: internetData, source: 'internet' }] });
        }

        return NextResponse.json({
          ok: true,
          data: {
            id: `web-${Date.now()}`,
            name: query,
            nameEn: journalData?.talent_name_en || '',
            title: journalData?.workplace || '互联网信息',
            currentOrg: journalData?.institution || journalData?.workplace || '',
            hasPingfangData: false,
            hasInternetData: true,
            highestDegree: '未知',
            experienceYears: '未知',
            rating: journalData?.h_index ? `H-Index: ${journalData.h_index}` : '暂无评级',
            tags: journalData?.research_fields?.length ? journalData.research_fields : [],
            sections,
            journalMeta: journalData ? {
              searchCount: journalData.search_count,
              dataSources: journalData.data_sources,
              lastSearched: journalData.last_searched_at,
            } : null,
          }
        });
      }
    }
  } catch (error: any) {
    console.error('Talent search API error:', error);
    return NextResponse.json({ ok: false, error: error.message || 'Internal error' }, { status: 500 });
  }
}

// ── 类型 ─────────────────────────────────────────────────────────────────
interface SectionItem {
  label: string;
  value: string;
  source: 'pingfang' | 'journal' | 'internet' | 'orcid';
  isLink?: boolean;
}

interface Section {
  title: string;
  icon: string;
  items: SectionItem[];
}

// ── 辅助函数 ─────────────────────────────────────────────────────────────

function extractDegree(t: any): string {
  if (t.education_backgrounds?.length > 0) {
    const highest = t.education_backgrounds.find((e: any) => e.if_highest_degree === '是');
    if (highest) return highest.degree || '未知';
    return t.education_backgrounds[0].degree || '未知';
  }
  return '未知';
}

function buildHumanTags(t: any): string[] {
  const tags: string[] = [];
  if (t.research_field) tags.push(t.research_field);
  if (t.talent_type) {
    const mapped = humanize(String(t.talent_type));
    if (mapped) tags.push(mapped);
  }
  return tags;
}

/**
 * 短化头衔/职位：按分号/句号/逗号/斜线切分，取前 1 段并截断到 16 字。
 * 用于在列表卡片中显示，避免多头衔拼接成超长字符串撑破布局。
 */
function shortTitle(raw: string): string {
  if (!raw) return '';
  const seg = String(raw).split(/[;；。,/／]/)[0]?.trim() || '';
  if (seg.length <= 16) return seg;
  return seg.slice(0, 16) + '…';
}
