import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'

export default function Login() {
  const [key, setKey] = useState('')
  const [org, setOrg] = useState('')
  const [error, setError] = useState('')
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch(`https://api.prufs.ai/health`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (!res.ok) throw new Error('Invalid API key')
      setAuth(key, org)
      navigate('/')
    } catch {
      setError('Could not authenticate. Check your API key and try again.')
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-navy">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-white tracking-wide">Prufs</h1>
        <p className="text-sm text-gray-400">Sign in with your API key</p>
        <input
          type="text"
          placeholder="Organization slug"
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          required
          className="w-full px-3 py-2 bg-navy-light/40 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-navy-light"
        />
        <input
          type="password"
          placeholder="prfs_..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
          className="w-full px-3 py-2 bg-navy-light/40 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-navy-light"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          className="w-full py-2 bg-navy-light text-white font-medium rounded-md hover:bg-navy-light/80 transition-colors"
        >
          Sign in
        </button>
      </form>
    </div>
  )
}
