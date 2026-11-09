import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchCategories, fetchTransactions } from '../lib/api'
import { countOpenAnomalies } from '../lib/anomalies'
import { currentMonth, fetchBudgets, monthRange } from '../lib/budget'
import { errMsg, formatINR, toISODate } from '../lib/format'
import type { Category, Transaction } from '../lib/types'

const round2 = (n: number) => Math.round(n * 100) / 100

function Card({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${tone ?? ''}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

export default function Dashboard() {
  const now = new Date()
  const [from, setFrom] = useState(toISODate(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
  const [categories, setCategories] = useState<Category[]>([])
  const [txns, setTxns] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [monthSpend, setMonthSpend] = useState<number | null>(null)
  const [overallBudget, setOverallBudget] = useState<number | null>(null)
  const [openAnomalies, setOpenAnomalies] = useState<number | null>(null)
  const ym = currentMonth()
  const monthLabel = now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })

  useEffect(() => {
    fetchCategories().then(setCategories).catch((e) => setError(errMsg(e)))
  }, [])

  useEffect(() => {
    const { from: mFrom, to: mTo } = monthRange(ym)
    Promise.all([
      fetchTransactions({ from: mFrom, to: mTo, kind: 'expense' }),
      fetchBudgets(ym),
      countOpenAnomalies(),
    ])
      .then(([monthTxns, budgets, n]) => {
        setMonthSpend(round2(monthTxns.reduce((s, t) => s + t.amount, 0)))
        const overall = budgets.find((b) => b.category_id === null)
        setOverallBudget(overall ? overall.amount : null)
        setOpenAnomalies(n)
      })
      .catch((e) => setError(errMsg(e)))
  }, [ym])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTransactions({ from, to })
      .then((d) => {
        if (!cancelled) setTxns(d)
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const stats = useMemo(() => {
    const names = new Map(categories.map((c) => [c.id, c.name]))
    let income = 0
    let expenses = 0
    const byCat = new Map<string, number>()
    const byDay = new Map<string, number>()
    for (const t of txns) {
      if (t.kind === 'income') {
        income += t.amount
      } else {
        expenses += t.amount
        const n = names.get(t.category_id) ?? 'Unknown'
        byCat.set(n, (byCat.get(n) ?? 0) + t.amount)
        byDay.set(t.txn_date, (byDay.get(t.txn_date) ?? 0) + t.amount)
      }
    }
    const catData = [...byCat].map(([name, total]) => ({ name, total: round2(total) })).sort((a, b) => b.total - a.total)
    const dayData = [...byDay].map(([date, total]) => ({ date, total: round2(total) })).sort((a, b) => a.date.localeCompare(b.date))
    const savings = income - expenses
    const rate = income > 0 ? (savings / income) * 100 : null
    return { income, expenses, savings, rate, catData, dayData }
  }, [txns, categories])

  const remaining = overallBudget !== null && monthSpend !== null ? overallBudget - monthSpend : null
  const dateInput = 'border border-slate-300 rounded-md px-2 py-1.5 text-sm'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500">From</label>
          <input type="date" className={dateInput} value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="text-slate-500">To</label>
          <input type="date" className={dateInput} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid sm:grid-cols-2 gap-4">
        <Card
          label={`Remaining budget (${monthLabel})`}
          value={monthSpend === null ? '…' : overallBudget === null ? 'No budget set' : formatINR(remaining ?? 0)}
          tone={remaining !== null && remaining < 0 ? 'text-red-600' : ''}
          hint={
            overallBudget === null ? (
              <Link to="/budgets" className="text-emerald-700 underline">Set a monthly budget</Link>
            ) : (
              `Spent ${formatINR(monthSpend ?? 0)} of ${formatINR(overallBudget)}`
            )
          }
        />
        <Card
          label="Unusual transactions to review"
          value={openAnomalies === null ? '…' : String(openAnomalies)}
          tone={openAnomalies ? 'text-amber-600' : ''}
          hint={<Link to="/anomalies" className="text-emerald-700 underline">Open unusual spending</Link>}
        />
      </div>

      {loading && <p className="text-slate-500 text-sm">Loading…</p>}

      {!loading && txns.length === 0 && !error && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-slate-600">
          No transactions in this date range. <Link to="/transactions" className="text-emerald-700 underline">Add or import some</Link>.
        </div>
      )}

      {txns.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card label="Total income" value={formatINR(stats.income)} tone="text-emerald-700" />
            <Card label="Total expenses" value={formatINR(stats.expenses)} tone="text-red-600" />
            <Card label="Net savings" value={formatINR(stats.savings)} tone={stats.savings >= 0 ? 'text-emerald-700' : 'text-red-600'} />
            <Card label="Savings rate" value={stats.rate === null ? 'No income recorded' : `${stats.rate.toFixed(1)}%`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold mb-3">Expenses by category</h2>
              {stats.catData.length === 0 ? (
                <p className="text-sm text-slate-500">No expenses in this range.</p>
              ) : (
                <div style={{ height: Math.max(220, stats.catData.length * 34) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.catData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" width={130} />
                      <Tooltip formatter={(v) => formatINR(Number(v))} />
                      <Bar dataKey="total" fill="#059669" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold mb-3">Daily expenses</h2>
              {stats.dayData.length === 0 ? (
                <p className="text-sm text-slate-500">No expenses in this range.</p>
              ) : (
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.dayData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip formatter={(v) => formatINR(Number(v))} />
                      <Line type="monotone" dataKey="total" stroke="#dc2626" dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}