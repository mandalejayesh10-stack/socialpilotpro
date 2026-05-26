'use client';

import { useIntegrations, useOrgId } from '@/lib/hooks';
import { integrationApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { mutate } from 'swr';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Instagram, Facebook, Youtube, Plus, Trash2, RefreshCw, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import dayjs from 'dayjs';

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
};

export default function ConnectionsPage() {
  const orgId = useOrgId();
  const toast = useToast();
  const searchParams = useSearchParams();
  const { data: integrations = [], isLoading } = useIntegrations();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<{ meta: boolean; youtube: boolean }>({
    meta: false,
    youtube: false,
  });

  // Load OAuth provider status — public endpoint, no auth needed
  useEffect(() => {
    fetch('/api/integrations/status', {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    })
      .then(r => r.json())
      .then(d => setOauthStatus({
        meta:    d.meta?.configured    ?? true,
        youtube: d.youtube?.configured ?? true,
      }))
      .catch(() => {
        // If status check fails, default to showing connect buttons
        setOauthStatus({ meta: true, youtube: true });
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
      const { url } = platform === 'YOUTUBE' 
        ? await integrationApi.connectYoutubeUrl(orgId)
        : await integrationApi.connectMetaUrl(orgId);
      window.location.href = url;
    } catch (e: any) {
      toast.error('Connection failed', e.message);
      setConnecting(null);
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
          <span className="text-text-secondary"> FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET</span>.
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
                const isMetaPlatform = platform === 'INSTAGRAM' || platform === 'FACEBOOK';
                const providerConfigured = isMetaPlatform ? oauthStatus.meta : oauthStatus.youtube;
                const setupGuide = isMetaPlatform ? 'SETUP_META.md' : 'SETUP_OAUTH.md';

                if (!providerConfigured) {
                  return (
                    <div className="flex items-start gap-2 bg-warning/5 border border-warning/20 rounded-xl px-3 py-2.5">
                      <AlertCircle size={13} className="text-warning mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-warning">Not configured</p>
                        <p className="text-[10px] text-text-muted mt-0.5">
                          Add {isMetaPlatform ? 'FACEBOOK_APP_ID' : 'YOUTUBE_CLIENT_ID'} to{' '}
                          <code className="bg-surface-border px-1 rounded">.env</code>.{' '}
                          See <code className="bg-surface-border px-1 rounded">{setupGuide}</code>
                        </p>
                      </div>
                    </div>
                  );
                }

                return (
                  <button
                    onClick={() => handleConnect(platform)}
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
          <div className="flex justify-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center text-pink-400">
              <Instagram size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
              <Facebook size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-400">
              <Youtube size={18} />
            </div>
          </div>
          <h3 className="text-base font-semibold text-text-primary mb-2">No accounts connected yet</h3>
          <p className="text-sm text-text-muted max-w-sm mx-auto">
            Connect your Instagram, Facebook, or YouTube accounts to start scheduling posts and tracking analytics.
          </p>
        </div>
      )}
    </div>
  );
}
