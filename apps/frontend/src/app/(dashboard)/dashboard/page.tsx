'use client';

import { useState } from 'react';
import { useOverview } from '@/lib/hooks';
import { MetricCard } from '@/components/ui/metric-card';
import { ChartCard } from '@/components/ui/chart-card';
import { SkeletonCard, SkeletonChart } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { PostComposer } from '@/components/posts/post-composer';
import { useAppStore } from '@/lib/store';
import {
  Users, Heart, Eye, TrendingUp,
  Instagram, Facebook, Youtube, Plus, Link2,
  Zap, Calendar, BarChart3,
} from 'lucide-react';
import clsx from 'clsx';
import Link from 'next/link';
import { ViralScoreWidget } from '@/components/analytics/viral-score-widget';
import dayjs from 'dayjs';
import { DateRangePicker, DateRange } from '@/components/ui/date-range-picker';

export default function DashboardPage() {
  const [dateRange, setDateRange] = useState<DateRange>({
    startDate: dayjs().subtract(29, 'days').toDate(),
    endDate: dayjs().toDate(),
  });
  const [showComposer, setShowComposer] = useState(false);

  const diffDays = dayjs(dateRange.endDate).diff(dayjs(dateRange.startDate), 'day') + 1;
  const backendPeriod = diffDays <= 7 ? '7d' : diffDays <= 30 ? '30d' : '90d';

  const { data, isLoading } = useOverview(backendPeriod);
  const { currentOrg, user } = useAppStore();

  const ig = data?.instagram;
  const fb = data?.facebook;
  const yt = data?.youtube;
  const hasData = ig || fb || yt;

  const totalFollowers = (ig?.totalFollowers || 0) + (fb?.totalFollowers || 0) + (yt?.totalFollowers || 0);
  const platforms = [ig, fb, yt].filter(Boolean);
  const avgEngagement = platforms.length > 0
    ? platforms.reduce((s, p) => s + (p?.avgEngagementRate || 0), 0) / platforms.length
    : 0;

  const getTimeline = (timelineData: any) => {
    const list = Array.isArray(timelineData) ? timelineData : (() => { try { return JSON.parse(timelineData || '[]'); } catch { return []; } })();
    return list.filter((d: any) => {
      const date = dayjs(d.date);
      return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
             date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
    });
  };

  const igFilteredReach = getTimeline(ig?.reachTimeline);
  const fbFilteredReach = getTimeline(fb?.reachTimeline);
  const ytFilteredReach = getTimeline(yt?.reachTimeline);

  const totalReach = igFilteredReach.reduce((s, d) => s + (d.value || 0), 0) +
                     fbFilteredReach.reduce((s, d) => s + (d.value || 0), 0) +
                     ytFilteredReach.reduce((s, d) => s + (d.value || 0), 0);

  const totalPosts = (ig?.totalPosts || 0) + (fb?.totalPosts || 0) + (yt?.totalPosts || 0);

  const combinedTimeline = (() => {
    const map: Record<string, any> = {};
    const add = (arr: any[], key: string) => {
      if (!Array.isArray(arr)) return;
      for (const d of arr) {
        if (!map[d.date]) map[d.date] = { date: d.date };
        map[d.date][key] = d.value;
      }
    };
    const safeParse = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v || '[]') : []);
    if (ig) add(safeParse(ig.followerTimeline), 'instagram');
    if (fb) add(safeParse(fb.followerTimeline), 'facebook');
    if (yt) add(safeParse(yt.followerTimeline), 'youtube');
    
    return Object.values(map)
      .sort((a: any, b: any) => a.date.localeCompare(b.date))
      .filter((d: any) => {
        const date = dayjs(d.date);
        return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
               date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
      });
  })();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            {greeting}, {user?.name?.split(' ')[0] || 'there'} 👋
          </h1>
          <p className="text-sm text-text-muted mt-0.5">
            {currentOrg?.name} · Overview across all platforms
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <Button icon={<Plus size={15} />} onClick={() => setShowComposer(true)}>
            New Post
          </Button>
        </div>
      </div>

      {/* Welcome / empty state for new users */}
      {!isLoading && !hasData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Welcome card */}
          <div className="lg:col-span-2 bg-gradient-to-br from-brand-500/10 to-purple-500/5 border border-brand-500/20 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center">
                <Zap size={18} className="text-white" />
              </div>
              <div>
                <p className="text-base font-bold text-text-primary">Welcome to SocialPilot Pro!</p>
                <p className="text-xs text-text-muted">Let's get your accounts connected</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { step: '1', label: 'Connect your social accounts', href: '/dashboard/settings/connections', done: false },
                { step: '2', label: 'Schedule your first post', href: '/dashboard/calendar', done: false },
                { step: '3', label: 'View your analytics', href: '/dashboard/analytics', done: false },
              ].map(item => (
                <Link key={item.step} href={item.href}
                  className="flex items-center gap-3 p-3 bg-surface-card/50 hover:bg-surface-card rounded-xl transition-colors group">
                  <div className="w-6 h-6 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-xs font-bold flex-shrink-0">
                    {item.step}
                  </div>
                  <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">{item.label}</span>
                  <span className="ml-auto text-text-muted group-hover:text-text-primary text-xs transition-colors">→</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Quick actions */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Quick actions</p>
            {[
              { icon: Link2, label: 'Connect Instagram', href: '/dashboard/settings/connections', color: 'text-pink-400 bg-pink-500/10' },
              { icon: Calendar, label: 'Schedule a post', href: '/dashboard/calendar', color: 'text-brand-400 bg-brand-500/10' },
              { icon: BarChart3, label: 'View analytics', href: '/dashboard/analytics', color: 'text-blue-400 bg-blue-500/10' },
            ].map(item => {
              const Icon = item.icon;
              return (
                <Link key={item.label} href={item.href}
                  className="flex items-center gap-3 p-3 bg-surface-card border border-surface-border hover:border-brand-500/30 rounded-xl transition-all group">
                  <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', item.color)}>
                    <Icon size={15} />
                  </div>
                  <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Platform summary cards */}
      {(isLoading || hasData) && (
        <div className="grid grid-cols-3 gap-4">
          <PlatformCard platform="Instagram" icon={<Instagram size={16} />} colorClass="bg-pink-500/10 text-pink-400 border-pink-500/20" data={ig} loading={isLoading} href="/dashboard/instagram" />
          <PlatformCard platform="Facebook"  icon={<Facebook size={16} />}  colorClass="bg-blue-500/10 text-blue-400 border-blue-500/20"  data={fb} loading={isLoading} href="/dashboard/facebook" />
          <PlatformCard platform="YouTube"   icon={<Youtube size={16} />}   colorClass="bg-red-500/10 text-red-400 border-red-500/20"     data={yt} loading={isLoading} href="/dashboard/youtube" />
        </div>
      )}

      {/* Aggregate metrics */}
      {(isLoading || hasData) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <MetricCard label="Total Followers" value={totalFollowers} icon={<Users size={16} />} color="brand" />
              <MetricCard label="Avg Engagement" value={`${avgEngagement.toFixed(2)}%`} icon={<Heart size={16} />} color="instagram" />
              <MetricCard label="Total Reach (Selected Range)" value={totalReach} icon={<Eye size={16} />} color="facebook" />
              <MetricCard label="Posts Published" value={totalPosts} icon={<TrendingUp size={16} />} color="youtube" />
            </>
          )}
        </div>
      )}

      {/* Charts */}
      {(isLoading || hasData) && (
        <>
          <div className="grid grid-cols-2 gap-4">
            {isLoading ? (
              <><SkeletonChart /><SkeletonChart /></>
            ) : (
              <>
                <ChartCard
                  title="Follower Growth"
                  subtitle="All platforms combined"
                  data={combinedTimeline}
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
                  data={ig ? getTimeline(ig.engagementTimeline) : []}
                  type="line"
                  dataKeys={[{ key: 'value', color: '#6366f1', label: 'Engagement %' }]}
                />
              </>
            )}
          </div>

          {/* Viral Score Widget */}
          {!isLoading && <ViralScoreWidget />}

          {!isLoading && ig && getTimeline(ig.reachTimeline).length > 0 && (
            <ChartCard
              title="Reach Over Time"
              subtitle="Total audience reached per day"
              data={getTimeline(ig.reachTimeline)}
              type="bar"
              dataKeys={[{ key: 'value', color: '#6366f1', label: 'Reach' }]}
              height={200}
            />
          )}
        </>
      )}

      <PostComposer open={showComposer} onClose={() => setShowComposer(false)} />
    </div>
  );
}

