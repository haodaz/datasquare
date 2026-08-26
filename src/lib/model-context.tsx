'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

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
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    supportsJsonMode: true,
  },
  {
    id: 'gemini-flash-latest', label: 'Gemini 3.6 Flash', provider: 'Google',
    modelName: 'gemini-3.6-flash', apiKeyEnv: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    supportsJsonMode: true,
  },
  {
    id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI',
    modelName: 'gpt-4o', apiKeyEnv: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    supportsJsonMode: true,
  },
];

interface ModelContextType {
  currentModel: string;
  setCurrentModel: (id: string) => void;
  modelLabel: string;
  modelConfig: ModelOption;
}

const defaultModel = MODEL_OPTIONS[0];

const ModelContext = createContext<ModelContextType>({
  currentModel: defaultModel.id,
  setCurrentModel: () => {},
  modelLabel: defaultModel.label,
  modelConfig: defaultModel,
});

const STORAGE_KEY = 'datasquare_model';

export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [currentModel, setModel] = useState(defaultModel.id);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && MODEL_OPTIONS.find(m => m.id === saved)) {
      setModel(saved);
    }
  }, []);

  function setCurrentModel(id: string) {
    setModel(id);
    localStorage.setItem(STORAGE_KEY, id);
    // 同步到 cookie 供服务端工具读取
    fetch('/api/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id }) }).catch(() => {});
  }

  const config = MODEL_OPTIONS.find(m => m.id === currentModel) || defaultModel;

  return (
    <ModelContext.Provider value={{ currentModel, setCurrentModel, modelLabel: config.label, modelConfig: config }}>
      {children}
    </ModelContext.Provider>
  );
}

export const useModel = () => useContext(ModelContext);
