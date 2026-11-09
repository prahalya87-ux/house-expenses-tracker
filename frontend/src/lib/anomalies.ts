import { backend } from './backend'
import { supabase } from './supabase'

export type Severity = 'low' | 'medium' | 'high'
export type AnomalyStatus = 'open' | 'reviewed' | 'dismissed'

export interface Anomaly {
  id: string
  status: AnomalyStatus
  severity: Severity
  reason_type: string
  detection_method: 'isolation_forest' | 'rule'
  anomaly_score: number | null
  baseline_amount: number | null
  difference_amount: number | null
  reason: string
  detected_at: string
  transaction: {
    id: string
    txn_date: string
    amount: number
    merchant: string | null
    description: string | null
    category: string
  } | null
}

export interface RunResult {
  run_id: string
  model_ran: boolean
  message: string | null
  expense_count: number
  detected_count: number
}

export const runDetection = () => backend<RunResult>('/anomalies/run', { method: 'POST' })

export const listAnomalies = (status?: AnomalyStatus) =>
  backend<Anomaly[]>(`/anomalies${status ? `?status=${status}` : ''}`)

export const setAnomalyStatus = (id: string, status: AnomalyStatus) =>
  backend<unknown>(`/anomalies/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })

export async function countOpenAnomalies(): Promise<number> {
  const { count, error } = await supabase
    .from('anomaly_detections')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
  if (error) throw error
  return count ?? 0
}