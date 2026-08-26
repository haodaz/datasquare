import { spawn, ChildProcessByStdio } from 'child_process';
import { Readable, Writable } from 'stream';
import { pickDashMcpBinary } from './utils';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface UserMeResponse {
  me?: {
    display_name?: string;
    email?: string;
    name?: string;
    nickname?: string;
    phone?: string;
    uid?: number;
    user_org_default_language?: string;
  };
  status?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export class McpClient {
  private process: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private buffer = '';
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private isInitialized = false;

  async start() {
    if (this.process && !this.process.killed) return;

    const bin = pickDashMcpBinary();
    if (!bin) {
      throw new Error('未找到合适的 MCP 二进制文件（dash-mcp）');
    }

    const childEnv = { ...process.env };
    childEnv.NODE_ENV = 'production'; // 强制设定为 production，避免连到无数据的 staging 环境

    this.process = spawn(bin, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    this.process.stdout.on('data', this.handleStdout.bind(this));
    this.process.stderr.on('data', (data) => {
      console.error(`[MCP-STDERR] ${data.toString()}`);
    });

    this.process.on('close', (code) => {
      this.cleanup(new Error(`MCP 进程已退出 (code ${code})`));
    });
    this.process.on('error', (err) => {
      this.cleanup(err);
    });

    await Promise.race([
      this.initialize(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('MCP initialize 超时')), 5000)
      ),
    ]);
  }

  private async initialize() {
    if (this.isInitialized) return;

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'zhiji-v2', version: '1.0.0' },
    });

    this.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    this.isInitialized = true;
  }

  async getTools() {
    await this.start();
    try {
      const result = await this.request('tools/list', {}, 10000);
      return (result as Record<string, unknown>)?.tools || [];
    } catch (err) {
      console.error('[MCP] Failed to get tools list:', err);
      return [];
    }
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.start();
    console.log(`[MCP CALL] ${name} args:`, JSON.stringify(args));
    const result = await this.request('tools/call', { name, arguments: args }, 120000);


    if (result && typeof result === 'object' && 'content' in result && Array.isArray(result.content)) {
      const textContent = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');

      try {
        return JSON.parse(textContent) as T;
      } catch {
        return textContent as T;
      }
    }
    return result as T;
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs = 15000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP 请求超时: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private send(msg: JsonRpcRequest) {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error('MCP 进程未启动或不可写');
    }
    this.process.stdin.write(JSON.stringify(msg) + '\n');
  }

  private handleStdout(data: Buffer) {
    this.buffer += data.toString('utf-8');
    let newlineIndex: number;

    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line) continue;

      try {
        const msg: JsonRpcResponse = JSON.parse(line);
        if (msg.id !== undefined) {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            this.pendingRequests.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      } catch (err) {
        console.error('Failed to parse MCP response:', line);
      }
    }
  }

  private cleanup(err: Error) {
    const pending = this.pendingRequests;
    this.pendingRequests = new Map();
    pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(err);
    });
    this.process = null;
    this.isInitialized = false;
  }

  stop() {
    if (this.process) {
      this.process.kill();
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var _globalMcpClient: McpClient | undefined;
}

export const mcpClient = global._globalMcpClient || new McpClient();

if (process.env.NODE_ENV !== 'production') {
  global._globalMcpClient = mcpClient;
}
