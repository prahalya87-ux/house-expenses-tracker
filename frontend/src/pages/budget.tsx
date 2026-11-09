import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCategories, fetchTransactions } from '../lib/api'
import { currentMonth, deleteBudget, fetchBudgets, monthRange, saveBudget } from '../lib/budget'
import type { Budget } from '../lib/budget'
import { errMsg, formatINR } from '../lib/format'
import type { Category } from '../lib/types'

interface RowProps {
  label: string
  spent: number
  budget?: Budget
  draft: string | undefined
  busy: boolean
  highlight?: boolean
  onDraft: (v: string) => void
  onSave: () => void
  onRemove: () => void
}

function BudgetRow({ label, spent, budget, draft, busy, highlight, onDraft, onSave, onRemove }: RowProps) {
  const amount = budget?.amount ?? 0
  const pct = amount > 0 ? (spent / amount) * 100 : 0
  const bar = pct > 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className={`px-4 py-3 ${highlight ? 'bg-emerald-50' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Budget (₹)"
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-32"
            value={draft ?? (budget ? String(budget.amount) : '')}
            onChange={(e) => onDraft(e.target.value)}
          />
          <button
            disabled={busy || draft === undefined}
            onClick={onSave}
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-40"
          >
            Save
          </button>
          {budget && (
            <button disabled={busy} onClick={onRemove} className="px-3 py-1.5 text-sm text-red-600 hover:underline">
              Remove
            </button>
          )}
        </div>
      </div>
      {budget ? (
        <>
          <div className="mt-2 h-2 bg-slate-200 rounded">
            <div className={`h-2 rounded ${bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Spent {formatINR(spent)} of {formatINR(amount)} ({pct.toFixed(0)}%) ·{' '}
            {spent <= amount ? `${formatINR(amount - spent)} left` : `${formatINR(spent - amount)} over budget`}
          </p>
        </>
      ) : (
        <p className="text-xs text-slate-500 mt-1">Spent {formatINR(spent)} · no budget set</p>
      )}
    </div>
  )
}

export default function Budgets() {
  const [month, setMonth] = useState(currentMonth())
  const [categories, setCategories] = useState<Category[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [spent, setSpent] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalSpent = useMemo(() => Object.values(spent).reduce((s, v) => s + v, 0), [spent])
  const expenseCategories = useMemo(() => categories.filter((c) => c.kind === 'expense'), [categories])

  useEffect(() => {
    fetchCategories().then(setCategories).catch((e) => setError(errMsg(e)))
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const { from, to } = monthRange(month)
      const [b, txns] = await Promise.all([fetchBudgets(month), fetchTransactions({ from, to, kind: 'expense' })])
      setBudgets(b)
      const totals: Record<string, number> = {}
      for (const t of txns) totals[t.category_id] = (totals[t.category_id] ?? 0) + t.amount
      setSpent(totals)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [month])

  useEffect(() => {
    setDrafts({})
    void load()
  }, [load])

  async function save(categoryId: string | null) {
    const key = categoryId ?? 'overall'
    const raw = drafts[key]
    const value = Number(raw)
    if (raw === undefined || raw.trim() === '' || !Number.isFinite(value) || value < 0) {
      setError('Enter a budget amount of 0 or more.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const existing = budgets.find((b) => b.category_id === categoryId)
      await saveBudget(existing, categoryId, month, Math.round(value * 100) / 100)
      setDrafts((d) => {
        const n = { ...d }
        delete n[key]
        return n
      })
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(b: Budget) {
    setBusy(true)
    try {
      await deleteBudget(b.id)
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const overall = budgets.find((b) => b.category_id === null)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Budgets</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        <BudgetRow
          label="Overall monthly budget"
          highlight
          spent={totalSpent}
          budget={overall}
          draft={drafts.overall}
          busy={busy}
          onDraft={(v) => setDrafts((d) => ({ ...d, overall: v }))}
          onSave={() => void save(null)}
          onRemove={() => overall && void remove(overall)}
        />
        {expenseCategories.map((c) => {
          const b = budgets.find((x) => x.category_id === c.id)
          return (
            <BudgetRow
              key={c.id}
              label={c.name}
              spent={spent[c.id] ?? 0}
              budget={b}
              draft={drafts[c.id]}
              busy={busy}
              onDraft={(v) => setDrafts((d) => ({ ...d, [c.id]: v }))}
              onSave={() => void save(c.id)}
              onRemove={() => b && void remove(b)}
            />
          )
        })}
      </div>
    </div>
  )
}