'use client';

import { useState, useEffect, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, Eye, EyeOff, AlertCircle, Info } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAppStore } from '@/lib/store';

interface LoginForm {
  email: string;
  password: string;
}

// Check if Google OAuth is configured by pinging the backend
async function checkGoogleOAuth(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/google/status', { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      return data.configured === true;
    }
    // If backend returns any error, default to showing the button
    // (better to show a button that might fail than hide it)
    return true;
  } catch {
    // Backend unreachable — show button anyway, user will see error on click
    return true;
  }
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, setOrganizations } = useAppStore();

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>();

  // Check for error from OAuth callback redirect
  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError) {
      setError(decodeURIComponent(oauthError));
      // Clean URL
      window.history.replaceState({}, '', '/login');
    }
  }, [searchParams]);

  // Check Google OAuth config status on mount
  useEffect(() => {
    checkGoogleOAuth().then(setGoogleConfigured);
  }, []);

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError('');
    try {
      const result = await authApi.login(data.email, data.password) as any;
      // Clear stale org from previous session before setting new user
      localStorage.removeItem('socialpilot-store');
      setUser(result.user);
      // Store token for Bearer auth
      if (result.token) {
        localStorage.setItem('auth_token', result.token);
      }
      if (result.organizations?.length) {
        setOrganizations(result.organizations.map((o: any) =>
          o.organization ? { ...o.organization, role: o.role } : o,
        ));
      }
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">

      {/* Logo */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center shadow-glow">
          <Zap size={20} className="text-white" />
        </div>
        <span className="text-xl font-bold text-text-primary">SocialPilot Pro</span>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-2xl p-8 shadow-card">
        <h1 className="text-xl font-bold text-text-primary mb-1">Welcome back</h1>
        <p className="text-sm text-text-muted mb-6">Sign in to your account</p>

        {/* Google OAuth button */}
        {googleConfigured === null ? (
          // Loading state
          <div className="w-full h-10 bg-surface-hover rounded-xl mb-4 skeleton" />
        ) : googleConfigured ? (
          // Configured — show real button
          <a
            href="/api/auth/google"
            className="flex items-center justify-center gap-3 w-full bg-surface-hover border border-surface-border rounded-xl py-2.5 text-sm font-medium text-text-primary hover:border-brand-500/50 hover:bg-surface-border/50 transition-all mb-4"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </a>
        ) : (
          // Not configured — show info banner instead of broken button
          <div className="flex items-start gap-3 bg-surface-hover border border-surface-border rounded-xl px-4 py-3 mb-4">
            <Info size={15} className="text-text-muted mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-text-secondary">Google login not configured</p>
              <p className="text-xs text-text-muted mt-0.5">
                Add <code className="bg-surface-border px-1 rounded text-brand-400">GOOGLE_CLIENT_ID</code> to{' '}
                <code className="bg-surface-border px-1 rounded text-brand-400">.env</code> to enable.{' '}
                <a
                  href="https://console.cloud.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-400 hover:underline"
                >
                  Get credentials →
                </a>
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-surface-border" />
          <span className="text-xs text-text-muted">or sign in with email</span>
          <div className="flex-1 h-px bg-surface-border" />
        </div>

        {/* Email form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Email</label>
            <input
              type="email"
              {...register('email', { required: 'Email is required' })}
              className="w-full bg-surface-input border border-surface-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500 transition-colors"
              placeholder="you@example.com"
              autoComplete="email"
            />
            {errors.email && <p className="text-xs text-error mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-text-secondary">Password</label>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                {...register('password', { required: 'Password is required' })}
                className="w-full bg-surface-input border border-surface-border rounded-xl px-4 py-2.5 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500 transition-colors"
                placeholder="••••••••"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-error mt-1">{errors.password.message}</p>}
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-error/10 border border-error/30 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-error mt-0.5 flex-shrink-0" />
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-text-muted mt-6">
          Don't have an account?{' '}
          <Link href="/register" className="text-brand-400 hover:text-brand-300 font-medium">
            Sign up free
          </Link>
        </p>
      </div>

      <p className="text-center text-xs text-text-muted mt-6">
        By signing in, you agree to our{' '}
        <Link href="/legal/terms" className="text-brand-400 hover:underline">Terms</Link>
        {' '}and{' '}
        <Link href="/legal/privacy" className="text-brand-400 hover:underline">Privacy Policy</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="w-full max-w-md flex items-center justify-center">
          <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center animate-pulse">
            <Zap size={20} className="text-white" />
          </div>
        </div>
      }>
        <LoginContent />
      </Suspense>
    </div>
  );
}
