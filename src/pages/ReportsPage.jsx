import { useState, useEffect, useCallback } from 'react'
import { Download, TableIcon, BarChart2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, formatDateTime, formatPercentage } from '../lib/utils'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import PageHeader from '../components/PageHeader'
import toast from 'react-hot-toast'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler)

export default function ReportsPage() {
  const [data, setData] = useState({ contributions: [], transactions: [], investments: [], dividends: [] })
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState('')
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  const fetchData = useCallback(async () => {
    setLoading(true)
    let txQuery = supabase.from('transactions').select('*, profiles!transactions_user_id_fkey(name)').order('transaction_date', { ascending: false })
    if (dateRange.from) txQuery = txQuery.gte('transaction_date', dateRange.from)
    if (dateRange.to) txQuery = txQuery.lte('transaction_date', dateRange.to + 'T23:59:59')
    const [cRes, tRes, iRes, dRes] = await Promise.all([
      supabase.from('member_contribution_summary').select('*'),
      txQuery,
      supabase.from('investments').select('*').order('start_date', { ascending: false }),
      supabase.from('dividends').select('*, profiles!dividends_user_id_fkey(name), investments(title)')
    ])
    setData({ contributions: cRes.data || [], transactions: tRes.data || [], investments: iRes.data || [], dividends: dRes.data || [] })
    setLoading(false)
  }, [dateRange])

  useEffect(() => { fetchData() }, [fetchData])

  const totalPool = data.contributions.reduce((s, c) => s + Number(c.net_contribution), 0)
  const totalDeposits = data.transactions.filter(t => t.type === 'deposit' && t.status === 'completed').reduce((s, t) => s + Number(t.amount), 0)
  const totalWithdrawals = data.transactions.filter(t => t.type === 'withdrawal' && t.status !== 'rejected').reduce((s, t) => s + Number(t.amount), 0)
  const totalInvested = data.investments.reduce((s, i) => s + Number(i.amount_invested), 0)
  const totalReturns = data.investments.reduce((s, i) => s + Number(i.actual_return || 0), 0)

  const monthlyMap = {}
  data.transactions.filter(t => t.status === 'completed').forEach(t => {
    const key = formatDate(t.transaction_date, 'MMM yy')
    if (!monthlyMap[key]) monthlyMap[key] = { deposits: 0, withdrawals: 0 }
    if (t.type === 'deposit') monthlyMap[key].deposits += Number(t.amount)
    if (t.type === 'withdrawal') monthlyMap[key].withdrawals += Number(t.amount)
  })
  const monthLabels = Object.keys(monthlyMap).slice(-12)

  const barChartData = {
    labels: monthLabels,
    datasets: [
      { label: 'Deposits', data: monthLabels.map(k => monthlyMap[k]?.deposits || 0), backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4 },
      { label: 'Withdrawals', data: monthLabels.map(k => monthlyMap[k]?.withdrawals || 0), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 }
    ]
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#8a9a90', font: { size: 12 } } },
      tooltip: { callbacks: { label: ctx => ` KES ${ctx.raw.toLocaleString()}` } }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#8a9a90', maxRotation: 45, font: { size: 10 } } },
      y: { grid: { color: 'rgba(128,128,128,0.12)' }, ticks: { color: '#8a9a90', callback: v => `${(v/1000).toFixed(0)}k` } }
    }
  }

  const exportPDF = async () => {
    setExporting('pdf')
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF()
      const pageW = doc.internal.pageSize.width
      doc.setFillColor(10, 22, 40); doc.rect(0, 0, pageW, 40, 'F')
      doc.setTextColor(212, 168, 67); doc.setFontSize(20); doc.setFont('helvetica', 'bold')
      doc.text('Fundex SAVINGS & INVESTMENT', pageW / 2, 18, { align: 'center' })
      doc.setFontSize(10); doc.setTextColor(143, 163, 200)
      doc.text('Financial Report — Generated ' + formatDateTime(new Date()), pageW / 2, 28, { align: 'center' })
      doc.setTextColor(30, 30, 30); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Summary', 14, 52)
      autoTable(doc, { startY: 56, head: [['Metric', 'Value']], body: [['Total Pool Balance', formatCurrency(totalPool)], ['Total Deposits', formatCurrency(totalDeposits)], ['Total Withdrawals', formatCurrency(totalWithdrawals)], ['Total Invested', formatCurrency(totalInvested)], ['Total Returns', formatCurrency(totalReturns)]], styles: { fontSize: 10 }, headStyles: { fillColor: [10, 22, 40], textColor: [212, 168, 67] } })
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Member Contributions', 14, doc.lastAutoTable.finalY + 14)
      autoTable(doc, { startY: doc.lastAutoTable.finalY + 18, head: [['Member', 'Role', 'Total Deposits', 'Withdrawals', 'Net Contribution']], body: data.contributions.map(c => [c.name, c.role, formatCurrency(c.total_deposits), formatCurrency(c.total_withdrawals), formatCurrency(c.net_contribution)]), styles: { fontSize: 10 }, headStyles: { fillColor: [10, 22, 40], textColor: [212, 168, 67] } })
      if (data.transactions.length > 0) {
        doc.addPage(); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Transaction Log', 14, 20)
        autoTable(doc, { startY: 24, head: [['Date', 'Member', 'Type', 'Amount', 'Reference', 'Status']], body: data.transactions.map(t => [formatDate(t.transaction_date), (t.profiles?.name?.split(' ')[0] || '') + ' ' + (t.profiles?.name?.split(' ')[1] || ''), t.type, formatCurrency(t.amount), t.reference || '—', t.status]), styles: { fontSize: 9 }, headStyles: { fillColor: [10, 22, 40], textColor: [212, 168, 67] } })
      }
      if (data.investments.length > 0) {
        doc.addPage(); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Investment Portfolio', 14, 20)
        autoTable(doc, { startY: 24, head: [['Title', 'Type', 'Invested', 'Returns', 'ROI', 'Status']], body: data.investments.map(i => { const roi = Number(i.amount_invested) > 0 ? ((Number(i.actual_return || 0) / Number(i.amount_invested)) * 100).toFixed(1) : '0'; return [i.title, i.investment_type, formatCurrency(i.amount_invested), formatCurrency(i.actual_return || 0), roi + '%', i.status] }), styles: { fontSize: 10 }, headStyles: { fillColor: [10, 22, 40], textColor: [212, 168, 67] } })
      }
      doc.save(`Fundex-report-${formatDate(new Date(), 'yyyy-MM-dd')}.pdf`)
      toast.success('PDF report downloaded!')
    } catch (err) { toast.error('PDF export failed: ' + err.message) }
    setExporting('')
  }

  const exportExcel = async () => {
    setExporting('excel')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const summaryData = [['Fundex SAVINGS & INVESTMENT - FINANCIAL REPORT'], ['Generated:', formatDateTime(new Date())], [], ['SUMMARY'], ['Total Pool Balance', totalPool], ['Total Deposits', totalDeposits], ['Total Withdrawals', totalWithdrawals], ['Total Invested', totalInvested], ['Total Returns', totalReturns]]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Summary')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Role', 'Total Deposits', 'Total Withdrawals', 'Net Contribution'], ...data.contributions.map(c => [c.name, c.role, Number(c.total_deposits), Number(c.total_withdrawals), Number(c.net_contribution)])]), 'Contributions')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'Member', 'Type', 'Amount', 'Reference', 'Description', 'Status'], ...data.transactions.map(t => [formatDateTime(t.transaction_date), t.profiles?.name, t.type, Number(t.amount), t.reference || '', t.description || '', t.status])]), 'Transactions')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Title', 'Type', 'Amount Invested', 'Actual Return', 'ROI %', 'Status', 'Start Date', 'End Date'], ...data.investments.map(i => { const roi = Number(i.amount_invested) > 0 ? ((Number(i.actual_return || 0) / Number(i.amount_invested)) * 100).toFixed(2) : '0'; return [i.title, i.investment_type, Number(i.amount_invested), Number(i.actual_return || 0), roi, i.status, formatDate(i.start_date), i.end_date ? formatDate(i.end_date) : ''] })]), 'Investments')
      if (data.dividends.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Member', 'Investment', 'Ownership %', 'Dividend', 'Date', 'Reinvested'], ...data.dividends.map(d => [d.profiles?.name, d.investments?.title, Number(d.ownership_percentage), Number(d.amount), formatDate(d.distribution_date), d.reinvested ? 'Yes' : 'No'])]), 'Dividends')
      XLSX.writeFile(wb, `Fundex-report-${formatDate(new Date(), 'yyyy-MM-dd')}.xlsx`)
      toast.success('Excel report downloaded!')
    } catch (err) { toast.error('Excel export failed: ' + err.message) }
    setExporting('')
  }

  return (
    <div>
      <PageHeader
        title="Reports & Exports"
        subtitle="Generate and download financial reports"
        onRefresh={fetchData}
        loading={loading}
      >
        <div className="reports-export-btns">
          <button className="btn btn-secondary" onClick={exportExcel} disabled={!!exporting}>
            {exporting === 'excel' ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <TableIcon size={15} />}
            Export Excel
          </button>
          <button className="btn btn-primary" onClick={exportPDF} disabled={!!exporting}>
            {exporting === 'pdf' ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Download size={15} />}
            Export PDF
          </button>
        </div>
      </PageHeader>

      {/* Date filter */}
      <div className="card mb-6">
        <div className="reports-date-row">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Filter by date:</span>
          <div className="reports-date-field">
            <label className="text-xs text-muted" style={{ flexShrink: 0 }}>From</label>
            <input className="form-input" type="date" style={{ flex: 1 }} value={dateRange.from} onChange={e => setDateRange(p => ({ ...p, from: e.target.value }))} />
          </div>
          <div className="reports-date-field">
            <label className="text-xs text-muted" style={{ flexShrink: 0 }}>To</label>
            <input className="form-input" type="date" style={{ flex: 1 }} value={dateRange.to} onChange={e => setDateRange(p => ({ ...p, to: e.target.value }))} />
          </div>
          {(dateRange.from || dateRange.to) && (
            <button className="btn btn-secondary btn-sm" onClick={() => setDateRange({ from: '', to: '' })}>Clear</button>
          )}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid-4 mb-6">
        {[
          { label: 'Pool Balance', value: formatCurrency(totalPool), color: 'gold' },
          { label: 'Total Deposits', value: formatCurrency(totalDeposits), color: 'green' },
          { label: 'Withdrawals', value: formatCurrency(totalWithdrawals), color: 'red' },
          { label: 'Net Returns', value: formatCurrency(totalReturns), color: 'blue' },
        ].map(m => (
          <div key={m.label} className="card">
            <div className="card-title mb-3">{m.label}</div>
            <div className={`stat-value ${m.color} text-mono`} style={{ fontSize: 20 }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Monthly chart */}
      <div className="card mb-6">
        <div className="card-header"><span className="card-title">Monthly Activity</span></div>
        <div style={{ height: 240 }}>
          {monthLabels.length > 0 ? <Bar data={barChartData} options={barOpts} /> : (
            <div className="empty-state"><p>No data for selected period</p></div>
          )}
        </div>
      </div>

      {/* Contribution table — mobile stacked via CSS */}
      <div className="card mb-6">
        <div className="card-header"><span className="card-title">Member Contribution Summary</span></div>
        <div className="table-container" style={{ overflowX: 'auto' }}>
          <table className="reports-contrib-table">
            <thead>
              <tr>
                <th>Member</th><th>Role</th><th>Total Deposits</th><th>Withdrawals</th><th>Net Contribution</th><th>Ownership %</th>
              </tr>
            </thead>
            <tbody>
              {data.contributions.map(c => {
                const ownershipPct = totalPool > 0 ? (Number(c.net_contribution) / totalPool) * 100 : 0
                return (
                  <tr key={c.id}>
                    <td data-label="Member" style={{ fontWeight: 600 }}>{c.name}</td>
                    <td data-label="Role"><span className={`badge badge-${c.role === 'admin' ? 'amber' : 'blue'}`}>{c.role}</span></td>
                    <td data-label="Total Deposits" className="text-mono text-green">{formatCurrency(c.total_deposits)}</td>
                    <td data-label="Withdrawals" className="text-mono text-red">{formatCurrency(c.total_withdrawals)}</td>
                    <td data-label="Net Contribution" className="text-mono font-bold">{formatCurrency(c.net_contribution)}</td>
                    <td data-label="Ownership %" className="text-mono" style={{ color: 'var(--olive-light)' }}>{formatPercentage(ownershipPct)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
