import { useCallback, useEffect, useState } from 'react'
import { errMsg, formatINR } from '../lib/format'
import { listWaste, runWaste, setWasteStatus } from '../lib/waste'
import type { WasteFinding, WasteStatus } from '../lib/waste'

type StatusFilter = WasteStatus | 'all'

const statuses: WasteStatus[] = ['open', 'reviewed', 'dismissed']

export default function Waste() {
  const [findings, setFindings] = useState<WasteFinding[]>([])
  const [filter, setFilter] = useState<StatusFilter>('open')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setFindings(await listWaste(filter === 'all' ? undefined : filter))
    } catch (cause) {
      setError(errMsg(cause))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  async function analyze() {
    setRunning(true)
    setError(null)
    setMessage(null)
    try {
      const result = await runWaste()
      setMessage(result.message ?? `Found ${result.finding_count} savings idea(s) from ${result.expense_count} expenses.`)
      await load()
    } catch (cause) {
      setError(errMsg(cause))
    } finally {
      setRunning(false)
    }
  }

  async function updateStatus(finding: WasteFinding, status: WasteStatus) {
    setBusyId(finding.id)
    setError(null)
    try {
      await setWasteStatus(finding.id, status)
      await load()
    } catch (cause) {
      setError(errMsg(cause))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Savings ideas</h1>
          <p className="mt-1 text-sm text-slate-600">
            These are patterns to review, not judgments about your spending.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="waste-status" className="text-sm text-slate-600">Show</label>
          <select
            id="waste-status"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={filter}
            onChange={(event) => setFilter(event.target.value as StatusFilter)}
          >
            <option value="open">Open</option>
            <option value="reviewed">Reviewed</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
          <button
            onClick={() => void analyze()}
            disabled={running}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {running ? 'Analyzing…' : 'Analyze spending'}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading savings ideas…</p>
      ) : findings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="font-medium">No {filter === 'all' ? '' : `${filter} `}savings ideas yet.</p>
          <p className="mt-1 text-sm text-slate-500">Run an analysis to look for patterns in your expenses.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {findings.map((finding) => (
            <article key={finding.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{finding.title}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">
                      {finding.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{finding.explanation}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {finding.category ? `${finding.category} · ` : ''}
                    {finding.period_start} to {finding.period_end} · {finding.occurrences} occurrence(s)
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Potential savings</p>
                  <p className="font-semibold">
                    {finding.potential_savings === null ? 'Review only' : formatINR(finding.potential_savings)}
                  </p>
                </div>
              </div>
              {finding.evidence.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm text-slate-600">
                  {finding.evidence.map((item, index) => (
                    <li key={`${item.label}-${index}`} className="flex justify-between gap-3">
                      <span>{item.label}</span>
                      <span className="whitespace-nowrap">{formatINR(item.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3">
                {statuses.filter((status) => status !== finding.status).map((status) => (
                  <button
                    key={status}
                    disabled={busyId === finding.id}
                    onClick={() => void updateStatus(finding, status)}
                    className="text-sm capitalize text-emerald-700 underline disabled:opacity-50"
                  >
                    Mark {status}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}