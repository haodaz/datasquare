import { ToolModule } from '@/lib/tools/types';
import { execSync } from 'child_process';
import vm from 'vm';

export const systemModule: ToolModule = {
  definitions: [
    {
      name: 'run_code',
      description: '在 Node.js 沙盒中执行 JavaScript 代码。禁止使用 require/import。',
      input_schema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要执行的 JavaScript 代码' },
        },
        required: ['code'],
      },
    },
    {
      name: 'run_python',
      description: '在本地执行 Python 脚本。支持安装 pip 包。',
      input_schema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要执行的 Python 代码' },
          packages: { type: 'string', description: '需要安装的 pip 包，空格分隔' },
        },
        required: ['code'],
      },
    },
    {
      name: 'git_exec',
      description: '执行 Git 命令（status, log, diff, add, commit 等）。',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'git 命令（不含 git 前缀）' },
          workdir: { type: 'string', description: '工作目录绝对路径' },
        },
        required: ['command'],
      },
    },
    {
      name: 'read_webpage',
      description: '读取网页正文内容，自动去除噪音。',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '网页完整 URL' },
        },
        required: ['url'],
      },
    },
  ],
  executors: {
    run_code: (inputs: { code: string }) => {
      const output: string[] = [];
      const sandboxConsole = {
        log: (...args: any[]) => output.push(args.map(String).join(' ')),
        error: (...args: any[]) => output.push('ERR: ' + args.map(String).join(' ')),
      };

      const context = vm.createContext({
        console: sandboxConsole,
        Math, JSON, Array, Object, String, Number, Boolean, Date, Map, Set, Promise,
        parseInt, parseFloat, isNaN, isFinite,
      });

      try {
        vm.runInContext(inputs.code, context, { timeout: 5000 });
        return output.join('\n') || '✓ 执行成功';
      } catch (err: any) {
        return `代码执行错误: ${err.message}`;
      }
    },
    run_python: async (_inputs: { code: string; packages?: string }) => {
      return '❌ 本地 Python 执行已被禁用，所有代码执行需通过云端 MCP 服务。';
    },
    git_exec: (inputs: { command: string; workdir?: string }) => {
      const ALLOWED = ['status', 'log', 'diff', 'add', 'commit', 'branch', 'show', 'init', 'stash'];
      const firstWord = inputs.command.trim().split(/\s+/)[0].toLowerCase();
      if (!ALLOWED.includes(firstWord)) return `❌ 不允许的 git 命令: ${firstWord}`;

      const cwd = inputs.workdir || process.cwd();
      try {
        return execSync(`git ${inputs.command}`, { cwd, encoding: 'utf-8' }).trim();
      } catch (err: any) {
        return err.stdout || err.stderr || err.message;
      }
    },
    read_webpage: async (_inputs: { url: string }) => {
      return '❌ 本地网页抓取已被禁用，请使用云端 MCP 搜索工具。';
    },
  },
};
