'use client';

import { useIntegrations, useOrgId } from '@/lib/hooks';
import { integrationApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { mutate } from 'swr';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Instagram, Facebook, Youtube, Plus, Trash2, RefreshCw, AlertCircle, CheckCircle, ExternalLink, X, Lock, Shield, Sparkles, Linkedin, Store } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import dayjs from 'dayjs';

const ThreadsIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2c-5.523 0-10 4.477-10 10s4.477 10 10 10c2.57 0 4.914-.972 6.697-2.563l-1.428-1.428c-1.393 1.222-3.21 1.991-5.269 1.991-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8v1.5c0 .828-.672 1.5-1.5 1.5s-1.5-.672-1.5-1.5v-5.5h-2v1.571c-.754-.973-1.921-1.571-3.25-1.571-2.347 0-4.25 1.903-4.25 4.25s1.903 4.25 4.25 4.25c1.329 0 2.496-.598 3.25-1.571v.821c0 1.933 1.567 3.5 3.5 3.5s3.5-1.567 3.5-3.5v-3c0-5.523-4.477-10-10-10zm0 11.75c-1.243 0-2.25-1.007-2.25-2.25s1.007-2.25 2.25-2.25 2.25 1.007 2.25 2.25-1.007 2.25-2.25 2.25z" />
  </svg>
);

const PLATFORM_CONFIG: Record<string, {
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  description: string;
  steps: string[];
}> = {
  INSTAGRAM: {
    label: 'Instagram',
    icon: <Instagram size={20} />,
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/20',
    description: 'Connect your Instagram Business account via Meta Graph API',
    steps: ['Requires Instagram Business or Creator account', 'Must be linked to a Facebook Page'],
  },
  FACEBOOK: {
    label: 'Facebook',
    icon: <Facebook size={20} />,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    description: 'Connect your Facebook Page to schedule posts and track analytics',
    steps: ['Requires Facebook Page admin access', 'Personal profiles are not supported'],
  },
  YOUTUBE: {
    label: 'YouTube',
    icon: <Youtube size={20} />,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    description: 'Connect your YouTube channel to upload videos and track performance',
    steps: ['Requires YouTube channel ownership', 'Uses Google OAuth 2.0'],
  },
  LINKEDIN: {
    label: 'LinkedIn',
    icon: <Linkedin size={20} />,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/20',
    description: 'Connect your LinkedIn Profile or Page to schedule posts and articles',
    steps: ['Supports Personal Profiles & Pages', 'Schedule text, images, and videos'],
  },
  THREADS: {
    label: 'Threads',
    icon: <ThreadsIcon size={20} />,
    color: 'text-slate-100',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/20',
    description: 'Connect your Threads account to publish threads and media',
    steps: ['Requires Instagram/Threads account', 'Uses Threads Graph API'],
  },
  GOOGLE_BUSINESS: {
    label: 'Google Business',
    icon: <Store size={20} />,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    description: 'Connect Google Business Profile locations to schedule updates and offers',
    steps: ['Requires business location manager access', 'Publish posts directly to Google Maps'],
  },
};

