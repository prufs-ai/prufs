import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/auth'
import { apiFetch } from '../lib/api'

interface Commit {
  commit_id: string
  agent_id: string
  branch: string
  signer_id: string
  timestamp: string
  verified: boolean
  message: string
}

interface UsageData {
  events_consumed: number
  events_cap: number
  tier: string
  reset_date: string
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-navy-light/30 border border-gray-700 rounded-xl p-5">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function StatusBadge({ verified }: { verified: boolean }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
      verified ? 'bg-success/20 text-green-400' : 'bg-danger/20 text-red-400'
    }`}>
      {verified ? 'Verified' : 'Failed'}
    </span>
  )
}

export default function Overview() {
  const orgSlug = useAuthStore((s) => s.orgSlug)

  const { data: commits, isLoading: commitsLoading } = useQuery({
    queryKey: ['commits', orgSlug],
    queryFn: () => apiFetch<Commit[]>(`/v1/log?limit=10`),
  })

  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ['usage', orgSlug],
    queryFn: () => apiFetch<UsageData>(`/v1/orgs/${orgSlug}/usage`),
  })

  const uniqueAgents = commits ? new Set(commits.map((c) => c.agent_id)).size : 0
  const verifiedRate = commits && commits.length > 0
    ? Math.round((commits.filter((c) => c.verified).length / commits.length) * 100)
    : 0
  const usagePercent = usage ? Math.round((usage.events_consumed / usage.events_cap) * 100) : 0

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Overview</h1>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Commits this month"
          value={commitsLoading ? '...' : commits?.length ?? 0}
        />
        <KpiCard
          label="Unique agents"
          value={commitsLoading ? '...' : uniqueAgents}
        />
        <KpiCard
          label="Verification rate"
          value={commitsLoading ? '...' : `${verifiedRate}%`}
        />
        <KpiCard
          label="Events consumed"
          value={usageLoading ? '...' : usage?.events_consumed ?? 0}
          sub={usage ? `of ${usage.events_cap.toLocaleString()} (${usage.tier})` : ''}
        />
      </div>

      {usage && (
        <div className="bg-navy-light/30 border border-gray-700 rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Usage</p>
          <div className="w-full bg-gray-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                usagePercent > 90 ? 'bg-danger' : usagePercent > 70 ? 'bg-warning' : 'bg-success'
              }`}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {usagePercent}% of {usage.tier} tier cap. Resets {usage.reset_date}.
          </p>
        </div>
      )}

      <div className="bg-navy-light/30 border border-gray-700 rounded-xl p-5">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Recent commits</p>
        {commitsLoading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : commits && commits.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-700">
                <th className="pb-2 font-medium">Commit</th>
                <th className="pb-2 font-medium">Agent</th>
                <th className="pb-2 font-medium">Branch</th>
                <th className="pb-2 font-medium">Signer</th>
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {commits.map((c) => (
                <tr key={c.commit_id} className="border-b border-gray-700/50 hover:bg-navy-light/20">
                  <td className="py-2 font-mono text-xs text-gray-300">{c.commit_id.slice(0, 8)}</td>
                  <td className="py-2 text-gray-400">{c.agent_id || 'human'}</td>
                  <td className="py-2 text-gray-400">{c.branch}</td>
                  <td className="py-2 text-gray-400">{c.signer_id?.slice(0, 12) ?? 'unsigned'}</td>
                  <td className="py-2 text-gray-500">{new Date(c.timestamp).toLocaleDateString()}</td>
                  <td className="py-2"><StatusBadge verified={c.verified} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500 text-sm">No commits yet. Push your first commit with the Prufs CLI or SDK.</p>
        )}
      </div>
    </div>
  )
}
