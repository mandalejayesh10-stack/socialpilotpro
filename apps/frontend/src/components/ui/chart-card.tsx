'use client';

import clsx from 'clsx';
import { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  data: Array<Record<string, any>>;
  type?: 'line' | 'bar';
  dataKeys: Array<{ key: string; color: string; label?: string }>;
  xKey?: string;
  loading?: boolean;
  height?: number;
  className?: string;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-3 shadow-card">
      <p className="text-xs text-text-muted mb-2">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-text-secondary">{entry.name || entry.dataKey}:</span>
          <span className="font-semibold text-text-primary">
            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export function ChartCard({
  title,
  subtitle,
  data,
  type = 'line',
  dataKeys,
  xKey = 'date',
  loading = false,
  height = 240,
  className,
}: ChartCardProps) {
  const safeData = useMemo(() => {
    return (Array.isArray(data) ? data : [])
      .filter((row) => row && row[xKey] !== undefined && row[xKey] !== null)
      .map((row) => {
        const clean = { ...row };
        for (const dk of dataKeys) {
          const n = Number(clean[dk.key] ?? 0);
          clean[dk.key] = Number.isFinite(n) ? n : 0;
        }
        return clean;
      });
  }, [data, dataKeys, xKey]);

  const hasRenderableData = safeData.some((row) =>
    dataKeys.some((dk) => Number(row[dk.key] || 0) !== 0),
  );

  if (loading) {
    return (
      <div className={clsx('bg-surface-card border border-surface-border rounded-2xl p-5', className)}>
        <div className="skeleton h-5 w-40 mb-2" />
        <div className="skeleton h-3 w-24 mb-6" />
        <div className="skeleton rounded-xl" style={{ height }} />
      </div>
    );
  }

  return (
    <div className={clsx('bg-surface-card border border-surface-border rounded-2xl p-5', className)}>
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>

      {safeData.length === 0 || !hasRenderableData ? (
        <div
          className="rounded-xl border border-surface-border bg-surface-hover/40 flex items-center justify-center"
          style={{ height }}
        >
          <div className="text-center px-4">
            <p className="text-sm font-medium text-text-secondary">No API data yet</p>
            <p className="text-xs text-text-muted mt-1">Sync analytics after connecting this account.</p>
          </div>
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={height}>
        {type === 'line' ? (
          <LineChart data={safeData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" vertical={false} />
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11, fill: '#9898b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => {
                if (typeof v === 'string' && v.includes('-')) {
                  const d = new Date(v);
                  if (Number.isNaN(d.getTime())) return v;
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }
                return v;
              }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9898b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
            />
            <Tooltip content={<CustomTooltip />} />
            {dataKeys.map((dk) => (
              <Line
                key={dk.key}
                type="monotone"
                dataKey={dk.key}
                name={dk.label || dk.key}
                stroke={dk.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={safeData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" vertical={false} />
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11, fill: '#9898b8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9898b8' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            {dataKeys.map((dk) => (
              <Bar
                key={dk.key}
                dataKey={dk.key}
                name={dk.label || dk.key}
                fill={dk.color}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
      )}
    </div>
  );
}
