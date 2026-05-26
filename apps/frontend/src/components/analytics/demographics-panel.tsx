'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Globe2, MapPin } from 'lucide-react';

const COLORS = ['#818cf8', '#8fd0a4', '#f0a3df', '#eda92f', '#b985b3', '#aab7ff', '#ff765e', '#9aa6b2'];

type BreakdownItem = {
  label: string;
  value: number;
  percent: number;
};

export function DemographicsPanel({ data, loading }: { data?: any; loading?: boolean }) {
  const countries: BreakdownItem[] = data?.country || [];
  const cities: BreakdownItem[] = data?.city || [];
  const gender: BreakdownItem[] = data?.gender || [];
  const age: BreakdownItem[] = data?.age || [];
  const activeHours: BreakdownItem[] = data?.activeHours || [];
  const hasData = countries.length || cities.length || gender.length || age.length || activeHours.length;

  if (loading) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
        <div className="skeleton h-5 w-44 mb-5" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-72 rounded-xl" />
          <div className="skeleton h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Audience Demographics</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {data?.syncedAt ? `Last synced ${new Date(data.syncedAt).toLocaleString()}` : 'Real platform audience insights'}
          </p>
        </div>
        <span className="text-xs text-text-muted">{data?.source || 'platform API'}</span>
      </div>

      {!hasData ? (
        <div className="rounded-xl border border-surface-border bg-surface-hover/40 py-12 text-center">
          <p className="text-sm font-medium text-text-secondary">No demographics available yet</p>
          <p className="text-xs text-text-muted mt-1">Platform APIs only return audience data after enough followers/viewers are available.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <BreakdownDonut title="Followers by country" icon={<Globe2 size={15} />} rows={countries} />
          <BreakdownTable title="Followers by city" icon={<MapPin size={15} />} rows={cities} />
          <MiniBreakdown title="Gender split" rows={gender} />
          <MiniBreakdown title="Age groups" rows={age} />
          <AudienceHeatmap rows={activeHours} />
        </div>
      )}
    </div>
  );
}

function AudienceHeatmap({ rows }: { rows: BreakdownItem[] }) {
  const byHour = new Map(rows.map((row) => [Number(String(row.label).replace(/\D/g, '')), row.percent || row.value]));
  const values = Array.from({ length: 24 }, (_, hour) => Number(byHour.get(hour) || 0));
  const max = Math.max(...values, 1);

  return (
    <div className="xl:col-span-2">
      <h4 className="text-sm font-semibold text-text-primary mb-4">Audience active hours</h4>
      {rows.length === 0 ? (
        <EmptyBlock compact />
      ) : (
        <div className="grid grid-cols-12 gap-1.5">
          {values.map((value, hour) => (
            <div key={hour} className="space-y-1">
              <div
                className="h-9 rounded-md border border-surface-border"
                style={{ background: `rgba(129, 140, 248, ${0.12 + (value / max) * 0.78})` }}
                title={`${hour}:00 - ${value.toFixed(1)}%`}
              />
              <p className="text-[10px] text-text-muted text-center">{hour}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BreakdownDonut({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: BreakdownItem[] }) {
  const topRows = rows.slice(0, 8);
  return (
    <div className="min-h-[280px]">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      </div>
      {topRows.length === 0 ? (
        <EmptyBlock />
      ) : (
        <div className="grid grid-cols-[minmax(180px,1fr)_minmax(160px,0.8fr)] gap-4 items-center">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={topRows}
                  dataKey="percent"
                  nameKey="label"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={1}
                  isAnimationActive={false}
                >
                  {topRows.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#17172a', border: '1px solid #2a2a45', borderRadius: 10 }}
                  formatter={(value: any) => [`${Number(value).toFixed(2)}%`, 'Share']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {topRows.map((row, index) => (
              <div key={row.label} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded" style={{ background: COLORS[index % COLORS.length] }} />
                <span className="text-text-secondary truncate flex-1">{row.label}</span>
                <span className="text-text-primary font-medium">{row.percent.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BreakdownTable({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: BreakdownItem[] }) {
  return (
    <div className="min-h-[280px]">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      </div>
      {rows.length === 0 ? (
        <EmptyBlock />
      ) : (
        <div className="rounded-xl border border-surface-border overflow-hidden">
          <div className="grid grid-cols-[1fr_90px] bg-surface-hover px-4 py-3 text-xs font-medium text-text-secondary">
            <span>Group</span>
            <span className="text-right">Count</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {rows.slice(0, 25).map((row) => (
              <div key={row.label} className="grid grid-cols-[1fr_90px] px-4 py-3 border-t border-surface-border text-sm">
                <span className="text-text-primary truncate">{row.label}</span>
                <span className="text-text-primary text-right">{row.percent.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniBreakdown({ title, rows }: { title: string; rows: BreakdownItem[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-text-primary mb-4">{title}</h4>
      {rows.length === 0 ? (
        <EmptyBlock compact />
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 8).map((row, index) => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-text-secondary">{row.label}</span>
                <span className="text-text-primary font-medium">{row.percent.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(row.percent, 100)}%`, background: COLORS[index % COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-hover/40 flex items-center justify-center" style={{ height: compact ? 130 : 220 }}>
      <p className="text-xs text-text-muted">Not returned by API yet</p>
    </div>
  );
}
