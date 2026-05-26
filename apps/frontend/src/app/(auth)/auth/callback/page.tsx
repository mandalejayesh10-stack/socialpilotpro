'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { authApi } from '@/lib/api';
import { Zap } from 'lucide-react';

/**
 * Handles OAuth callbacks (Google login).
 * The backend sets the secure httpOnly session cookie and redirects here.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, setOrganizations } = useAppStore();

  useEffect(() => {
    const ok = searchParams.get('login') === 'success';

    if (!ok) {
      router.push('/login?error=Authentication+failed');
      return;
    }

    // Clear any stale org from previous session
    // The setOrganizations call will pick the correct org for this user
    localStorage.removeItem('socialpilot-store');

    // Fetch user profile with the new token
    authApi.me()
      .then(async (me: any) => {
        setUser(me);
        if (me.organizations?.length) {
          setOrganizations(me.organizations.map((o: any) => ({
            ...o.organization,
            role: o.role,
          })));
        }
        router.push('/dashboard');
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        router.push('/login?error=Authentication+failed');
      });
  }, []);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center animate-pulse">
          <Zap size={20} className="text-white" />
        </div>
        <p className="text-sm text-text-muted">Signing you in...</p>
      </div>
    </div>
  );
}
