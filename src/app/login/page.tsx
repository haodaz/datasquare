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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a1a' }}>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>加载中…</div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      overflow: 'hidden',
    }}>
      {/* Unsplash 背景图 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'url(https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'brightness(0.45)',
      }} />

      {/* 渐变叠加层 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(96,85,245,0.3) 0%, rgba(10,10,26,0.7) 100%)',
      }} />

      {/* 主内容 */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32 }}>

        {/* 欢迎标语 */}
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <h1 style={{
            fontSize: 42,
            fontWeight: 800,
            color: '#fff',
            margin: 0,
            letterSpacing: '-0.5px',
            textShadow: '0 2px 20px rgba(96,85,245,0.5)',
          }}>
            欢迎进入人才世界
          </h1>
          <div style={{
            fontSize: 16,
            color: 'rgba(255,255,255,0.5)',
            marginTop: 10,
            fontWeight: 400,
            letterSpacing: '2px',
          }}>
            —— 好大壮
          </div>
        </div>

        {/* 登录卡片 */}
        <div style={{
          width: 400,
          background: 'rgba(255,255,255,0.08)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: 20,
          padding: '36px 32px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>看人才DataSquare</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>人才数据检索平台</div>
          </div>

          {signupSuccess ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: '#fff' }}>注册成功</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>请检查邮箱完成验证，然后登录</div>
              <button onClick={() => { setMode('login'); setSignupSuccess(false); }}
                style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 14 }}>
                去登录
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {mode === 'signup' && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>显示名称</label>
                  <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                    placeholder="你的名字" style={inputStyle} />
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>邮箱</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  placeholder="name@example.com" style={inputStyle} />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>密码</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder="至少 6 位" minLength={6} style={inputStyle} />
              </div>

              {error && (
                <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 16, padding: '8px 12px', background: 'rgba(220,38,38,0.15)', borderRadius: 6 }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={submitting}
                style={{
                  width: '100%', padding: '12px 0', background: `linear-gradient(135deg, ${PRIMARY}, #7c6bf5)`, color: '#fff',
                  border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
                  transition: 'all 0.2s', boxShadow: '0 4px 16px rgba(96,85,245,0.4)',
                }}>
                {submitting ? '处理中…' : (mode === 'login' ? '登录' : '注册')}
              </button>

              <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
                {mode === 'login' ? (
                  <>还没有账号？<span onClick={() => setMode('signup')} style={{ color: '#a5b4fc', cursor: 'pointer' }}>注册</span></>
                ) : (
                  <>已有账号？<span onClick={() => setMode('login')} style={{ color: '#a5b4fc', cursor: 'pointer' }}>登录</span></>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.06)', color: '#fff',
  transition: 'border-color 0.2s',
};
