import { ToolModule, ToolContext } from '@/lib/tools/types';
import { mcpClient } from '@/lib/mcp/client';

export const reportModule: ToolModule = {
  definitions: [
    {
      name: 'save_report',
      description: '📋 将本次生成的重要输出保存到「报告记录」，用户可在侧导航「报告记录」中随时查看。',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '报告标题，10-25字' },
          summary: { type: 'string', description: '一句话摘要，说明核心结论或用户画像（可选）' },
          content: { type: 'string', description: '报告正文内容（Markdown 格式）' },
          format: { type: 'string', enum: ['markdown', 'html'], description: '内容格式，默认 markdown' },
          file_path: { type: 'string', description: '已存在的文件路径，与 content 二选一' }
        },
        required: ['title']
      }
    },
    {
      name: 'append_report',
      description: '📋 将续写内容追加到最近一份未完成的报告。当上一条回复因篇幅被截断、报告未输出完整时使用。',
      input_schema: {
        type: 'object',
        properties: {
          report_title: { type: 'string', description: '要追加到的报告标题（必须与之前 save_report 的 title 完全一致）' },
          additional_content: { type: 'string', description: '续写的 Markdown 内容，将被追加到原报告末尾' },
        },
        required: ['report_title', 'additional_content']
      }
    }
  ],
  executors: {
    save_report: async (inputs: any, context: ToolContext) => {
      return await mcpClient.callTool('zhiji_report_action', {
        ...inputs,
        action: 'save',
        bearerToken: context.token
      });
    },
    append_report: async (inputs: any, context: ToolContext) => {
      return await mcpClient.callTool('zhiji_report_action', {
        action: 'append',
        report_title: inputs.report_title,
        content: inputs.additional_content,
        bearerToken: context.token
      });
    }
  }
};