import { supabase } from './supabase'

export interface Budget {
  id: string
  category_id: string | null // null = overall monthly budget
  month: string // YYYY-MM-01
  amount: number
}

export const currentMonth = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

export async function fetchBudgets(ym: string): Promise<Budget[]> {
  const { data, error } = await supabase
    .from('budgets')
    .select('id,category_id,month,amount')
    .eq('month', `${ym}-01`)
  if (error) throw error
  return (data ?? []) as Budget[]
}

export async function saveBudget(
  existing: Budget | undefined,
  categoryId: string | null,
  ym: string,
  amount: number,
): Promise<void> {
  if (existing) {
    const { error } = await supabase.from('budgets').update({ amount }).eq('id', existing.id)
    if (error) throw error
    return
  }
  const { data } = await supabase.auth.getSession()
  const user_id = data.session?.user.id
  if (!user_id) throw new Error('Not signed in')
  const { error } = await supabase
    .from('budgets')
    .insert({ user_id, category_id: categoryId, month: `${ym}-01`, amount })
  if (error) throw error
}

export async function deleteBudget(id: string): Promise<void> {
  const { error } = await supabase.from('budgets').delete().eq('id', id)
  if (error) throw error
}