import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/auth'
import { apiFetch } from '../lib/api'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// --- Types ---

interface UsageHistory {
  date: string
  events: number
  commits: number
}

interface UsageSummary {
  org_slug: string
  tier: 'free' | 'starter' | 'pro' | 'enterprise'
  period_start: string
  period_end: string
  events_consumed: number
  events_limit: number
  commits_this_month: number
  commits_limit: number
  api_calls_today: number
  api_calls_limit: number
  storage_bytes: number
  storage_limit_bytes: number
  agents_active: number
  agents_limit: number
  history: UsageHistory[]
}

// --- Helpers ---

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// --- Components ---

function TierBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    free: 'bg-gray-700/60 text-gray-400',
    starter: 'bg-blue-900/40 text-blue-300',
    pro: 'bg-purple-900/40 text-purple-300',
    enterprise: 'bg-yellow-900/40 text-yellow-300',
  }
  return (
    <span className={'inline-block px-2.5 py-0.5 text-xs font-semibold rounded-full uppercase tracking-wider ' + (styles[tier] || 'bg-gray-700 text-gray-400')}>
      {tier}
    </span>
  )
}

interface GaugeProps {
  label: string
  used: number
  limit: number
  formatUsed?: (n: number) => string
  formatLimit?: (n: number) => string
}

function UsageGauge({ label, used, limit, formatUsed = fmtNum, formatLimit = fmtNum }: GaugeProps) {
  const p = pct(used, limit)
  const barColor = p >= 90 ? 'bg-red-500' : p >= 75 ? 'bg-yellow-500' : 'bg-blue-500'
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-sm text-gray-300">
          <span className="font-medium text-white">{formatUsed(used)}</span>
          <span className="text-gray-500"> / {formatLimit(limit)}</span>
        </span>
      </div>
      <div className="h-2 w-full bg-gray-700/60 rounded-full overflow-hidden">
        <div
          className={'h-full rounded-full transition-all duration-500 ' + barColor}
          style={{ width: p + '%' }}
        />
      </div>
      <div className="flex justify-end">
        <span className={'text-xs font-medium ' + (p >= 90 ? 'text-red-400' : p >= 75 ? 'text-yellow-400' : 'text-gray-500')}>
          {p}% used
        </span>
      </div>
    </div>
  )
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}

function ChartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-[#0D1B2A] border border-gray-700 rounded-lg px-3 py-2 text-xs space-y-1 shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-400">{entry.name}:</span>
          <span className="text-white font-medium">{fmtNum(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

// --- Main Usage Page ---

export default function Usage() {
  const orgSlug = useAuthStore((s) => s.orgSlug)

  const { data: usage, isLoading } = useQuery({
    queryKey: ['usage', orgSlug],
    queryFn: () => apiFetch<UsageSummary>('/v1/usage'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-gray-500 text-sm">Loading usage data…</p>
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-gray-500 text-sm">No usage data available.</p>
      </div>
    )
  }

  const chartData = usage.history.map((h) => ({
    ...h,
    date: fmtDate(h.date),
  }))

  const periodLabel =
    new Date(usage.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' – ' +
    new Date(usage.period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Usage</h1>
          <p className="text-sm text-gray-500 mt-0.5">Billing period: {periodLabel}</p>
        </div>
        <TierBadge tier={usage.tier} />
      </div>

      {/* Gauges */}
      <section className="bg-navy-light/20 border border-gray-700 rounded-xl p-6 space-y-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Current period</h2>
        <UsageGauge
          label="Events consumed"
          used={usage.events_consumed}
          limit={usage.events_limit}
        />
        <UsageGauge
          label="Commits this month"
          used={usage.commits_this_month}
          limit={usage.commits_limit}
        />
        <UsageGauge
          label="API calls today"
          used={usage.api_calls_today}
          limit={usage.api_calls_limit}
        />
        <UsageGauge
          label="Storage"
          used={usage.storage_bytes}
          limit={usage.storage_limit_bytes}
          formatUsed={fmtBytes}
          formatLimit={fmtBytes}
        />
        <UsageGauge
          label="Active agents"
          used={usage.agents_active}
          limit={usage.agents_limit}
        />
      </section>

      {/* Events over time chart */}
      <section className="bg-navy-light/20 border border-gray-700 rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Activity — last 30 days</h2>
        {chartData.length > 0 ? (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradEvents" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCommits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#6B7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#6B7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmtNum}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="events"
                  name="Events"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  fill="url(#gradEvents)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="commits"
                  name="Commits"
                  stroke="#10B981"
                  strokeWidth={2}
                  fill="url(#gradCommits)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-56 flex items-center justify-center">
            <p className="text-gray-500 text-sm">No activity data for this period.</p>
          </div>
        )}
        {/* Legend */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-blue-500 rounded" />
            <span className="text-xs text-gray-500">Events</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-emerald-500 rounded" />
            <span className="text-xs text-gray-500">Commits</span>
          </div>
        </div>
      </section>
    </div>
  )
}
