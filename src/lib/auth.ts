import { cookies } from 'next/headers';
import { mcpTools } from '@/lib/mcp/generated-tools';

/**
 * 获取用户认证 token，优先级：cookie > Authorization header
 * @param req - 可选，需要从 header 取 token 时传入
 * @returns token 字符串或 undefined
 */
export async function getToken(req?: Request): Promise<string | undefined> {
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get('zhiji_token')?.value;
  if (cookieToken) return cookieToken;

  if (req) {
    const headerToken = req.headers.get('authorization')?.replace('Bearer ', '');
    if (headerToken) return headerToken;
  }

  return undefined;
}

/**
 * 检查当前 token 是否为管理员
 */
export async function checkIsAdmin(token: string): Promise<boolean> {
  if (!token || token.startsWith('local_')) return false;
  try {
    const meRes = await mcpTools.userMe(token);
    if (meRes?.me) {
       const uName = meRes.me.name || '';
       const dName = meRes.me.display_name || '';
       const SUPER_ADMINS = ['mcp测试用', 'admin', '13626853563'];
       if (SUPER_ADMINS.includes(uName) || SUPER_ADMINS.includes(dName)) {
          return true;
       } else {
          const permCheck = await mcpTools.dashGenericAllowPermissionTags({
            matchPermissionTags: ['ss.zhiji.companion.role.admin']
          }, token);
          return permCheck?.allowPermissionTags?.includes('ss.zhiji.companion.role.admin') || false;
       }
    }
  } catch (e) {
     return false;
  }
  return false;
}
