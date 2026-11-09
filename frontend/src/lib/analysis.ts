import { backend } from './backend'

export interface DailySection {
  average_daily: number
  median_daily: number
  days_in_range: number
  days_with_spending: number
  highest_days: { date: string; total: number; top_category: string }[]
  series: { date: string; total: number }[]
}

export interface WeeklySection {
  weekly_totals: { week_start: string; total: number; days: number }[]
  weekday_average: { weekday: string; average: number }[]
  peak_weekday: string
}

export interface MonthlySection {
  months: {
    month: string
    expenses: number
    income: number
    savings: number
    savings_rate: number | null
    mom_change_pct: number | null
    is_partial: boolean
  }[]
  category_totals: { category: string; total: number; share_pct: number }[]
}

export interface IncomeExpenseSection {
  total_income: number
  total_expense: number
  expense_to_income_ratio: number | null
  avg_monthly_income: number
  avg_monthly_expense: number
  months_analysed: number
  basis: string
}

export interface HabitChangeSection {
  available: boolean
  reason?: string
  latest_month?: string
  baseline_months?: string[]
  overall?: { latest: number; baseline_avg: number; change_pct: number | null }
  categories?: { category: string; latest: number; baseline_avg: number; change: number; change_pct: number | null }[]
}

export interface ClusterSection {
  available: boolean
  reason?: string
  k?: number
  silhouette?: number
  spending_days?: number
  clusters?: {
    label: string
    days: number
    avg_spend: number
    avg_transactions: number
    essential_share_pct: number
    share_of_spend_pct: number
  }[]
}

export interface AnalysisResponse {
  computed_at: string | null
  message: string | null
  sections: {
    daily?: DailySection
    weekly?: WeeklySection
    monthly?: MonthlySection
    income_expense?: IncomeExpenseSection
    habit_change?: HabitChangeSection
    clusters?: ClusterSection
  }
}

export interface MonthComparison {
  month_a: string
  month_b: string
  total_a: number
  total_b: number
  total_diff: number
  total_pct: number | null
  categories: { category: string; a: number; b: number; diff: number; pct: number | null }[]
}

export const fetchAnalysis = () => backend<AnalysisResponse>('/analysis')
export const runAnalysis = () => backend<AnalysisResponse>('/analysis/run', { method: 'POST' })
export const compareMonths = (a: string, b: string) =>
  backend<MonthComparison>(`/analysis/compare?month_a=${a}&month_b=${b}`)