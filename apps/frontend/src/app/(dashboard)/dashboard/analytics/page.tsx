'use client';

import { useState } from 'react';
import { useAnalyticsSyncStatus, useOverview, useOrgId } from '@/lib/hooks';
import { MetricCard } from '@/components/ui/metric-card';
import { ChartCard } from '@/components/ui/chart-card';
import { PeriodSelector, Period } from '@/components/ui/period-selector';
import { SkeletonCard, SkeletonChart } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Users, Heart, Eye, TrendingUp, BarChart3, Link2 } from 'lucide-react';
import Link from 'next/link';

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const { data, isLoading } = useOverview(period);
  const { data: syncStatus } = useAnalyticsSyncStatus();

  const ig = data?.instagram;
  const fb = data?.facebook;
  const yt = data?.youtube;
  const hasData = ig || fb || yt;

  const totalFollowers = (ig?.totalFollowers || 0) + (fb?.totalFollowers || 0) + (yt?.totalFollowers || 0);
  const platforms = [ig, fb, yt].filter(Boolean);
  const avgEngagement = platforms.length > 0
    ? platforms.reduce((s, p) => s + (p?.avgEngagementRate || 0), 0) / platforms.length
    : 0;
  const totalReach = (ig?.totalReach || 0) + (fb?.totalReach || 0) + (yt?.totalReach || 0);
  const totalPosts = (ig?.totalPosts || 0) + (fb?.totalPosts || 0) + (yt?.totalPosts || 0);

  // Merge timelines
  const mergeTimelines = (key: string) => {
    const map: Record<string, any> = {};
    const safeParse = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v || '[]') : []);
    const add = (arr: any[], label: string) => {
      if (!Array.isArray(arr)) return;
      for (const d of arr) {
        if (!map[d.date]) map[d.date] = { date: d.date };
        map[d.date][label] = d.value;
      }
    };
    if (ig) add(safeParse(ig[key]), 'instagram');
    if (fb) add(safeParse(fb[key]), 'facebook');
    if (yt) add(safeParse(yt[key]), 'youtube');
    return Object.values(map).sort((a: any, b: any) => a.date.localeCompare(b.date));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Analytics"
          subtitle="Cross-platform performance overview"
          icon={<BarChart3 size={18} />}
        />
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {syncStatus && (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Real API sync</p>
            <p className="text-xs text-text-muted">
              Basic stats every 15 minutes, post metrics hourly, summaries daily. Last checked {new Date(syncStatus.generatedAt).toLocaleString()}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(syncStatus.platforms || []).map((item: any) => (
              <Badge
                key={item.integrationId}
                variant={item.status === 'healthy' ? 'success' : item.status === 'failed' || item.status === 'auth_required' ? 'error' : 'warning'}
              >
                {item.platform.toLowerCase()}: {String(item.status).replace('_', ' ')}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* No data state */}
      {!isLoading && !hasData && (
        <div className="bg-surface-card border border-dashed border-surface-border rounded-2xl p-12">
          <EmptyState
            icon={<Link2 size={24} />}
            title="No analytics data yet"
            description="Connect your social accounts and wait for the analytics pipeline to collect data. It runs every 15 minutes automatically."
            action={{
              label: 'Connect Accounts',
              onClick: () => window.location.href = '/dashboard/settings/connections',
            }}
          />
          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-text-muted">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
              Basic stats: every 15 min
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Post metrics: every hour
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Full analytics: daily at 2am
            </div>
          </div>
        </div>
      )}

      {/* Metrics */}
      {(isLoading || hasData) && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <MetricCard label="Total Followers" value={totalFollowers} icon={<Users size={16} />} color="brand" />
                <MetricCard label="Avg Engagement" value={`${avgEngagement.toFixed(2)}%`} icon={<Heart size={16} />} color="instagram" />
                <MetricCard label="Total Reach" value={totalReach} icon={<Eye size={16} />} color="facebook" />
                <MetricCard label="Posts Published" value={totalPosts} icon={<TrendingUp size={16} />} color="youtube" />
              </>
            )}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-4">
            {isLoading ? (
              <><SkeletonChart /><SkeletonChart /></>
            ) : (
              <>
                <ChartCard
                  title="Follower Growth"
                  subtitle="All platforms combined"
                  data={mergeTimelines('followerTimeline')}
                  type="line"
                  dataKeys={[
                    { key: 'instagram', color: '#e1306c', label: 'Instagram' },
                    { key: 'facebook',  color: '#1877f2', label: 'Facebook' },
                    { key: 'youtube',   color: '#ff0000', label: 'YouTube' },
                  ]}
                />
                <ChartCard
                  title="Engagement Rate"
                  subtitle="Instagram daily average"
                  data={ig ? (Array.isArray(ig.engagementTimeline) ? ig.engagementTimeline : (() => { try { return JSON.parse(ig.engagementTimeline || '[]'); } catch { return []; } })()) : []}
                  type="line"
                  dataKeys={[{ key: 'value', color: '#6366f1', label: 'Engagement %' }]}
                />
              </>
            )}
          </div>

          {!isLoading && (
            <div className="grid grid-cols-2 gap-4">
              <ChartCard
                title="Reach — Instagram"
                data={ig ? (Array.isArray(ig.reachTimeline) ? ig.reachTimeline : (() => { try { return JSON.parse(ig.reachTimeline || '[]'); } catch { return []; } })()) : []}
                type="bar"
                dataKeys={[{ key: 'value', color: '#e1306c', label: 'Reach' }]}
                height={200}
              />
              <ChartCard
                title="Reach — Facebook"
                data={fb ? (Array.isArray(fb.reachTimeline) ? fb.reachTimeline : (() => { try { return JSON.parse(fb.reachTimeline || '[]'); } catch { return []; } })()) : []}
                type="bar"
                dataKeys={[{ key: 'value', color: '#1877f2', label: 'Reach' }]}
                height={200}
              />
            </div>
          )}

          {/* Platform links */}
          {!isLoading && hasData && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Instagram Analytics', href: '/dashboard/instagram', color: 'text-pink-400', bg: 'bg-pink-500/10' },
                { label: 'Facebook Analytics', href: '/dashboard/facebook', color: 'text-blue-400', bg: 'bg-blue-500/10' },
                { label: 'YouTube Analytics', href: '/dashboard/youtube', color: 'text-red-400', bg: 'bg-red-500/10' },
              ].map(p => (
                <Link key={p.href} href={p.href}
                  className="flex items-center justify-between bg-surface-card border border-surface-border hover:border-brand-500/30 rounded-2xl p-4 transition-all group">
                  <span className={`text-sm font-medium ${p.color}`}>{p.label}</span>
                  <span className="text-text-muted group-hover:text-text-primary transition-colors text-xs">View →</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
