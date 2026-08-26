'use client';

import { AuthProvider } from '@/lib/supabase/auth-context';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
