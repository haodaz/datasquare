import { ToolModule, ToolContext } from '@/lib/tools/types';
import { mcpClient } from '@/lib/mcp/client';

export const profileModule: ToolModule = {
  definitions: [
    {
      name: 'student_profile',
      description: '🗂️ 学生成长档案 · 主动记录和查询学生的碎片信息，构建完整的个人成长画像。',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'delete'], description: '操作类型' },
          fragment: { 
            type: 'object', 
            properties: {
              category: { type: 'string' },
              title: { type: 'string' },
              content: { type: 'string' },
              date: { type: 'string' }
            },
            required: ['category', 'title', 'content']
          },
          category: { type: 'string' },
          id: { type: 'string' }
        },
        required: ['action']
      }
    },
    {
      name: 'save_profile',
      description: '💾 将学生的结构化档案（JSON）持久化保存。',
      input_schema: {
        type: 'object',
        properties: {
          person_id: { type: 'string' },
          profile_json: { type: 'string' }
        },
        required: ['person_id', 'profile_json']
      }
    },
    {
      name: 'load_profile',
      description: '📖 加载学生的结构化档案。',
      input_schema: {
        type: 'object',
        properties: {
          person_id: { type: 'string' }
        }
      }
    }
  ],
  executors: {
    student_profile: async (inputs: any, context: ToolContext) => {
      // 在 v2 中，我们可以将这些逻辑也封装在 MCP 服务器中，或者在这里直接发请求给后端 API
      return await mcpClient.callTool('zhiji_profile_action', { ...inputs, bearerToken: context.token, type: 'fragment' });
    },
    save_profile: async (inputs: any, context: ToolContext) => {
      return await mcpClient.callTool('zhiji_profile_action', { ...inputs, bearerToken: context.token, action: 'save_structured' });
    },
    load_profile: async (inputs: any, context: ToolContext) => {
      return await mcpClient.callTool('zhiji_profile_action', { ...inputs, bearerToken: context.token, action: 'load_structured' });
    }
  }
};