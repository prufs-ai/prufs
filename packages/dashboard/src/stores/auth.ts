import { create } from "zustand"
import { persist } from "zustand/middleware"

interface AuthState {
  apiKey: string | null
  orgSlug: string | null
  _hasHydrated: boolean
  setAuth: (apiKey: string, orgSlug: string) => void
  logout: () => void
  setHasHydrated: (v: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      apiKey: null,
      orgSlug: null,
      _hasHydrated: false,
      setAuth: (apiKey, orgSlug) => set({ apiKey, orgSlug }),
      logout: () => set({ apiKey: null, orgSlug: null }),
      setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      name: "prufs-auth",
      onRehydrateStorage: () => (state) => { state?.setHasHydrated(true) },
    }
  )
)
