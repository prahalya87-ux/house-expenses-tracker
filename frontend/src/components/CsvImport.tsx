import { useState } from 'react'
import type { FormEvent } from 'react'
import { bulkInsertTransactions } from '../lib/api'
import { errMsg } from '../lib/format'
import type { Category, Kind, NewTransaction } from '../lib/types'

interface Props {
  categories: Category[]
  onDone: () => Promise<void>
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (quoted) {
        quoted = false
      } else if (field.length === 0) {
        quoted = true
      } else {
        throw new Error(`Unexpected quote near character ${i + 1}.`)
      }
    } else if (char === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (quoted) throw new Error('The CSV has an unclosed quoted field.')
  row.push(field)
  if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  return rows
}

function parseTransactions(text: string, categories: Category[]): NewTransaction[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one transaction.')

  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/\s+/g, '_'))
  const index = (...names: string[]) => headers.findIndex((header) => names.includes(header))
  const dateIndex = index('date', 'txn_date')
  const typeIndex = index('type', 'kind')
  const categoryIndex = index('category', 'category_name')
  const amountIndex = index('amount')

  if ([dateIndex, typeIndex, categoryIndex, amountIndex].some((i) => i < 0)) {
    throw new Error('Required columns: date, type, category, amount.')
  }

  const merchantIndex = index('merchant')
  const descriptionIndex = index('description')
  const paymentIndex = index('payment_method')
  const recurringIndex = index('recurring', 'is_recurring')
  const categoryLookup = new Map(
    categories.map((category) => [`${category.kind}:${category.name.trim().toLowerCase()}`, category.id]),
  )
  const transactions: NewTransaction[] = []
  const issues: string[] = []
  let issueCount = 0

  const reportIssue = (lineNumber: number, message: string) => {
    issueCount += 1
    if (issues.length < 10) issues.push(`Row ${lineNumber}: ${message}.`)
  }

  rows.slice(1).forEach((cells, rowIndex) => {
    const cell = (column: number) => (column < 0 ? '' : (cells[column] ?? '').trim())
    const lineNumber = rowIndex + 2
    const rawKind = cell(typeIndex).toLowerCase()
    if (rawKind !== 'expense' && rawKind !== 'income') {
      reportIssue(lineNumber, 'type must be expense or income')
      return
    }
    const kind: Kind = rawKind
    const categoryName = cell(categoryIndex)
    const categoryId = categoryLookup.get(`${kind}:${categoryName.toLowerCase()}`)
    if (!categoryId) {
      reportIssue(lineNumber, `unknown ${kind} category "${categoryName}"`)
      return
    }

    const amountText = cell(amountIndex).replace(/[₹,$\s]/g, '')
    const amount = Number(amountText)
    const txnDate = cell(dateIndex)
    const date = new Date(`${txnDate}T00:00:00Z`)
    const recurringText = cell(recurringIndex).toLowerCase()
    if (!Number.isFinite(amount) || amount <= 0) {
      reportIssue(lineNumber, 'amount must be greater than zero')
      return
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(txnDate)
      || Number.isNaN(date.valueOf())
      || date.toISOString().slice(0, 10) !== txnDate
    ) {
      reportIssue(lineNumber, 'date must be a valid YYYY-MM-DD date')
      return
    }
    if (!['', 'yes', 'no', 'true', 'false', '1', '0'].includes(recurringText)) {
      reportIssue(lineNumber, 'recurring must be yes/no or true/false')
      return
    }

    transactions.push({
      kind,
      category_id: categoryId,
      amount: Math.round(amount * 100) / 100,
      txn_date: txnDate,
      merchant: cell(merchantIndex) || null,
      description: cell(descriptionIndex) || null,
      payment_method: cell(paymentIndex) || null,
      is_recurring: ['yes', 'true', '1'].includes(recurringText),
    })
  })

  if (issues.length) {
    throw new Error(`${issues.join(' ')}${issueCount > issues.length ? ` ${issueCount - issues.length} more invalid row(s) omitted.` : ''}`)
  }
  if (!transactions.length) throw new Error('No valid transactions were found in the CSV.')
  return transactions
}

export default function CsvImport({ categories, onDone }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) {
      setError('Choose a CSV file first.')
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const transactions = parseTransactions(await file.text(), categories)
      await bulkInsertTransactions(transactions)
      setMessage(`Imported ${transactions.length} transaction(s).`)
      setFile(null)
      await onDone()
    } catch (cause) {
      setError(errMsg(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void importFile(event)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold">Import transactions from CSV</h2>
        <p className="mt-1 text-xs text-slate-500">
          Required columns: date, type, category, amount. Optional: merchant, description, payment_method, recurring.
          Dates must use YYYY-MM-DD, and category names must match your categories.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setError(null)
            setMessage(null)
          }}
          className="text-sm"
        />
        <button
          disabled={busy || !file}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? 'Importing…' : 'Import CSV'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    </form>
  )
}