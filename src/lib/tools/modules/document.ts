import { ToolModule, ToolContext } from '@/lib/tools/types';
import { mcpClient } from '@/lib/mcp/client';

export const documentModule: ToolModule = {
  definitions: [
    {
      name: 'knowledge_base',
      description: '📚 知识库 · 查询 kb/ 目录中的本地升学知识库，包含录取数据、院校资料、专业介绍、高考政策等。',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'search', 'read'], description: 'list=列出所有文件, search=搜索关键词, read=读取指定文件' },
          query: { type: 'string', description: '搜索关键词' },
          path: { type: 'string', description: '文件路径' }
        },
        required: ['action']
      }
    },
    {
      name: 'scan_documents',
      description: '📂 扫描文件夹，自动提取其中所有文档（PDF/Word/TXT/MD/HTML/CSV）的文字内容。',
      input_schema: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: '要扫描的文件夹路径' }
        }
      }
    }
  ],
  executors: {
    knowledge_base: async (inputs: any, context: ToolContext) => {
      return await mcpClient.callTool('zhiji_kb_action', { 
        ...inputs, 
        bearerToken: context.token,
        repositoryIds: context.repositoryIds || []
      });
    },
    scan_documents: async (inputs: any, context: ToolContext) => {
      // 在生产环境中如果依赖本地文件系统读取，可能需要重写或走 MCP
      return await mcpClient.callTool('zhiji_scan_documents', { 
        ...inputs, 
        bearerToken: context.token 
      });
    }
  }
};