'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { usePosts, useIntegrations, useOrgId } from '@/lib/hooks';
import { postApi, analyticsApi } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { mutate } from 'swr';
import useSWR from 'swr';
import dayjs from 'dayjs';
import clsx from 'clsx';
import {
  Instagram, Facebook, Youtube, Plus, ChevronLeft, ChevronRight,
  Search, List, Calendar, Trash2, Edit2, MoreVertical, Clock,
  Check, Sparkles, Filter, X, ExternalLink, Linkedin, Store,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MetricoolCreatePost } from '@/components/posts/metricool-create-post';

const ThreadsIcon = ({ size = 12 }: { size?: number }) => (
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

// ── Platform config ───────────────────────────────────────────
const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  INSTAGRAM: <Instagram size={12} />,
  FACEBOOK:  <Facebook size={12} />,
  YOUTUBE:   <Youtube size={12} />,
  LINKEDIN:  <Linkedin size={12} />,
  THREADS:   <ThreadsIcon size={12} />,
  GOOGLE_BUSINESS: <Store size={12} />,
};

const PLATFORM_COLORS: Record<string, string> = {
  INSTAGRAM: 'bg-pink-500 text-white',
  FACEBOOK:  'bg-blue-600 text-white',
  YOUTUBE:   'bg-red-600 text-white',
  LINKEDIN:  'bg-sky-600 text-white',
  THREADS:   'bg-slate-700 text-white',
  GOOGLE_BUSINESS: 'bg-emerald-600 text-white',
};

const PLATFORM_BG: Record<string, string> = {
  INSTAGRAM: 'bg-pink-500/15 border-pink-500/30 text-pink-400',
  FACEBOOK:  'bg-blue-500/15 border-blue-500/30 text-blue-400',
  YOUTUBE:   'bg-red-500/15 border-red-500/30 text-red-400',
  LINKEDIN:  'bg-sky-500/15 border-sky-500/30 text-sky-400',
  THREADS:   'bg-slate-500/15 border-slate-500/30 text-slate-300',
  GOOGLE_BUSINESS: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
};

const STATE_COLORS: Record<string, string> = {
  QUEUE:     'bg-amber-500',
  PUBLISHED: 'bg-green-500',
  ERROR:     'bg-red-500',
  DRAFT:     'bg-surface-border',
};

const HOURS = Array.from({ length: 24 }, (_, h) => {
  const ampm = h < 12 ? 'am' : 'pm';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { h, label: h === 0 ? '12:00am' : h === 12 ? '12:00pm' : h % 12 === 0 ? '' : h + ':00' + ampm };
});

type ViewMode = 'calendar' | 'list';
type BestTimePlatform = 'none' | 'FACEBOOK' | 'INSTAGRAM' | 'YOUTUBE';

