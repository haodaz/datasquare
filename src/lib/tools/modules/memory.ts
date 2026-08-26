import { ToolModule, ToolContext } from '@/lib/tools/types';
import { mcpClient } from '@/lib/mcp/client';

export const memoryModule: ToolModule = {
  definitions: [
    {
      name: 'remember',
      description: '将一条信息存入持久记忆，供之后使用 recall 读取。',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '记忆的键名' },
          value: { type: 'string', description: '要存储的值' }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'recall',
      description: '从记忆中读取之前存储的信息。',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '要读取的键名' }
        },
        required: ['key']
      }
    },
    {
      name: 'list_memory',
      description: '列出所有已存储在记忆中的键值对。',
      input_schema: { type: 'object', properties: {} }
    }
  ],
  executors: {
    remember: async (inputs: any, context: ToolContext) => {
      return await mcpClient.callTool('zhiji_memory_action', { 
        ...inputs, 
        action: 'remember',
        namespace: context.memoryNamespace || 'default',
        bearerToken: context.token 
      });
    },
    recall: async (inputs: any, context: ToolContext) => {
      return await mcpClient.callTool('zhiji_memory_action', { 
        ...inputs, 
        action: 'recall',
        namespace: context.memoryNamespace || 'default',
        bearerToken: context.token 
      });
    },
    list_memory: async (inputs: any, context: ToolContext) => {
      return await mcpClient.callTool('zhiji_memory_action', { 
        ...inputs, 
        action: 'list',
        namespace: context.memoryNamespace || 'default',
        bearerToken: context.token 
      });
    }
  }
};