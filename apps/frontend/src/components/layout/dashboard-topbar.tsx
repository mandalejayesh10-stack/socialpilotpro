'use client';

import { Bell, Plus, Search } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useNotifications } from '@/lib/hooks';
import clsx from 'clsx';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { PostComposer } from '@/components/posts/post-composer';
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export function DashboardTopbar() {
  const router = useRouter();
  const { user, currentPlan, reset } = useAppStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: notifications = [] } = useNotifications();
  const unreadCount = notifications.filter((n: any) => !n.read).length;
  const plan = currentPlan();

  const planColors: Record<string, string> = {
    FREE:   'bg-surface-border text-text-secondary',
    PRO:    'bg-brand-500/20 text-brand-400',
    AGENCY: 'bg-amber-500/20 text-amber-400',
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setShowUserMenu(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    await authApi.logout();
    reset();
    router.push('/login');
  };

  return (
    <>
      <header className="h-16 bg-surface-card border-b border-surface-border flex items-center px-6 gap-4 flex-shrink-0 z-10">

        {/* Workspace switcher */}
        <WorkspaceSwitcher />

        {/* Search */}
        <div className="flex-1 max-w-sm hidden md:block">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search posts, analytics..."
              className="w-full bg-surface-input border border-surface-border rounded-xl pl-9 pr-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Plan badge */}
          <span className={clsx('text-xs font-semibold px-2.5 py-1 rounded-full hidden sm:inline-flex', planColors[plan] || planColors.FREE)}>
            {plan}
          </span>

          {/* New Post */}
          <button
            onClick={() => setShowComposer(true)}
            className="flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-3 py-2 rounded-xl transition-colors"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">New Post</span>
          </button>

          {/* Notifications */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative w-9 h-9 rounded-xl bg-surface-hover flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-brand-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-surface-card border border-surface-border rounded-xl shadow-card z-50 animate-fade-in overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
                  <p className="text-sm font-semibold text-text-primary">Notifications</p>
                  {unreadCount > 0 && (
                    <button className="text-xs text-brand-400 hover:text-brand-300">Mark all read</button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-sm text-text-muted text-center py-8">No notifications</p>
                  ) : (
                    notifications.slice(0, 10).map((n: any) => (
                      <div key={n.id} className={clsx('px-4 py-3 border-b border-surface-border/50 hover:bg-surface-hover transition-colors', !n.read && 'bg-brand-500/5')}>
                        <p className="text-sm text-text-primary font-medium">{n.title}</p>
                        <p className="text-xs text-text-muted mt-0.5">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* User menu */}
          <div ref={userRef} className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              {user?.pictureUrl ? (
                <img src={user.pictureUrl} alt={user.name || ''} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand-500/30 flex items-center justify-center text-brand-400 text-sm font-semibold">
                  {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
              )}
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-surface-card border border-surface-border rounded-xl shadow-card py-1 z-50 animate-fade-in">
                <div className="px-4 py-2.5 border-b border-surface-border">
                  <p className="text-sm font-medium text-text-primary truncate">{user?.name}</p>
                  <p className="text-xs text-text-muted truncate">{user?.email}</p>
                </div>
                <Link href="/dashboard/settings" className="block px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors" onClick={() => setShowUserMenu(false)}>
                  Settings
                </Link>
                <Link href="/dashboard/billing" className="block px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors" onClick={() => setShowUserMenu(false)}>
                  Billing & Plans
                </Link>
                <hr className="border-surface-border my-1" />
                <button onClick={handleLogout} className="block w-full text-left px-4 py-2 text-sm text-error hover:bg-surface-hover transition-colors">
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global post composer */}
      <PostComposer
        open={showComposer}
        onClose={() => setShowComposer(false)}
      />
    </>
  );
}
