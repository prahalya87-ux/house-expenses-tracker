import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { compareMonths, fetchAnalysis, runAnalysis } from '../lib/analysis'
import type { AnalysisResponse, MonthComparison } from '../lib/analysis'
import { errMsg, formatINR } from '../lib/format'

const pct = (v: number | null) => (v === null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h2 className="font-semibold">{title}</h2>
      {note && <p className="text-xs text-slate-500 mb-3">{note}</p>}
      {!note && <div className="mb-3" />}
      {children}
    </div>
  )
}

function CompareMonths({ months }: { months: string[] }) {
  const [a, setA] = useState(months.length >= 2 ? months[months.length - 2] : months[0])
  const [b, setB] = useState(months[months.length - 1])
  const [data, setData] = useState<MonthComparison | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    compareMonths(a, b)
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e))
      })
    return () => {
      cancelled = true
    }
  }, [a, b])

  const select = 'border border-slate-300 rounded-md px-2 py-1.5 text-sm'
  const chart = (data?.categories ?? []).slice(0, 8).map((c) => ({ name: c.category, first: c.a, second: c.b }))

  return (
    <Panel title="Compare two months" note="Expenses by category, month B compared with month A.">
      <div className="flex items-center gap-2 text-sm mb-3">
        <select className={select} value={a} onChange={(e) => setA(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-slate-500">vs</span>
        <select className={select} value={b} onChange={(e) => setB(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (
        <>
          <p className="text-sm mb-3">
            Total expenses: {formatINR(data.total_a)} → {formatINR(data.total_b)}{' '}
            <span className={data.total_diff > 0 ? 'text-red-600' : 'text-emerald-700'}>
              ({data.total_diff > 0 ? '+' : ''}{formatINR(data.total_diff)}, {pct(data.total_pct)})
            </span>
          </p>
          {chart.length > 0 && (
            <div style={{ height: 260 }} className="mb-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis />
                  <Tooltip formatter={(v) => formatINR(Number(v))} />
                  <Legend />
                  <Bar dataKey="first" name={a} fill="#94a3b8" />
                  <Bar dataKey="second" name={b} fill="#059669" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600 bg-slate-100">
                <tr>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">{a}</th>
                  <th className="px-3 py-2 text-right">{b}</th>
                  <th className="px-3 py-2 text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.category} className="border-t border-slate-100">
                    <td className="px-3 py-2">{c.category}</td>
                    <td className="px-3 py-2 text-right">{formatINR(c.a)}</td>
                    <td className="px-3 py-2 text-right">{formatINR(c.b)}</td>
                    <td className={`px-3 py-2 text-right ${c.diff > 0 ? 'text-red-600' : c.diff < 0 ? 'text-emerald-700' : ''}`}>
                      {c.diff > 0 ? '+' : ''}{formatINR(c.diff)} ({pct(c.pct)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  )
}

export default function Behaviour() {
  const [data, setData] = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let res = await fetchAnalysis()
      if (!res.computed_at) res = await runAnalysis()
      setData(res)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      setData(await runAnalysis())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setRefreshing(false)
    }
  }

  const s = data?.sections ?? {}
  const daily = s.daily
  const weekly = s.weekly
  const monthly = s.monthly
  const ie = s.income_expense
  const habit = s.habit_change
  const clusters = s.clusters

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Spending habits</h1>
          <p className="text-sm text-slate-500">
            {data?.computed_at
              ? `Last analysed ${new Date(data.computed_at).toLocaleString('en-IN')}. Refresh after adding transactions.`
              : 'Patterns in your own transactions over the last 12 months.'}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing || loading}
          className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {refreshing ? 'Analysing…' : 'Refresh analysis'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Analysing your transactions…</p>}
      {!loading && data && !daily && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-slate-600 text-sm">
          {data.message ?? 'No expense data yet. Add some transactions first.'}
        </div>
      )}

      {daily && weekly && ie && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Average daily spend" value={formatINR(daily.average_daily)} hint={`median ${formatINR(daily.median_daily)}`} />
          <Stat label="Days with spending" value={`${daily.days_with_spending} of ${daily.days_in_range}`} />
          <Stat label="Highest-spending weekday" value={weekly.peak_weekday} hint="average over all days incl. zero-spend days" />
          <Stat
            label="Expense-to-income ratio"
            value={ie.expense_to_income_ratio === null ? 'No income' : `${(ie.expense_to_income_ratio * 100).toFixed(0)}%`}
            hint={`avg ${formatINR(ie.avg_monthly_expense)} spent of ${formatINR(ie.avg_monthly_income)} earned per month (${ie.basis})`}
          />
        </div>
      )}

      {monthly && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel title="Monthly income vs expenses" note="The latest month may be partial.">
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly.months}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(v) => formatINR(Number(v))} />
                  <Legend />
                  <Bar dataKey="income" name="Income" fill="#059669" />
                  <Bar dataKey="expenses" name="Expenses" fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Most expensive categories">
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly.category_totals.slice(0, 8)} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="category" width={120} />
                  <Tooltip formatter={(v) => formatINR(Number(v))} />
                  <Bar dataKey="total" fill="#0f766e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      )}

      {weekly && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel title="Average spend by weekday">
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly.weekday_average}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="weekday" />
                  <YAxis />
                  <Tooltip formatter={(v) => formatINR(Number(v))} />
                  <Bar dataKey="average" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Weekly spending" note="The first and last weeks can be partial.">
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weekly.weekly_totals}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week_start" />
                  <YAxis />
                  <Tooltip formatter={(v) => formatINR(Number(v))} />
                  <Line type="monotone" dataKey="total" stroke="#dc2626" dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      )}

      {daily && daily.highest_days.length > 0 && (
        <Panel title="Highest-spending days" note="Large fixed bills such as rent often dominate this list.">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600 bg-slate-100">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Biggest category that day</th>
                <th className="px-3 py-2 text-right">Total spent</th>
              </tr>
            </thead>
            <tbody>
              {daily.highest_days.map((d) => (
                <tr key={d.date} className="border-t border-slate-100">
                  <td className="px-3 py-2">{d.date}</td>
                  <td className="px-3 py-2">{d.top_category}</td>
                  <td className="px-3 py-2 text-right">{formatINR(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {habit && (
        <Panel
          title="Changes in spending habits"
          note={habit.available ? `${habit.latest_month} compared with the average of ${habit.baseline_months?.join(', ')}.` : undefined}
        >
          {!habit.available ? (
            <p className="text-sm text-slate-500">{habit.reason}</p>
          ) : (
            <>
              {habit.overall && (
                <p className="text-sm mb-3">
                  Total: {formatINR(habit.overall.latest)} vs usual {formatINR(habit.overall.baseline_avg)} ({pct(habit.overall.change_pct)})
                </p>
              )}
              <table className="w-full text-sm">
                <thead className="text-left text-slate-600 bg-slate-100">
                  <tr>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Latest month</th>
                    <th className="px-3 py-2 text-right">Usual</th>
                    <th className="px-3 py-2 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {(habit.categories ?? []).slice(0, 8).map((c) => (
                    <tr key={c.category} className="border-t border-slate-100">
                      <td className="px-3 py-2">{c.category}</td>
                      <td className="px-3 py-2 text-right">{formatINR(c.latest)}</td>
                      <td className="px-3 py-2 text-right">{formatINR(c.baseline_avg)}</td>
                      <td className={`px-3 py-2 text-right ${c.change > 0 ? 'text-red-600' : c.change < 0 ? 'text-emerald-700' : ''}`}>
                        {c.change > 0 ? '+' : ''}{formatINR(c.change)} ({pct(c.change_pct)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Panel>
      )}

      {clusters && (
        <Panel
          title="Spending-day groups (K-Means)"
          note={clusters.available ? `Your ${clusters.spending_days} spending days grouped into ${clusters.k} clusters (silhouette ${clusters.silhouette}).` : undefined}
        >
          {!clusters.available ? (
            <p className="text-sm text-slate-500">{clusters.reason}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600 bg-slate-100">
                <tr>
                  <th className="px-3 py-2">Group</th>
                  <th className="px-3 py-2 text-right">Days</th>
                  <th className="px-3 py-2 text-right">Avg spend</th>
                  <th className="px-3 py-2 text-right">Avg transactions</th>
                  <th className="px-3 py-2 text-right">Essentials share</th>
                  <th className="px-3 py-2 text-right">Share of all spend</th>
                </tr>
              </thead>
              <tbody>
                {(clusters.clusters ?? []).map((c) => (
                  <tr key={c.label} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{c.label}</td>
                    <td className="px-3 py-2 text-right">{c.days}</td>
                    <td className="px-3 py-2 text-right">{formatINR(c.avg_spend)}</td>
                    <td className="px-3 py-2 text-right">{c.avg_transactions}</td>
                    <td className="px-3 py-2 text-right">{c.essential_share_pct}%</td>
                    <td className="px-3 py-2 text-right">{c.share_of_spend_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {monthly && monthly.months.length > 0 && <CompareMonths months={monthly.months.map((m) => m.month)} />}
    </div>
  )
}