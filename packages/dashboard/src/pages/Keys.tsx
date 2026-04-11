import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/auth'
import { apiFetch } from '../lib/api'

// --- Types ---

interface ApiKey {
  key_id: string
  name: string
  prefix: string
  created_at: string
  last_used_at?: string
  revoked: boolean
}

interface NewApiKeyResponse {
  key_id: string
  name: string
  prefix: string
  secret: string // returned once only
  created_at: string
}

interface SigningKey {
  signing_key_id: string
  fingerprint: string
  algorithm: string
  public_key: string
  label?: string
  registered_at: string
  last_used_at?: string
}

interface CreateApiKeyPayload {
  name: string
}

interface RegisterSigningKeyPayload {
  public_key: string
  label?: string
}

// --- Components ---

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="text-xs text-gray-500 hover:text-blue-400 transition-colors ml-2"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function NewKeyBanner({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
  return (
    <div className="border border-yellow-600/50 bg-yellow-900/20 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-yellow-300">Save this key now — it will not be shown again.</p>
        <button onClick={onDismiss} className="text-gray-500 hover:text-white text-sm">✕</button>
      </div>
      <div className="flex items-center gap-2 bg-black/40 border border-gray-700 rounded-lg px-3 py-2">
        <code className="text-sm font-mono text-green-400 break-all flex-1">{secret}</code>
        <CopyButton value={secret} />
      </div>
    </div>
  )
}

// --- Main Keys Page ---

export default function Keys() {
  const orgSlug = useAuthStore((s) => s.orgSlug)
  const queryClient = useQueryClient()

  // API key state
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null)
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null)
  const [showCreateApiKey, setShowCreateApiKey] = useState(false)

  // Signing key state
  const [signingKeyLabel, setSigningKeyLabel] = useState('')
  const [signingKeyPem, setSigningKeyPem] = useState('')
  const [showRegisterSigning, setShowRegisterSigning] = useState(false)
  const [signingError, setSigningError] = useState<string | null>(null)

  // --- Queries ---

  const { data: apiKeys, isLoading: apiKeysLoading } = useQuery({
    queryKey: ['api-keys', orgSlug],
    queryFn: () => apiFetch<ApiKey[]>('/v1/api-keys'),
  })

  const { data: signingKeys, isLoading: signingKeysLoading } = useQuery({
    queryKey: ['signing-keys', orgSlug],
    queryFn: () => apiFetch<SigningKey[]>('/v1/signing-keys'),
  })

  // --- Mutations ---

  const createApiKeyMutation = useMutation({
    mutationFn: (payload: CreateApiKeyPayload) =>
      apiFetch<NewApiKeyResponse>('/v1/api-keys', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys', orgSlug] })
      setNewKeySecret(data.secret)
      setNewKeyName('')
      setShowCreateApiKey(false)
    },
  })

  const revokeApiKeyMutation = useMutation({
    mutationFn: (keyId: string) =>
      apiFetch<void>('/v1/api-keys/' + keyId, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys', orgSlug] })
      setRevokingKeyId(null)
    },
  })

  const registerSigningKeyMutation = useMutation({
    mutationFn: (payload: RegisterSigningKeyPayload) =>
      apiFetch<SigningKey>('/v1/signing-keys', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signing-keys', orgSlug] })
      setSigningKeyPem('')
      setSigningKeyLabel('')
      setShowRegisterSigning(false)
      setSigningError(null)
    },
    onError: (err: Error) => {
      setSigningError(err.message || 'Failed to register signing key.')
    },
  })

  const deleteSigningKeyMutation = useMutation({
    mutationFn: (signingKeyId: string) =>
      apiFetch<void>('/v1/signing-keys/' + signingKeyId, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signing-keys', orgSlug] })
    },
  })

  // --- Helpers ---

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

  function handleCreateApiKey(e: React.FormEvent) {
    e.preventDefault()
    if (!newKeyName.trim()) return
    createApiKeyMutation.mutate({ name: newKeyName.trim() })
  }

  function handleRegisterSigning(e: React.FormEvent) {
    e.preventDefault()
    setSigningError(null)
    if (!signingKeyPem.trim()) {
      setSigningError('Public key is required.')
      return
    }
    registerSigningKeyMutation.mutate({
      public_key: signingKeyPem.trim(),
      label: signingKeyLabel.trim() || undefined,
    })
  }

  return (
    <div className="space-y-10 max-w-4xl">
      {/* ─── API Keys ─── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">API keys</h1>
            <p className="text-sm text-gray-500 mt-0.5">Used to authenticate SDK and CLI requests against your org.</p>
          </div>
          <button
            onClick={() => { setShowCreateApiKey((v) => !v); setNewKeySecret(null) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors"
          >
            + Create key
          </button>
        </div>

        {/* New key banner */}
        {newKeySecret && (
          <NewKeyBanner secret={newKeySecret} onDismiss={() => setNewKeySecret(null)} />
        )}

        {/* Create form */}
        {showCreateApiKey && (
          <form
            onSubmit={handleCreateApiKey}
            className="flex items-center gap-3 border border-gray-700 bg-navy-light/20 rounded-xl px-4 py-3"
          >
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. CI/CD, local-dev)"
              className="flex-1 bg-transparent border-b border-gray-700 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 py-1"
            />
            <button
              type="submit"
              disabled={createApiKeyMutation.isPending || !newKeyName.trim()}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-sm font-medium text-white transition-colors"
            >
              {createApiKeyMutation.isPending ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateApiKey(false)}
              className="text-gray-500 hover:text-white text-sm"
            >
              Cancel
            </button>
          </form>
        )}

        {/* API key table */}
        <div className="border border-gray-700 rounded-xl overflow-hidden">
          {apiKeysLoading ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">Loading API keys…</div>
          ) : apiKeys && apiKeys.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-navy-light/20">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Key prefix</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Last used</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((k, i) => (
                  <tr
                    key={k.key_id}
                    className={'border-gray-700 ' + (k.revoked ? 'opacity-50 ' : '') + (i < apiKeys.length - 1 ? 'border-b' : '')}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm text-white">{k.name}</p>
                      {k.revoked && <span className="text-xs text-red-400">revoked</span>}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-gray-400 bg-black/30 px-2 py-0.5 rounded">
                        {k.prefix}…
                      </code>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{formatDate(k.created_at)}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {k.last_used_at ? formatRelative(k.last_used_at) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!k.revoked && (
                        revokingKeyId === k.key_id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-gray-400">Revoke?</span>
                            <button
                              onClick={() => revokeApiKeyMutation.mutate(k.key_id)}
                              disabled={revokeApiKeyMutation.isPending}
                              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setRevokingKeyId(null)}
                              className="text-xs text-gray-500 hover:text-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRevokingKeyId(k.key_id)}
                            className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                          >
                            Revoke
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">No API keys yet. Create one to authenticate SDK and CLI requests.</div>
          )}
        </div>
      </section>

      {/* ─── Signing Keys ─── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Signing keys</h2>
            <p className="text-sm text-gray-500 mt-0.5">Ed25519 public keys registered to verify commit signatures from your agents.</p>
          </div>
          <button
            onClick={() => { setShowRegisterSigning((v) => !v); setSigningError(null) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors"
          >
            + Register key
          </button>
        </div>

        {/* Register signing key form */}
        {showRegisterSigning && (
          <form
            onSubmit={handleRegisterSigning}
            className="border border-gray-700 bg-navy-light/20 rounded-xl p-4 space-y-4"
          >
            <div>
              <label className="block text-xs text-gray-500 mb-1">Label (optional)</label>
              <input
                type="text"
                value={signingKeyLabel}
                onChange={(e) => setSigningKeyLabel(e.target.value)}
                placeholder="e.g. deployment-agent, local-dev"
                className="w-full px-3 py-2 bg-navy-light/40 border border-gray-700 rounded-md text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ed25519 public key (PEM or raw base64)</label>
              <textarea
                value={signingKeyPem}
                onChange={(e) => setSigningKeyPem(e.target.value)}
                rows={4}
                placeholder="-----BEGIN PUBLIC KEY-----&#10;MCowBQYDK2VdAy...&#10;-----END PUBLIC KEY-----"
                className="w-full px-3 py-2 bg-navy-light/40 border border-gray-700 rounded-md text-xs font-mono text-green-400 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            {signingError && <p className="text-xs text-red-400">{signingError}</p>}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={registerSigningKeyMutation.isPending || !signingKeyPem.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-sm font-medium text-white transition-colors"
              >
                {registerSigningKeyMutation.isPending ? 'Registering…' : 'Register'}
              </button>
              <button
                type="button"
                onClick={() => { setShowRegisterSigning(false); setSigningError(null) }}
                className="px-4 py-2 bg-navy-light/40 border border-gray-700 rounded-md text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Signing key list */}
        <div className="border border-gray-700 rounded-xl overflow-hidden">
          {signingKeysLoading ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">Loading signing keys…</div>
          ) : signingKeys && signingKeys.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-navy-light/20">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Fingerprint</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Label</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Algorithm</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Registered</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Last used</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {signingKeys.map((sk, i) => (
                  <tr
                    key={sk.signing_key_id}
                    className={'border-gray-700 ' + (i < signingKeys.length - 1 ? 'border-b' : '')}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <code className="text-xs font-mono text-blue-400 bg-blue-900/20 px-2 py-0.5 rounded">
                          {sk.fingerprint}
                        </code>
                        <CopyButton value={sk.fingerprint} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{sk.label || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-gray-400 bg-gray-700/40 px-2 py-0.5 rounded">
                        {sk.algorithm}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{formatDate(sk.registered_at)}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {sk.last_used_at ? formatRelative(sk.last_used_at) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteSigningKeyMutation.mutate(sk.signing_key_id)}
                        disabled={deleteSigningKeyMutation.isPending}
                        className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">
              No signing keys registered. Register an Ed25519 public key to enable verified commits.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
