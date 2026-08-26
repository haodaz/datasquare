/**
 * lib/mcp/entityContext.ts
 *
 * 运行时从 Flora / MCP 拉取角色关联实体的详细数据，
 * 格式化为 Markdown 段落后注入 system prompt。
 *
 * 设计原则：
 * - 全部 fire-and-forget，单个实体超时或出错不影响主对话
 * - 每个实体限制字段数量，避免 prompt 过长
 */

import { mcpTools, mcpToolsDataPlatform } from './generated-tools';
import { cacheGetOrSet } from '@/lib/redis';

const ENTITY_CACHE_TTL = 600; // 10 min，实体参考数据极少变更

type RelationFieldMeta = { name: string; relation: string };
export type EntityFieldConfig = {
  label: string;
  fields: string[];
  service?: 'dataPlatform';
  /** 关联实体字段映射：{ 字段名 -> { name: 中文名, relation: 目标模型名 } } */
  relation_fields?: Record<string, RelationFieldMeta>;
};

// ── 每个实体类型的显示名称、拉取字段、数据源 ────────────────────────────
// service 为空/不存在时默认走 mcpTools（Flora），设为 'dataPlatform' 时走 mcpToolsDataPlatform
export const ENTITY_FIELD_MAP: Record<string, EntityFieldConfig> = {
  CRMInstitute:               { label: '院校',     fields: ['id', 'name', 'name_lang_cn', 'name_lang_en', 'native_name', 'info_email', 'continent', 'country', 'state', 'city', 'info_address', 'description', 'homepage_url', 'slug', 'country_info_id'], service: 'dataPlatform', relation_fields: { country_info_id: { name: '所在国家', relation: 'CRMCountry' } } },
  CRMHighschool:              { label: '高中',     fields: ['id', 'name', 'slug'], service: 'dataPlatform' },
  CRMCompany:                 { label: '公司',     fields: ['id', 'name', 'brief_name', 'business_range', 'city', 'company_case', 'company_evaluate', 'company_specialties', 'country', 'geo_region', 'province', 'info_email', 'info_phone', 'info_founding_year', 'introduction', 'kind', 'legal_representative', 'ceo_general_manager', 'chairman', 'official_website', 'one_sentence', 'operating_revenue', 'registered_capital', 'slug', 'unified_social_credit_code', 'company_industry_ids', 'company_industry_list_ids'], service: 'dataPlatform', relation_fields: { company_industry_ids: { name: '所属行业大类', relation: 'VSDGbIndustrys' }, company_industry_list_ids: { name: '所属产业二级目录', relation: 'VSDIndustryList' } } },
  CRMCountry:                 { label: '国家',     fields: ['id', 'key', 'el_country', 'name_cn', 'name_en', 'name_foreign', 'continent', 'capital', 'country_intro', 'eco_development', 'edu_intro', 'land_area', 'population', 'type'], service: 'dataPlatform' },
  CRMCompetition:             { label: '竞赛',     fields: ['id', 'name_cn', 'name_en', 'official_link', 'evaluating_authority', 'discipline_category', 'description', 'degree', 'founding_year', 'high_school_category', 'competition_degree', 'host_country', 'related_major_ids'], service: 'dataPlatform', relation_fields: { related_major_ids: { name: '相关专业', relation: 'CRMFos' } } },
  CRMProgramFunding:          { label: '基金项目', fields: ['id', 'name', 'name_en', 'official_link', 'evaluating_authority', 'discipline_category', 'description', 'degree', 'funding_amount'], service: 'dataPlatform' },
  CRMAwards:                  { label: '荣誉奖项', fields: ['id', 'name', 'name_en', 'award_type', 'degree', 'description', 'discipline_category', 'evaluating_authority', 'official_link'], service: 'dataPlatform' },
  VSDIndustryList:            { label: '产业目录', fields: ['id', 'name', 'industry_type', 'level', 'code', 'industry_category_id'], service: 'dataPlatform', relation_fields: { industry_category_id: { name: '上一级目录', relation: 'VSDIndustryList' } } },
  VSDPaper:                   { label: '论文',     fields: ['id', 'name', 'authors', 'impact_factor_publish_year', 'indexed_by', 'journal_included', 'journal_source', 'journal_id'], service: 'dataPlatform', relation_fields: { journal_id: { name: '关联期刊', relation: 'VSDJournal' } } },
  VSDPaperAuthor:             { label: '论文人才关联',     fields: ['id', 'paper_id', 'talent_id', 'position'], service: 'dataPlatform', relation_fields: { paper_id: { name: '关联论文', relation: 'VSDPaper' }, talent_id: { name: '关联人才', relation: 'CRMTalentPerson' } } },
  VSDPatent:                  { label: '专利',     fields: ['id', 'abstract', 'appl_date', 'applicant', 'applicant_address', 'applicant_city', 'applicant_district', 'applicant_geo_region', 'applicant_region', 'applicant_type', 'application_number', 'application_year', 'assignee', 'assignee_type', 'assignee_type_info', 'claims_content', 'current_patentee_address', 'grant_date', 'grant_year', 'inventors', 'main_ipc_classification', 'ipc_classification', 'language', 'name', 'patent_field', 'patent_grant_number', 'patent_type', 'pub_date', 'pub_no', 'publication_year', 'related_industry_fields', 'unified_social_credit_code', 'assignee_company_ids', 'assignee_institute_ids'], service: 'dataPlatform', relation_fields: { assignee_company_ids: { name: '专利权人_关联公司', relation: 'CRMCompany' }, assignee_institute_ids: { name: '专利权人_关联院校', relation: 'CRMInstitute' } } },
  VSDPatentInventor:          { label: '专利人才关联',     fields: ['id', 'patent_id', 'talent_id', 'first_inventor', 'position'], service: 'dataPlatform', relation_fields: { patent_id: { name: '关联专利', relation: 'VSDPatent' }, talent_id: { name: '关联人才', relation: 'CRMTalentPerson' } } },
  CRMTalentPerson:            { label: '人才',     fields: ['id', 'name', 'name_en', 'birth_date', 'gender', 'nationality', 'is_chinese', 'province', 'email', 'profile_link', 'research_field', 'talent_source_category', 'talent_type', 'introduction', 'notes', 'country_current', 'admin_position', 'position_current', 'school_current', 'workplace_current', 'fos_ids'], service: 'dataPlatform', relation_fields: { fos_ids: { name: '相关专业领域', relation: 'CRMFos' } } },
  CRMPeEduBackgrounds:        { label: '人才教育背景',     fields: ['id', 'degree', 'if_highest_degree', 'start_date', 'end_date', 'if_in_progress_vone', 'school_id', 'school_name_cn', 'school_name_en', 'major_name_cn', 'major_name_en', 'highschool_id', 'highschool_area', 'talent_person_id', 'major_ids'], service: 'dataPlatform', relation_fields: { talent_person_id: { name: '人才信息', relation: 'CRMTalentPerson' }, school_id: { name: '院校', relation: 'CRMInstitute' }, highschool_id: { name: '高中学校', relation: 'CRMHighschool' }, major_ids: { name: '专业', relation: 'CRMFos' } } },
  CRMPeWorkExperiences:       { label: '人才工作经历',     fields: ['id', 'name', 'employer', 'department', 'company_id', 'school_id', 'country', 'start_date', 'end_date', 'is_current_work', 'job_type', 'position', 'work_contents', 'talent_person_id'], service: 'dataPlatform', relation_fields: { talent_person_id: { name: '人才信息', relation: 'CRMTalentPerson' }, school_id: { name: '相关院校', relation: 'CRMInstitute' }, company_id: { name: '关联公司', relation: 'CRMCompany' } } },
  CRMAwardExperiences:        { label: '人才获奖经历',     fields: ['id', 'award_id', 'description', 'level', 'pe_work_experiences_id', 'program_name', 'session', 'sub_award', 'talent_person_id', 'year', 'fos_ids'], service: 'dataPlatform', relation_fields: { talent_person_id: { name: '人才信息', relation: 'CRMTalentPerson' }, award_id: { name: '关联奖项', relation: 'CRMAwards' }, pe_work_experiences_id: { name: '获奖时所在单位', relation: 'CRMPeWorkExperiences' }, fos_ids: { name: '相关专业领域', relation: 'CRMFos' } } },
  CRMPeProFunExperiences:     { label: '人才基金项目经历',     fields: ['id', 'if_first_person', 'pe_work_experiences_id', 'program_funding_id', 'program_name', 'program_number', 'talent_person_id', 'type', 'year', 'fos_ids'], service: 'dataPlatform', relation_fields: { talent_person_id: { name: '人才信息', relation: 'CRMTalentPerson' }, program_funding_id: { name: '关联基金', relation: 'CRMProgramFunding' }, pe_work_experiences_id: { name: '所属单位名称', relation: 'CRMPeWorkExperiences' }, fos_ids: { name: '相关专业领域', relation: 'CRMFos' } } },
  CRMPeActExperiences:        { label: '人才活动经历',     fields: ['id', 'activity_result', 'activity_type', 'competition_id', 'description', 'program_id', 'talent_person_id', 'year', 'fos_ids'], service: 'dataPlatform', relation_fields: { talent_person_id: { name: '人才信息', relation: 'CRMTalentPerson' }, program_id: { name: '项目库', relation: 'CRMProgram' }, competition_id: { name: '竞赛库', relation: 'CRMCompetition' }, fos_ids: { name: '相关专业领域', relation: 'CRMFos' } } },
  VSDJournal:                 { label: '期刊',     fields: ['id', 'name', 'cnno', 'issn', 'eissn', 'language', 'founding_year', 'publisher_name', 'publisher_address', 'subject_category', 'subject_info', 'status', 'journal_indexed_ids', 'publisher_institute_ids', 'subject_first_level_ids'], service: 'dataPlatform', relation_fields: { journal_indexed_ids: { name: '期刊收录标签', relation: 'VSDJournalIndexed' }, publisher_institute_ids: { name: '主办/出版单位关联院校', relation: 'CRMInstitute' }, subject_first_level_ids: { name: '关联一级学科', relation: 'CRMMoe' } } },
  VSDJournalIndexed:          { label: '期刊收录标签',     fields: ['id', 'indexed_key', 'journal_ids', 'level', 'tag', 'top', 'type', 'year', 'zone'], service: 'dataPlatform', relation_fields: { journal_ids: { name: '关联期刊', relation: 'VSDJournal' } } },
  VSDIndustryPolicy:          { label: '产业政策',     fields: ['id', 'name', 'type', 'label', 'country', 'region', 'province', 'city', 'county_area', 'policy_level', 'publish_organization', 'publish_date', 'official_link', 'remarks', 'theme', 'industry_list_ids', 'content', 'policy_keywords'], service: 'dataPlatform', relation_fields: { industry_list_ids: { name: '关联产业一级目录', relation: 'VSDIndustryList' } } },
  VSDGbIndustrys:             { label: '国民经济行业分类',     fields: ['id', 'name', 'level', 'code', 'industry_category_id', 'introduction'], service: 'dataPlatform', relation_fields: { industry_category_id: { name: '上一级目录', relation: 'VSDGbIndustrys' } } },
  VSDIndustryCluster:         { label: '产业集群',     fields: ['id', 'name', 'cluster_type', 'province', 'city', 'main_industry', 'industry_list_id'], service: 'dataPlatform', relation_fields: { industry_list_id: { name: '关联产业二级目录', relation: 'VSDIndustryList' } } },
  CRMOccupation:              { label: '职业',     fields: ['id', 'career_category', 'career_mid_category', 'intro', 'key', 'name', 'name_lang_cn', 'name_lang_en', 'position_requirement', 'recent_year_monthly_salary', 'responsibility', 'salary_str', 'book_ids', 'relevant_fos_ids'], service: 'dataPlatform', relation_fields: { relevant_fos_ids: { name: '相关专业', relation: 'CRMFos' }, book_ids: { name: '书籍', relation: 'VSDBook' } } },
  CRMCase:                    { label: '案例',     fields: ['id', 'admission_result', 'apply_degree', 'apply_institute_id', 'feature_label', 'highest_degree', 'program_name', 'student_case_id', 'term', 'year', 'major_ids'], service: 'dataPlatform', relation_fields: { apply_institute_id: { name: '申请学校', relation: 'CRMInstitute' }, student_case_id: { name: '学生', relation: 'CRMStudentCase' }, major_ids: { name: '申请专业', relation: 'CRMFos' } } },
  CRMStudentCase:             { label: '案例学生',     fields: ['id', 'abroad_experience', 'bachelor_institute_id', 'bachelor_major_fos_id', 'bachelor_minor_fos_id', 'degree', 'feature_label', 'final_institute_id', 'local_data_source', 'long_case', 'master_institute_id', 'master_major_fos_id', 'master_minor_fos_id', 'name', 'overseas_recommendation_letter_number', 'phd_institute_id', 'phd_major_fos_id', 'recommendation_letter_type', 'research_experience', 'short_case', 'source_note', 'student_case_name'], service: 'dataPlatform', relation_fields: { bachelor_institute_id: { name: '本科学校', relation: 'CRMInstitute' }, bachelor_major_fos_id: { name: '本科主修专业', relation: 'CRMFos' }, bachelor_minor_fos_id: { name: '本科辅修专业', relation: 'CRMFos' }, final_institute_id: { name: '最终入读学校', relation: 'CRMInstitute' }, master_institute_id: { name: '硕士学校', relation: 'CRMInstitute' }, master_major_fos_id: { name: '硕士主修专业', relation: 'CRMFos' }, master_minor_fos_id: { name: '硕士辅修专业', relation: 'CRMFos' }, phd_institute_id: { name: '博士学校', relation: 'CRMInstitute' }, phd_major_fos_id: { name: '博士主修专业', relation: 'CRMFos' } } },
  CRMOpportunity:             { label: '机会',     fields: ['id', 'address', 'application_end_date_time', 'application_materials_description', 'application_start_date_time', 'application_website', 'city', 'company_id', 'competition_awards', 'competition_id', 'conference_id', 'contact_email', 'contact_fax', 'contact_name', 'contact_name_en', 'contact_phone', 'contact_qq', 'contact_wechat', 'costs', 'country', 'description', 'end_date_time', 'exchange_institute_id', 'expiration_time', 'form_of_play', 'grade', 'institute_or_company_name', 'internship_salary_max', 'internship_salary_min', 'is_in_campus', 'kind', 'labels', 'laboratory_link', 'language', 'link', 'minimum_working_days', 'name', 'number_of_recruits', 'organizer', 'overview', 'participation_type', 'process', 'projectgroup_link', 'province', 'province_requirement', 'province_str', 'recruiter_email', 'recruiter_fax', 'recruiter_introduction', 'recruiter_introduction_en', 'recruiter_name', 'recruiter_name_en', 'recruiter_phone', 'recruiter_qq', 'recruiter_website', 'recruiter_wechat', 'responsibilities', 'schedule', 'service_platform', 'source', 'speaker_introduction', 'speaker_introduction_en', 'speaker_name', 'speaker_name_en', 'start_date_time', 'term', 'welfare', 'fos_ids', 'institute_participate_ids', 'institute_id'], service: 'dataPlatform', relation_fields: { company_id: { name: '主场单位（机构）', relation: 'CRMCompany' }, competition_id: { name: '竞赛', relation: 'CRMCompetition' }, conference_id: { name: '会议', relation: 'CRMConference' }, exchange_institute_id: { name: '交换院校', relation: 'CRMInstitute' }, institute_id: { name: '主场单位（学校）', relation: 'CRMInstitute' }, institute_participate_ids: { name: '参展学校', relation: 'CRMInstitute' }, fos_ids: { name: '相关专业', relation: 'CRMFos' } } },
  CRMFos:                     { label: '海外专业', fields: ['id', 'name', 'name_lang_cn', 'name_lang_en', 'category', 'fos_intro', 'key', 'sub_fos', 'award_experience_ids', 'book_ids', 'course_core_ids', 'job_title_ids', 'online_course_ids', 'program_ids'], service: 'dataPlatform', relation_fields: { award_experience_ids: { name: '获奖经历', relation: 'CRMAwardExperiences'}, book_ids: { name: '书籍', relation: 'VSDBook'}, course_core_ids: { name: '关联核心课程', relation: 'VSDCourseCore'}, job_title_ids: { name: '就业职位', relation: 'CRMOccupation'}, online_course_ids: { name: '在线课程', relation: 'VSDOnlineCourse'}, program_ids: { name: '项目', relation: 'CRMProgram'} } },
  CRMMoe:                     { label: '国内专业', fields: ['id', 'annual_salary', 'award_degree', 'career_industry_after_graduation', 'code', 'courses_info', 'degree', 'description', 'employer_info', 'employment_direction', 'employment_rate_year_change', 'first_impressions_str', 'founding_year', 'graduate_career_str', 'if_soldier', 'majors_other_names', 'moe_category_id', 'moe_category_str', 'moe_hierarchy_type', 'moe_type_discipline_id', 'moe_type_discipline_str', 'name', 'name_lang_cn', 'name_lang_en', 'position_distribution_percentage', 'ratio_female_to_male', 'ratio_science_to_art', 'region_distribution_percentage', 'size_of_graduates', 'year_count_annual_salary_average', 'years_of_study', 'first_impressions_ids', 'fos_ids', 'graduate_careers_ids'], service: 'dataPlatform', relation_fields: { moe_category_id: { name: '门类', relation: 'CRMMoe' }, moe_type_discipline_id: { name: '专业类/学科名称', relation: 'CRMMoe' }, first_impressions_ids: {name: '第一印象', relation: 'VSDFirstImpressions' }, fos_ids: {name: '相关专业', relation: 'CRMFos' }, graduate_careers_ids: {name: '相关职业', relation: 'CRMOccupation' } } },
  VSDFirstImpressions:        { label: '第一印象', fields: ['id', 'content', 'course_core_id', 'fos_id'], service: 'dataPlatform', relation_fields: {course_core_id: {name: '关联核心课程', relation: 'VSDCourseCore' }, fos_id: {name: '关联专业', relation: 'CRMFos' } } },
  CRMProgram:                 { label: '项目',     fields: ['id', 'application_process', 'contact_address', 'deadline', 'degree', 'degree_requirement', 'department', 'description', 'discipline_category', 'duration', 'education_plan', 'hot_fos_id', 'institute_id', 'name', 'online_application_link', 'program_admission_link', 'program_type', 'term', 'year', 'case_ids', 'course_setting_ids', 'fos_ids', 'institute_haiwai_ids', 'moe_ids', 'personalized_selection_requirement_ids'], service: 'dataPlatform', relation_fields: { hot_fos_id: { name: '专业', relation: 'CRMFos' }, institute_id: { name: '所属院校', relation: 'CRMInstitute' }, case_ids: { name: '案例', relation: 'CRMCase'}, course_setting_ids: { name: '课程设置', relation: 'VSDCourseSetting'}, fos_ids: { name: '专业', relation: 'CRMFos'}, institute_haiwai_ids: { name: '海外招生院校', relation: 'CRMInstitute'}, moe_ids: { name: '关联国内专业', relation: 'CRMMoe'}, personalized_selection_requirement_ids: { name: '项目报名条件', relation: 'VSDPersonalizedSelectionRequirement'} } },
  VSDPersonalizedSelectionRequirement:      { label: '项目报名条件',     fields: ['id', 'competition_id', 'level', 'name', 'program_ids', 'type'], service: 'dataPlatform', relation_fields: {competition_id: {name: '关联竞赛', relation: 'CRMCompetition' }, program_ids: {name: '关联项目', relation: 'CRMProgram'} } },
  VSDDomesticMasterAdmission: { label: '国内硕士招生', fields: ['id', 'degree_type', 'department_code', 'department_id', 'department_name', 'dept_planned_enrollment', 'discipline_evaluation', 'discipline_moe_id', 'ethnic_minority_plan', 'exam_type', 'if_double_first_class_discipline', 'institute_id', 'major_code', 'major_name', 'phd_development', 'planned_enrollment', 'postgraduate_rec_type', 'remarks', 'research_direction_code', 'research_direction_name', 'school_code', 'school_name', 'study_mode', 'supervisor', 'veterans_plan', 'year', 'yz_website_link', 'examination_subjects_ids'], service: 'dataPlatform', relation_fields: { department_id: { name: '关联院系', relation: 'VSDInstituteDepartment' }, discipline_moe_id: { name: '学科名称', relation: 'CRMMoe' }, institute_id: { name: '关联院校', relation: 'CRMInstitute' }, examination_subjects_ids: {name: '考试科目', relation: 'VSDExaminationSubjects'} } },
  VSDExamExperience:          { label: '高考经验', fields: ['id', 'batch_name', 'case_info', 'case_label', 'case_source', 'gaokao_score', 'gaokao_year', 'highschool_id', 'kind', 'name', 'ranking', 'related_admitted_school_id', 'student_name', 'student_origin', 'subject_combination', 'admitted_major_ids'], service: 'dataPlatform', relation_fields: { related_admitted_school_id: { name: '录取院校', relation: 'CRMInstitute' }, highschool_id: { name: '毕业高中', relation: 'CRMHighschool' }, admitted_major_ids: { name: '录取专业', relation: 'CRMMoe' } } },
  VSDChineseForeignCooperative:         { label: '中外合作办学', fields: ['id', 'approval_authority', 'approval_document_number', 'approval_type', 'campus_address', 'certificate_issued_cn', 'certificate_issued_foreign', 'cooperation_model', 'cooperative_organization_cn', 'cooperative_organization_foreign', 'degree_if_cooperative_program_text', 'diploma_if_cooperative_program_text', 'duration', 'end_year', 'enrollment_method', 'enrollment_quota_per_period', 'if_eligible_graduate_recommendation', 'if_official_canceled', 'institute_china_id', 'institute_foreign_country', 'institution_address', 'institution_attribute', 'institution_scale_of_operation', 'issuance_date', 'issuing_authority', 'legal_representative', 'level', 'level_sandard', 'license_number', 'license_validity_period', 'major_course', 'name', 'name_foreign', 'official_website', 'principal_or_chief_admin', 'province', 'remarks', 'start_end_year', 'start_year', 'tuition_fee_info', 'type', 'validity_date', 'institute_foreign_ids'], service: 'dataPlatform', relation_fields: { institute_china_id: { name: '中外合作办学者-中方关联院校', relation: 'CRMInstitute' }, institute_foreign_ids: { name: '中外合作办学者-外方关联院校', relation: 'CRMInstitute'} } },
  VSDGongWuYuan:              { label: '国考公务员', fields: ['id', 'certificate_apq_limit', 'certificate_cpa_limit', 'certificate_law_limit', 'certificate_ncre_limit', 'cunguan', 'degree', 'degree_limit', 'department_code', 'department_name', 'department_tel1', 'department_tel2', 'department_tel3', 'department_website', 'english_limit', 'exam_type', 'fresh_graduate_limit', 'groot_work_min', 'groot_work_type_limit', 'hometown_limit', 'if_xinjiang_minor', 'if_xizang_minor', 'interview_ratio', 'major', 'minority_limit', 'nolimit', 'notes', 'number', 'org_level', 'organization', 'organization_type', 'other', 'politic_limit', 'politic_status', 'position_code', 'position_des', 'position_name', 'position_pos', 'position_type', 'sanzhi', 'settlement_location', 'settlement_location_city', 'settlement_location_province', 'source_sheetname', 'study_exp', 'study_exp_limit', 'subtest', 'tegang', 'west', 'work_location', 'work_location_city', 'work_location_province', 'year', 'fos_ids', 'major_limit_ids'], service: 'dataPlatform', relation_fields: { fos_ids: { name: '相关fos', relation: 'CRMFos' }, major_limit_ids: { name: '专业限制', relation: 'CRMMoe' } } },
  VSDResearchProjectResults:         { label: '项目成果', fields: ['id', 'name', 'keywords', 'research_field', 'status', 'related_institute_ids'], service: 'dataPlatform', relation_fields: { related_institute_ids: { name: '相关院校', relation: 'CRMInstitute' } } },
  VSDRePrResultsResearchers:         { label: '项目成果人才关联', fields: ['id', 'talent_id', 'research_project_result_id', 'research_project_result_charger'], service: 'dataPlatform', relation_fields: {talent_id: { name: '关联人才', relation: 'CRMTalentPerson' }, research_project_result_id: { name: '关联项目', relation: 'VSDResearchProjectResults' } } },
  VSDCourseCore:              { label: '大学核心课程', fields: ['id', 'homologies_common_word', 'hot_topics_explanation', 'introduction_cn', 'introduction_en', 'name', 'name_cn', 'name_en', 'name_other', 'slug', 'syllabus_cn', 'syllabus_en', 'belong_to_fos_ids', 'book_ids', 'fos_ids', 'online_course_ids', 'prerequisite_course_core_ids', 'related_career_ids', 'related_core_course_fos_ids', 'related_fos_ids', 'related_fos_moe_ids'], service: 'dataPlatform', relation_fields: { belong_to_fos_ids: { name: '所属专业', relation: 'CRMFos'}, book_ids: { name: '书籍', relation: 'VSDBook'}, fos_ids: { name: '专业', relation: 'CRMFos'}, online_course_ids: { name: '在线课程', relation: 'VSDOnlineCourse'}, prerequisite_course_core_ids: { name: '先修课程', relation: 'VSDCourseCore'}, related_career_ids: { name: '相关职业', relation: 'CRMOccupation'}, related_core_course_fos_ids: { name: '核心课程相关专业', relation: 'CRMFos'}, related_fos_ids: { name: '非核心课程相关专业', relation: 'CRMFos'}, related_fos_moe_ids: { name: '关联国内专业', relation: 'CRMMoe'} } },
  VSDOnlineCourse:            { label: '大学在线课程', fields: ['id', 'course_core_ids', 'fos_ids', 'introduction', 'is_self_paced', 'language_subtitles', 'languages', 'name_en_us', 'name_zh_cn', 'professor_name', 'slug', 'websites_provider', 'websites_url'], service: 'dataPlatform', relation_fields: { course_core_ids: { name: '相关核心课程', relation: 'VSDCourseCore'}, fos_ids: { name: '相关专业信息', relation: 'CRMFos'} } },
  VSDInstitutePolicy:         { label: '高校政策',   fields: ['id', 'content', 'gaokao_enrollment_rule', 'institute_id', 'label', 'name', 'official_link', 'school_department', 'source', 'source_publish_date', 'type', 'moe_list_ids'], service: 'dataPlatform', relation_fields: { institute_id: { name: '关联院校', relation: 'CRMInstitute' }, moe_list_ids: { name: '相关学科/专业', relation: 'CRMMoe' } } },
  CRMConference:              { label: '学术会议',   fields: ['id', 'founding_year', 'introduction', 'name', 'name_cn', 'official_web', 'organizer', 'period', 'slug', 'fos_ids'], service: 'dataPlatform', relation_fields: { fos_ids: { name: '相关专业', relation: 'CRMFos' } } },
  CRMOccupationSalary:        { label: '薪资成长',   fields: ['id', 'occupation_id', 'salary', 'year'], service: 'dataPlatform', relation_fields: { occupation_id: { name: '职业百科', relation: 'CRMOccupation' } } },
  VSDBook:                    { label: '教材',   fields: ['id', 'author_name', 'introduction_cn', 'introduction_en', 'isbn', 'kind', 'languages', 'level', 'name', 'name_cn', 'name_en', 'publisher', 'publishing_time', 'slug', 'target_people', 'version', 'career_ids', 'core_course_ids', 'fos_ids'], service: 'dataPlatform', relation_fields: { career_ids: { name: '书籍相关职业', relation: 'CRMOccupation' }, core_course_ids: {name: '相关核心课程', relation: 'VSDCourseCore' }, fos_ids: {name: '书籍相关专业', relation: 'CRMFos' } } },
  VSDCourseSetting:           { label: '课程设置',   fields: ['id', 'course_name', 'course_name_en', 'program_ids'], service: 'dataPlatform', relation_fields: { program_ids: { name: '项目', relation: 'CRMProgram' } } },
  VSDExaminationSubjects:     { label: '考试科目',   fields: ['id', 'foreign_language', 'foreign_language_note', 'political_theory', 'political_theory_note', 'prof_course1', 'prof_course1_note', 'prof_course2', 'prof_course2_note'], service: 'dataPlatform' },
  VSDHistoryChange:           { label: '历史沿革',   fields: ['id', 'event', 'institute_id', 'year'], service: 'dataPlatform', relation_fields: { institute_id: { name: '关联院校', relation: 'CRMInstitute' } } },
  VSDInstituteDepartment:     { label: '院校部门',   fields: ['id', 'departments_key', 'departments_type', 'description_cn', 'description_en', 'institute_id', 'name', 'name_en', 'official_website'], service: 'dataPlatform', relation_fields: { institute_id: { name: '关联院校', relation: 'CRMInstitute' } } },
  VSDProductTechDevice:       { label: '产品技术设备',   fields: ['id', 'code', 'gb_industrys_id', 'industry_list_id', 'name'], service: 'dataPlatform', relation_fields: { gb_industrys_id: { name: '关联行业', relation: 'VSDGbIndustrys' }, industry_list_id: { name: '关联产业', relation: 'VSDIndustryList' } } },
  VSDQualificationVerify:     { label: '资质核查',   fields: ['id', 'description', 'institute_id', 'label', 'safety_level'], service: 'dataPlatform', relation_fields: { institute_id: { name: '关联院校', relation: 'CRMInstitute' } } },
  SelectionOptions:           { label: '选项',   fields: ['id', 'name', 'value', 'flora_external_id', 'selection_id'], service: 'dataPlatform', relation_fields: { selection_id: { name: '关联选项集', relation: 'Selections' } } },
  Selections:                 { label: '选项集',   fields: ['id', 'name'], service: 'dataPlatform' },
  VSDResearchMaterial:        { label: '科研物资',   fields: ['id', 'name', 'type', 'brand_name', 'mid_category', 'real_category', 'specification', 'sub_category', 'supplier_id'], service: 'dataPlatform', relation_fields: { supplier_id: { name: '商家', relation: 'CRMCompany' }, mid_category: { name: '所属类目-二级', relation: 'SelectionOptions' }, real_category: { name: '所属类目-四级', relation: 'SelectionOptions' }, sub_category: { name: '所属类目-三级', relation: 'SelectionOptions' } } }
};

