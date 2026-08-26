/** AI 状态 —— 对应 Character.assets 中的 7 种状态图 + idle 兜底 */
export type AIStatus = 'idle' | 'thinking' | 'talking' | 'working' | 'sleeping' | 'resting';

export interface Message {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  timestamp?: string;
  /** 本条 AI 回复的 system prompt 中注入了平方数据实体，用于前台渲染「平方数据」信源徽章 */
  entity_used?: boolean;
  
  // Yida specific inline payloads
  yidaToolCard?: any;        // Renders a tool card (e.g. upload zone, hashtags)
  yidaAuditOverview?: any;   // Renders the audit overview block
  yidaTalents?: any[];       // Renders inline talent tags
  yidaResumeId?: string;
  yidaFilename?: string;     // Renders a file upload placeholder
  yidaFileSize?: number;

  // UI Multiplexing State for V4
  thinkTime?: number;
  isWorking?: boolean;
  workTime?: number;
  toolCalls?: Record<string, {
    id: string;
    name: string;
    status: 'running' | 'success' | 'error';
    logs: string[];
  }>;
}

export interface Character {
  id: string;
  name: string;
  description?: string;
  persona?: string;
  slug?: string;
  avatar?: string;
  tools?: string[] | 'all';
  memory_namespace?: string;
  is_cloud?: boolean;
  assets?: {
    avatar?: string;
    idle?: string;
    thinking?: string;
    working?: string;
    talking?: string;
    sleeping?: string;
    resting?: string;
    hero?: string;
  };
  repository_ids?: number[];
  avatar_ids?: number[];
  tagline?: string;
  intro?: string;
  topic_tags?: string[];
  avatar_emoji?: string;
  ai_type?: 'official' | 'partner' | 'custom' | 'virtual' | 'digital_twin' | 'ambassador';
  skills_preview?: unknown[];
  state_labels?: Record<string, unknown>;
  extra_prompt?: string;
  tags?: string[];
  is_custom?: boolean;
  disable_handoff?: boolean;
  greeting?: string;
  related_chars?: string[];
  visit_count?: number;
  linked_entities?: Array<{ model: string; model_label: string; entity_id: number; entity_name: string; slug?: string }>;
  context_files?: Record<string, string>;
  theme_id?: string;
  quick_prompts?: string[];
  skills?: { name: string; content: string }[];
  public?: boolean;
  
  // A2A Integration Fields
  allow_a2a?: boolean;
  a2a_instructions?: string;
  a2a_topics?: string[];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  token?: string; // Auth token
}

export interface AIResponse {
  message: Message;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
