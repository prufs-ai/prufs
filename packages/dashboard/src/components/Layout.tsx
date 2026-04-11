import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import type { ReactNode } from 'react'

const navItems = [
  { to: '/', label: 'Overview' },
  { to: '/trails', label: 'Trails' },
  { to: '/commits', label: 'Commits' },
  { to: '/team', label: 'Team' },
  { to: '/keys', label: 'Keys' },
  { to: '/usage', label: 'Usage' },
  { to: '/audit', label: 'Audit' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const orgSlug = useAuthStore((s) => s.orgSlug)
  const logout = useAuthStore((s) => s.logout)

  return (
    <div className="flex h-screen bg-navy text-gray-200 font-sans">
      <nav className="w-56 flex-shrink-0 border-r border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <span className="text-lg font-bold tracking-wide text-white">Prufs</span>
          {orgSlug && (
            <span className="block text-xs text-gray-400 mt-1">{orgSlug}</span>
          )}
        </div>
        <ul className="flex-1 py-2">
          {navItems.map(({ to, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `block px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-navy-light text-white font-medium'
                      : 'text-gray-400 hover:text-white hover:bg-navy-light/40'
                  }`
                }
              >
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
        <button
          onClick={logout}
          className="m-4 px-3 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors"
        >
          Sign out
        </button>
      </nav>
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  )
}
