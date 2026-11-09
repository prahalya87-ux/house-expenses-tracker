import { supabase } from './supabase'
import type { Category, Kind, NewTransaction, Transaction } from './types'

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,kind,is_essential')
    .order('name')
  if (error) throw error
  return (data ?? []) as Category[]
}

export interface TxnFilters {
  from?: string
  to?: string
  kind?: Kind
  categoryId?: string
}

// Pages through results so we are never capped at 1000 rows.
export async function fetchTransactions(f: TxnFilters = {}): Promise<Transaction[]> {
  const pageSize = 1000
  const all: Transaction[] = []
  for (let start = 0; ; start += pageSize) {
    let q = supabase
      .from('transactions')
      .select('*')
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
      .range(start, start + pageSize - 1)
    if (f.from) q = q.gte('txn_date', f.from)
    if (f.to) q = q.lte('txn_date', f.to)
    if (f.kind) q = q.eq('kind', f.kind)
    if (f.categoryId) q = q.eq('category_id', f.categoryId)
    const { data, error } = await q
    if (error) throw error
    const rows = (data ?? []) as Transaction[]
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return all
}

export async function addTransaction(input: NewTransaction): Promise<void> {
  const user_id = await currentUserId()
  const { error } = await supabase.from('transactions').insert({ ...input, user_id })
  if (error) throw error
}

export async function updateTransaction(id: string, input: NewTransaction): Promise<void> {
  const { error } = await supabase.from('transactions').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}

export async function bulkInsertTransactions(rows: NewTransaction[]): Promise<void> {
  const user_id = await currentUserId()
  const chunk = 500
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk).map((r) => ({ ...r, user_id }))
    const { error } = await supabase.from('transactions').insert(batch)
    if (error) throw error
  }
}