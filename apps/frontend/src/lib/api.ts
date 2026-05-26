/**
 * Typed API client — all requests go through the Next.js rewrite proxy to the backend.
 * Never calls platform APIs directly from the frontend.
 */

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL
  ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/api`
  : '/api';

/**
 * Resolve a media URL returned by the backend.
 * The backend stores local preview paths in development and CDN URLs in production.
 * This function prepends the backend base URL so the browser can load the asset.
 */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Already absolute — return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Relative path — prepend backend origin
  const backendOrigin = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';
  return `${backendOrigin}${url.startsWith('/') ? '' : '/'}${url}`;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { orgId?: string } = {},
): Promise<T> {
  const { orgId, ...init } = options;

  // Get token from localStorage (set on login)
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(orgId ? { 'x-org-id': orgId } : {}),
    ...(init.headers as Record<string, string> || {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (res.status === 401) {
    // Clear invalid token
    if (typeof window !== 'undefined') localStorage.removeItem('auth_token');
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, data.message || `Request failed: ${res.status}`);
  }

  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data: { name: string; email: string; password: string; organizationName?: string }) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/auth/me'),
  logout: () => {
    if (typeof window !== 'undefined') localStorage.removeItem('auth_token');
    return request('/auth/logout', { method: 'POST' });
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    request('/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }),
};

// ── Organizations ─────────────────────────────────────────────
export const orgApi = {
  list: () => request<any[]>('/organizations'),
  create: (data: { name: string; timezone?: string; logoUrl?: string; brandColor?: string }) =>
    request<any>('/organizations', { method: 'POST', body: JSON.stringify(data) }),
  update: (orgId: string, data: any) =>
    request<any>(`/organizations/${orgId}`, { method: 'PATCH', body: JSON.stringify(data), orgId }),
  getMembers: (orgId: string) =>
    request(`/organizations/${orgId}/members`, { orgId }),
  invite: (orgId: string, email: string, role: string) =>
    request(`/organizations/${orgId}/members/invite`, { method: 'POST', body: JSON.stringify({ email, role }), orgId }),
  removeMember: (orgId: string, memberId: string) =>
    request(`/organizations/${orgId}/members/${memberId}`, { method: 'DELETE', orgId }),
};

// ── Integrations ──────────────────────────────────────────────
export const integrationApi = {
  list: (orgId: string) => request<any[]>('/integrations', { orgId }),
  disconnect: (orgId: string, id: string) =>
    request(`/integrations/${id}`, { method: 'DELETE', orgId }),
  // These now make authenticated fetch requests using the Authorization header,
  // bypassing cross-domain cookie issues completely.
  connectMetaUrl: (orgId: string) => request<{ url: string }>('/integrations/meta/connect', { orgId }),
  connectYoutubeUrl: (orgId: string) => request<{ url: string }>('/integrations/youtube/connect', { orgId }),
};

// ── Posts ─────────────────────────────────────────────────────
export const postApi = {
  list: (orgId: string, params?: { from?: string; to?: string; platform?: string; state?: string }) => {
    const q = new URLSearchParams(params as any).toString();
    return request<any[]>(`/posts${q ? '?' + q : ''}`, { orgId });
  },
  create: (orgId: string, data: any) =>
    request('/posts', { method: 'POST', body: JSON.stringify(data), orgId }),
  bulkSchedule: (orgId: string, posts: any[]) =>
    request('/posts/bulk', { method: 'POST', body: JSON.stringify({ posts }), orgId }),
  get: (orgId: string, id: string) => request(`/posts/${id}`, { orgId }),
  update: (orgId: string, id: string, data: any) =>
    request(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(data), orgId }),
  delete: (orgId: string, id: string) =>
    request(`/posts/${id}`, { method: 'DELETE', orgId }),
  getLogs: (orgId: string, id: string) =>
    request<any[]>(`/posts/${id}/logs`, { orgId }),
};

// ── Analytics ─────────────────────────────────────────────────
export const analyticsApi = {
  overview: (orgId: string, period = '30d') =>
    request<any>(`/analytics/overview?period=${period}`, { orgId }),
  platform: (orgId: string, platform: string, period = '30d') =>
    request<any>(`/analytics/${platform}?period=${period}`, { orgId }),
  growth: (orgId: string, platform: string, period = '30d') =>
    request<any[]>(`/analytics/${platform}/growth?period=${period}`, { orgId }),
  topPosts: (orgId: string, platform: string, period = '30d') =>
    request<any[]>(`/analytics/${platform}/top-posts?period=${period}`, { orgId }),
  contentTypes: (orgId: string, platform: string, period = '30d') =>
    request<any[]>(`/analytics/${platform}/content-types?period=${period}`, { orgId }),
  hashtags: (orgId: string, platform: string, period = '30d') =>
    request<any[]>(`/analytics/${platform}/hashtags?period=${period}`, { orgId }),
  demographics: (orgId: string, platform: string, period = '30d') =>
    request<any>(`/analytics/${platform}/demographics?period=${period}`, { orgId }),
  // Best times to post
  bestTimes: (orgId: string, platform: string, timezone?: string) => {
    const tz = timezone ? `&timezone=${encodeURIComponent(timezone)}` : '';
    return request<any>(`/analytics/best-times/${platform.toLowerCase()}?${tz}`, { orgId });
  },
  bestTimesAll: (orgId: string, timezone?: string) => {
    const tz = timezone ? `?timezone=${encodeURIComponent(timezone)}` : '';
    return request<any>(`/analytics/all-best-times${tz}`, { orgId });
  },
  // Force sync — fetches real data from APIs immediately
  forceSync: (orgId: string) =>
    request<any>('/analytics/sync', { method: 'POST', orgId }),
  syncStatus: (orgId: string) =>
    request<any>('/analytics/sync-status', { orgId }),
  // YouTube specific
  youtubeVideos: (orgId: string, params?: { search?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    ).toString();
    return request<any>(`/analytics/youtube/videos${q ? '?' + q : ''}`, { orgId });
  },
  youtubeStats: (orgId: string) =>
    request<any[]>('/analytics/youtube/stats', { orgId }),
  // Instagram real-time
  instagramRealtime: (orgId: string) =>
    request<any[]>('/analytics/instagram/realtime', { orgId }),
  instagramPosts: (orgId: string, params?: { page?: number; limit?: number }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    ).toString();
    return request<any>(`/analytics/instagram/posts${q ? '?' + q : ''}`, { orgId });
  },
  // Facebook real-time
  facebookRealtime: (orgId: string) =>
    request<any[]>('/analytics/facebook/realtime', { orgId }),
  facebookPosts: (orgId: string, params?: { page?: number; limit?: number }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    ).toString();
    return request<any>(`/analytics/facebook/posts${q ? '?' + q : ''}`, { orgId });
  },
};

// ── Media ─────────────────────────────────────────────────────
export const mediaApi = {
  list: (orgId: string, page = 1, limit = 20) =>
    request<any>(`/media?page=${page}&limit=${limit}`, { orgId }),
  upload: async (orgId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    // Use /api proxy (same origin) to avoid CORS issues.
    const res = await fetch('/api/media/upload', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-org-id': orgId,
        'ngrok-skip-browser-warning': 'true',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        // Do NOT set Content-Type — browser sets it with multipart boundary
      },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.message || `Upload failed (${res.status})`);
    }
    return res.json();
  },
  processVideo: (orgId: string, id: string, options: any) =>
    request(`/media/${id}/process`, { method: 'POST', body: JSON.stringify(options), orgId }),
  validate: (orgId: string, id: string, platform: string, isReel = false, isShort = false) =>
    request<any>(`/media/${id}/validate`, {
      method: 'POST',
      body: JSON.stringify({ platform, isReel, isShort }),
      orgId,
    }),
  delete: (orgId: string, id: string) =>
    request(`/media/${id}`, { method: 'DELETE', orgId }),
};

// ── AI ────────────────────────────────────────────────────────
export const aiApi = {
  generateCaption: (orgId: string, data: any) =>
    request<any>('/ai/caption', { method: 'POST', body: JSON.stringify(data), orgId }),
  suggestHashtags: (orgId: string, data: any) =>
    request<any>('/ai/hashtags', { method: 'POST', body: JSON.stringify(data), orgId }),
  getInsights: (orgId: string, platform: string, period = '30d') =>
    request<any>(`/ai/insights/${platform}`, { method: 'POST', body: JSON.stringify({ period }), orgId }),
  chat: (orgId: string, data: any) =>
    request<any>('/ai/chat', { method: 'POST', body: JSON.stringify(data), orgId }),
};

// ── Billing ───────────────────────────────────────────────────
export const billingApi = {
  getSubscription: (orgId: string) => request<any>('/billing/subscription', { orgId }),
  createCheckout: (orgId: string, tier: string, period: string, couponCode?: string) =>
    request<any>('/billing/checkout', { method: 'POST', body: JSON.stringify({ tier, period, couponCode }), orgId }),
  getBillingPortal: (orgId: string) =>
    request<any>('/billing/portal', { method: 'POST', orgId }),
  getInvoices: (orgId: string) =>
    request<any[]>('/billing/invoices', { orgId }),
  generateInvoicePdf: (orgId: string, invoiceId: string) =>
    request<any>(`/billing/invoices/${invoiceId}/pdf`, { method: 'POST', orgId }),
};

// ── Reports ───────────────────────────────────────────────────
export const reportApi = {
  list: (orgId: string) => request<any[]>('/reports', { orgId }),
  create: (orgId: string, data: any) =>
    request('/reports', { method: 'POST', body: JSON.stringify(data), orgId }),
  get: (orgId: string, id: string) => request<any>(`/reports/${id}`, { orgId }),
};

// ── Notifications ─────────────────────────────────────────────
export const notificationApi = {
  list: (orgId: string) => request<any[]>('/notifications', { orgId }),
  markRead: (orgId: string, id: string) =>
    request(`/notifications/${id}/read`, { method: 'PATCH', orgId }),
  markAllRead: (orgId: string) =>
    request('/notifications/read-all', { method: 'PATCH', orgId }),
};

// ── Settings ──────────────────────────────────────────────────
export const settingsApi = {
  updateProfile: (data: any) =>
    request<any>('/settings/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  updateOrganization: (orgId: string, data: any) =>
    request<any>('/settings/organization', { method: 'PATCH', body: JSON.stringify(data), orgId }),
  getApiKey: (orgId: string) => request<any>('/settings/api-key', { orgId }),
  regenerateApiKey: (orgId: string) =>
    request<any>('/settings/api-key/regenerate', { method: 'POST', orgId }),
  getUsage: (orgId: string) => request<any>('/settings/usage', { orgId }),
};

export { ApiError };

// ── Inbox ─────────────────────────────────────────────────────
export const inboxApi = {
  getConversations: (orgId: string, params?: {
    platform?: string; status?: string; search?: string; page?: number; limit?: number;
  }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    ).toString();
    return request<any>(`/inbox/conversations${q ? '?' + q : ''}`, { orgId });
  },
  getConversation: (orgId: string, id: string) =>
    request<any>(`/inbox/conversations/${id}`, { orgId }),
  getMessages: (orgId: string, conversationId: string) =>
    request<any[]>(`/inbox/messages/${conversationId}`, { orgId }),
  reply: (orgId: string, conversationId: string, message: string) =>
    request<any>('/inbox/reply', { method: 'POST', body: JSON.stringify({ conversationId, message }), orgId }),
  resolve: (orgId: string, id: string, resolved: boolean) =>
    request<any>(`/inbox/resolve/${id}`, { method: 'PATCH', body: JSON.stringify({ resolved }), orgId }),
  markSpam: (orgId: string, id: string, spam: boolean) =>
    request<any>(`/inbox/spam/${id}`, { method: 'PATCH', body: JSON.stringify({ spam }), orgId }),
  getUnread: (orgId: string) =>
    request<any>('/inbox/unread', { orgId }),
  suggestReply: (orgId: string, conversationId: string) =>
    request<any>(`/inbox/ai/suggest/${conversationId}`, { orgId }),
  sync: (orgId: string) =>
    request<any>('/inbox/sync', { method: 'POST', orgId }),
};