// ── WTF-8 修复：MCP 有时将 UTF-8 字节映射成 lone surrogate（DC80-DCFF）────
function fixWtf8(s: string): string {
  if (typeof s !== 'string' || !/[\uDC80-\uDCFF]/.test(s)) return s;
  try {
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code >= 0xDC80 && code <= 0xDCFF) bytes.push(code - 0xDC00);
      else if (code < 0x80)                  bytes.push(code);
      else                                   bytes.push(...Buffer.from(s[i], 'utf-8'));
    }
    return Buffer.from(bytes).toString('utf-8');
  } catch { return s; }
}

function fixObjStrings(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? fixWtf8(v) : v;
  }
  return out;
}

// ── 根据实体配置选择数据源，默认走 Flora mcpTools ─────────────────────────
export function resolveMcpService(model: string) {
  const cfg = ENTITY_FIELD_MAP[model];
  return cfg?.service === 'dataPlatform' ? mcpToolsDataPlatform : mcpTools;
}

// ── 拉取单个实体的详情 ───────────────────────────────────────────────────
async function fetchEntityDetail(
  model: string,
  entityId: number,
  token: string
): Promise<Record<string, unknown> | null> {
  const fieldCfg = ENTITY_FIELD_MAP[model];
  const fields = fieldCfg?.fields ?? ['name', 'description'];
  const service = resolveMcpService(model);

  return cacheGetOrSet(
    `entity:${model}:${entityId}`,
    async () => {
      try {
        const result = await service.dashGenericGet({
          model,
          id: entityId,
          fields,
        }, token) as unknown as Record<string, unknown>;

        // 多层路径兼容（与 crm.ts 中 dash_generic_get 的解析逻辑保持一致）
        const rr  = result?.remoteResponse as Record<string, unknown> | undefined;
        const obj = result?.item
          ?? (rr?.data as any)?.dash?.generic?.get
          ?? null;

        if (!obj) return null;

        // 如果有 raw 字段（JSON字符串），尝试解析
        if ((obj as any).raw) {
          try { return fixObjStrings(JSON.parse((obj as any).raw)); } catch { /* ignore */ }
        }
        return fixObjStrings(obj as Record<string, unknown>);
      } catch {
        return null;
      }
    },
    ENTITY_CACHE_TTL,
  );
}

