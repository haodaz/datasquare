import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase/client';

/**
 * 获取用户认证信息
 * 优先级：Supabase session (cookie) > Authorization header > zhiji_token (legacy)
 */
export async function getToken(req?: Request): Promise<string | undefined> {
  // 1. 从 Authorization header 读 Supabase JWT
  if (req) {
    const headerToken = req.headers.get('authorization')?.replace('Bearer ', '');
    if (headerToken && headerToken.startsWith('eyJ')) return headerToken;
  }

  // 2. 从 cookie 读 Supabase session token
  const cookieStore = await cookies();
  const sbToken = cookieStore.get('sb-qrmjiwbvqerdsrayqvpv-auth-token')?.value;
  if (sbToken) {
    try {
      const parsed = JSON.parse(sbToken);
      if (parsed?.access_token) return parsed.access_token;
    } catch { /* not JSON, use raw */ }
    return sbToken;
  }

  // 3. Legacy: zhiji_token (for backward compatibility with MCP)
  const legacyToken = cookieStore.get('zhiji_token')?.value;
  if (legacyToken) return legacyToken;

  return undefined;
}

/**
 * 检查当前用户是否为管理员
 * 使用 Supabase service_role 查 profiles 表
 */
export async function checkIsAdmin(_token?: string): Promise<boolean> {
  // 开发期间暂时放通所有认证用户
  // 后续可以通过 profiles.role = 'admin' 严格控制
  if (_token) return true;
  return false;
}

/**
 * 获取当前 Supabase 用户 ID（从 JWT 解析）
 */
export function getUserIdFromToken(token?: string): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.sub || null;
  } catch {
    return null;
  }
}
