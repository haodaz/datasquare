import { ToolModule } from '@/lib/tools/types';

export const baseModule: ToolModule = {
  definitions: [
    {
      name: 'calculator',
      description: '计算数学表达式。支持 JavaScript 数学语法。',
      input_schema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '要计算的数学表达式' },
        },
        required: ['expression'],
      },
    },
    {
      name: 'get_datetime',
      description: '获取当前的日期和时间（本地时间）。',
      input_schema: { type: 'object', properties: {} },
    },
  ],
  executors: {
    calculator: (inputs: { expression: string }) => {
      try {
        // Note: In a real production environment, use a safer math parser instead of eval/vm
        // For refactoring purposes, we keep the logic similar but structured
        const result = Function(`"use strict"; return (${inputs.expression})`)();
        return `= ${result}`;
      } catch (err: any) {
        return `计算错误: ${err.message}`;
      }
    },
    get_datetime: () => {
      const now = new Date();
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const date = now.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const time = now.toLocaleTimeString('zh-CN');
      return `${date} ${time} (${days[now.getDay()]})`;
    },
  },
};
