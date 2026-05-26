'use client';

import { useState } from 'react';
import { useAnalyticsSyncStatus, usePlatformAnalytics, useTopPosts, useContentTypes, useHashtags, useDemographics, useOrgId, invalidateAnalytics } from '@/lib/hooks';
import { MetricCard } from '@/components/ui/metric-card';
import { ChartCard } from '@/components/ui/chart-card';
import { PeriodSelector, Period } from '@/components/ui/period-selector';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonCard, SkeletonChart } from '@/components/ui/skeleton';
import { aiApi, analyticsApi, resolveMediaUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { DemographicsPanel } from '@/components/analytics/demographics-panel';
import {
  Users, Heart, Eye, TrendingUp, Clock, Hash,
  Image, Video, FileText, Sparkles, ExternalLink,
  RefreshCw, AlertCircle, CheckCircle2,
} from 'lucide-react';
import clsx from 'clsx';

interface PlatformPageProps {
  platform: 'INSTAGRAM' | 'FACEBOOK' | 'YOUTUBE';
  color: string;
  icon: React.ReactNode;
}

export function PlatformPage({ platform, color, icon }: PlatformPageProps) {
  const [period, setPeriod] = useState<Period>('30d');
  const [aiInsights, setAiInsights] = useState('');
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const orgId = useOrgId();

  const { data, isLoading } = usePlatformAnalytics(platform, period);
  const { data: topPosts = [], isLoading: loadingPosts } = useTopPosts(platform, period);
  const { data: contentTypes = [] } = useContentTypes(platform, period);
  const { data: hashtags = [] } = useHashtags(platform, period);
  const { data: demographics, isLoading: loadingDemographics } = useDemographics(platform, period);
  const { data: syncStatus } = useAnalyticsSyncStatus();

  const summary = data?.summary;
  const isYoutube = platform === 'YOUTUBE';

  const followerLabel = isYoutube ? 'Subscribers' : 'Followers';

  // Safe parse — handles both string and already-parsed array
  const sp = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })() : []);

  const DAYS_MAP: Record<number, string> = { 0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun' };
  const platformSync = (syncStatus?.platforms || []).filter((item: any) => item.platform === platform);
  const latestSync = platformSync
    .map((item: any) => item.lastSyncedAt ? new Date(item.lastSyncedAt).getTime() : 0)
    .sort((a: number, b: number) => b - a)[0];

  const handleSync = async () => {
    if (!orgId) return;
    setSyncing(true);
    try {
      await analyticsApi.forceSync(orgId);
      invalidateAnalytics(orgId);
    } finally {
      setSyncing(false);
    }
  };

  const handleGetInsights = async () => {
    setLoadingInsights(true);
    try {
      const res = await aiApi.getInsights(orgId, platform, period);
      setAiInsights(res.insights);
    } catch {
      setAiInsights('Unable to generate insights. Please ensure Ollama is running.');
    } finally {
      setLoadingInsights(false);
    }
  };

  if (!isLoading && !summary) {
    return (
      <EmptyState
        icon={icon}
        title={`No ${platform.toLowerCase()} data yet`}
        description="Connect your account and wait for the analytics pipeline to collect data (runs every 15 minutes)."
        action={{ label: 'Connect Account', onClick: () => window.location.href = '/dashboard/settings/connections' }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', color)}>
            {icon}
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary capitalize">{platform.toLowerCase()}</h1>
            <p className="text-sm text-text-muted">Analytics overview</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector value={period} onChange={setPeriod} />
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />}
            loading={syncing}
            onClick={handleSync}
          >
            Sync
          </Button>
        </div>
      </div>

      <SyncStatusStrip items={platformSync} latestSync={latestSync} />

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              label={followerLabel}
              value={summary?.totalFollowers || 0}
              change={summary?.growthPercent}
              changeLabel="growth"
              icon={<Users size={16} />}
              color="brand"
            />
            <MetricCard
              label="Avg Engagement"
              value={`${(summary?.avgEngagementRate || 0).toFixed(2)}%`}
              icon={<Heart size={16} />}
              color="instagram"
            />
            <MetricCard
              label="Total Reach"
              value={summary?.totalReach || 0}
              icon={<Eye size={16} />}
              color="facebook"
            />
            <MetricCard
              label="Posts Published"
              value={summary?.totalPosts || 0}
              icon={<TrendingUp size={16} />}
              color="youtube"
            />
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        {isLoading ? (
          <>
            <SkeletonChart />
            <SkeletonChart />
          </>
        ) : (
          <>
            <ChartCard
              title={`${followerLabel} Growth`}
              subtitle={`Last ${period}`}
              data={summary ? sp(summary.followerTimeline) : []}
              type="line"
              dataKeys={[{ key: 'value', color: '#6366f1', label: followerLabel }]}
            />
            <ChartCard
              title="Engagement Rate"
              subtitle="Daily average %"
              data={summary ? sp(summary.engagementTimeline) : []}
              type="line"
              dataKeys={[{ key: 'value', color: '#e1306c', label: 'Engagement %' }]}
            />
          </>
        )}
      </div>

      {/* Reach chart */}
      {!isLoading && (
        <ChartCard
          title="Reach Over Time"
          subtitle="Total audience reached per day"
          data={summary ? sp(summary.reachTimeline) : []}
          type="bar"
          dataKeys={[{ key: 'value', color: '#6366f1', label: 'Reach' }]}
          height={200}
        />
      )}

      <DemographicsPanel data={demographics} loading={loadingDemographics} />

      {/* Best posting time + content type */}
      <div className="grid grid-cols-2 gap-4">
        {/* Best time */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-brand-400" />
            <h3 className="text-sm font-semibold text-text-primary">Best Posting Time</h3>
          </div>
          {summary?.bestPostingHour !== null && summary?.bestPostingHour !== undefined ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Best hour</span>
                <span className="text-sm font-semibold text-text-primary">
                  {summary.bestPostingHour}:00 – {summary.bestPostingHour + 1}:00 UTC
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Best day</span>
                <span className="text-sm font-semibold text-text-primary">
                  {summary.bestPostingDay !== null ? DAYS_MAP[summary.bestPostingDay] : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Top content</span>
                <Badge variant="default" className="capitalize">{summary.topContentType || 'Mixed'}</Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">Not enough data yet. Publish more posts to see recommendations.</p>
          )}
        </div>

        {/* Content type performance */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Image size={16} className="text-brand-400" />
            <h3 className="text-sm font-semibold text-text-primary">Content Performance</h3>
          </div>
          <div className="space-y-3">
            {contentTypes.length === 0 ? (
              <p className="text-sm text-text-muted">No data yet</p>
            ) : (
              contentTypes.map((ct: any) => (
                <div key={ct.type} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-surface-hover flex items-center justify-center text-text-muted">
                    {ct.type === 'video' ? <Video size={14} /> : ct.type === 'image' ? <Image size={14} /> : <FileText size={14} />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-text-secondary capitalize">{ct.type}</span>
                      <span className="text-xs text-text-muted">{ct.avgEngagementRate.toFixed(2)}% eng.</span>
                    </div>
                    <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full"
                        style={{ width: `${Math.min(ct.avgEngagementRate * 10, 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-text-muted w-8 text-right">{ct.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Top posts */}
      <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-text-primary">Top Performing Posts</h3>
          <span className="text-xs text-text-muted">Last {period}</span>
        </div>
        {loadingPosts ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="w-12 h-12 bg-surface-hover rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-surface-hover rounded w-3/4" />
                  <div className="h-3 bg-surface-hover rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : topPosts.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">No published posts yet</p>
        ) : (
          <div className="space-y-3">
            {topPosts.map((post: any, i: number) => (
              <TopPostRow key={post.postId} post={post} rank={i + 1} />
            ))}
          </div>
        )}
      </div>

      {/* Hashtag performance */}
      {hashtags.length > 0 && (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Hash size={16} className="text-brand-400" />
            <h3 className="text-sm font-semibold text-text-primary">Top Hashtags</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {hashtags.slice(0, 20).map((h: any) => (
              <div key={h.hashtag} className="flex items-center gap-1.5 bg-surface-hover rounded-xl px-3 py-1.5">
                <span className="text-sm text-text-primary">{h.hashtag}</span>
                <span className="text-xs text-brand-400 font-medium">{h.avgEngagement.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Insights */}
      <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand-400" />
            <h3 className="text-sm font-semibold text-text-primary">AI Insights</h3>
          </div>
          <button
            onClick={handleGetInsights}
            disabled={loadingInsights}
            className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 font-medium disabled:opacity-50 transition-colors"
          >
            {loadingInsights ? 'Generating...' : 'Generate insights'}
          </button>
        </div>
        {aiInsights ? (
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{aiInsights}</p>
        ) : (
          <p className="text-sm text-text-muted">Click "Generate insights" to get AI-powered recommendations based on your analytics data.</p>
        )}
      </div>
    </div>
  );
}

// ── Top post row ──────────────────────────────────────────────
function TopPostRow({ post, rank }: { post: any; rank: number }) {
  const mediaUrls: string[] = post.mediaUrls || [];

  return (
    <div className="flex items-start gap-4 p-3 rounded-xl hover:bg-surface-hover transition-colors group">
      <span className="text-lg font-bold text-text-muted w-6 flex-shrink-0 mt-1">#{rank}</span>

      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-xl bg-surface-hover flex-shrink-0 overflow-hidden">
        {mediaUrls[0] ? (
          <img src={resolveMediaUrl(mediaUrls[0])} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            <FileText size={16} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary line-clamp-2 mb-2">{post.content}</p>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>❤️ {(post.metrics?.likes || 0).toLocaleString()}</span>
          <span>💬 {(post.metrics?.comments || 0).toLocaleString()}</span>
          <span>🔁 {(post.metrics?.shares || 0).toLocaleString()}</span>
          <span>Saved {(post.metrics?.saves || 0).toLocaleString()}</span>
          <span>Views {(post.metrics?.views || 0).toLocaleString()}</span>
          <span>👁️ {(post.metrics?.reach || 0).toLocaleString()}</span>
          <span className="text-brand-400 font-medium">{(post.metrics?.engagementRate || 0).toFixed(2)}%</span>
        </div>
      </div>

      {/* External link */}
      {post.publishedUrl && (
        <a
          href={post.publishedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text-primary"
        >
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

function SyncStatusStrip({ items, latestSync }: { items: any[]; latestSync?: number }) {
  const hasFailure = items.some((item) => ['failed', 'auth_required'].includes(item.status));
  const hasStale = items.some((item) => item.status === 'stale');
  const icon = hasFailure
    ? <AlertCircle size={14} className="text-error" />
    : hasStale
      ? <AlertCircle size={14} className="text-amber-400" />
      : <CheckCircle2 size={14} className="text-emerald-400" />;
  const label = hasFailure ? 'Needs attention' : hasStale ? 'Data stale' : 'Live API data';
  const last = latestSync ? new Date(latestSync).toLocaleString() : 'Never';

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <p className="text-sm font-medium text-text-primary">{label}</p>
          <p className="text-xs text-text-muted">Last synced: {last}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 ? (
          <Badge variant="default">No connected account</Badge>
        ) : items.map((item) => (
          <Badge key={item.integrationId} variant={item.status === 'healthy' ? 'success' : item.status === 'failed' || item.status === 'auth_required' ? 'error' : 'warning'}>
            {item.name}: {String(item.status).replace('_', ' ')}
          </Badge>
        ))}
      </div>
      {items.some((item) => item.validation?.checks?.length) && (
        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-2 pt-3 border-t border-surface-border">
          {items.flatMap((item) => (item.validation?.checks || []).map((check: any) => (
            <div key={`${item.integrationId}-${check.key}`} className="flex items-start gap-2 text-xs">
              {check.ok ? <CheckCircle2 size={13} className="text-emerald-400 mt-0.5" /> : <AlertCircle size={13} className="text-amber-400 mt-0.5" />}
              <div>
                <p className="text-text-secondary">{item.name}: {check.label}</p>
                {!check.ok && check.message && <p className="text-text-muted mt-0.5">{check.message}</p>}
              </div>
            </div>
          )))}
        </div>
      )}
    </div>
  );
}
