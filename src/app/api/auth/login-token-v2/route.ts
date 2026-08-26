import { NextResponse } from 'next/server';
import { mcpTools } from '@/lib/mcp/generated-tools';
import { getToken } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const token = await getToken(req);
    
    if (!token) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });

    const result = await mcpTools.authRequestLoginTokenV2(token);

    // The result from MCP tool might be a string containing the text "临时token: XXX"
    // Or it might be structured. We'll parse it like server.js did.
    const responseText = typeof result === 'string' ? result : JSON.stringify(result);
    
    const tokenMatch = responseText.match(/临时token[：:]\s*([a-zA-Z0-9_\-]+)/);
    const accountMatch = responseText.match(/账号[：:]\s*([a-zA-Z0-9_@\.\-]+)/);

    const tempToken = tokenMatch ? tokenMatch[1] : result?.token;
    const account = accountMatch ? accountMatch[1] : result?.account;

    if (!tempToken || !account) {
      return NextResponse.json({
        ok: false,
        error: '获取临时token失败',
        detail: responseText
      });
    }

    return NextResponse.json({ ok: true, tempToken, account });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}