import clsx from 'clsx';
import type { CSSProperties } from 'react';

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={clsx('skeleton', className)} style={style} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <Skeleton className="h-5 w-40 mb-2" />
      <Skeleton className="h-3 w-24 mb-6" />
      <Skeleton className="rounded-xl" style={{ height }} />
    </div>
  );
}
