import { useState } from 'react'
import type { FormEvent } from 'react'
import { errMsg, toISODate } from '../lib/format'
import type { Category, Kind, NewTransaction, Transaction } from '../lib/types'

interface Props {
  categories: Category[]
  initial?: Transaction | null
  onSave: (data: NewTransaction) => Promise<void>
  onCancel: () => void
}

const PAYMENT_METHODS = ['', 'Cash', 'UPI', 'Card', 'Bank transfer', 'Other']

export default function TransactionForm({ categories, initial, onSave, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'expense')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [date, setDate] = useState(initial?.txn_date ?? toISODate(new Date()))
  const [merchant, setMerchant] = useState(initial?.merchant ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [paymentMethod, setPaymentMethod] = useState(initial?.payment_method ?? '')
  const [recurring, setRecurring] = useState(initial?.is_recurring ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = categories.filter((c) => c.kind === kind)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const amt = Number(amount)
    if (!categoryId) return setError('Please choose a category.')
    if (!Number.isFinite(amt) || amt <= 0) return setError('Amount must be a number greater than 0.')
    if (!date) return setError('Please choose a date.')
    setBusy(true)
    try {
      await onSave({
        kind,
        category_id: categoryId,
        amount: Math.round(amt * 100) / 100,
        txn_date: date,
        merchant: merchant.trim() || null,
        description: description.trim() || null,
        payment_method: paymentMethod || null,
        is_recurring: recurring,
      })
    } catch (err) {
      setError(errMsg(err))
      setBusy(false)
    }
  }

  const field = 'border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full'

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h2 className="font-semibold">{initial ? 'Edit transaction' : 'New transaction'}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <select
          className={field}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as Kind)
            setCategoryId('')
          }}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <select className={field} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Select category…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className={field} type="number" step="0.01" min="0" placeholder="Amount (₹)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className={field} placeholder="Merchant (optional)" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        <input className={field} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <select className={field} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m || 'Payment method (optional)'}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
          Recurring (rent, subscription, bill…)
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </form>
  )
}