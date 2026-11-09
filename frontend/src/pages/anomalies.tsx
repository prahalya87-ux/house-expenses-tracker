import { useCallback, useEffect, useState } from 'react'
import { listAnomalies, runDetection, setAnomalyStatus } from '../lib/anomalies'
import type { Anomaly, AnomalyStatus, RunResult, Severity } from '../lib/anomalies'
import { errMsg, formatINR } from '../lib/format'

const TABS: AnomalyStatus[] = ['open', 'reviewed', 'dismissed']

const BADGE: Record<Severity, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-200 text-slate-700',
}

const TYPE_LABEL: Record<string, string> = {
  high_amount: 'High amount',
  category_spike: 'Monthly category spike',
  frequency: 'Unusual frequency',
  utility_spike: 'Utility bill increase',
  grocery_spike: 'Unusual grocery spend',
  duplicate: 'Possible duplicate',
  other: 'Other',
}

export default function Anomalies() {
  const [tab, setTab] = useState<AnomalyStatus>('open')
  const [items, setItems] = useState<Anomaly[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await listAnomalies(tab))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void load()
  }, [load])

  async function doRun() {
    setRunning(true)
    setError(null)
    try {
      setRun(await runDetection())
      setTab('open')
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setRunning(false)
    }
  }

  async function mark(a: Anomaly, status: AnomalyStatus) {
    try {
      await setAnomalyStatus(a.id, status)
      await load()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Unusual spending</h1>
          <p className="text-sm text-slate-500">
            Each transaction is compared with its own category's history. Findings are items to review, not conclusions.
          </p>
        </div>
        <button
          onClick={() => void doRun()}
          disabled={running}
          className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {running ? 'Analysing…' : 'Run detection'}
        </button>
      </div>

      {run && (
        <div className={`rounded-lg px-4 py-3 text-sm border ${run.model_ran ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          Analysed {run.expense_count} expense transactions and found {run.detected_count} item(s) to review.
          {run.message && <div className="mt-1">{run.message}</div>}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-sm capitalize ${tab === t ? 'bg-slate-800 text-white' : 'bg-white border border-slate-300 hover:bg-slate-100'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-left">
            <tr>
              <th className="px-3 py-2">Transaction</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Normal baseline</th>
              <th className="px-3 py-2 text-right">Difference</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Why it was flagged</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  {tab === 'open' ? 'Nothing to review. Click "Run detection" to analyse your transactions.' : `No ${tab} items.`}
                </td>
              </tr>
            )}
            {!loading &&
              items.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.transaction?.category ?? 'Unknown'}</div>
                    <div className="text-slate-500 text-xs">
                      {a.transaction?.txn_date} {a.transaction?.merchant ? `· ${a.transaction.merchant}` : ''}
                    </div>
                    <div className="text-xs mt-1 inline-block bg-slate-100 rounded px-1.5 py-0.5">
                      {TYPE_LABEL[a.reason_type] ?? a.reason_type}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{a.transaction ? formatINR(a.transaction.amount) : '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{a.baseline_amount === null ? '—' : formatINR(a.baseline_amount)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{a.difference_amount === null ? '—' : formatINR(a.difference_amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.anomaly_score === null ? <span className="text-xs text-slate-500">rule-based</span> : a.anomaly_score.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${BADGE[a.severity]}`}>{a.severity}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600 min-w-64">{a.reason}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    {a.status === 'open' ? (
                      <>
                        <button className="text-emerald-700 hover:underline mr-3" onClick={() => void mark(a, 'reviewed')}>Reviewed</button>
                        <button className="text-slate-600 hover:underline" onClick={() => void mark(a, 'dismissed')}>Dismiss</button>
                      </>
                    ) : (
                      <button className="text-slate-600 hover:underline" onClick={() => void mark(a, 'open')}>Reopen</button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}