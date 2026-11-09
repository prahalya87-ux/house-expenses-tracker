import { backend } from './backend'
import { supabase } from './supabase'

export type WasteStatus = 'open' | 'reviewed' | 'dismissed'
export type WasteType = 'repeat_purchase' | 'delivery_frequency' | 'subscription_review' | 'non_essential_growth'

export interface WasteFinding {
  id: string
  status: WasteStatus
  finding_type: WasteType
  title: string
  explanation: string
  category: string | null
  period_start: string
  period_end: string
  occurrences: number
  total_amount: number
  potential_savings: number | null
  evidence: { label: string; amount: number }[]
  created_at: string
}

export interface WasteRun {
  run_id: string
  message: string | null
  expense_count: number
  finding_count: number
}

export const runWaste = () => backend<WasteRun>('/waste/run', { method: 'POST' })

export const listWaste = (status?: WasteStatus) =>
  backend<WasteFinding[]>(`/waste${status ? `?status=${status}` : ''}`)

export const setWasteStatus = (id: string, status: WasteStatus) =>
  backend<unknown>(`/waste/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })

export async function openWasteSummary(): Promise<{ count: number; total: number }> {
  const { data, error } = await supabase.from('waste_findings').select('potential_savings').eq('status', 'open')
  if (error) throw error
  const rows = data ?? []
  return { count: rows.length, total: rows.reduce((s, r) => s + Number(r.potential_savings ?? 0), 0) }
}