import { ToolDefinition, ToolContext, ToolExecutor } from './types';
import { baseModule } from './modules/base';
import { searchModule } from './modules/search';
import { imageModule } from './modules/image';
import { systemModule } from './modules/system';
import { mcpGenericModule } from './modules/mcp-generic';
import { profileModule } from './modules/profile';
import { memoryModule } from './modules/memory';
import { reportModule } from './modules/report';
import { documentModule } from './modules/document';
import { mcpClient } from '@/lib/mcp/client';

const modules = [
  baseModule,
  searchModule,
  imageModule,
  systemModule,
  mcpGenericModule,
  profileModule,
  memoryModule,
  reportModule,
  documentModule,
];

export const TOOL_DEFINITIONS: ToolDefinition[] = modules.flatMap(m => m.definitions);

const executors: Record<string, ToolExecutor> = modules.reduce((acc, m) => ({
  ...acc,
  ...m.executors
}), {});

export async function executeToolCall(name: string, inputs: any, context: ToolContext = {}) {
  const executor = executors[name];
  if (!executor) {
    // If not found in local modules, route to MCP dynamically
    try {
      return await mcpClient.callTool(name, { ...inputs, bearerToken: context.token });
    } catch (err: any) {
      return `工具错误 (MCP) [${name}]: ${err.message}`;
    }
  }

  try {
    return await executor(inputs, context);
  } catch (err: any) {
    return `工具错误 [${name}]: ${err.message}`;
  }
}