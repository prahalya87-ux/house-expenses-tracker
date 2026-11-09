import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL ?? ''

interface BackendOptions {
  method?: string
  body?: string
}

export async function backend<T>(path: string, init: BackendOptions = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  let response: Response
  try {
    response = await fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
  } catch {
    throw new Error(`Cannot reach the analytics backend at ${API_URL}. Is it running?`)
  }

  if (!response.ok) {
    let detail = response.statusText
    try {
      const body: unknown = await response.json()
      if (typeof body === 'object' && body !== null && 'detail' in body) {
        const value = body.detail
        detail = typeof value === 'string' ? value : JSON.stringify(value)
      }
    } catch {
      // Keep the HTTP status text when the server does not return JSON.
    }
    throw new Error(detail)
  }

  return (await response.json()) as T
}