// ── 拉取单个实体的详情 (Slug 模式) ─────────────────────────────────────────
async function fetchEntityDetailBySlug(
  model: string,
  slug: string,
  token: string
): Promise<Record<string, unknown> | null> {
  const fieldCfg = ENTITY_FIELD_MAP[model];
  const fields = fieldCfg?.fields ?? ['name', 'description'];
  const service = resolveMcpService(model);

  return cacheGetOrSet(
    `entity:${model}:slug:${slug}`,
    async () => {
      try {
        const result = await service.dashGenericGetByFloraExternalId({
          model,
          floraExternalID: slug,
          fields,
        }, token) as unknown as Record<string, unknown>;

        const rr  = result?.remoteResponse as Record<string, unknown> | undefined;
        const obj = result?.item ?? (rr?.data as any)?.dash?.generic?.getByFloraExternalId ?? null;

        if (!obj || Object.keys(obj).filter(k => k !== '__typename').length === 0) return null;

        if ((obj as any).raw) {
          try { return fixObjStrings(JSON.parse((obj as any).raw)); } catch { /* ignore */ }
        }
        return fixObjStrings(obj as Record<string, unknown>);
      } catch {
        return null;
      }
    },
    ENTITY_CACHE_TTL,
  );
}

// 获取关联实体数据
async function fetchEntityRelations(
  model: string,
  entityId: number,
  relationField: string,
  token: string,
  relationModel: string,
  options?: { limit?: number; fields?: string[]; slug?: string }
): Promise<Record<string, unknown>[] | null> {
  const fieldCfg = ENTITY_FIELD_MAP[relationModel];
  const fields = options?.fields ?? fieldCfg?.fields ?? ['name', 'description'];
  const service = resolveMcpService(model);
  const cacheKey = `entity:${model}:${entityId}:rel:${relationField}`;

  return cacheGetOrSet(
    cacheKey,
    async () => {
      try {
        const result = await service.dashGenericRelationModelSearch({
          currentModel: model,
          currentID: entityId === 0 ? undefined : entityId,
          currentExternalID: options?.slug,
          currentRelationField: relationField,
          fields,
          limit: options?.limit ?? 10,
          offset: 0,
          searchType: 'associated',
        }, token);

        if (!result?.items?.length) return null;

        return result.items.map(item => fixObjStrings(item as Record<string, unknown>));
      } catch {
        return null;
      }
    },
    ENTITY_CACHE_TTL,
  );
}


