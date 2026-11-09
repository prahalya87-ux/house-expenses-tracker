import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap ${
    isActive ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-200'
  }`

export default function Layout() {
  const { session, signOut } = useAuth()
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 overflow-x-auto">
            <span className="font-bold text-emerald-700 whitespace-nowrap">SmartSpend AI</span>
            <nav className="flex gap-1">
              <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
              <NavLink to="/transactions" className={linkClass}>Transactions</NavLink>
              <NavLink to="/budgets" className={linkClass}>Budgets</NavLink>
              <NavLink to="/anomalies" className={linkClass}>Unusual spending</NavLink>
              <NavLink to="/waste" className={linkClass}>Savings ideas</NavLink>
              <NavLink to="/behaviour" className={linkClass}>Spending habits</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 hidden xl:inline">{session?.user.email}</span>
            <button
              onClick={() => void signOut()}
              className="px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}