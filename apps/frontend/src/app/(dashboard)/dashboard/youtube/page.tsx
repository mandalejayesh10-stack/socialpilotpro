"use client";

import { useState, useEffect } from "react";
import { useDemographics, useOrgId } from "@/lib/hooks";
import { analyticsApi } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/ui/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { DemographicsPanel } from "@/components/analytics/demographics-panel";
import clsx from "clsx";
import dayjs from "dayjs";
import {
  Youtube, RefreshCw, Download, Search, Users,
  Eye, ThumbsUp, MessageSquare, Share2, Clock,
  TrendingUp, TrendingDown, Minus, ExternalLink,
} from "lucide-react";
import { DateRangePicker, DateRange } from "@/components/ui/date-range-picker";

// ── Metric card ───────────────────────────────────────────────
function StatCard({ label, value, color, icon }: {
  label: string; value: string | number; color: string; icon?: React.ReactNode;
}) {
  return (
    <div className={clsx("rounded-2xl p-4 flex flex-col gap-1", color)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium opacity-70">{label}</span>
        {icon && <span className="opacity-60">{icon}</span>}
      </div>
      <span className="text-2xl font-bold">{value === 0 || value === "0" ? "—" : formatNum(value as number)}</span>
    </div>
  );
}

function formatNum(n: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatDuration(iso: string): string {
  if (!iso) return "";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;
  const h = parseInt(match[1] || "0");
  const m = parseInt(match[2] || "0");
  const s = parseInt(match[3] || "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function YouTubeAnalyticsPage() {
  const orgId = useOrgId();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [videoSearch, setVideoSearch] = useState("");
  const [videoPage, setVideoPage] = useState(1);
  const [videoTotal, setVideoTotal] = useState(0);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [activeTab, setActiveTab] = useState<"growth" | "balance" | "videos" | "list">("growth");

  const [dateRange, setDateRange] = useState<DateRange>({
    startDate: dayjs().subtract(29, 'days').toDate(),
    endDate: dayjs().toDate(),
  });

  const diffDays = dayjs(dateRange.endDate).diff(dayjs(dateRange.startDate), 'day') + 1;
  const backendPeriod = diffDays <= 7 ? "7d" : diffDays <= 30 ? "30d" : "90d";

  const { data: demographics, isLoading: loadingDemographics } = useDemographics("YOUTUBE", backendPeriod);

  // ── Load data ─────────────────────────────────────────────
  const loadData = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [statsData, summaryData] = await Promise.all([
        analyticsApi.youtubeStats(orgId),
        analyticsApi.platform(orgId, "youtube", backendPeriod),
      ]);
      setStats(statsData || []);
      setSummary(summaryData?.summary || null);
    } catch (e: any) {
      // No data yet — show empty state
    } finally {
      setLoading(false);
    }
  };

  const loadVideos = async () => {
    if (!orgId) return;
    setLoadingVideos(true);
    try {
      const res = await analyticsApi.youtubeVideos(orgId, {
        search: videoSearch || undefined,
        page: videoPage,
        limit: 20,
      });
      setVideos(res.videos || []);
      setVideoTotal(res.total || 0);
    } catch {
      setVideos([]);
    } finally {
      setLoadingVideos(false);
    }
  };

  useEffect(() => { loadData(); }, [orgId, backendPeriod]);
  useEffect(() => { if (activeTab === "list") loadVideos(); }, [activeTab, orgId, videoSearch, videoPage]);

  // ── Force sync ────────────────────────────────────────────
  const handleSync = async () => {
    if (!orgId) return;
    setSyncing(true);
    try {
      await analyticsApi.forceSync(orgId);
      toast.success("Synced!", "Real data fetched from YouTube API");
      await loadData();
      if (activeTab === "list") await loadVideos();
    } catch (e: any) {
      toast.error("Sync failed", e.message);
    } finally {
      setSyncing(false);
    }
  };

  const filteredVideos = videos.filter((v) => {
    const date = dayjs(v.publishedAt);
    return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
           date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
  });

  // ── CSV export ────────────────────────────────────────────
  const exportCSV = () => {
    if (!filteredVideos.length) return;
    const headers = ["Title", "Published", "Views", "Likes", "Comments", "Duration"];
    const rows = filteredVideos.map((v) => [
      `"${v.title?.replace(/"/g, "")}"`,
      dayjs(v.publishedAt).format("YYYY-MM-DD"),
      v.views,
      v.likes,
      v.comments,
      formatDuration(v.duration),
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `youtube-videos-${dayjs().format("YYYY-MM-DD")}.csv`;
    a.click();
  };

  // ── Aggregate stats ───────────────────────────────────────
  const totalSubscribers = stats.reduce((s, c) => s + (c.subscribers || 0), 0);
  const totalVideos = stats.reduce((s, c) => s + (c.videoCount || 0), 0);
  const watchTime = stats.reduce((s, c) => s + (c.totalWatchTime || 0), 0);
  const avgRetention = stats.length ? stats.reduce((s, c) => s + (c.avgRetention || 0), 0) / stats.length : 0;
  const avgCtr = stats.length ? stats.reduce((s, c) => s + (c.avgCtr || 0), 0) / stats.length : 0;

  // Build chart data from summary
  const sp = (v: any) => Array.isArray(v) ? v : (typeof v === "string" ? (() => { try { return JSON.parse(v || "[]"); } catch { return []; } })() : []);
  const followerTimeline = sp(summary?.followerTimeline);
  const reachTimeline = sp(summary?.reachTimeline);

  const filteredFollowerTimeline = followerTimeline.filter((d: any) => {
    const date = dayjs(d.date);
    return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
           date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
  });

  const filteredReachTimeline = reachTimeline.filter((d: any) => {
    const date = dayjs(d.date);
    return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
           date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
  });

  // Build subscriber balance chart from analytics rows
  const balanceData = stats.flatMap((c) =>
    (c.rows || []).map((row: any) => ({
      date: row[0],
      gained: row[8] || 0,
      lost: row[9] || 0,
      net: (row[8] || 0) - (row[9] || 0),
    }))
  ).sort((a, b) => a.date.localeCompare(b.date));

  const filteredBalanceData = balanceData.filter((d: any) => {
    const date = dayjs(d.date);
    return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
           date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
  });

  const subsGained = filteredBalanceData.reduce((s, c) => s + (c.gained || 0), 0);
  const subsLost = filteredBalanceData.reduce((s, c) => s + (c.lost || 0), 0);

  const publishedData = stats.flatMap((c) =>
    (c.rows || []).map((row: any) => ({
      date: row[0],
      views: row[1] || 0,
      likes: row[5] || 0,
      comments: row[6] || 0,
      shares: row[7] || 0,
    }))
  ).sort((a, b) => a.date.localeCompare(b.date));

  const filteredPublishedData = publishedData.filter((d: any) => {
    const date = dayjs(d.date);
    return date.isAfter(dayjs(dateRange.startDate).subtract(1, 'day'), 'day') &&
           date.isBefore(dayjs(dateRange.endDate).add(1, 'day'), 'day');
  });

  const periodViews = filteredPublishedData.reduce((s, c) => s + (c.views || 0), 0);
  const periodLikes = filteredPublishedData.reduce((s, c) => s + (c.likes || 0), 0);
  const periodComments = filteredPublishedData.reduce((s, c) => s + (c.comments || 0), 0);
  const periodShares = filteredPublishedData.reduce((s, c) => s + (c.shares || 0), 0);

  const hasData = stats.length > 0 || summary;

  if (!loading && !hasData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center text-red-400">
              <Youtube size={18} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary">YouTube</h1>
              <p className="text-sm text-text-muted">Analytics overview</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} className={syncing ? "animate-spin" : ""} />}
              loading={syncing}
              onClick={handleSync}
            >
              Sync Now
            </Button>
          </div>
        </div>
        <EmptyState
          icon={<Youtube size={24} />}
          title="No YouTube data yet"
          description="Connect your YouTube channel and click Sync Now to fetch real analytics data."
          action={{ label: "Sync Now", onClick: handleSync }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center text-red-400">
            <Youtube size={18} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">YouTube</h1>
            <p className="text-sm text-text-muted">
              {stats.map((s) => s.channelName).join(", ") || "Analytics overview"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={13} className={syncing ? "animate-spin" : ""} />}
            loading={syncing}
            onClick={handleSync}
          >
            Sync
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-card border border-surface-border rounded-xl p-1 w-fit">
        {[
          { id: "growth",  label: "Growth" },
          { id: "balance", label: "Subscribers" },
          { id: "videos",  label: "Published Videos" },
          { id: "list",    label: "List of Videos" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={clsx(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === t.id ? "bg-brand-500 text-white" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── GROWTH TAB ─────────────────────────────────────── */}
      {activeTab === "growth" && (
        <div className="space-y-5">
          {/* Metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <StatCard label="Subscribers" value={totalSubscribers} color="bg-purple-500/15 text-purple-300" icon={<Users size={16} />} />
            <StatCard label="Video Views (Selected Range)" value={periodViews} color="bg-green-500/15 text-green-300" icon={<Eye size={16} />} />
            <StatCard label="Watch Time (min)" value={watchTime} color="bg-pink-500/15 text-pink-300" icon={<Clock size={16} />} />
            <StatCard label="Videos" value={totalVideos} color="bg-amber-500/15 text-amber-300" icon={<Youtube size={16} />} />
            <StatCard label="Avg Retention" value={`${avgRetention.toFixed(1)}%`} color="bg-blue-500/15 text-blue-300" />
            <StatCard label="Avg CTR" value={`${avgCtr.toFixed(1)}%`} color="bg-cyan-500/15 text-cyan-300" />
          </div>

          {/* Growth chart */}
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Growth</h3>
            {filteredFollowerTimeline.length > 0 ? (
              <ChartCard
                title=""
                data={filteredFollowerTimeline}
                type="line"
                dataKeys={[{ key: "value", color: "#6366f1", label: "Subscribers" }]}
                height={220}
              />
            ) : (
              <div className="h-48 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-sm text-text-muted">No historical data yet</p>
                  <button onClick={handleSync} className="mt-2 text-xs text-brand-400 hover:text-brand-300">
                    Click Sync to fetch real data →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Views chart */}
          {filteredReachTimeline.length > 0 && (
            <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-4">Video Views</h3>
              <ChartCard
                title=""
                data={filteredReachTimeline}
                type="bar"
                dataKeys={[{ key: "value", color: "#ef4444", label: "Views" }]}
                height={200}
              />
            </div>
          )}

          <DemographicsPanel data={demographics} loading={loadingDemographics} />
        </div>
      )}

      {/* ── SUBSCRIBER BALANCE TAB ─────────────────────────── */}
      {activeTab === "balance" && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Gained" value={subsGained} color="bg-green-500/15 text-green-300" icon={<TrendingUp size={16} />} />
            <StatCard label="Lost" value={subsLost} color="bg-red-500/15 text-red-300" icon={<TrendingDown size={16} />} />
            <StatCard label="Net Growth" value={subsGained - subsLost} color="bg-brand-500/15 text-brand-300" icon={<Minus size={16} />} />
          </div>

          <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Balance of Subscribers</h3>
            {filteredBalanceData.length > 0 ? (
              <ChartCard
                title=""
                data={filteredBalanceData}
                type="bar"
                dataKeys={[
                  { key: "gained", color: "#22c55e", label: "Gained" },
                  { key: "lost",   color: "#ef4444", label: "Lost" },
                ]}
                xKey="date"
                height={220}
              />
            ) : (
              <div className="h-48 flex items-center justify-center">
                <p className="text-sm text-text-muted">No subscriber data yet — click Sync</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PUBLISHED VIDEOS TAB ───────────────────────────── */}
      {activeTab === "videos" && (
        <div className="space-y-5">
          <div className="grid grid-cols-6 gap-3">
            <StatCard label="Video Views" value={periodViews} color="bg-green-500/15 text-green-300" />
            <StatCard label="Likes" value={periodLikes} color="bg-blue-500/15 text-blue-300" />
            <StatCard label="Dislikes" value={0} color="bg-red-500/15 text-red-300" />
            <StatCard label="Comments" value={periodComments} color="bg-purple-500/15 text-purple-300" />
            <StatCard label="Shares" value={periodShares} color="bg-pink-500/15 text-pink-300" />
            <StatCard label="Videos" value={totalVideos} color="bg-amber-500/15 text-amber-300" />
          </div>

          <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Published Videos Performance</h3>
            {filteredPublishedData.length > 0 ? (
              <ChartCard
                title=""
                data={filteredPublishedData}
                type="bar"
                dataKeys={[
                  { key: "views",    color: "#22c55e", label: "Views" },
                  { key: "likes",    color: "#3b82f6", label: "Likes" },
                  { key: "comments", color: "#a855f7", label: "Comments" },
                ]}
                xKey="date"
                height={220}
              />
            ) : (
              <div className="h-48 flex items-center justify-center">
                <p className="text-sm text-text-muted">No video data yet — click Sync</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LIST OF VIDEOS TAB ─────────────────────────────── */}
      {activeTab === "list" && (
        <div className="space-y-4">
          {/* Search + export */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={videoSearch}
                onChange={(e) => { setVideoSearch(e.target.value); setVideoPage(1); }}
                placeholder="Search videos..."
                className="w-full bg-surface-input border border-surface-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={13} />}
              onClick={exportCSV}
              disabled={!filteredVideos.length}
            >
              Download CSV
            </Button>
          </div>

          {/* Videos table */}
          <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Video</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Views</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Likes</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Comments</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Watch</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Retention</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Duration</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Published</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/50">
                {loadingVideos ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="skeleton w-20 h-12 rounded-lg" /><div className="skeleton h-4 w-48" /></div></td>
                      {[1,2,3,4,5,6].map(j => <td key={j} className="px-4 py-4"><div className="skeleton h-4 w-12 ml-auto" /></td>)}
                    </tr>
                  ))
                ) : filteredVideos.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center">
                      <p className="text-sm text-text-muted">No videos found</p>
                      <button onClick={handleSync} className="mt-2 text-xs text-brand-400 hover:text-brand-300">
                        Click Sync to fetch your videos →
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredVideos.map((video) => (
                    <tr key={video.id} className="hover:bg-surface-hover/50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {video.thumbnail && (
                            <img src={video.thumbnail} alt="" className="w-20 h-12 rounded-lg object-cover flex-shrink-0" />
                          )}
                          <p className="text-sm text-text-primary line-clamp-2 max-w-xs">{video.title}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-text-secondary">{formatNum(video.views)}</td>
                      <td className="px-4 py-3 text-right text-sm text-text-secondary">{formatNum(video.likes)}</td>
                      <td className="px-4 py-3 text-right text-sm text-text-secondary">{formatNum(video.comments)}</td>
                      <td className="px-4 py-3 text-right text-sm text-text-secondary">{formatNum(video.watchTimeMinutes || 0)}</td>
                      <td className="px-4 py-3 text-right text-sm text-text-secondary">{(video.retentionPercent || 0).toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right text-sm text-text-muted">{formatDuration(video.duration)}</td>
                      <td className="px-4 py-3 text-right text-sm text-text-muted">{dayjs(video.publishedAt).format("MMM D, YYYY")}</td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`https://www.youtube.com/watch?v=${video.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-text-muted hover:text-brand-400 transition-colors"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {videoTotal > 20 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-surface-border">
                <p className="text-xs text-text-muted">{videoTotal} videos total</p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={videoPage === 1} onClick={() => setVideoPage(p => p - 1)}>
                    Previous
                  </Button>
                  <span className="text-xs text-text-muted">Page {videoPage}</span>
                  <Button variant="secondary" size="sm" disabled={videos.length < 20} onClick={() => setVideoPage(p => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