export default function CalendarPage() {
  const orgId = useOrgId();
  const toast = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [currentWeek, setCurrentWeek] = useState(dayjs().startOf('week'));
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [defaultDate, setDefaultDate] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [bestTimePlatform, setBestTimePlatform] = useState<BestTimePlatform>('FACEBOOK');
  const [showBestTimeMenu, setShowBestTimeMenu] = useState(false);
  const [showPercentage, setShowPercentage] = useState(false);
  const [bestTimeData, setBestTimeData] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showTodayTrend, setShowTodayTrend] = useState(false);

  const weekStart = currentWeek.startOf('week');
  const weekEnd = currentWeek.endOf('week');
  const weekDays = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));

  const { data: posts = [], isLoading } = usePosts({
    from: weekStart.subtract(1, 'day').toISOString(),
    to: weekEnd.add(1, 'day').toISOString(),
  });

  const { data: integrations = [] } = useIntegrations();

  // Load best times
  useEffect(() => {
    if (!orgId || bestTimePlatform === 'none') { setBestTimeData(null); return; }
    analyticsApi.bestTimes(orgId, bestTimePlatform, 'Asia/Kolkata')
      .then(setBestTimeData)
      .catch(() => setBestTimeData(null));
  }, [orgId, bestTimePlatform]);

  // Group posts by day+hour for weekly view
  const postsBySlot = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const post of posts) {
      const d = dayjs(post.publishDate);
      const key = d.format('YYYY-MM-DD') + '_' + d.hour();
      if (!map[key]) map[key] = [];
      map[key].push(post);
    }
    return map;
  }, [posts]);

  // Get heatmap score for a day+hour slot
  const getHeatScore = (dayIndex: number, hour: number): number => {
    if (!bestTimeData || bestTimePlatform === 'none') return 0;
    return bestTimeData.heatmap?.[dayIndex]?.[hour] || 0;
  };

  // Get confidence for a day+hour slot
  const getConfidence = (dayIndex: number, hour: number): number => {
    if (!bestTimeData) return 0;
    return bestTimeData.confidenceMap?.[dayIndex]?.[hour] || 0;
  };

  // Check if slot is a top recommended slot
  const isTopSlot = (dayIndex: number, hour: number): boolean => {
    if (!bestTimeData?.topSlots) return false;
    return bestTimeData.topSlots.some((s: any) => s.day === dayIndex && s.hour === hour && s.score >= 70);
  };

  // Get "why" for a slot
  const getSlotWhy = (dayIndex: number, hour: number): string => {
    if (!bestTimeData?.topSlots) return '';
    const slot = bestTimeData.topSlots.find((s: any) => s.day === dayIndex && s.hour === hour);
    return slot?.why || '';
  };

  const handleSlotClick = (day: dayjs.Dayjs, hour: number) => {
    const dt = day.hour(hour).minute(0).second(0);
    setDefaultDate(dt.format('YYYY-MM-DDTHH:mm'));
    setShowCreatePost(true);
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Delete this post?')) return;
    setDeletingId(postId);
    try {
      await postApi.delete(orgId, postId);
      mutate(['posts', orgId, JSON.stringify({ from: weekStart.subtract(1,'day').toISOString(), to: weekEnd.add(1,'day').toISOString() })]);
      toast.success('Post deleted');
      setSelectedPost(null);
    } catch (e: any) {
      toast.error('Failed to delete', e.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSync = async () => {
    if (!orgId) return;
    setSyncing(true);
    try {
      await analyticsApi.forceSync(orgId);
      // Reload best times after sync
      if (bestTimePlatform !== 'none') {
        const bt = await analyticsApi.bestTimes(orgId, bestTimePlatform, 'Asia/Kolkata');
        setBestTimeData(bt);
      }
      toast.success('Synced!', 'Real engagement data fetched from APIs');
    } catch (e: any) {
      toast.error('Sync failed', e.message);
    } finally {
      setSyncing(false);
    }
  };

  const filteredPosts = posts.filter((p: any) =>
    !search || p.content?.toLowerCase().includes(search.toLowerCase()),
  );

  const today = dayjs();
  const isCurrentWeek = weekStart.isSame(today.startOf('week'), 'day');

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] -m-6 overflow-hidden bg-surface">
      {/* ── TOP BAR ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-surface-border bg-surface-card flex-shrink-0">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          {[
            { id: 'calendar', label: 'Calendar', icon: <Calendar size={14} /> },
            { id: 'list',     label: 'List',     icon: <List size={14} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id as ViewMode)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                viewMode === tab.id
                  ? 'text-text-primary border-b-2 border-brand-500'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Timezone */}
        <div className="flex items-center gap-1 text-xs text-text-muted ml-auto">
          <Clock size={12} />
          <span>Asia/Kolkata</span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="bg-surface-input border border-surface-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500 w-40"
          />
        </div>

        {/* Week nav */}
        {viewMode === 'calendar' && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentWeek(today.startOf('week'))}
              className="px-2.5 py-1.5 text-xs border border-surface-border rounded-lg text-text-secondary hover:bg-surface-hover transition-colors"
            >
              This week
            </button>
            <button onClick={() => setCurrentWeek(currentWeek.subtract(1, 'week'))} className="w-7 h-7 rounded-lg border border-surface-border flex items-center justify-center text-text-muted hover:bg-surface-hover transition-colors">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-text-secondary px-2 min-w-[160px] text-center">
              {weekStart.format('MMM D')} - {weekEnd.format('MMM D, YYYY')}
            </span>
            <button onClick={() => setCurrentWeek(currentWeek.add(1, 'week'))} className="w-7 h-7 rounded-lg border border-surface-border flex items-center justify-center text-text-muted hover:bg-surface-hover transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Best times dropdown */}
        {viewMode === 'calendar' && (
          <div className="relative">
            <button
              onClick={() => setShowBestTimeMenu(!showBestTimeMenu)}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                bestTimePlatform !== 'none'
                  ? 'bg-pink-500/10 border-pink-500/30 text-pink-400'
                  : 'border-surface-border text-text-secondary hover:bg-surface-hover',
              )}
            >
              {bestTimePlatform !== 'none' && (
                <span className={clsx('w-4 h-4 rounded-full flex items-center justify-center', PLATFORM_COLORS[bestTimePlatform])}>
                  {PLATFORM_ICONS[bestTimePlatform]}
                </span>
              )}
              Best times
              <ChevronLeft size={12} className={clsx('transition-transform', showBestTimeMenu ? 'rotate-90' : '-rotate-90')} />
            </button>

            {showBestTimeMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-surface-card border border-surface-border rounded-xl shadow-card py-1 z-50">
                {[
                  { id: 'none',      label: 'None',      icon: null },
                  { id: 'FACEBOOK',  label: 'Facebook',  icon: <Facebook size={14} className="text-blue-400" /> },
                  { id: 'INSTAGRAM', label: 'Instagram', icon: <Instagram size={14} className="text-pink-400" /> },
                  { id: 'YOUTUBE',   label: 'YouTube',   icon: <Youtube size={14} className="text-red-400" /> },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { setBestTimePlatform(opt.id as BestTimePlatform); setShowBestTimeMenu(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    {opt.icon || <span className="w-4" />}
                    {opt.label}
                    {bestTimePlatform === opt.id && <Check size={13} className="ml-auto text-brand-400" />}
                  </button>
                ))}
                <div className="border-t border-surface-border mt-1 pt-1 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Show as percentage</span>
                    <button
                      onClick={() => setShowPercentage(!showPercentage)}
                      className={clsx('w-8 h-4 rounded-full transition-colors relative', showPercentage ? 'bg-brand-500' : 'bg-surface-border')}
                    >
                      <div className={clsx('absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform', showPercentage ? 'translate-x-4' : 'translate-x-0.5')} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Create post */}
        <Button
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => { setDefaultDate(''); setShowCreatePost(true); }}
        >
          Create post
        </Button>

        {/* Sync button */}
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-8 h-8 rounded-lg border border-surface-border flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Sync real data from APIs"
        >
          <Sparkles size={14} className={syncing ? 'animate-spin text-brand-400' : ''} />
        </button>
      </div>

      {/* ── CALENDAR VIEW ────────────────────────────────────── */}
      {viewMode === 'calendar' && (
        <div className="flex-1 overflow-auto">
          <div className="min-w-[900px]">
            {/* Day headers */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-surface-border sticky top-0 bg-surface-card z-10">
              <div className="py-3" />
              {weekDays.map((day, i) => {
                const isToday = day.isSame(today, 'day');
                return (
                  <div key={i} className={clsx('py-3 text-center border-l border-surface-border', isToday && 'bg-brand-500/5')}>
                    <p className="text-xs text-text-muted">{day.format('ddd').toUpperCase()}</p>
                    <p className={clsx(
                      'text-sm font-semibold mt-0.5 w-7 h-7 rounded-full flex items-center justify-center mx-auto',
                      isToday ? 'bg-brand-500 text-white' : 'text-text-primary',
                    )}>
                      {day.date()}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Hour rows */}
            {HOURS.map(({ h, label }) => (
              <div key={h} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-surface-border/30 min-h-[52px]">
                {/* Time label */}
                <div className="flex items-start justify-end pr-3 pt-1">
                  <span className="text-[10px] text-text-muted">{label}</span>
                </div>

                {/* Day cells */}
                {weekDays.map((day, dayIdx) => {
                  const slotKey = day.format('YYYY-MM-DD') + '_' + h;
                  const slotPosts = postsBySlot[slotKey] || [];
                  const heatScore = getHeatScore(day.day(), h);
                  const confidence = getConfidence(day.day(), h);
                  const topSlot = isTopSlot(day.day(), h);
                  const slotWhy = getSlotWhy(day.day(), h);
                  const isToday = day.isSame(today, 'day');

                  return (
                    <div
                      key={dayIdx}
                      onClick={() => handleSlotClick(day, h)}
                      title={slotWhy || (heatScore > 0 ? `${heatScore}% engagement score${confidence > 0 ? ` · ${confidence}% confidence` : ''}` : undefined)}
                      className={clsx(
                        'border-l border-surface-border/30 p-1 cursor-pointer relative group transition-colors',
                        isToday && 'bg-brand-500/3',
                        slotPosts.length === 0 && 'hover:bg-surface-hover/30',
                        topSlot && 'ring-1 ring-inset ring-pink-400/60',
                      )}
                      style={heatScore > 0 ? {
                        backgroundColor: `rgba(236, 72, 153, ${(heatScore / 100) * 0.55 + 0.05})`,
                      } : undefined}
                    >
                      {/* Heat score label */}
                      {heatScore > 0 && showPercentage && (
                        <span className="absolute top-0.5 right-1 text-[9px] text-blue-400 font-medium opacity-70">
                          {heatScore}%
                        </span>
                      )}

                      {/* Low-confidence indicator dot */}
                      {heatScore > 0 && confidence > 0 && confidence < 40 && (
                        <div className="absolute top-0.5 left-0.5 w-1 h-1 rounded-full bg-amber-400 opacity-60" />
                      )}

                      {/* Posts in this slot */}
                      {slotPosts.map((post: any) => (
                        <div
                          key={post.id}
                          onClick={(e) => { e.stopPropagation(); setSelectedPost(post); }}
                          className="flex items-center gap-1 bg-surface-card border border-surface-border rounded-md px-1.5 py-1 mb-0.5 cursor-pointer hover:border-brand-500/40 transition-colors group/post"
                        >
                          <div className="flex gap-0.5 flex-shrink-0">
                            {post.integration?.platform && (
                              <span className={clsx('w-4 h-4 rounded-full flex items-center justify-center text-[9px]', PLATFORM_COLORS[post.integration.platform])}>
                                {PLATFORM_ICONS[post.integration.platform]}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-text-secondary truncate flex-1">
                            {dayjs(post.publishDate).format('h:mm A')}
                          </span>
                          <div className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATE_COLORS[post.state] || 'bg-surface-border')} />
                        </div>
                      ))}

                      {/* Add button on hover */}
                      {slotPosts.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus size={14} className="text-text-muted" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LIST VIEW ────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-auto p-5">
          <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">
                    <input type="checkbox" className="rounded" />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">Post content</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">Networks</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/50">
                {filteredPosts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-text-muted">
                      No posts found. <button onClick={() => setShowCreatePost(true)} className="text-brand-400 hover:underline">Create one →</button>
                    </td>
                  </tr>
                ) : (
                  filteredPosts.map((post: any) => (
                    <tr key={post.id} className="hover:bg-surface-hover/30 transition-colors">
                      <td className="px-4 py-3">
                        <input type="checkbox" className="rounded" />
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">
                        <p>{dayjs(post.publishDate).format('MMM D, YYYY')}</p>
                        <p className="text-xs text-text-muted">{dayjs(post.publishDate).format('h:mm A')}</p>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="flex items-start gap-2">
                          {post.integration?.pictureUrl && (
                            <img src={post.integration.pictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0 object-cover" />
                          )}
                          <p className="text-sm text-text-primary line-clamp-2">{post.content}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {post.integration?.platform && (
                            <span className={clsx('w-5 h-5 rounded-full flex items-center justify-center', PLATFORM_COLORS[post.integration.platform])}>
                              {PLATFORM_ICONS[post.integration.platform]}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className={clsx('w-2 h-2 rounded-full', STATE_COLORS[post.state])} />
                          <span className="text-xs text-text-secondary capitalize">
                            {post.state === 'QUEUE' ? 'Pending' : post.state === 'PUBLISHED' ? 'Published' : post.state === 'ERROR' ? 'With errors' : post.state}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button className="w-7 h-7 rounded-lg hover:bg-surface-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDeletePost(post.id)}
                            disabled={deletingId === post.id}
                            className="w-7 h-7 rounded-lg hover:bg-surface-hover flex items-center justify-center text-text-muted hover:text-error transition-colors"
                          >
                            <MoreVertical size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── POST DETAIL PANEL ────────────────────────────────── */}
      {selectedPost && (
        <PostDetailPanel
          post={selectedPost}
          orgId={orgId}
          onClose={() => setSelectedPost(null)}
          onDelete={handleDeletePost}
          deletingId={deletingId}
        />
      )}

      {/* ── TODAY TREND PANEL ────────────────────────────────── */}
      {bestTimeData?.todayTrend?.length > 0 && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={() => setShowTodayTrend(!showTodayTrend)}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg transition-all"
          >
            <Sparkles size={13} />
            Today&apos;s Trend
            <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[10px]">
              {bestTimeData.todayTrend[0]?.tag}
            </span>
          </button>

          {showTodayTrend && (
            <div className="absolute bottom-12 right-0 w-72 bg-surface-card border border-surface-border rounded-2xl shadow-card p-4 animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Today&apos;s Best Times</p>
                  <p className="text-xs text-text-muted">
                    {bestTimePlatform !== 'none' ? bestTimePlatform.charAt(0) + bestTimePlatform.slice(1).toLowerCase() : 'All platforms'} · {dayjs().format('dddd')}
                  </p>
                </div>
                <button onClick={() => setShowTodayTrend(false)} className="text-text-muted hover:text-text-primary">
                  <Check size={14} />
                </button>
              </div>

              <div className="space-y-2">
                {bestTimeData.todayTrend.map((slot: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-hover cursor-pointer transition-colors"
                    onClick={() => {
                      const dt = dayjs().hour(slot.hour).minute(0).second(0);
                      setDefaultDate(dt.format('YYYY-MM-DDTHH:mm'));
                      setShowCreatePost(true);
                      setShowTodayTrend(false);
                    }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `rgba(236, 72, 153, ${(slot.score / 100) * 0.6 + 0.1})` }}>
                      <span className="text-[10px] font-bold text-white">{slot.score}%</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-text-primary">{slot.label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-[10px] text-text-muted">{slot.tag}</p>
                        {slot.confidence > 0 && (
                          <span className={clsx(
                            'text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                            slot.confidence >= 65 ? 'bg-green-500/15 text-green-400' :
                            slot.confidence >= 40 ? 'bg-amber-500/15 text-amber-400' :
                            'bg-surface-hover text-text-muted',
                          )}>
                            {slot.confidence}% conf.
                          </span>
                        )}
                      </div>
                    </div>
                    <Plus size={12} className="text-text-muted" />
                  </div>
                ))}
              </div>

              {bestTimeData.insights?.[1] && (
                <div className="mt-3 pt-3 border-t border-surface-border">
                  <p className="text-[10px] text-text-muted leading-relaxed">{bestTimeData.insights[1]}</p>
                </div>
              )}

              <div className="mt-3 text-[10px] text-text-muted text-center">
                {bestTimeData.dataSource === 'real'
                  ? `Based on ${bestTimeData.postsAnalyzed} real posts`
                  : bestTimeData.dataSource === 'partial'
                  ? `Partial data (${bestTimeData.postsAnalyzed} posts) · Sync for better accuracy`
                  : 'Based on industry research · Sync for personalized data'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CREATE POST MODAL ─────────────────────────────────── */}
      {showCreatePost && (
        <MetricoolCreatePost
          open={showCreatePost}
          onClose={() => setShowCreatePost(false)}
          integrations={integrations}
          defaultDate={defaultDate}
          orgId={orgId}
          onSuccess={() => {
            mutate(['posts', orgId, JSON.stringify({ from: weekStart.subtract(1,'day').toISOString(), to: weekEnd.add(1,'day').toISOString() })]);
            setShowCreatePost(false);
            toast.success('Post scheduled!');
          }}
        />
      )}
    </div>
  );
}

// ── Post Detail Panel ─────────────────────────────────────────
function PostDetailPanel({
  post,
  orgId,
  onClose,
  onDelete,
  deletingId,
}: {
  post: any;
  orgId: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const { data: logs = [], isLoading: logsLoading } = useSWR(
    post?.id ? ['post-logs', orgId, post.id] : null,
    () => postApi.getLogs(orgId, post.id),
    { revalidateOnFocus: false },
  );

  const statusLabel: Record<string, string> = {
    QUEUE: 'Scheduled',
    PUBLISHED: 'Published',
    ERROR: 'Failed',
    DRAFT: 'Draft',
  };

  const statusDot: Record<string, string> = {
    QUEUE: 'bg-amber-500',
    PUBLISHED: 'bg-green-500',
    ERROR: 'bg-red-500',
    DRAFT: 'bg-surface-border',
  };

  const logStatusColor: Record<string, string> = {
    SUCCESS: 'text-green-400',
    FAILED: 'text-red-400',
    RETRYING: 'text-amber-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-surface-card border border-surface-border rounded-2xl w-[420px] max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border sticky top-0 bg-surface-card z-10">
          <h3 className="text-sm font-semibold text-text-primary">Post Details</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Platform + time + status */}
          <div className="flex items-center gap-2">
            {post.integration?.platform && (
              <span className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0', PLATFORM_COLORS[post.integration.platform])}>
                {PLATFORM_ICONS[post.integration.platform]}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text-primary truncate">{post.integration?.name}</p>
              <p className="text-xs text-text-muted">{dayjs(post.publishDate).format('MMM D, YYYY [at] h:mm A')}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className={clsx('w-2 h-2 rounded-full', statusDot[post.state] || 'bg-surface-border')} />
              <span className="text-xs text-text-secondary">{statusLabel[post.state] || post.state}</span>
            </div>
          </div>

          {/* Content */}
          <div className="bg-surface-hover rounded-xl p-3">
            <p className="text-sm text-text-primary whitespace-pre-wrap">{post.content}</p>
            {post.hashtags && (
              <p className="text-xs text-brand-400 mt-2 leading-relaxed">{post.hashtags}</p>
            )}
          </div>

          {/* Error detail */}
          {post.state === 'ERROR' && post.error && (
            <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-3">
              <p className="text-xs font-semibold text-red-400 mb-1">
                {post.error.includes('cannot access your media file publicly')
                  ? 'Instagram cannot access your media file publicly'
                  : 'Publish Error'}
              </p>
              <p className="text-xs text-red-300/80 font-mono leading-relaxed break-all">
                {post.error.replace('__CLAIMED__', '').trim() || 'Unknown error'}
              </p>
            </div>
          )}

          {/* Published URL */}
          {post.publishedUrl && (
            <a
              href={post.publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              <ExternalLink size={12} />
              View live post
            </a>
          )}

          {/* Metrics */}
          {post.metrics?.[0] && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Likes', value: post.metrics[0].likes },
                { label: 'Comments', value: post.metrics[0].comments },
                { label: 'Reach', value: post.metrics[0].reach },
                { label: 'Eng.', value: (post.metrics[0].engagementRate?.toFixed(1) || '0') + '%' },
              ].map((m) => (
                <div key={m.label} className="bg-surface-hover rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-text-primary">{m.value}</p>
                  <p className="text-[10px] text-text-muted">{m.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Publish logs */}
          {(logs.length > 0 || logsLoading) && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Publish Log</p>
              {logsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <div key={i} className="skeleton h-8 rounded-lg" />)}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {logs.map((log: any) => (
                    <div key={log.id} className="bg-surface-hover rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className={clsx('text-xs font-semibold', logStatusColor[log.status] || 'text-text-muted')}>
                          {log.status}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {dayjs(log.createdAt).format('MMM D, h:mm A')}
                          {log.durationMs && ` · ${(log.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      </div>
                      {log.error && (
                        <p className="text-[11px] text-text-muted mt-1 font-mono break-all leading-relaxed">
                          {log.error.slice(0, 200)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {(post.state === 'QUEUE' || post.state === 'ERROR') && (
              <button
                onClick={() => onDelete(post.id)}
                disabled={deletingId === post.id}
                className="flex-1 py-2 text-xs font-medium text-error border border-error/30 rounded-xl hover:bg-error/10 transition-colors disabled:opacity-50"
              >
                {deletingId === post.id ? 'Deleting...' : 'Delete'}
              </button>
            )}
            {post.publishedUrl && (
              <a href={post.publishedUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                <button className="w-full py-2 text-xs font-medium text-brand-400 border border-brand-500/30 rounded-xl hover:bg-brand-500/10 transition-colors">
                  View live post
                </button>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
