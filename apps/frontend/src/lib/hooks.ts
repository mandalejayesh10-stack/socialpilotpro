import useSWR, { mutate as globalMutate } from 'swr';
import { useAppStore } from './store';
import {
  analyticsApi, postApi, integrationApi,
  mediaApi, reportApi, notificationApi,
  billingApi, settingsApi,
} from './api';

// ── Org ID helper ─────────────────────────────────────────────
export function useOrgId() {
  return useAppStore((s) => s.currentOrg?.id || '');
}

// ── Analytics hooks ───────────────────────────────────────────
export function useOverview(period = '30d') {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['analytics/overview', orgId, period] : null,
    () => analyticsApi.overview(orgId, period),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
}

export function usePlatformAnalytics(platform: string, period = '30d') {
  const orgId = useOrgId();
  return useSWR(
    orgId && platform ? ['analytics/platform', orgId, platform, period] : null,
    () => analyticsApi.platform(orgId, platform.toLowerCase(), period),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
}

export function useGrowthData(platform: string, period = '30d') {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['analytics/growth', orgId, platform, period] : null,
    () => analyticsApi.growth(orgId, platform.toLowerCase(), period),
    { revalidateOnFocus: false },
  );
}

export function useTopPosts(platform: string, period = '30d') {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['analytics/top-posts', orgId, platform, period] : null,
    () => analyticsApi.topPosts(orgId, platform.toLowerCase(), period),
    { revalidateOnFocus: false },
  );
}

export function useAnalyticsSyncStatus() {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['analytics/sync-status', orgId] : null,
    () => analyticsApi.syncStatus(orgId),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
}

export function useContentTypes(platform: string, period = '30d') {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['analytics/content-types', orgId, platform, period] : null,
    () => analyticsApi.contentTypes(orgId, platform.toLowerCase(), period),
    { revalidateOnFocus: false },
  );
}

export function useHashtags(platform: string, period = '30d') {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['analytics/hashtags', orgId, platform, period] : null,
    () => analyticsApi.hashtags(orgId, platform.toLowerCase(), period),
    { revalidateOnFocus: false },
  );
}

export function useDemographics(platform: string, period = '30d') {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['analytics/demographics', orgId, platform, period] : null,
    () => analyticsApi.demographics(orgId, platform.toLowerCase(), period),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
}

// ── Posts hooks ───────────────────────────────────────────────
export function usePosts(params?: {
  from?: string;
  to?: string;
  platform?: string;
  state?: string;
}) {
  const orgId = useOrgId();
  const key = JSON.stringify(params || {});
  return useSWR(
    orgId ? ['posts', orgId, key] : null,
    () => postApi.list(orgId, params),
    { refreshInterval: 30_000 },
  );
}

export function usePost(postId: string | null) {
  const orgId = useOrgId();
  return useSWR(
    orgId && postId ? ['post', orgId, postId] : null,
    () => postApi.get(orgId, postId!),
  );
}

// ── Integrations hook ─────────────────────────────────────────
export function useIntegrations() {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['integrations', orgId] : null,
    () => integrationApi.list(orgId),
    { revalidateOnFocus: false },
  );
}

// ── Media hook ────────────────────────────────────────────────
export function useMedia(page = 1, limit = 20) {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['media', orgId, page, limit] : null,
    () => mediaApi.list(orgId, page, limit),
  );
}

// ── Reports hook ──────────────────────────────────────────────
export function useReports() {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['reports', orgId] : null,
    () => reportApi.list(orgId),
    { refreshInterval: 10_000 }, // Poll while reports are generating
  );
}

// ── Notifications hook ────────────────────────────────────────
export function useNotifications() {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['notifications', orgId] : null,
    () => notificationApi.list(orgId),
    { refreshInterval: 30_000 },
  );
}

// ── Billing hook ──────────────────────────────────────────────
export function useBilling() {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['billing/subscription', orgId] : null,
    () => billingApi.getSubscription(orgId),
    { revalidateOnFocus: false },
  );
}

export function useInvoices() {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['billing/invoices', orgId] : null,
    () => billingApi.getInvoices(orgId),
    { revalidateOnFocus: false },
  );
}

// ── Usage stats hook ──────────────────────────────────────────
export function useUsageStats() {
  const orgId = useOrgId();
  return useSWR(
    orgId ? ['settings/usage', orgId] : null,
    () => settingsApi.getUsage(orgId),
    { refreshInterval: 60_000 },
  );
}

// ── Mutate helpers ────────────────────────────────────────────
export function invalidatePosts(orgId: string) {
  globalMutate((key: any) => Array.isArray(key) && key[0] === 'posts' && key[1] === orgId);
}

export function invalidateAnalytics(orgId: string) {
  globalMutate((key: any) => Array.isArray(key) && key[0]?.startsWith('analytics') && key[1] === orgId);
}
