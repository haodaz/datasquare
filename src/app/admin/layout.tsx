'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ApiOutlined, DatabaseOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { AuthProvider, useAuth } from '@/lib/supabase/auth-context';

const PRIMARY = '#6055f5';

const NAV = [
  { key: 'tools-tester',     icon: <ApiOutlined />,         label: '应用测试台',   path: '/admin/tools-tester' },
  { key: 'talent-journal',   icon: <DatabaseOutlined />,    label: '人才日志',     path: '/admin/talent-journal' },
];

function AdminLayoutGuard({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f5f6fa' }}>
        <div style={{ fontSize: 14, color: '#999' }}>加载中…</div>
      </div>
    );
  }

  if (!user) {
    // 未登录，跳转到登录页
    if (typeof window !== 'undefined') {
      router.replace('/login');
    }
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f5f6fa' }}>
        <div style={{ fontSize: 14, color: '#999' }}>正在跳转到登录页…</div>
      </div>
    );
  }

  const activeKey = NAV.find(n => pathname.startsWith(n.path))?.key || 'tools-tester';

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f5f6fa' }}>
      {/* 左侧导航 */}
      <div style={{
        width: 200, flexShrink: 0, background: '#fff',
        borderRight: '1px solid rgba(223,227,245,1)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* 顶部标题 */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(223,227,245,0.6)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.85)' }}>管理后台</div>
          <div style={{ fontSize: 11, color: 'rgba(128,128,128,1)', marginTop: 2 }}>DataSquare</div>
        </div>

        {/* 导航项 */}
        <div style={{ padding: '8px 8px', flex: 1 }}>
          {NAV.map(item => (
            <div key={item.key} onClick={() => router.push(item.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
                background: activeKey === item.key ? 'rgba(96,85,245,0.10)' : 'transparent',
                color: activeKey === item.key ? PRIMARY : 'rgba(0,0,0,0.70)',
                fontWeight: activeKey === item.key ? 600 : 400,
                fontSize: 13, transition: 'all 0.15s',
              }}>
              <span style={{ fontSize: 15 }}>{item.icon}</span>
              {item.label}
            </div>
          ))}
        </div>

        {/* 底部用户信息 */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(223,227,245,0.6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <UserOutlined style={{ fontSize: 14, color: PRIMARY }} />
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {profile?.display_name || user.email?.split('@')[0] || '用户'}
            </span>
          </div>
          <div onClick={() => signOut().then(() => router.replace('/login'))}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0', cursor: 'pointer', fontSize: 12, color: '#999',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
            onMouseLeave={e => (e.currentTarget.style.color = '#999')}>
            <LogoutOutlined style={{ fontSize: 13 }} />
            退出登录
          </div>
        </div>
      </div>

      {/* 右侧内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
        {children}
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AdminLayoutGuard>{children}</AdminLayoutGuard>
    </AuthProvider>
  );
}
