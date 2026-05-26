'use client';

import { Bell, Plus, ChevronDown, Search, Check, LogOut, Settings, CreditCard } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { useAppStore } from '@/lib/store';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { useRouter } from 'next/navigation';

const PLAN_STYLES: Record<string, string> = {
  FREE:   'bg-surface-border text-text-secondary',
  PRO:    'bg-brand-500/20 text-brand-400 border border-brand-500/30',
  AGENCY: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
};

export function Topbar() {
  const { user, organizations, currentOrg, setCurrentOrg, getCurrentTier } = useAppStore();
  const [showOrgMenu, setShowOrgMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNewPost, setShowNewPost] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const tier = getCurrentTier();

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setShowOrgMenu(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    await authApi.logout();
    useAppStore.getState().reset();
    router.push('/login');
  };

  return (
    <header className="h-16 bg-surface-card border-b border-surface-border flex items-center px-6 gap-4 flex-shrink-0 z-30">
      {/* Org selector */}
      <div className="relative" ref={orgMenuRef}>
        <button
          onClick={() => setShowOrgMenu(!showOrgMenu)}
          className="flex items-center gap-2 text-sm font-medium text-text-primary hover:text-brand-400 transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-brand-500/20 flex items-center justify-center text-brand-400 text-xs font-bold flex-shrink-0">
            {currentOrg?.name?.charAt(0)?.toUpperCase() || 'W'}
          </div>
          <span className="max-w-[140px] truncate hidden sm:block">{currentOrg?.name || 'Select workspace'}</span>
          <ChevronDown size={14} className="text-text-muted flex-shrink-0" />
        </button>

        {showOrgMenu && (
          <div className="absolute left-0 top-full mt-2 w-56 bg-surface-card border border-surface-border rounded-xl shadow-card py-1 z-50 animate-fade-in">
            <p className="px-3 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">Workspaces</p>
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => { setCurrentOrg(org.id); setShowOrgMenu(false); }}
                className="flex items-center gap-3 w-full px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <div className="w-6 h-6 rounded-md bg-brand-500/20 flex items-center justify-center text-brand-400 text-xs font-bold flex-shrink-0">
                  {org.name.charAt(0).toUpperCase()}
                </div>
                <span className="flex-1 truncate text-left">{org.name}</span>
                {org.id === (currentOrg?.id || organizations[0]?.id) && (
                  <Check size={14} className="text-brand-400 flex-shrink-0" />
                )}
              </button>
            ))}
            <hr className="border-surface-border my-1" />
            <Link
              href="/dashboard/settings/workspace"
              className="flex items-center gap-2 px-3 py-2 text-sm text-brand-400 hover:bg-surface-hover transition-colors"
              onClick={() => setShowOrgMenu(false)}
            >
              <Plus size={14} />
              New workspace
            </Link>
          </div>
        )}
      </div>

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
        <Link href="/dashboard/billing">
          <span className={clsx('text-xs font-semibold px-2.5 py-1 rounded-full cursor-pointer', PLAN_STYLES[tier] || PLAN_STYLES.FREE)}>
            {tier}
          </span>
        </Link>

        {/* New Post */}
        <Link
          href="/dashboard/calendar?new=true"
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          <Plus size={15} />
          <span className="hidden sm:block">New Post</span>
        </Link>

        {/* Notifications */}
        <button className="relative w-9 h-9 rounded-xl bg-surface-hover flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors">
          <Bell size={17} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand-500 rounded-full" />
        </button>

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            {user?.pictureUrl ? (
              <img src={user.pictureUrl} alt={user.name || ''} className="w-8 h-8 rounded-full object-cover ring-2 ring-surface-border" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-brand-500/30 flex items-center justify-center text-brand-400 text-sm font-semibold ring-2 ring-surface-border">
                {user?.name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
            )}
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-52 bg-surface-card border border-surface-border rounded-xl shadow-card py-1 z-50 animate-fade-in">
              <div className="px-4 py-3 border-b border-surface-border">
                <p className="text-sm font-semibold text-text-primary truncate">{user?.name || 'User'}</p>
                <p className="text-xs text-text-muted truncate">{user?.email}</p>
              </div>
              <Link href="/dashboard/settings" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors" onClick={() => setShowUserMenu(false)}>
                <Settings size={15} /> Settings
              </Link>
              <Link href="/dashboard/billing" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors" onClick={() => setShowUserMenu(false)}>
                <CreditCard size={15} /> Billing
              </Link>
              <hr className="border-surface-border my-1" />
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-error hover:bg-surface-hover transition-colors"
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
