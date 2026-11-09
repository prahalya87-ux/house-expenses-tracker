import { useCallback, useEffect, useMemo, useState } from 'react'
import { addTransaction, deleteTransaction, fetchCategories, fetchTransactions, updateTransaction } from '../lib/api'
import { errMsg, formatINR } from '../lib/format'
import type { Category, Kind, NewTransaction, Transaction } from '../lib/types'
import TransactionForm from '../components/TransactionForm'
import CsvImport from '../components/CsvImport'

const PAGE_SIZE = 50

export default function Transactions() {
  const [categories, setCategories] = useState<Category[]>([])
  const [rows, setRows] = useState<Transaction[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState<'' | Kind>('')
  const [categoryId, setCategoryId] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [showImport, setShowImport] = useState(false)

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTransactions({
        from: from || undefined,
        to: to || undefined,
        kind: kind || undefined,
        categoryId: categoryId || undefined,
      })
      setRows(data)
      setPage(0)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [from, to, kind, categoryId])

  useEffect(() => {
    fetchCategories().then(setCategories).catch((e) => setError(errMsg(e)))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSave(data: NewTransaction) {
    if (editing) await updateTransaction(editing.id, data)
    else await addTransaction(data)
    setShowForm(false)
    setEditing(null)
    await load()
  }

  async function handleDelete(t: Transaction) {
    if (!window.confirm('Delete this transaction?')) return
    try {
      await deleteTransaction(t.id)
      await load()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const field = 'border border-slate-300 rounded-md px-2 py-1.5 text-sm'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Transactions</h1>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowImport((v) => !v)
              setShowForm(false)
            }}
            className="px-3 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm"
          >
            Import CSV
          </button>
          <button
            onClick={() => {
              setEditing(null)
              setShowForm(true)
              setShowImport(false)
            }}
            className="px-3 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 text-sm"
          >
            Add transaction
          </button>
        </div>
      </div>

      {showForm && (
        <TransactionForm
          key={editing?.id ?? 'new'}
          categories={categories}
          initial={editing}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false)
            setEditing(null)
          }}
        />
      )}

      {showImport && (
        <CsvImport
          categories={categories}
          onDone={async () => {
            setShowImport(false)
            await load()
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-slate-500">to</span>
        <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
        <select className={field} value={kind} onChange={(e) => setKind(e.target.value as '' | Kind)}>
          <option value="">All types</option>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <select className={field} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.kind})
            </option>
          ))}
        </select>
        {(from || to || kind || categoryId) && (
          <button
            className="text-emerald-700 underline"
            onClick={() => {
              setFrom('')
              setTo('')
              setKind('')
              setCategoryId('')
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-left">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Merchant / description</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No transactions found.
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">{t.txn_date}</td>
                  <td className="px-3 py-2">
                    {catName.get(t.category_id) ?? 'Unknown'}
                    {t.is_recurring && <span className="ml-2 text-xs bg-slate-200 rounded px-1.5 py-0.5">recurring</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{[t.merchant, t.description].filter(Boolean).join(' — ')}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${t.kind === 'income' ? 'text-emerald-700' : 'text-red-600'}`}>
                    {t.kind === 'income' ? '+' : '−'}
                    {formatINR(t.amount)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      className="text-slate-600 hover:underline mr-3"
                      onClick={() => {
                        setEditing(t)
                        setShowForm(true)
                        setShowImport(false)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                    >
                      Edit
                    </button>
                    <button className="text-red-600 hover:underline" onClick={() => void handleDelete(t)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{rows.length} transactions</span>
        <div className="flex items-center gap-2">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-1 border rounded disabled:opacity-40">
            Prev
          </button>
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)} className="px-2 py-1 border rounded disabled:opacity-40">
            Next
          </button>
        </div>
      </div>
    </div>
  )
}