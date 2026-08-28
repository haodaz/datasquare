export interface EducationExperience {
  id?: string; // used for frontend list keys
  degree: string;
  school: string;
  school_en?: string;
  major?: string;
  start_year?: number | null;
  end_year?: number | null;
}

export interface WorkExperience {
  id?: string;
  employer: string;
  employer_en?: string;
  position?: string;
  department?: string;
  start_year?: number | null;
  end_year?: number | null;
  is_current?: boolean;
}

export interface TalentProfile {
  id: number;
  talent_entry_id: number;
  name_cn?: string;
  name_en?: string;
  gender?: string;
  nationality?: string;
  birth_date?: string;
  current_employer?: string;
  position?: string;
  department?: string;
  email?: string;
  homepage_url?: string;
  orcid_id?: string;
  h_index?: number;
  cited_by_count?: number;
  works_count?: number;
  research_fields?: string[];
  bio_snippet?: string;
  other_info?: string;
  education_raw?: string | any[]; // Usually stringified JSON from DB
  work_history?: string | any[];
  awards?: string | string[];
  updated_at?: string;
}

export interface TalentEntry {
  id: number;
  external_id: string;
  talent_name: string;
  talent_name_en?: string;
  institution?: string;
  search_count: number;
  verified: boolean;
  first_searched_at: string;
  last_searched_at: string;
  data_sources: string[];
  trigger_tools: string[];
  ai_report?: string;
  notes?: string;
  
  // Joined relation
  talent_profiles?: TalentProfile | TalentProfile[];
}

// ============================================
// Talent Database (Entity Library) Types
// ============================================

export interface TalentDBEntity {
  id: number;
  source_journal_id?: number;
  first_name?: string;
  last_name?: string;
  name?: string;
  name_en?: string;
  gender?: string;
  birth_date?: string;
  nationality?: string;
  is_chinese?: string;
  province?: string;
  email?: string;
  brid?: string;
  orcid?: string;
  researcher_id?: string;
  profile_link?: string;
  introduction?: string;
  research_field?: string;
  bachelor_duration?: string;
  bachelor_school?: string;
  bachelor_major?: string;
  master_duration?: string;
  master_school?: string;
  master_major?: string;
  phd_duration?: string;
  phd_school?: string;
  phd_major?: string;
  work_current?: string;
  work_experiences?: string;
  award_experiences?: string;
  created_at?: string;
  updated_at?: string;
}

