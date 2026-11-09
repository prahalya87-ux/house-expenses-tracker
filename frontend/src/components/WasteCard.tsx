import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatINR } from '../lib/format'
import { openWasteSummary } from '../lib/waste'

export default function WasteCard() {
  const [summary, setSummary] = useState<{ count: number; total: number } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    openWasteSummary().then(setSummary).catch(() => setFailed(true))
  }, [])

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm text-slate-500">Potential savings to review</p>
      <p className="text-2xl font-semibold mt-1">
        {failed ? 'Unavailable' : summary === null ? '…' : formatINR(summary.total)}
      </p>
      <p className="text-xs text-slate-500 mt-1">
        {summary ? `${summary.count} open finding(s) · ` : ''}
        <Link to="/waste" className="text-emerald-700 underline">Savings ideas</Link>
      </p>
    </div>
  )
}