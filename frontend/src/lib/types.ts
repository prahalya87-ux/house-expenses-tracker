export type Kind = 'expense' | 'income'

export interface Category {
  id: string
  name: string
  kind: Kind
  is_essential: boolean
}

export interface Transaction {
  id: string
  category_id: string
  kind: Kind
  amount: number
  description: string | null
  merchant: string | null
  txn_date: string // YYYY-MM-DD
  payment_method: string | null
  is_recurring: boolean
}

export type NewTransaction = Omit<Transaction, 'id'>