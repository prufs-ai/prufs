import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/auth'
import { apiFetch } from '../lib/api'

// --- Types ---

interface AuditEntry {
  audit_id: string
  timestamp: string
  actor_id: string
  actor_email: string
  action: string
  resource_type: string
  resource_id: string
  ip_address?: string
  metadata?: Record<string, unknown>
}

interface AuditPage {
  entries: AuditEntry[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

// --- Constants ---

const ACTION_CATEGORIES: Record<string, string> = {
  'commit.create': 'commit',
  'commit.verify': 'commit',
  'commit.delete': 'commit',
  'trail.create': 'trail',
  'trail.export': 'trail',
  'api_key.create': 'key',
  'api_key.revoke': 'key',
  'signing_key.register': 'key',
  'signing_key.delete': 'key',
  'member.invite': 'team',
  'member.remove': 'team',
  'member.join': 'team',
  'invite.revoke': 'team',
  'org.update': 'org',
  'settings.update': 'org',
}

const CATEGORY_COLORS: Record<string, string> = {
  commit: 'bg-blue-900/40 text-blue-300',
  trail: 'bg-purple-900/40 text-purple-300',
  key: 'bg-yellow-900/40 text-yellow-300',
  team: 'bg-green-900/40 text-green-400',
  org: 'bg-gray-700/60 text-gray-400',
}

const PAGE_SIZE = 25

// --- Helpers ---

function actionCategory(action: string): string {
  return ACTION_CATEGORIES[action] || 'org'
}

function formatTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }
}

// --- Components ---

function ActionBadge({ action }: { action: string }) {
  const cat = actionCategory(action)
  const colorClass = CATEGORY_COLORS[cat] || 'bg-gray-700 text-gray-400'
  return (
    <span className={'inline-block px-2 py-0.5 text-xs font-mono rounded ' + colorClass}>
      {action}
    </span>
  )
}

interface MetadataDrawerProps {
  entry: AuditEntry
  onClose: () => void
}

function MetadataDrawer({ entry, onClose }: MetadataDrawerProps) {
  const ts = formatTimestamp(entry.timestamp)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg bg-[#0D1B2A] border border-gray-700 rounded-xl p-6 space-y-4 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Audit entry</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-sm">✕</button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500">Timestamp</p>
              <p className="text-gray-300">{ts.date}</p>
              <p className="text-gray-400 text-xs font-mono">{ts.time}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Actor</p>
              <p className="text-gray-300">{entry.actor_email}</p>
              <p className="text-gray-500 text-xs font-mono">{entry.actor_id.slice(0, 12)}…</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Action</p>
              <ActionBadge action={entry.action} />
            </div>
            <div>
              <p className="text-xs text-gray-500">Resource</p>
              <p className="text-gray-300">{entry.resource_type}</p>
              <p className="text-gray-500 text-xs font-mono">{entry.resource_id.slice(0, 16)}…</p>
            </div>
          </div>
          {entry.ip_address && (
            <div>
              <p className="text-xs text-gray-500">IP address</p>
              <p className="font-mono text-gray-300 text-xs">{entry.ip_address}</p>
            </div>
          )}
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Metadata</p>
              <pre className="text-xs font-mono text-green-400 bg-black/40 border border-gray-700 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500">Audit ID</p>
            <p className="font-mono text-gray-500 text-xs">{entry.audit_id}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Main Audit Page ---

export default function Audit() {
  const orgSlug = useAuthStore((s) => s.orgSlug)
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null)

  const { data: auditPage, isLoading, isFetching } = useQuery({
    queryKey: ['audit', orgSlug, page, actionFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
      })
      if (actionFilter !== 'all') params.set('action', actionFilter)
      return apiFetch<AuditPage>('/v1/audit?' + params.toString())
    },
    placeholderData: (prev) => prev,
  })

  const filteredEntries = auditPage?.entries.filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.actor_email.toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      e.resource_type.toLowerCase().includes(q) ||
      e.resource_id.toLowerCase().includes(q)
    )
  })

  const totalPages = auditPage ? Math.ceil(auditPage.total / PAGE_SIZE) : 1

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Audit log</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {auditPage ? auditPage.total.toLocaleString() + ' events recorded' : 'All org-level activity, immutable.'}
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search actor, action, resource…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-navy-light/40 border border-gray-700 rounded-md text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
          className="bg-navy-light/40 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none"
        >
          <option value="all">All actions</option>
          <option value="commit">Commits</option>
          <option value="trail">Trails</option>
          <option value="key">Keys</option>
          <option value="team">Team</option>
          <option value="org">Org</option>
        </select>
      </div>

      {/* Table */}
      <div className="border border-gray-700 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-6 py-12 text-center text-gray-500 text-sm">Loading audit log…</div>
        ) : filteredEntries && filteredEntries.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700 bg-navy-light/20">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-40">Time</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actor</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Resource</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry, i) => {
                const ts = formatTimestamp(entry.timestamp)
                return (
                  <tr
                    key={entry.audit_id}
                    className={'border-gray-700 hover:bg-navy-light/10 cursor-pointer transition-colors ' + (i < filteredEntries.length - 1 ? 'border-b' : '')}
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-400">{ts.date}</p>
                      <p className="text-xs font-mono text-gray-600">{ts.time}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-300">{entry.actor_email}</p>
                      {entry.ip_address && (
                        <p className="text-xs font-mono text-gray-600">{entry.ip_address}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ActionBadge action={entry.action} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-400">{entry.resource_type}</p>
                      <p className="text-xs font-mono text-gray-600">{entry.resource_id.slice(0, 16)}…</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-gray-600 hover:text-gray-400">›</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-12 text-center text-gray-500 text-sm">
            {search ? 'No entries match your search.' : 'No audit events recorded yet.'}
          </div>
        )}
      </div>

      {/* Pagination */}
      {auditPage && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Page {page} of {totalPages} &mdash; {auditPage.total.toLocaleString()} total events
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isFetching}
              className="px-3 py-1.5 bg-navy-light/40 border border-gray-700 rounded-md text-xs text-gray-400 hover:text-white disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={!auditPage.has_more || isFetching}
              className="px-3 py-1.5 bg-navy-light/40 border border-gray-700 rounded-md text-xs text-gray-400 hover:text-white disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selectedEntry && (
        <MetadataDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  )
}
