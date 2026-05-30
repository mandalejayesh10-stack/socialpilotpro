'use client';

import { useState, useEffect } from 'react';
import { useDemographics, useOrgId } from '@/lib/hooks';
import { analyticsApi } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { ChartCard } from '@/components/ui/chart-card';
import { EmptyState } from '@/components/ui/empty-state';
import { DemographicsPanel } from '@/components/analytics/demographics-panel';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { Facebook, RefreshCw, Download, Users, Eye, TrendingUp, ExternalLink, BarChart3 } from 'lucide-react';
import { DateRangePicker, DateRange } from '@/components/ui/date-range-picker';

function fmt(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon?: React.ReactNode }) {
  return (
    <div className={clsx('rounded-2xl p-4 flex flex-col gap-1', color)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium opacity-70">{label}</span>
        {icon && <span className="opacity-60">{icon}</span>}
      </div>
      <span className="text-2xl font-bold">{fmt(value)}</span>
    </div>
  );
}

export default function FacebookAnalyticsPage() {
  const orgId = useOrgId();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [postTotal, setPostTotal] = useState(0);
  const [postPage, setPostPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'overview' | 'posts'>('overview');
  
  const [dateRange, setDateRange] = useState<DateRange>({
    startDate: dayjs().subtract(29, 'days').toDate(),
    endDate: dayjs().toDate(),
  });

  const diffDays = dayjs(dateRange.endDate).diff(dayjs(dateRange.startDate), 'day') + 1;
  const backendPeriod = diffDays <= 7 ? '7d' : diffDays <= 30 ? '30d' : '90d';

  const { data: demographics, isLoading: loadingDemographics } = useDemographics('FACEBOOK', backendPeriod);

  const loadStats = async () => {
    if (!orgId) return;
    setLoading(true);
    try { setStats(await analyticsApi.facebookRealtime(orgId) || []); }
    catch { setStats([]); }
    finally { setLoading(false); }
  };

  const loadPosts = async () => {
    if (!orgId) return;
    setLoadingPosts(true);
    try {
      const res = await analyticsApi.facebookPosts(orgId, { page: postPage, limit: 20 });
      setPosts(res.posts || []);
      setPostTotal(res.total || 0);
    } catch { setPosts([]); }
    finally { setLoadingPosts(false); }
  };

  useEffect(() => { loadStats(); }, [orgId]);
  useEffect(() => { if (activeTab === 'posts') loadPosts(); }, [activeTab, orgId, postPage]);

  const handleSync = async () => {
    if (!orgId) return;
    setSyncing(true);
    try {
      await analyticsApi.forceSync(orgId);
      toast.success('Synced!', 'Real data fetched from Facebook API');
      await loadStats();
      if (activeTab === 'posts') await loadPosts();
    } catch (e: any) {
      toast.error('Sync failed', e.message);
    } finally { setSyncing(false); }
  };

  const filteredPosts = posts.filter((p) => {
    const date = dayjs(p.createdTime);
    return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
           date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
  });

  const exportCSV = () => {
    if (!filteredPosts.length) return;
    const rows = [['Message', 'Date', 'Reactions', 'Comments', 'Shares', 'Reach', 'Impressions'],
      ...filteredPosts.map((p) => [`"${(p.message || '').replace(/"/g, '').slice(0, 100)}"`,
        dayjs(p.createdTime).format('YYYY-MM-DD'), p.reactions, p.comments, p.shares, p.reach, p.impressions])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `facebook-posts-${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
  };

  const totalFans = stats.reduce((s, c) => s + (c.fanCount || 0), 0);

  const dailyMap: Record<string, any> = {};
  for (const s of stats) {
    for (const d of s.dailyData || []) {
      if (!dailyMap[d.date]) dailyMap[d.date] = { date: d.date, fans: 0, reach: 0, impressions: 0, engaged: 0 };
      dailyMap[d.date].fans += d.fans || 0;
      dailyMap[d.date].reach += d.reach || 0;
      dailyMap[d.date].impressions += d.impressions || 0;
      dailyMap[d.date].engaged += d.engaged || 0;
    }
  }
  const chartData = Object.values(dailyMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

  const filteredChartData = chartData.filter((d: any) => {
    const date = dayjs(d.date);
    return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
           date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
  });

  const totalReach = filteredChartData.reduce((s, c) => s + (c.reach || 0), 0);
  const totalImpressions = filteredChartData.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalEngaged = filteredChartData.reduce((s, c) => s + (c.engaged || 0), 0);

  if (!loading && !stats.length) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400"><Facebook size={18} /></div>
            <div><h1 className="text-xl font-bold text-text-primary">Facebook</h1><p className="text-sm text-text-muted">Analytics overview</p></div>
          </div>
          <div className="flex items-center gap-3">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
            <Button variant="secondary" size="sm" icon={<RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />} loading={syncing} onClick={handleSync}>Sync Now</Button>
          </div>
        </div>
        <EmptyState icon={<Facebook size={24} />} title="No Facebook data yet"
          description="Connect your Facebook Page and click Sync Now to fetch real analytics."
          action={{ label: 'Sync Now', onClick: handleSync }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400"><Facebook size={18} /></div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Facebook</h1>
            <p className="text-sm text-text-muted">{stats.map((s) => s.pageName).join(', ') || 'Analytics overview'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <Button variant="secondary" size="sm" icon={<RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />} loading={syncing} onClick={handleSync}>Sync</Button>
        </div>
      </div>

      <div className="flex gap-1 bg-surface-card border border-surface-border rounded-xl p-1 w-fit">
        {[{ id: 'overview', label: 'Overview' }, { id: 'posts', label: 'Posts' }].map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === t.id ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-text-primary')}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Page Followers" value={totalFans} color="bg-blue-500/15 text-blue-300" icon={<Users size={16} />} />
            <StatCard label="Total Reach (Selected Range)" value={totalReach} color="bg-green-500/15 text-green-300" icon={<Eye size={16} />} />
            <StatCard label="Impressions (Selected Range)" value={totalImpressions} color="bg-purple-500/15 text-purple-300" icon={<BarChart3 size={16} />} />
            <StatCard label="Engaged Users (Selected Range)" value={totalEngaged} color="bg-amber-500/15 text-amber-300" icon={<TrendingUp size={16} />} />
          </div>

          <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Page Followers Growth</h3>
            {filteredChartData.length > 0 ? (
              <ChartCard title="" data={filteredChartData} type="line" dataKeys={[{ key: 'fans', color: '#3b82f6', label: 'Followers' }]} xKey="date" height={220} />
            ) : (
              <div className="h-48 flex items-center justify-center">
                <button onClick={handleSync} className="text-sm text-brand-400 hover:text-brand-300">Click Sync to fetch real data →</button>
              </div>
            )}
          </div>

          {filteredChartData.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-4">Daily Reach</h3>
                <ChartCard title="" data={filteredChartData} type="bar" dataKeys={[{ key: 'reach', color: '#22c55e', label: 'Reach' }]} xKey="date" height={180} />
              </div>
              <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-4">Engaged Users</h3>
                <ChartCard title="" data={filteredChartData} type="bar" dataKeys={[{ key: 'engaged', color: '#f59e0b', label: 'Engaged' }]} xKey="date" height={180} />
              </div>
            </div>
          )}

          <DemographicsPanel data={demographics} loading={loadingDemographics} />
        </div>
      )}

      {activeTab === 'posts' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" icon={<Download size={13} />} onClick={exportCSV} disabled={!filteredPosts.length}>Download CSV</Button>
          </div>
          <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase">Post</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase">Reactions</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase">Comments</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase">Shares</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase">Reach</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/50">
                {loadingPosts ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-5 py-4"><div className="skeleton h-4 w-full" /></td></tr>
                )) : filteredPosts.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-12 text-center">
                    <p className="text-sm text-text-muted">No posts found</p>
                    <button onClick={handleSync} className="mt-2 text-xs text-brand-400 hover:text-brand-300">Click Sync to fetch posts →</button>
                  </td></tr>
                ) : filteredPosts.map((post) => (
                  <tr key={post.id} className="hover:bg-surface-hover/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {post.picture && <img src={post.picture} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />}
                        <p className="text-sm text-text-primary line-clamp-2 max-w-xs">{post.message || '(No text)'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-text-secondary">{fmt(post.reactions)}</td>
                    <td className="px-4 py-3 text-right text-sm text-text-secondary">{fmt(post.comments)}</td>
                    <td className="px-4 py-3 text-right text-sm text-text-secondary">{fmt(post.shares)}</td>
                    <td className="px-4 py-3 text-right text-sm text-text-secondary">{fmt(post.reach)}</td>
                    <td className="px-4 py-3 text-right text-sm text-text-muted">{dayjs(post.createdTime).format('MMM D, YYYY')}</td>
                    <td className="px-4 py-3 text-right">
                      {post.permalink && <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-brand-400 transition-colors"><ExternalLink size={14} /></a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {postTotal > 20 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-surface-border">
                <p className="text-xs text-text-muted">{postTotal} posts total</p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={postPage === 1} onClick={() => setPostPage((p) => p - 1)}>Previous</Button>
                  <span className="text-xs text-text-muted">Page {postPage}</span>
                  <Button variant="secondary" size="sm" disabled={posts.length < 20} onClick={() => setPostPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