// ── 格式化单个实体为 Markdown 段落 ───────────────────────────────────────
function formatEntityToMarkdown(
  model: string,
  entityName: string,
  data: Record<string, unknown>
): string {
  const cfg = ENTITY_FIELD_MAP[model];
  const label = cfg?.label ?? model;

  const lines: string[] = [`### ${label}：${entityName}`];

  // 只输出有值的字段
  for (const [key, val] of Object.entries(data)) {
    if (key === 'id' || key === 'raw' || !val) continue;
    const strVal = Array.isArray(val) ? val.join('、') : String(val);
    if (strVal.trim()) lines.push(`- **${key}**：${strVal.trim()}`);
  }

  return lines.join('\n');
}

// ── 主函数：构建实体知识段落 ─────────────────────────────────────────────
/**
 * 给定角色的 linked_entities，拉取每条实体详情并组装成可注入 system prompt 的 Markdown 段落。
 *
 * @param charId        角色 ID（用于缓存 key）
 * @param linkedEntities 角色配置中的关联实体数组
 * @param token         用户 Bearer Token（MCP 调用需要）
 * @returns 格式化后的 Markdown 字符串（空时返回 ''）
 */
export async function buildEntityContextBlock(
  charId: string,
  linkedEntities: Array<{ model: string; entity_id: number; entity_name: string; slug?: string }>,
  token: string
): Promise<string> {
  if (!linkedEntities || linkedEntities.length === 0) return '';
  if (!token) return '';

  // 并发拉取（最多 8 个实体，超过截断，避免 prompt 过长）
  const toFetch = linkedEntities.slice(0, 8);
  const results = await Promise.allSettled(
    toFetch.map(e => 
      e.entity_id === 0 && e.slug 
        ? fetchEntityDetailBySlug(e.model, e.slug, token)
        : fetchEntityDetail(e.model, e.entity_id, token)
    )
  );

  const sections: string[] = [];
  for (let i = 0; i < toFetch.length; i++) {
    const entity = toFetch[i];
    const result = results[i];
    if (result.status === 'rejected' || !result.value) continue;

    const md = formatEntityToMarkdown(entity.model, fixWtf8(entity.entity_name), result.value);
    if (md) sections.push(md);
  }

  if (sections.length === 0) return '';

  const block = [
    '\n\n## 【背景知识底座 — 关联数据库实体】',
    '以下是系统从平方数据库实时拉取的结构化数据，作为你的知识底座：',
    '⚠️ **数据使用规则（必须遵守）**：',
    '1. 涉及数字、薪资、分数线、比例等定量信息时，**必须直接引用下方数据中的原始数值，不得四舍五入、估算或使用训练数据中的通用印象**。',
    '2. 如果下方数据已提供具体数字，不允许用"约"、"大约"、"一般在X~Y之间"等模糊表达替代。',
    '3. 如果某项信息下方数据没有覆盖，才可以结合通用知识补充，并明确说明"此为行业通常情况，非平方专项数据"。',
    '',
    sections.join('\n\n'),
    '\n> *以上数据来自平方数据库，如有最新变化请以官方渠道为准。*',
  ].join('\n');

  return block;
}
