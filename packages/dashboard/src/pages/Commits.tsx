import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/auth'
import { apiFetch } from '../lib/api'

interface Commit {
  commit_id: string
  message: string
  agent_id: string
  model_id: string
  parent_hash: string
  timestamp: string
  verified: boolean
  signer_id: string
  branch: string
  trail_id?: string
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

export default function Commits() {
  const orgSlug = useAuthStore((s) => s.orgSlug)
  const [branch, setBranch] = useState('main')
  const [selected, setSelected] = useState<Commit | null>(null)

  const { data: branches } = useQuery({
    queryKey: ['branches', orgSlug],
    queryFn: () => apiFetch<string[]>(`/v1/branches`),
  })

  const { data: commits, isLoading } = useQuery({
    queryKey: ['commits', orgSlug, branch],
    queryFn: () => apiFetch<Commit[]>(`/v1/log?branch=${branch}`),
  })

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">Commits</h1>
          <div className="flex items-center gap-3">
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="bg-navy-light/40 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-navy-light"
            >
              {branches ? branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              )) : (
                <option value="main">main</option>
              )}
            </select>
            <button className="px-3 py-1.5 text-sm bg-navy-light/40 border border-gray-700 rounded-md text-gray-400 hover:text-white transition-colors">
              Sweep chain
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-gray-500 text-sm">Loading commits...</p>
        ) : commits && commits.length > 0 ? (
          <div className="space-y-1">
            {commits.map((c) => (
              <button
                key={c.commit_id}
                onClick={() => setSelected(c)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  selected?.commit_id === c.commit_id
                    ? 'border-navy-light bg-navy-light/30'
                    : 'border-transparent hover:bg-navy-light/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-gray-300">{c.commit_id.slice(0, 8)}</span>
                    <span className="text-sm text-white truncate max-w-md">{c.message}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{c.agent_id || 'human'}</span>
                    <StatusBadge verified={c.verified} />
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-1">
                  <span className="text-xs text-gray-500">parent: {c.parent_hash?.slice(0, 8) ?? 'none'}</span>
                  <span className="text-xs text-gray-500">{new Date(c.timestamp).toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No commits on branch {branch}.</p>
        )}
      </div>

      {selected && (
        <div className="w-96 flex-shrink-0 bg-navy-light/30 border border-gray-700 rounded-xl p-5 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Commit detail</h2>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-500 hover:text-white text-sm"
            >
              Close
            </button>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Commit ID</p>
              <p className="font-mono text-gray-300">{selected.commit_id}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Message</p>
              <p className="text-gray-300">{selected.message}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-gray-500 text-xs">Agent</p>
                <p className="text-gray-300">{selected.agent_id || 'human'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Model</p>
                <p className="text-gray-300">{selected.model_id || 'n/a'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-gray-500 text-xs">Signer</p>
                <p className="font-mono text-gray-300 text-xs">{selected.signer_id || 'unsigned'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Verified</p>
                <StatusBadge verified={selected.verified} />
              </div>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Parent</p>
              <p className="font-mono text-gray-300 text-xs">{selected.parent_hash || 'root'}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Timestamp</p>
              <p className="text-gray-300">{new Date(selected.timestamp).toLocaleString()}</p>
            </div>
            {selected.trail_id && (
              <a
                href={"/trails?id=" + selected.trail_id}
                className="block text-sm text-blue-400 hover:text-blue-300"
              >
                View trail →
              </a>
            )}
          </div>

          <div>
            <p className="text-gray-500 text-xs mb-2">Raw JSON</p>
            <pre className="bg-navy/50 border border-gray-700 rounded-md p-3 text-xs text-gray-400 overflow-x-auto font-mono">
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
