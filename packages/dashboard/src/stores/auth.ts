import { create } from 'zustand'

interface AuthState {
  apiKey: string | null
  orgSlug: string | null
  setAuth: (apiKey: string, orgSlug: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  apiKey: null,
  orgSlug: null,
  setAuth: (apiKey, orgSlug) => set({ apiKey, orgSlug }),
  logout: () => set({ apiKey: null, orgSlug: null }),
}))
