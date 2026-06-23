import clsx from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'instagram' | 'facebook' | 'youtube' | 'linkedin' | 'threads' | 'google_business';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  const variants = {
    default:   'bg-surface-border text-text-secondary',
    success:   'bg-success/15 text-success',
    warning:   'bg-warning/15 text-warning',
    error:     'bg-error/15 text-error',
    info:      'bg-info/15 text-info',
    instagram: 'bg-pink-500/15 text-pink-400',
    facebook:  'bg-blue-500/15 text-blue-400',
    youtube:   'bg-red-500/15 text-red-400',
    linkedin:  'bg-sky-500/15 text-sky-400',
    threads:   'bg-slate-500/15 text-slate-100',
    google_business: 'bg-emerald-500/15 text-emerald-400',
  };

  const sizes = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
  };

  return (
    <span className={clsx('inline-flex items-center font-medium rounded-full', variants[variant], sizes[size], className)}>
      {children}
    </span>
  );
}

export function PlatformBadge({ platform }: { platform: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    INSTAGRAM:       { label: 'Instagram',       variant: 'instagram' },
    FACEBOOK:        { label: 'Facebook',        variant: 'facebook' },
    YOUTUBE:         { label: 'YouTube',         variant: 'youtube' },
    LINKEDIN:        { label: 'LinkedIn',        variant: 'linkedin' },
    THREADS:         { label: 'Threads',         variant: 'threads' },
    GOOGLE_BUSINESS: { label: 'Google Business', variant: 'google_business' },
  };
  const config = map[platform?.toUpperCase()] || { label: platform, variant: 'default' };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function StateBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    QUEUE:     { label: 'Scheduled', variant: 'info' },
    PUBLISHED: { label: 'Published', variant: 'success' },
    ERROR:     { label: 'Failed',    variant: 'error' },
    DRAFT:     { label: 'Draft',     variant: 'default' },
  };
  const config = map[state] || { label: state, variant: 'default' };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
