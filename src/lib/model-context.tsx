'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { ModelOption, MODEL_OPTIONS } from './models';
export { MODEL_OPTIONS } from './models';
export type { ModelOption } from './models';

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
