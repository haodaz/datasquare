import { mcpClient } from './client';
import fs from 'fs';
import path from 'path';

async function main() {
  try {
    const tools = await mcpClient.getTools();
    const filePath = path.join(__dirname, 'mcp_tools_list.json');
    fs.writeFileSync(filePath, JSON.stringify(tools, null, 2), 'utf-8');
  } catch (err) {
    console.error('获取工具列表失败:', err);
  } finally {
    mcpClient.stop();
  }
}

main();
