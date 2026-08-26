'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/supabase/auth-context';
import { useRouter } from 'next/navigation';

const PRIMARY = '#6055f5';

export default function LoginPage() {
  const { signIn, signUp, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    if (mode === 'login') {
      const res = await signIn(email, password);
      if (res.error) { setError(res.error); setSubmitting(false); }
      else router.push('/admin/tools-tester');
    } else {
      const res = await signUp(email, password, displayName || email.split('@')[0]);
      if (res.error) { setError(res.error); setSubmitting(false); }
      else { setSignupSuccess(true); setSubmitting(false); }
    }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f5f6fa' }}>加载中…</div>;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f5f6fa' }}>
      <div style={{ width: 380, background: '#fff', borderRadius: 16, padding: '40px 32px', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(0,0,0,0.85)' }}>DataSquare</div>
          <div style={{ fontSize: 13, color: 'rgba(128,128,128,1)', marginTop: 6 }}>人才数据平台</div>
        </div>

        {signupSuccess ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>注册成功</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>请检查邮箱完成验证，然后登录</div>
            <button onClick={() => { setMode('login'); setSignupSuccess(false); }}
              style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 14 }}>
              去登录
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.65)', display: 'block', marginBottom: 6 }}>显示名称</label>
                <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                  placeholder="你的名字" style={inputStyle} />
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.65)', display: 'block', marginBottom: 6 }}>邮箱</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="name@example.com" style={inputStyle} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.65)', display: 'block', marginBottom: 6 }}>密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="至少 6 位" minLength={6} style={inputStyle} />
            </div>

            {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16, padding: '8px 12px', background: '#fef2f2', borderRadius: 6 }}>{error}</div>}

            <button type="submit" disabled={submitting}
              style={{
                width: '100%', padding: '11px 0', background: PRIMARY, color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
              }}>
              {submitting ? '处理中…' : (mode === 'login' ? '登录' : '注册')}
            </button>

            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#888' }}>
              {mode === 'login' ? (
                <>还没有账号？<span onClick={() => setMode('signup')} style={{ color: PRIMARY, cursor: 'pointer' }}>注册</span></>
              ) : (
                <>已有账号？<span onClick={() => setMode('login')} style={{ color: PRIMARY, cursor: 'pointer' }}>登录</span></>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0',
  borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
