import { useAuthStore } from '../stores/auth'

const BASE_URL = 'https://api.prufs.ai'

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const apiKey = useAuthStore.getState().apiKey
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...options?.headers,
    },
  })
  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().logout()
    }
    throw new Error(`API error: ${res.status}`)
  }
  return res.json()
}
