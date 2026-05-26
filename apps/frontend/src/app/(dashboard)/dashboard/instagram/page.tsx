'use client';

import { useState, useEffect } from 'react';
import { useDemographics, useOrgId } from '@/lib/hooks';
import { analyticsApi, resolveMediaUrl } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { ChartCard } from '@/components/ui/chart-card';
import { EmptyState } from '@/components/ui/empty-state';
import { DemographicsPanel } from '@/components/analytics/demographics-panel';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { Instagram, RefreshCw, Download, Users, Eye, Heart, MessageSquare, Bookmark, ExternalLink, TrendingUp } from 'lucide-react';

function fmt(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function StatCard({ label, value, color, icon, sub }: { label: string; value: number; color: string; icon?: React.ReactNode; sub?: string }) {
  return (
    <div className={clsx('rounded-2xl p-4 flex flex-col gap-1', color)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium opacity-70">{label}</span>
        {icon && <span className="opacity-60">{icon}</span>}
      </div>
      <span className="text-2xl font-bold">{fmt(value)}</span>
      {sub && <span className="text-xs opacity-60">{sub}</span>}
    </div>
  );
}

const MEDIA_TYPE_COLORS: Record<string, string> = {
  IMAGE: 'bg-blue-500/15 text-blue-400',
  VIDEO: 'bg-purple-500/15 text-purple-400',
  CAROUSEL_ALBUM: 'bg-pink-500/15 text-pink-400',
  REELS: 'bg-amber-500/15 text-amber-400',
};

export default function InstagramAnalyticsPage() {
  const orgId = useOrgId();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [postTotal, setPostTotal] = useState(0);
  const [postPage, setPostPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'overview' | 'posts' | 'reels'>('overview');
  const { data: demographics, isLoading: loadingDemographics } = useDemographics('INSTAGRAM', '30d');

  const loadStats = async () => {
    if (!orgId) return;
    setLoading(true);
    try { setStats(await analyticsApi.instagramRealtime(orgId) || []); }
    catch { setStats([]); }
    finally { setLoading(false); }
  };

  const loadPosts = async () => {
    if (!orgId) return;
    setLoadingPosts(true);
    try {
      const res = await analyticsApi.instagramPosts(orgId, { page: postPage, limit: 20 });
      setPosts(res.posts || []);
      setPostTotal(res.total || 0);
    } catch { setPosts([]); }
    finally { setLoadingPosts(false); }
  };

  useEffect(() => { loadStats(); }, [orgId]);
  useEffect(() => { if (activeTab === 'posts' || activeTab === 'reels') loadPosts(); }, [activeTab, orgId, postPage]);

  const handleSync = async () => {
    if (!orgId) return;
    setSyncing(true);
    try {
      await analyticsApi.forceSync(orgId);
      toast.success('Synced!', 'Real data fetched from Instagram API');
      await loadStats();
      if (activeTab !== 'overview') await loadPosts();
    } catch (e: any) {
      toast.error('Sync failed', e.message);
    } finally { setSyncing(false); }
  };

  const exportCSV = () => {
    if (!posts.length) return;
    const rows = [['Caption', 'Type', 'Date', 'Likes', 'Comments', 'Reach', 'Impressions', 'Saved'],
      ...posts.map((p) => [`"${(p.caption || '').replace(/"/g, '').slice(0, 100)}"`,
        p.mediaType, dayjs(p.timestamp).format('YYYY-MM-DD'), p.likes, p.comments, p.reach, p.impressions, p.saved])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `instagram-posts-${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
  };

  // Aggregate
  const totalFollowers = stats.reduce((s, c) => s + (c.followers || 0), 0);
  const totalFollowing = stats.reduce((s, c) => s + (c.following || 0), 0);
  const totalMedia = stats.reduce((s, c) => s + (c.mediaCount || 0), 0);
  const totalReach = stats.reduce((s, c) => s + (c.totalReach || 0), 0);
  const totalImpressions = stats.reduce((s, c) => s + (c.totalImpressions || 0), 0);
  const totalProfileViews = stats.reduce((s, c) => s + (c.totalProfileViews || 0), 0);

  // Build chart data
  const dailyMap: Record<string, any> = {};
  for (const s of stats) {
    for (const d of s.dailyData || []) {
      if (!dailyMap[d.date]) dailyMap[d.date] = { date: d.date, followers: 0, reach: 0, impressions: 0, profileViews: 0 };
      dailyMap[d.date].followers += d.followers || 0;
      dailyMap[d.date].reach += d.reach || 0;
      dailyMap[d.date].impressions += d.impressions || 0;
      dailyMap[d.date].profileViews += d.profileViews || 0;
    }
  }
  const chartData = Object.values(dailyMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

  // Filter posts by type for reels tab
  const reels = posts.filter((p) => p.mediaType === 'VIDEO' || p.mediaType === 'REELS');
  const displayPosts = activeTab === 'reels' ? reels : posts;

  if (!loading && !stats.length) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-pink-500/20 flex items-center justify-center text-pink-400"><Instagram size={18} /></div>
            <div><h1 className="text-xl font-bold text-text-primary">Instagram</h1><p className="text-sm text-text-muted">Analytics overview</p></div>
          </div>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />} loading={syncing} onClick={handleSync}>Sync Now</Button>
        </div>
        <EmptyState icon={<Instagram size={24} />} title="No Instagram data yet"
          description="Connect your Instagram Business account and click Sync Now to fetch real analytics."
          action={{ label: 'Sync Now', onClick: handleSync }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-pink-500/20 flex items-center justify-center text-pink-400"><Instagram size={18} /></div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Instagram</h1>
            <p className="text-sm text-text-muted">
              {stats.map((s) => `@${s.username || s.accountName}`).join(', ') || 'Analytics overview'}
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />} loading={syncing} onClick={handleSync}>Sync</Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-card border border-surface-border rounded-xl p-1 w-fit">
        {[{ id: 'overview', label: 'Overview' }, { id: 'posts', label: 'Posts' }, { id: 'reels', label: 'Reels' }].map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === t.id ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-text-primary')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Profile cards */}
          {stats.map((s) => (
            <div key={s.integrationId} className="bg-surface-card border border-surface-border rounded-2xl p-5 flex items-center gap-4">
              {s.pictureUrl && <img src={s.pictureUrl} alt="" className="w-14 h-14 rounded-full object-cover" />}
              <div className="flex-1">
                <p className="text-base font-bold text-text-primary">{s.accountName}</p>
                <p className="text-sm text-text-muted">@{s.username}</p>
                {s.biography && <p className="text-xs text-text-muted mt-1 line-clamp-2">{s.biography}</p>}
              </div>
              <div className="grid grid-cols-3 gap-6 text-center">
                <div><p className="text-lg font-bold text-text-primary">{fmt(s.followers)}</p><p className="text-xs text-text-muted">Followers</p></div>
                <div><p className="text-lg font-bold text-text-primary">{fmt(s.following)}</p><p className="text-xs text-text-muted">Following</p></div>
                <div><p className="text-lg font-bold text-text-primary">{fmt(s.mediaCount)}</p><p className="text-xs text-text-muted">Posts</p></div>
              </div>
            </div>
          ))}

          {/* Metric cards */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total Reach (30d)" value={totalReach} color="bg-pink-500/15 text-pink-300" icon={<Eye size={16} />} />
            <StatCard label="Impressions (30d)" value={totalImpressions} color="bg-purple-500/15 text-purple-300" icon={<TrendingUp size={16} />} />
            <StatCard label="Profile Views (30d)" value={totalProfileViews} color="bg-blue-500/15 text-blue-300" icon={<Users size={16} />} />
          </div>

          {/* Followers growth */}
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Followers Growth</h3>
            {chartData.length > 0 ? (
              <ChartCard title="" data={chartData} type="line" dataKeys={[{ key: 'followers', color: '#ec4899', label: 'Followers' }]} xKey="date" height={220} />
            ) : (
              <div className="h-48 flex items-center justify-center">
                <button onClick={handleSync} className="text-sm text-brand-400 hover:text-brand-300">Click Sync to fetch real data →</button>
              </div>
            )}
          </div>

          {/* Reach + Impressions */}
          {chartData.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-4">Daily Reach</h3>
                <ChartCard title="" data={chartData} type="bar" dataKeys={[{ key: 'reach', color: '#ec4899', label: 'Reach' }]} xKey="date" height={180} />
              </div>
              <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-4">Profile Views</h3>
                <ChartCard title="" data={chartData} type="bar" dataKeys={[{ key: 'profileViews', color: '#a855f7', label: 'Profile Views' }]} xKey="date" height={180} />
              </div>
            </div>
          )}

          <DemographicsPanel data={demographics} loading={loadingDemographics} />
        </div>
      )}

      {/* ── POSTS / REELS ─────────────────────────────────── */}
      {(activeTab === 'posts' || activeTab === 'reels') && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" icon={<Download size={13} />} onClick={exportCSV} disabled={!posts.length}>Download CSV</Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {loadingPosts ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
                <div className="skeleton aspect-square" />
                <div className="p-3 space-y-2"><div className="skeleton h-3 w-full" /><div className="skeleton h-3 w-2/3" /></div>
              </div>
            )) : displayPosts.length === 0 ? (
              <div className="col-span-4 py-12 text-center">
                <p className="text-sm text-text-muted">No {activeTab === 'reels' ? 'reels' : 'posts'} found</p>
                <button onClick={handleSync} className="mt-2 text-xs text-brand-400 hover:text-brand-300">Click Sync to fetch posts →</button>
              </div>
            ) : displayPosts.map((post) => (
              <div key={post.id} className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden hover:border-brand-500/30 transition-colors group">
                {/* Media */}
                <div className="aspect-square bg-surface-hover overflow-hidden relative">
                  {post.mediaUrl ? (
                    <img src={resolveMediaUrl(post.mediaUrl)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-muted"><Instagram size={24} /></div>
                  )}
                  <div className={clsx('absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full', MEDIA_TYPE_COLORS[post.mediaType] || 'bg-surface-card text-text-muted')}>
                    {post.mediaType}
                  </div>
                  {post.permalink && (
                    <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                      className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <ExternalLink size={11} className="text-white" />
                    </a>
                  )}
                </div>
                {/* Stats */}
                <div className="p-3">
                  <p className="text-xs text-text-muted line-clamp-2 mb-2">{post.caption || '(No caption)'}</p>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div className="flex items-center gap-1 text-text-secondary"><Heart size={11} className="text-pink-400" />{fmt(post.likes)}</div>
                    <div className="flex items-center gap-1 text-text-secondary"><MessageSquare size={11} className="text-blue-400" />{fmt(post.comments)}</div>
                    <div className="flex items-center gap-1 text-text-secondary"><Eye size={11} className="text-green-400" />{fmt(post.reach)}</div>
                    <div className="flex items-center gap-1 text-text-secondary"><Bookmark size={11} className="text-amber-400" />{fmt(post.saved)}</div>
                  </div>
                  <p className="text-[10px] text-text-muted mt-2">{dayjs(post.timestamp).format('MMM D, YYYY')}</p>
                </div>
              </div>
            ))}
          </div>

          {postTotal > 20 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" disabled={postPage === 1} onClick={() => setPostPage((p) => p - 1)}>Previous</Button>
              <span className="text-xs text-text-muted">Page {postPage} · {postTotal} total</span>
              <Button variant="secondary" size="sm" disabled={posts.length < 20} onClick={() => setPostPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
