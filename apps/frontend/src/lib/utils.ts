import clsx, { ClassValue } from 'clsx';

// ── Class name helper ─────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// ── Date formatting ───────────────────────────────────────────
export function formatDistanceToNow(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) return d.toLocaleDateString();
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function formatDate(date: Date | string, format: 'short' | 'long' | 'time' = 'short'): string {
  const d = new Date(date);
  if (format === 'long') return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  if (format === 'time') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Number formatting ─────────────────────────────────────────
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatPercent(n: number, decimals = 2): string {
  return `${n.toFixed(decimals)}%`;
}

// ── Currency formatting ───────────────────────────────────────
export function formatCurrency(
  amount: number,
  currency = 'usd',
  locale = 'en-US',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

// ── Platform helpers ──────────────────────────────────────────
export function getPlatformColor(platform: string): string {
  const colors: Record<string, string> = {
    INSTAGRAM: '#e1306c',
    FACEBOOK:  '#1877f2',
    YOUTUBE:   '#ff0000',
    LINKEDIN:  '#0a66c2',
    THREADS:   '#000000',
    GOOGLE_BUSINESS: '#0f9d58',
  };
  return colors[platform?.toUpperCase()] || '#6366f1';
}

export function getPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    INSTAGRAM: 'Instagram',
    FACEBOOK:  'Facebook',
    YOUTUBE:   'YouTube',
    LINKEDIN:  'LinkedIn',
    THREADS:   'Threads',
    GOOGLE_BUSINESS: 'Google Business',
  };
  return labels[platform?.toUpperCase()] || platform;
}

// ── File helpers ──────────────────────────────────────────────
export function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function isVideoFile(filename: string): boolean {
  return /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(filename);
}

export function isImageFile(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(filename);
}

// ── String helpers ────────────────────────────────────────────
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength)}...`;
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Debounce ──────────────────────────────────────────────────
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ── Copy to clipboard ─────────────────────────────────────────
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Day of week label ─────────────────────────────────────────
export function getDayLabel(day: number): string {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day] || '';
}

export function getHourLabel(hour: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}:00 ${ampm}`;
}
