import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import Trails from './pages/Trails'
import Commits from './pages/Commits'
import Team from './pages/Team'
import Keys from './pages/Keys'
import Usage from './pages/Usage'
import Audit from './pages/Audit'
import Settings from './pages/Settings'
import Login from './pages/Login'
import { useAuthStore } from './stores/auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function ProtectedRoutes() {
  const apiKey = useAuthStore((s) => s.apiKey)
  const hasHydrated = useAuthStore((s) => s._hasHydrated)
  if (!hasHydrated) return null
  if (!apiKey) return <Navigate to="/login" replace />
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/trails" element={<Trails />} />
        <Route path="/commits" element={<Commits />} />
        <Route path="/team" element={<Team />} />
        <Route path="/keys" element={<Keys />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
