export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  modelName: string;       // 实际传给 API 的 model 名称
  apiKeyEnv: string;       // 环境变量名
  baseURL: string;
  supportsJsonMode: boolean;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'deepseek-v3', label: 'DeepSeek V3', provider: 'DashScope',
    modelName: 'deepseek-v3', apiKeyEnv: 'DASHSCOPE_API_KEY',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    supportsJsonMode: true,
  },
  {
    id: 'claude-sonnet', label: 'Claude Sonnet 5', provider: 'Anthropic',
    modelName: 'claude-sonnet-5', apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseURL: 'https://api.anthropic.com/v1',
    supportsJsonMode: false,
  },
  {
    id: 'gemini-flash', label: 'Gemini 3.5 Flash', provider: 'Google',
    modelName: 'gemini-3.5-flash', apiKeyEnv: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    supportsJsonMode: true,
  },
  {
    id: 'gemini-flash-latest', label: 'Gemini 3.6 Flash', provider: 'Google',
    modelName: 'gemini-3.6-flash', apiKeyEnv: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    supportsJsonMode: true,
  },
  {
    id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI',
    modelName: 'gpt-4o', apiKeyEnv: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    supportsJsonMode: true,
  },
];
