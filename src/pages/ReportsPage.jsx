import { useState, useEffect, useCallback, useMemo } from 'react'
import { Download, TableIcon, FileText, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, formatDateTime } from '../lib/utils'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import PageHeader from '../components/PageHeader'
import toast from 'react-hot-toast'
import { loadReportData } from '../lib/reportLoader'
import { buildReportModel } from '../lib/reportModel'
import { monthPeriod, allTimePeriod, listMonthKeys, lastCompletedMonthKey } from '../lib/reportPeriod'
import { logError } from '../lib/errorLogger'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const fmt = { currency: (n) => formatCurrency(n), date: (d) => formatDate(d), dateTime: (d) => formatDateTime(d) }
const pct = (n) => `${Number(n || 0).toFixed(2)}%`

async function logoDataUrl() {
  try {
    const blob = await (await fetch('/logo-mark.png')).blob()
    return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob) })
  } catch { return null } // the logo is optional
}

export default function ReportsPage() {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [periodKey, setPeriodKey] = useState('')
  const [exporting, setExporting] = useState('')
  const [stmtMember, setStmtMember] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await loadReportData(supabase)
      setRaw(data)
      if (data._coreFailed) toast.error('Could not load transactions. Reports are disabled until this is fixed.')
    } catch (err) {
      logError(err, 'ReportsPage.load')
      toast.error('Failed to load report data')
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const firstDate = useMemo(() => {
    const times = (raw?.transactions || []).map((t) => new Date(t.transaction_date).getTime()).filter(Number.isFinite)
    return times.length ? new Date(Math.min(...times)) : null
  }, [raw])
  const monthKeys = useMemo(() => listMonthKeys(firstDate, new Date()), [firstDate])
  useEffect(() => {
    if (!raw || periodKey) return
    const wanted = lastCompletedMonthKey(new Date())
    setPeriodKey(monthKeys.includes(wanted) ? wanted : monthKeys[0])
  }, [raw, monthKeys, periodKey])

  const period = useMemo(() => (periodKey === 'all' ? allTimePeriod(firstDate) : periodKey ? monthPeriod(periodKey) : null), [periodKey, firstDate])
  const model = useMemo(() => (raw && period ? buildReportModel(raw, period, new Date()) : null), [raw, period])
  const blocked = loading || !model || raw?._coreFailed

  const exportPDF = async () => {
    setExporting('pdf')
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const { buildReportPdf } = await import('../lib/reportPdf')
      const doc = buildReportPdf(model, { jsPDF, autoTable, fmt, logo: await logoDataUrl() })
      doc.save(`Nitalink-report-${model.meta.periodKey}.pdf`)
      toast.success('PDF report downloaded')
    } catch (err) { logError(err, 'ReportsPage.exportPDF'); toast.error('PDF export failed') }
    setExporting('')
  }
  const exportExcel = async () => {
    setExporting('excel')
    try {
      const XLSX = await import('xlsx')
      const { buildWorkbook } = await import('../lib/reportExcel')
      XLSX.writeFile(buildWorkbook(model, XLSX, fmt), `Nitalink-report-${model.meta.periodKey}.xlsx`)
      toast.success('Excel report downloaded')
    } catch (err) { logError(err, 'ReportsPage.exportExcel'); toast.error('Excel export failed') }
    setExporting('')
  }
  const exportStatements = async () => {
    setExporting('stmt')
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const { buildStatementsPdf } = await import('../lib/reportPdf')
      const ids = stmtMember === 'all' ? model.members.map((m) => m.id) : [stmtMember]
      const doc = buildStatementsPdf(model, ids, { jsPDF, autoTable, fmt, logo: await logoDataUrl() })
      const who = stmtMember === 'all' ? 'all-members' : (model.statements[stmtMember]?.member.name || 'member').replace(/\s+/g, '-')
      doc.save(`Nitalink-statement-${who}-${model.meta.periodKey}.pdf`)
      toast.success('Statement downloaded')
    } catch (err) { logError(err, 'ReportsPage.exportStatements'); toast.error('Statement export failed') }
    setExporting('')
  }

  const k = model?.kpis
  const barData = model && {
    labels: model.monthly.map((m) => m.label),
    datasets: [
      { label: 'Deposits', data: model.monthly.map((m) => m.deposits), backgroundColor: 'rgba(90,138,30,0.75)', borderRadius: 4 },
      { label: 'Withdrawals', data: model.monthly.map((m) => m.withdrawals), backgroundColor: 'rgba(27,31,122,0.7)', borderRadius: 4 },
    ],
  }
  const barOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } } } }

  return (
    <div>
      <PageHeader title="Reports & Exports" subtitle="Monthly financial reports for the whole group" onRefresh={load} loading={loading}>
        <div className="reports-export-btns">
          <button className="btn btn-secondary" onClick={exportExcel} disabled={blocked || !!exporting}>
            {exporting === 'excel' ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <TableIcon size={15} />} Export Excel
          </button>
          <button className="btn btn-primary" onClick={exportPDF} disabled={blocked || !!exporting}>
            {exporting === 'pdf' ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Download size={15} />} Export PDF
          </button>
        </div>
      </PageHeader>

      <div className="card mb-6">
        <div className="reports-date-row">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Report month:</span>
          <select className="form-select" style={{ maxWidth: 240 }} value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} disabled={!monthKeys.length}>
            {monthKeys.map((key) => <option key={key} value={key}>{monthPeriod(key).label}</option>)}
            <option value="all">All time</option>
          </select>
          {model && <span className="text-xs text-muted">Balances are as at {formatDate(new Date(model.meta.end.getTime() - 1))}. Pending and unverified items are never counted.</span>}
        </div>
      </div>

      {raw?._coreFailed && (
        <div className="card mb-6" style={{ borderLeft: '4px solid var(--accent-red)' }}>
          <strong style={{ color: 'var(--accent-red)' }}>Report data could not be loaded.</strong> Exports are switched off so you do not download wrong figures. Tap refresh to try again.
        </div>
      )}
      {raw && !raw._coreFailed && raw._failed.length > 0 && (
        <div className="card mb-6" style={{ borderLeft: '4px solid var(--accent-amber)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertTriangle size={16} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
          <span style={{ fontSize: 13 }}>Some data did not load: <strong>{raw._failed.join(', ')}</strong>. Exports will say so and those sections are incomplete.</span>
        </div>
      )}
      {model && !model.checks.rollForwardBalanced && (
        <div className="card mb-6" style={{ borderLeft: '4px solid var(--accent-red)' }}>
          <strong style={{ color: 'var(--accent-red)' }}>Figures do not reconcile.</strong> Closing balance differs from member equity by {formatCurrency(model.rollForward.difference)}.
        </div>
      )}

      {model && (
        <>
          <div className="grid-4 mb-6">
            {[
              { label: 'Pool Balance (end of month)', value: formatCurrency(k.closingPool), color: 'gold' },
              { label: 'Deposits', value: formatCurrency(k.periodDeposits), color: 'green', sub: k.depositGrowthPct === null ? '' : `${k.depositGrowthPct >= 0 ? '+' : ''}${k.depositGrowthPct}% vs last month` },
              { label: 'Withdrawals', value: formatCurrency(k.periodWithdrawals), color: 'red', sub: `${k.pendingWithdrawals.count} pending` },
              { label: 'Net movement', value: formatCurrency(k.netMovement), color: 'blue', sub: `Opening ${formatCurrency(k.openingPool)}` },
            ].map((m) => (
              <div key={m.label} className="card">
                <div className="card-title mb-3">{m.label}</div>
                <div className={`stat-value ${m.color} text-mono`} style={{ fontSize: 20 }}>{m.value}</div>
                {m.sub && <div className="stat-label">{m.sub}</div>}
              </div>
            ))}
          </div>

          <div className="grid-4 mb-6">
            {[
              { label: 'Awaiting verification', value: formatCurrency(k.awaitingVerification.amount), sub: `${k.awaitingVerification.count} deposit(s)${k.awaitingVerification.oldestDays === null ? '' : `, oldest ${k.awaitingVerification.oldestDays}d`}` },
              { label: 'Members', value: String(k.memberCount), sub: `${k.activeContributors} contributed` },
              { label: 'Currently invested', value: formatCurrency(model.liquidity.invested), sub: `${pct(model.liquidity.investedPct)} of pool (estimate)` },
              { label: 'Reserve fund', value: model.reserve.status ? formatCurrency(model.reserve.status.currentBalance) : 'n/a', sub: model.reserve.status ? `${pct(model.reserve.status.pctOfTarget)} of target` : '' },
            ].map((m) => (
              <div key={m.label} className="card">
                <div className="card-title mb-3">{m.label}</div>
                <div className="stat-value text-mono" style={{ fontSize: 20 }}>{m.value}</div>
                {m.sub && <div className="stat-label">{m.sub}</div>}
              </div>
            ))}
          </div>

          <div className="card mb-6">
            <div className="card-header"><span className="card-title">Monthly Activity (last 12 months)</span></div>
            <div style={{ height: 240 }}><Bar data={barData} options={barOpts} /></div>
          </div>

          <div className="card mb-6">
            <div className="card-header"><span className="card-title">Member Summary</span></div>
            <div className="table-container" style={{ overflowX: 'auto' }}>
              <table className="reports-contrib-table">
                <thead><tr><th>Member</th><th>Ownership</th><th>Equity</th><th>Deposits</th><th>Withdrawals</th><th>Loan</th></tr></thead>
                <tbody>
                  {model.members.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Member"><strong>{m.name}</strong></td>
                      <td data-label="Ownership" className="text-mono">{pct(m.ownershipPct)}</td>
                      <td data-label="Equity" className="text-mono">{formatCurrency(m.closingEquity)}</td>
                      <td data-label="Deposits" className="text-mono" style={{ color: 'var(--accent-emerald)' }}>{formatCurrency(m.deposits)}</td>
                      <td data-label="Withdrawals" className="text-mono" style={{ color: 'var(--accent-red)' }}>{formatCurrency(m.withdrawals)}</td>
                      <td data-label="Loan" className="text-mono">{m.loanBalance > 0 ? formatCurrency(m.loanBalance) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid-2 mb-6">
            <div className="card">
              <div className="card-header"><span className="card-title">Deposit Verification</span></div>
              {[
                ['Recorded', model.verification.recorded.count], ['Verified', model.verification.verified.count], ['Without bank reference', model.verification.completedNoCode.count],
                ['Awaiting', model.verification.awaiting.count], ['Rejected', model.verification.rejected.count],
                ['Median time to verify', model.verification.medianHoursToVerify === null ? 'n/a' : `${model.verification.medianHoursToVerify} h`],
              ].map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><strong>{v}</strong></div>)}
            </div>
            <div className="card">
              <div className="card-header"><span className="card-title">Bank Reconciliation</span></div>
              {[
                ['Bank entries', model.reconciliation.entries], ['Matched', model.reconciliation.matched], ['Unmatched', model.reconciliation.unmatched],
                ['Amount differences', model.reconciliation.mismatches.length], ['Deposits with no bank entry', model.reconciliation.unreconciledDeposits.count],
                ['Total bank amount', formatCurrency(model.reconciliation.totalBankAmount)],
              ].map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><strong>{v}</strong></div>)}
            </div>
          </div>

          <div className="card mb-6">
            <div className="card-header"><span className="card-title">Member Statements</span></div>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>One PDF per member: every transaction for the month with a running balance, bank references, and ownership share.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <select className="form-select" style={{ maxWidth: 260 }} value={stmtMember} onChange={(e) => setStmtMember(e.target.value)}>
                <option value="all">All members (one PDF)</option>
                {model.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button className="btn btn-secondary" onClick={exportStatements} disabled={blocked || !!exporting}>
                {exporting === 'stmt' ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <FileText size={15} />} Download statement
              </button>
            </div>
          </div>
        </>
      )}
      {loading && !model && <div className="card"><div className="skeleton" style={{ height: 120 }} /></div>}
    </div>
  )
}