export default function ConnectionsPage() {
  const orgId = useOrgId();
  const toast = useToast();
  const searchParams = useSearchParams();
  const { data: integrations = [], isLoading } = useIntegrations();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [isInstagramModalOpen, setIsInstagramModalOpen] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<{
    meta: boolean;
    youtube: boolean;
    linkedin: boolean;
    threads: boolean;
    googleBusiness: boolean;
  }>({
    meta: false,
    youtube: false,
    linkedin: false,
    threads: false,
    googleBusiness: false,
  });

  // ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsInstagramModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load OAuth provider status — public endpoint, no auth needed
  useEffect(() => {
    fetch('/api/integrations/status', {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    })
      .then(r => r.json())
      .then(d => setOauthStatus({
        meta:    d.meta?.configured    ?? true,
        youtube: d.youtube?.configured ?? true,
        linkedin: d.linkedin?.configured ?? true,
        threads: d.threads?.configured ?? true,
        googleBusiness: d.googleBusiness?.configured ?? true,
      }))
      .catch(() => {
        // If status check fails, default to showing connect buttons
        setOauthStatus({
          meta: true,
          youtube: true,
          linkedin: true,
          threads: true,
          googleBusiness: true,
        });
      });
  }, []);

  // Show toast on OAuth return
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      toast.success(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected!`, 'Your account is now linked.');
      // Force re-fetch integrations
      mutate(['integrations', orgId]);
      // Also invalidate after a short delay to catch any async saves
      setTimeout(() => mutate(['integrations', orgId]), 1500);
      setTimeout(() => mutate(['integrations', orgId]), 3000);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (error) {
      toast.error('Connection failed', decodeURIComponent(error));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams, orgId]);

  const handleDisconnect = async (id: string, name: string) => {
    if (!confirm(`Disconnect "${name}"? Scheduled posts will not be published.`)) return;
    setDisconnecting(id);
    try {
      await integrationApi.disconnect(orgId, id);
      mutate(['integrations', orgId]);
      toast.success('Account disconnected');
    } catch (e: any) {
      toast.error('Failed to disconnect', e.message);
    } finally {
      setDisconnecting(null);
    }
  };

  const connectedPlatforms = new Set(integrations.map((i: any) => i.platform));

  const [connecting, setConnecting] = useState<string | null>(null);

  const handleConnect = async (platform: string) => {
    try {
      setConnecting(platform);
      let url: string;
      if (platform === 'YOUTUBE') {
        const res = await integrationApi.connectYoutubeUrl(orgId);
        url = res.url;
      } else if (platform === 'INSTAGRAM_DIRECT') {
        const res = await integrationApi.connectInstagramUrl(orgId);
        url = res.url;
      } else if (platform === 'LINKEDIN') {
        const res = await integrationApi.connectLinkedinUrl(orgId);
        url = res.url;
      } else if (platform === 'THREADS') {
        const res = await integrationApi.connectThreadsUrl(orgId);
        url = res.url;
      } else if (platform === 'GOOGLE_BUSINESS') {
        const res = await integrationApi.connectGoogleBusinessUrl(orgId);
        url = res.url;
      } else {
        const res = await integrationApi.connectMetaUrl(orgId);
        url = res.url;
      }
      window.location.href = url;
    } catch (e: any) {
      toast.error('Connection failed', e.message);
      setConnecting(null);
    }
  };

  const handleConnectClick = (platform: string) => {
    if (platform === 'INSTAGRAM') {
      setIsInstagramModalOpen(true);
    } else {
      handleConnect(platform);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">Connected Accounts</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Connect your social media accounts to start scheduling and tracking analytics
        </p>
      </div>

      {/* Setup requirements notice */}
      <div className="bg-brand-500/5 border border-brand-500/20 rounded-2xl p-4">
        <p className="text-sm font-semibold text-brand-400 mb-1">Before connecting</p>
        <p className="text-xs text-text-muted leading-relaxed">
          Add your API credentials to <code className="bg-surface-hover px-1 py-0.5 rounded text-brand-400">.env</code> first:
          <span className="text-text-secondary"> FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, THREADS_CLIENT_ID, THREADS_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET</span>.
          Then restart the backend.
        </p>
      </div>

      {/* Platform cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.entries(PLATFORM_CONFIG).map(([platform, config]) => {
          const isConnected = connectedPlatforms.has(platform);
          const platformIntegrations = integrations.filter((i: any) => i.platform === platform);

          return (
            <div key={platform}
              className={clsx(
                'bg-surface-card border rounded-2xl p-5 transition-all',
                isConnected ? `${config.border} shadow-sm` : 'border-surface-border',
              )}>
              {/* Icon + status */}
              <div className="flex items-start justify-between mb-3">
                <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center', config.bg, config.color)}>
                  {config.icon}
                </div>
                {isConnected && (
                  <div className="flex items-center gap-1.5 bg-success/10 border border-success/20 rounded-full px-2.5 py-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span className="text-[10px] font-semibold text-success">Connected</span>
                  </div>
                )}
              </div>

              <h3 className="text-sm font-bold text-text-primary mb-1">{config.label}</h3>
              <p className="text-xs text-text-muted mb-3 leading-relaxed">{config.description}</p>

              {/* Requirements */}
              <div className="space-y-1 mb-4">
                {config.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <div className="w-1 h-1 rounded-full bg-text-muted mt-1.5 flex-shrink-0" />
                    <span className="text-[10px] text-text-muted">{step}</span>
                  </div>
                ))}
              </div>

              {/* Connected accounts list */}
              {platformIntegrations.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {platformIntegrations.map((ig: any) => {
                    const profile = ig.profileData ? JSON.parse(ig.profileData) : {};
                    return (
                      <div key={ig.id} className="flex items-center gap-2 bg-surface-hover rounded-xl px-3 py-2">
                        <div className={clsx('w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white', config.bg, config.color)}>
                          {ig.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-text-primary truncate">{ig.name}</p>
                          {profile.username && (
                            <p className="text-[10px] text-text-muted">@{profile.username}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDisconnect(ig.id, ig.name)}
                          disabled={disconnecting === ig.id}
                          className="text-text-muted hover:text-error transition-colors flex-shrink-0"
                          title="Disconnect"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Connect button */}
              {(() => {
                let providerConfigured = false;
                let envVar = '';
                let setupGuide = 'SETUP_OAUTH.md';
                
                if (platform === 'INSTAGRAM' || platform === 'FACEBOOK') {
                  providerConfigured = oauthStatus.meta;
                  envVar = 'FACEBOOK_APP_ID';
                  setupGuide = 'SETUP_META.md';
                } else if (platform === 'YOUTUBE') {
                  providerConfigured = oauthStatus.youtube;
                  envVar = 'YOUTUBE_CLIENT_ID';
                  setupGuide = 'SETUP_OAUTH.md';
                } else if (platform === 'LINKEDIN') {
                  providerConfigured = oauthStatus.linkedin;
                  envVar = 'LINKEDIN_CLIENT_ID';
                  setupGuide = 'SETUP_LINKEDIN.md';
                } else if (platform === 'THREADS') {
                  providerConfigured = oauthStatus.threads;
                  envVar = 'THREADS_CLIENT_ID';
                  setupGuide = 'SETUP_THREADS.md';
                } else if (platform === 'GOOGLE_BUSINESS') {
                  providerConfigured = oauthStatus.googleBusiness;
                  envVar = 'GOOGLE_CLIENT_ID';
                  setupGuide = 'SETUP_GOOGLE.md';
                }

                if (!providerConfigured) {
                  return (
                    <div className="flex items-start gap-2 bg-warning/5 border border-warning/20 rounded-xl px-3 py-2.5">
                      <AlertCircle size={13} className="text-warning mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-warning">Not configured</p>
                        <p className="text-[10px] text-text-muted mt-0.5">
                          Add {envVar} to{' '}
                          <code className="bg-surface-border px-1 rounded">.env</code>.{' '}
                          See <code className="bg-surface-border px-1 rounded">{setupGuide}</code>
                        </p>
                      </div>
                    </div>
                  );
                }

                return (
                  <button
                    onClick={() => handleConnectClick(platform)}
                    disabled={connecting === platform}
                    className={clsx(
                      'flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-semibold transition-all',
                      isConnected
                        ? 'bg-surface-hover text-text-secondary hover:text-text-primary border border-surface-border'
                        : `${config.bg} ${config.color} border ${config.border} hover:opacity-80`,
                      connecting === platform && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <Plus size={12} />
                    {connecting === platform ? 'Connecting...' : isConnected ? `Add another ${config.label}` : `Connect ${config.label}`}
                  </button>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Connected accounts full list */}
      {integrations.length > 0 && (
        <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">
              All Connected Accounts
              <span className="ml-2 text-xs text-text-muted font-normal">({integrations.length})</span>
            </h3>
          </div>

          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <div className="skeleton w-10 h-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-4 w-40" />
                    <div className="skeleton h-3 w-28" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-surface-border/50">
              {integrations.map((integration: any) => {
                const config = PLATFORM_CONFIG[integration.platform];
                const profile = integration.profileData ? JSON.parse(integration.profileData) : {};
                const isExpiringSoon = integration.tokenExpiry &&
                  dayjs(integration.tokenExpiry).diff(dayjs(), 'day') < 7;

                return (
                  <div key={integration.id}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-surface-hover/50 transition-colors">
                    {/* Platform icon */}
                    <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', config?.bg, config?.color)}>
                      {config?.icon}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-text-primary">{integration.name}</p>
                        <Badge variant={integration.platform.toLowerCase() as any}>{config?.label}</Badge>
                        {integration.refreshNeeded && (
                          <div className="flex items-center gap-1 text-xs text-warning">
                            <AlertCircle size={11} />
                            <span>Reconnect needed</span>
                          </div>
                        )}
                        {isExpiringSoon && !integration.refreshNeeded && (
                          <div className="flex items-center gap-1 text-xs text-warning">
                            <RefreshCw size={11} />
                            <span>Token expiring soon</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {profile.username && (
                          <span className="text-xs text-text-muted">@{profile.username}</span>
                        )}
                        {profile.followersCount && (
                          <span className="text-xs text-text-muted">{Number(profile.followersCount).toLocaleString()} followers</span>
                        )}
                        {profile.subscriberCount && (
                          <span className="text-xs text-text-muted">{Number(profile.subscriberCount).toLocaleString()} subscribers</span>
                        )}
                        {integration.tokenExpiry && (
                          <span className="text-xs text-text-muted">
                            Token expires {dayjs(integration.tokenExpiry).format('MMM D, YYYY')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {integration.refreshNeeded && (
                        <button
                          onClick={() => handleConnect(integration.platform)}
                          disabled={connecting === integration.platform}
                          className={clsx(
                            "flex items-center gap-1.5 text-xs text-warning hover:text-amber-300 font-medium transition-colors",
                            connecting === integration.platform && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <RefreshCw size={12} />
                          {connecting === integration.platform ? 'Connecting...' : 'Reconnect'}
                        </button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={13} />}
                        loading={disconnecting === integration.id}
                        onClick={() => handleDisconnect(integration.id, integration.name)}
                        className="text-error hover:text-error"
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && integrations.length === 0 && (
        <div className="bg-surface-card border border-dashed border-surface-border rounded-2xl p-12 text-center">
          <div className="flex justify-center gap-3 mb-4 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center text-pink-400">
              <Instagram size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
              <Facebook size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-400">
              <Youtube size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400">
              <Linkedin size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-500/10 flex items-center justify-center text-slate-100">
              <ThreadsIcon size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <Store size={18} />
            </div>
          </div>
          <h3 className="text-base font-semibold text-text-primary mb-2">No accounts connected yet</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Connect your social media profiles, pages, channels, or business locations to start scheduling posts and tracking analytics.
          </p>
        </div>
      )}

      {/* Premium Instagram Connection Selector Modal */}
      <AnimatePresence>
        {isInstagramModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop Mask */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsInstagramModalOpen(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />

            {/* Modal Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="relative w-full max-w-4xl bg-[#0c0c16]/95 border border-violet-500/20 rounded-[32px] overflow-hidden p-6 md:p-10 shadow-[0_0_80px_-12px_rgba(139,92,246,0.35)] z-10 max-h-[90vh] overflow-y-auto"
            >
              {/* Close Button */}
              <button
                onClick={() => setIsInstagramModalOpen(false)}
                className="absolute top-6 right-6 p-2 rounded-full bg-surface-hover hover:bg-surface-border text-text-muted hover:text-text-primary transition-colors z-20"
              >
                <X size={16} />
              </button>

              {/* Title & Header */}
              <div className="text-center mb-10 max-w-lg mx-auto">
                <h2 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-text-primary to-violet-300">
                  Connect Instagram account
                </h2>
                <p className="text-sm text-text-muted mt-2">
                  Select how you would like to connect your account
                </p>
              </div>

              {/* Side-by-Side Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                
                {/* CARD 1 — DIRECT INSTAGRAM OAUTH */}
                <motion.div
                  whileHover={{ y: -6, scale: 1.01 }}
                  className="relative group flex flex-col justify-between rounded-3xl bg-gradient-to-b from-[#1c1c30]/40 to-[#0e0e18]/60 border border-pink-500/10 hover:border-pink-500/30 p-6 md:p-8 transition-all duration-300 hover:shadow-[0_0_30px_-5px_rgba(236,72,153,0.25)]"
                >
                  <div>
                    {/* Pink Glow Accent */}
                    <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    
                    <div className="flex items-center justify-between mb-6">
                      <div className="w-12 h-12 rounded-2xl bg-pink-500/10 text-pink-400 flex items-center justify-center shadow-[0_0_20px_rgba(236,72,153,0.15)]">
                        <Instagram size={22} />
                      </div>
                      <Badge className="bg-pink-500/20 text-pink-300 border-none font-bold tracking-wide">
                        Direct Login
                      </Badge>
                    </div>

                    <h3 className="text-lg font-bold text-text-primary mb-2">Connect via Instagram</h3>
                    <p className="text-xs text-text-muted mb-6 leading-relaxed">
                      Connect your Instagram account directly without starting from Facebook.
                    </p>

                    {/* Features list */}
                    <ul className="space-y-3 mb-8">
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Direct Instagram authentication</span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Profile information syncing</span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Basic account metrics & stats</span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Creator account support</span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Personal account connection support</span>
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={() => {
                        setIsInstagramModalOpen(false);
                        handleConnect('INSTAGRAM_DIRECT');
                      }}
                      disabled={connecting === 'INSTAGRAM_DIRECT'}
                      className="w-full py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-bold text-xs tracking-wide shadow-lg shadow-pink-500/20 transition-all duration-200"
                    >
                      {connecting === 'INSTAGRAM_DIRECT' ? 'Connecting...' : 'Connect via Instagram'}
                    </button>
                    <p className="text-[10px] text-center text-text-muted italic">
                      Best for direct Instagram account access and lightweight integrations
                    </p>
                  </div>
                </motion.div>

                {/* CARD 2 — FACEBOOK GRAPH API */}
                <motion.div
                  whileHover={{ y: -6, scale: 1.01 }}
                  className="relative group flex flex-col justify-between rounded-3xl bg-gradient-to-b from-[#1c1c30]/40 to-[#0e0e18]/60 border border-blue-500/10 hover:border-blue-500/30 p-6 md:p-8 transition-all duration-300 hover:shadow-[0_0_30px_-5px_rgba(59,130,246,0.3)]"
                >
                  <div>
                    {/* Blue Glow Accent */}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    
                    <div className="flex items-center justify-between mb-6">
                      <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.15)]">
                        <Facebook size={22} />
                      </div>
                      <Badge className="bg-gradient-to-r from-blue-500/30 to-violet-500/30 text-blue-300 border-none font-bold tracking-wide flex items-center gap-1">
                        <Sparkles size={10} className="animate-pulse" />
                        Recommended
                      </Badge>
                    </div>

                    <h3 className="text-lg font-bold text-text-primary mb-2">Connect via Facebook</h3>
                    <p className="text-xs text-text-muted mb-6 leading-relaxed">
                      Unlock full Instagram Business capabilities through Meta Graph API.
                    </p>

                    {/* Features list */}
                    <ul className="space-y-3 mb-8">
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Direct scheduling & automated publishing</span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Reels & Stories publishing support</span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Business insights & advanced analytics syncing</span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Inbox access & comment management integrations</span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs text-text-secondary">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        <span>Facebook Page connection integration</span>
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={() => {
                        setIsInstagramModalOpen(false);
                        handleConnect('FACEBOOK');
                      }}
                      disabled={connecting === 'FACEBOOK'}
                      className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold text-xs tracking-wide shadow-lg shadow-blue-500/20 transition-all duration-200"
                    >
                      {connecting === 'FACEBOOK' ? 'Connecting...' : 'Connect via Facebook'}
                    </button>
                    <p className="text-[10px] text-center text-text-muted italic">
                      Recommended for businesses requiring publishing, analytics, scheduling, and reels
                    </p>
                  </div>
                </motion.div>

              </div>

              {/* Informational Architecture Footnotes */}
              <div className="mt-10 pt-6 border-t border-surface-border/50 text-[11px] text-text-muted/70 leading-relaxed grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-text-secondary mb-1 flex items-center gap-1">
                    <Lock size={10} />
                    Direct Instagram Login (Instagram Basic API)
                  </h4>
                  <p>
                    Authenticates you directly via Instagram. This lightweight protocol permits fetching your profile name, media count, and follower counts cleanly. However, it does not support third-party publishing, Reels scheduling, or automated inbox actions.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-text-secondary mb-1 flex items-center gap-1">
                    <Shield size={10} />
                    Facebook Login (Instagram Graph API)
                  </h4>
                  <p>
                    Leverages the comprehensive enterprise Meta Graph API. This connection requires that your Instagram account is set to a Creator or Business profile and linked to a Facebook Page you manage. Enables full scheduling, auto-publishing, Reels, and deep analytics syncing.
                  </p>
                </div>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
