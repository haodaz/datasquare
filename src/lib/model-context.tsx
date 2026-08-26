'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface ModelOption {
  id: string;
  label: string;
  provider: 'deepseek' | 'qwen' | 'gemini' | 'anthropic';
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'deepseek-v3.2-exp', label: 'DeepSeek V3.2', provider: 'deepseek' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek' },
  { id: 'qwen-plus', label: '通义千问 Plus', provider: 'qwen' },
  { id: 'qwen-turbo', label: '通义千问 Turbo', provider: 'qwen' },
  { id: 'qwen-max', label: '通义千问 Max', provider: 'qwen' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'anthropic' },
];

interface ModelContextType {
  currentModel: string;
  setCurrentModel: (id: string) => void;
  modelLabel: string;
}

const ModelContext = createContext<ModelContextType>({
  currentModel: 'deepseek-v3.2-exp',
  setCurrentModel: () => {},
  modelLabel: 'DeepSeek V3.2',
});

const STORAGE_KEY = 'datasquare_model';

export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [currentModel, setModel] = useState('deepseek-v3.2-exp');

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

  const modelLabel = MODEL_OPTIONS.find(m => m.id === currentModel)?.label || currentModel;

  return (
    <ModelContext.Provider value={{ currentModel, setCurrentModel, modelLabel }}>
      {children}
    </ModelContext.Provider>
  );
}

export const useModel = () => useContext(ModelContext);
