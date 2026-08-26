import { ToolModule, ToolContext } from '@/lib/tools/types';
import { mcpClient } from '@/lib/mcp/client';

export const mcpGenericModule: ToolModule = {
  definitions: [
    {
      name: 'dash_generic_search',
      description: '在指定模型中搜索记录。',
      input_schema: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          condition: { type: 'string' },
          fields: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
        },
        required: ['model', 'fields'],
      },
    },
  ],
  executors: {
    dash_generic_search: async (inputs: any, context: ToolContext) => {
      // Direct call to mcpClient since we are in the server context
      return await mcpClient.callTool('dash_generic_search', {
        ...inputs,
        bearerToken: context.token
      });
    },
  },
};
