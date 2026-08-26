import { ToolModule } from '@/lib/tools/types';

export const imageModule: ToolModule = {
  definitions: [
    {
      name: 'read_image',
      description: '使用 AI 提取图片中的文字内容（OCR）。支持成绩单、证书、手写笔记等。',
      input_schema: {
        type: 'object',
        properties: {
          image_path: { type: 'string', description: '图片路径，相对于项目根目录' },
          prompt: { type: 'string', description: '可选的提取指令' },
        },
        required: ['image_path'],
      },
    },
    {
      name: 'generate_image',
      description: '调用 AI 生成图片。',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片生成提示词（英文）' },
          filename: { type: 'string', description: '保存的文件名' },
          aspect_ratio: { type: 'string', description: '宽高比，默认 9:16' },
        },
        required: ['prompt', 'filename'],
      },
    },
  ],
  executors: {
    read_image: async (_inputs: { image_path: string; prompt?: string }) => {
      return '❌ 本地图片读取已被禁用，所有文件操作需通过云端 MCP 服务。';
    },
    generate_image: async (_inputs: { prompt: string; filename: string; aspect_ratio?: string }) => {
      return '❌ 图片生成及本地保存已被禁用，要求所有资产统一走云端 MCP 存储。';
    },
  },
};
