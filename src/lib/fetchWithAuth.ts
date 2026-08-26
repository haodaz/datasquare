/**
 * 带 Supabase 认证的 fetch 包装
 * 自动从浏览器 Supabase session 获取 JWT 放入 Authorization header
 */
import { supabaseBrowser } from '@/lib/supabase/browser';

export async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabaseBrowser.auth.getSession();
  const token = session?.access_token;

  const headers = new Headers(options?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, { ...options, headers });
}
