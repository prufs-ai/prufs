import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/auth'
import { apiFetch } from '../lib/api'

// --- Types ---

interface Member {
  member_id: string
  user_id: string
  email: string
  display_name: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  joined_at: string
  last_active?: string
}

interface Invite {
  invite_id: string
  email: string
  role: 'admin' | 'member' | 'viewer'
  invited_at: string
  expires_at: string
}

interface InvitePayload {
  email: string
  role: 'admin' | 'member' | 'viewer'
}

// --- Constants ---

const ROLE_OPTIONS: Array<'admin' | 'member' | 'viewer'> = ['admin', 'member', 'viewer']

// --- Components ---

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    owner: 'bg-purple-900/40 text-purple-300',
    admin: 'bg-blue-900/40 text-blue-300',
    member: 'bg-green-900/40 text-green-400',
    viewer: 'bg-gray-700/60 text-gray-400',
  }
  return (
    <span className={'inline-block px-2 py-0.5 text-xs font-medium rounded-full ' + (styles[role] || 'bg-gray-700 text-gray-400')}>
      {role}
    </span>
  )
}

function InviteModal({
  onClose,
  orgSlug,
}: {
  onClose: () => void
  orgSlug: string | null
}) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member')
  const [error, setError] = useState<string | null>(null)

  const inviteMutation = useMutation({
    mutationFn: (payload: InvitePayload) =>
      apiFetch<Invite>('/v1/invites', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites', orgSlug] })
      onClose()
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to send invite.')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    inviteMutation.mutate({ email: email.trim(), role })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md bg-[#0D1B2A] border border-gray-700 rounded-xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Invite team member</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-sm">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full px-3 py-2 bg-navy-light/40 border border-gray-700 rounded-md text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'member' | 'viewer')}
              className="w-full bg-navy-light/40 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-300 focus:outline-none"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={inviteMutation.isPending}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-sm font-medium text-white transition-colors"
            >
              {inviteMutation.isPending ? 'Sending…' : 'Send invite'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-navy-light/40 border border-gray-700 rounded-md text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// --- Main Team Page ---

export default function Team() {
  const orgSlug = useAuthStore((s) => s.orgSlug)
  const queryClient = useQueryClient()
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['members', orgSlug],
    queryFn: () => apiFetch<Member[]>('/v1/members'),
  })

  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ['invites', orgSlug],
    queryFn: () => apiFetch<Invite[]>('/v1/invites'),
  })

  const removeMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiFetch<void>('/v1/members/' + memberId, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', orgSlug] })
      setRemovingId(null)
    },
  })

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) =>
      apiFetch<void>('/v1/invites/' + inviteId, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites', orgSlug] })
    },
  })

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function formatRelative(iso: string) {
    const d = new Date(iso)
    const now = Date.now()
    const diff = now - d.getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 30) return days + ' days ago'
    return formatDate(iso)
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Team</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage members and pending invitations.</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors"
        >
          + Invite member
        </button>
      </div>

      {/* Members table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Members</h2>
        <div className="border border-gray-700 rounded-xl overflow-hidden">
          {membersLoading ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">Loading members…</div>
          ) : members && members.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-navy-light/20">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Member</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Last active</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <tr
                    key={m.member_id}
                    className={'border-gray-700 ' + (i < members.length - 1 ? 'border-b' : '')}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-white font-medium">{m.display_name}</p>
                        <p className="text-xs text-gray-500">{m.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={m.role} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {formatDate(m.joined_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {m.last_active ? formatRelative(m.last_active) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m.role !== 'owner' && (
                        removingId === m.member_id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-gray-400">Remove?</span>
                            <button
                              onClick={() => removeMutation.mutate(m.member_id)}
                              disabled={removeMutation.isPending}
                              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setRemovingId(null)}
                              className="text-xs text-gray-500 hover:text-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRemovingId(m.member_id)}
                            className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                          >
                            Remove
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">No members found.</div>
          )}
        </div>
      </section>

      {/* Pending invites */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Pending invitations</h2>
        <div className="border border-gray-700 rounded-xl overflow-hidden">
          {invitesLoading ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">Loading invitations…</div>
          ) : invites && invites.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-navy-light/20">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Invited</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Expires</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {invites.map((inv, i) => (
                  <tr
                    key={inv.invite_id}
                    className={'border-gray-700 ' + (i < invites.length - 1 ? 'border-b' : '')}
                  >
                    <td className="px-4 py-3 text-sm text-gray-300">{inv.email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={inv.role} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{formatDate(inv.invited_at)}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">{formatDate(inv.expires_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => revokeInviteMutation.mutate(inv.invite_id)}
                        disabled={revokeInviteMutation.isPending}
                        className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">No pending invitations.</div>
          )}
        </div>
      </section>

      {showInviteModal && (
        <InviteModal orgSlug={orgSlug} onClose={() => setShowInviteModal(false)} />
      )}
    </div>
  )
}
