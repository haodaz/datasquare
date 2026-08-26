import { NextResponse } from 'next/server';
import { mcpTools } from '@/lib/mcp/generated-tools';
import { cacheGetOrSet, hashToken } from '@/lib/redis';
import { getToken } from '@/lib/auth';

const ALL_PERMISSION_TAGS = [
  'ss.zhiji.companion.role.admin'
];

const SUPER_ADMINS = ['mcp测试用', 'admin', '13626853563'];

export async function GET(req: Request) {
  try {
    const token = await getToken(req);

    if (!token) return NextResponse.json({ loggedIn: false });

    if (token.startsWith('local_')) return NextResponse.json({ loggedIn: false });

    const result = await cacheGetOrSet(
      `user:me:${hashToken(token)}`,
      () => mcpTools.userMe(token),
      60,
    );
    if (!result || !result.me) {
      return NextResponse.json({
        loggedIn: true,
        username: 'user',
        displayName: '用户',
        isLocal: false,
        permissions: [],
        isAdmin: false
      });
    }

    const me = result.me;

    let userPermissions: string[] = [];
    try {
      const permCheck = await mcpTools.dashGenericAllowPermissionTags({
        matchPermissionTags: ALL_PERMISSION_TAGS
      }, token);
      userPermissions = (permCheck && permCheck.status === 200) ? (permCheck.allowPermissionTags || []) : [];
    } catch (pe: any) {
      console.error('[auth/me] permission check error:', pe.message);
    }

    const uName = me.name || '';
    const dName = me.display_name || '';
    if (SUPER_ADMINS.includes(uName) || SUPER_ADMINS.includes(dName)) {
      if (!userPermissions.includes('ss.zhiji.companion.role.admin')) {
        userPermissions.push('ss.zhiji.companion.role.admin');
      }
    }

    return NextResponse.json({
      loggedIn: true,
      username: me.name || String(me.uid),
      displayName: me.display_name || me.nickname || me.name || String(me.uid),
      email: me.email,
      phone: me.phone,
      uid: me.uid ?? 0,
      isLocal: false,
      permissions: userPermissions,
      isAdmin: userPermissions.includes('ss.zhiji.companion.role.admin')
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}