function PlatformCard({ platform, icon, colorClass, data, loading, href }: {
  platform: string; icon: React.ReactNode; colorClass: string;
  data: any; loading: boolean; href: string;
}) {
  if (loading) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
        <div className="skeleton h-4 w-24 mb-4" />
        <div className="skeleton h-7 w-28 mb-2" />
        <div className="skeleton h-3 w-16" />
      </div>
    );
  }

  if (!data) {
    return (
      <Link href="/dashboard/settings/connections">
        <div className="bg-surface-card border border-dashed border-surface-border rounded-2xl p-5 cursor-pointer hover:border-brand-500/30 transition-colors">
          <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center mb-3', colorClass.split(' ').slice(0, 2).join(' '))}>
            {icon}
          </div>
          <p className="text-sm font-medium text-text-secondary">{platform}</p>
          <p className="text-xs text-text-muted mt-1">Connect →</p>
        </div>
      </Link>
    );
  }

  return (
    <Link href={href}>
      <div className={clsx('bg-surface-card border rounded-2xl p-5 cursor-pointer transition-all hover:shadow-glow-sm', colorClass.split(' ').slice(2).join(' ') || 'border-surface-border')}>
        <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center mb-3', colorClass.split(' ').slice(0, 2).join(' '))}>
          {icon}
        </div>
        <p className="text-sm font-medium text-text-secondary">{platform}</p>
        <p className="text-2xl font-bold text-text-primary mt-1">
          {(data.totalFollowers || 0).toLocaleString()}
        </p>
        <p className={clsx('text-xs mt-1 font-medium',
          data.growthPercent > 0 ? 'text-success' : data.growthPercent < 0 ? 'text-error' : 'text-text-muted',
        )}>
          {data.growthPercent > 0 ? '+' : ''}{(data.growthPercent || 0).toFixed(1)}% growth
        </p>
      </div>
    </Link>
  );
}
