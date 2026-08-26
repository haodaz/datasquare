'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ApiOutlined, DatabaseOutlined, LogoutOutlined, UserOutlined, SwapOutlined, DownOutlined } from '@ant-design/icons';
import { AuthProvider, useAuth } from '@/lib/supabase/auth-context';
import { ModelProvider, useModel, MODEL_OPTIONS } from '@/lib/model-context';

const PRIMARY = '#6055f5';

const NAV = [
  { key: 'tools-tester',     icon: <ApiOutlined />,         label: '应用测试台',   path: '/admin/tools-tester' },
  { key: 'talent-journal',   icon: <DatabaseOutlined />,    label: '人才日志',     path: '/admin/talent-journal' },
];

/* ── 模型切换下拉 ── */
function ModelSwitcher() {
  const { currentModel, setCurrentModel, modelLabel } = useModel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
          borderRadius: 8, cursor: 'pointer', fontSize: 12,
          background: open ? 'rgba(96,85,245,0.06)' : 'transparent',
          color: 'rgba(0,0,0,0.65)', transition: 'all 0.15s',
          border: '1px solid rgba(223,227,245,0.8)',
        }}
      >
        <SwapOutlined style={{ fontSize: 13, color: PRIMARY }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {modelLabel}
        </span>
        <DownOutlined style={{ fontSize: 9, color: '#aaa', transform: open ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
      </div>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0,
          marginBottom: 4, background: '#fff', borderRadius: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)', border: '1px solid rgba(223,227,245,0.8)',
          maxHeight: 280, overflowY: 'auto', zIndex: 100,
        }}>
          {MODEL_OPTIONS.map(m => (
            <div key={m.id}
              onClick={() => { setCurrentModel(m.id); setOpen(false); }}
              style={{
                padding: '9px 12px', fontSize: 12, cursor: 'pointer',
                background: currentModel === m.id ? 'rgba(96,85,245,0.08)' : 'transparent',
                color: currentModel === m.id ? PRIMARY : 'rgba(0,0,0,0.65)',
                fontWeight: currentModel === m.id ? 600 : 400,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (currentModel !== m.id) e.currentTarget.style.background = '#f8f8fa'; }}
              onMouseLeave={e => { if (currentModel !== m.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div>{m.label}</div>
              <div style={{ fontSize: 10, color: '#bbb', marginTop: 1 }}>{m.id}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 主布局 ── */
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
    if (typeof window !== 'undefined') router.replace('/login');
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

        {/* 底部：模型切换 + 用户信息 */}
        <div style={{ padding: '12px 10px', borderTop: '1px solid rgba(223,227,245,0.6)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 模型切换 */}
          <ModelSwitcher />

          {/* 用户信息 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: 'rgba(96,85,245,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <UserOutlined style={{ fontSize: 13, color: PRIMARY }} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.display_name || user.email?.split('@')[0] || '用户'}
              </div>
              <div style={{ fontSize: 10, color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
            </div>
            <div
              onClick={() => signOut().then(() => router.replace('/login'))}
              title="退出登录"
              style={{ cursor: 'pointer', color: '#ccc', padding: 4, borderRadius: 4, transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
              onMouseLeave={e => (e.currentTarget.style.color = '#ccc')}
            >
              <LogoutOutlined style={{ fontSize: 14 }} />
            </div>
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
      <ModelProvider>
        <AdminLayoutGuard>{children}</AdminLayoutGuard>
      </ModelProvider>
    </AuthProvider>
  );
}
