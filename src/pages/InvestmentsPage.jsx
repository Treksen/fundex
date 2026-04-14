import MemberAvatar from '../components/MemberAvatar'
import PageHeader from '../components/PageHeader'
import DecisionPanel from '../components/DecisionPanel'
import AdminActions from '../components/AdminActions'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, X, TrendingUp, TrendingDown, BarChart2,
  Eye, DollarSign, AlertCircle, CheckCircle,
  Clock, Zap, Edit2, Trash2, Save, Download
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, formatPercentage, getMemberColor } from '../lib/utils'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import toast from 'react-hot-toast'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// ── Status config ────────────────────────────────────────────
const STATUS_CFG = {
  active:    { label: '🟢 Active',    badge: 'badge-green',  color: 'var(--accent-emerald)' },
  maturing:  { label: '🟡 Maturing',  badge: 'badge-amber',  color: 'var(--accent-amber)' },
  completed: { label: '🔵 Completed', badge: 'badge-blue',   color: 'var(--navy-light)' },
  loss:      { label: '🔴 Loss',      badge: 'badge-red',    color: 'var(--accent-red)' },
  pending:   { label: '⚪ Pending',   badge: 'badge-gray',   color: 'var(--text-muted)' },
  closed:    { label: '⚫ Closed',    badge: 'badge-gray',   color: 'var(--text-muted)' },
}

function computeStatus(inv) {
  const ret = Number(inv.actual_return || 0)
  const invested = Number(inv.amount_invested)
  if (inv.status === 'completed' || inv.distribution_completed) return 'completed'
  if (ret > 0 && ret < invested) return 'loss'
  if (inv.end_date) {
    const end = new Date(inv.end_date)
    const now = new Date()
    const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24))
    if (daysLeft <= 30 && daysLeft > 0) return 'maturing'
    if (daysLeft <= 0 && inv.status === 'active') return 'maturing'
  }
  return inv.status || 'active'
}

export default function InvestmentsPage() {
  const { profile, isAdmin } = useAuth()
  const [investments, setInvestments] = useState([])
  const [dividends, setDividends] = useState([])
  const [snapshotMap, setSnapshotMap] = useState({})   // investment_id → [snapshots]
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('portfolio')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')

  // Modals
  const [showAdd, setShowAdd] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showDistribute, setShowDistribute] = useState(null)
  const [showEditReturns, setShowEditReturns] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [invRes, divRes, snapRes] = await Promise.all([
      supabase.from('investment_performance').select('*').order('created_at', { ascending: false }),
      supabase.from('dividends')
        .select('*, profiles!dividends_user_id_fkey(name, avatar_url), investments(title)')
        .order('distribution_date', { ascending: false }),
      supabase.from('investment_ownership_snapshots').select('*'),
    ])
    if (invRes.data) setInvestments(invRes.data)
    if (divRes.data) setDividends(divRes.data)
    if (snapRes.data) {
      const map = {}
      snapRes.data.forEach(s => {
        if (!map[s.investment_id]) map[s.investment_id] = []
        map[s.investment_id].push(s)
      })
      setSnapshotMap(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Computed summary stats ──────────────────────────────────
  const summary = useMemo(() => {
    const totalInvested  = investments.reduce((s, i) => s + Number(i.amount_invested), 0)
    const totalReturns   = investments.reduce((s, i) => s + Number(i.actual_return || 0), 0)
    const netProfit      = totalReturns - totalInvested
    const activeCount    = investments.filter(i => computeStatus(i) === 'active').length
    const sorted         = [...investments].filter(i => Number(i.roi_pct) !== 0).sort((a, b) => Number(b.roi_pct) - Number(a.roi_pct))
    const best           = sorted[0] || null
    const worst          = sorted[sorted.length - 1] || null
    return { totalInvested, totalReturns, netProfit, activeCount, best, worst }
  }, [investments])

  // ── Filtered list ────────────────────────────────────────────
  const filtered = useMemo(() => investments.filter(i => {
    const s = computeStatus(i)
    if (filterStatus && s !== filterStatus) return false
    if (filterType && i.investment_type !== filterType) return false
    return true
  }), [investments, filterStatus, filterType])

  const investmentTypes = useMemo(() => [...new Set(investments.map(i => i.investment_type))], [investments])

  // ── Bar chart: profit vs invested per investment ─────────────
  const chartData = useMemo(() => ({
    labels: investments.slice(0, 8).map(i => i.title.length > 14 ? i.title.slice(0, 14) + '…' : i.title),
    datasets: [
      { label: 'Invested', data: investments.slice(0, 8).map(i => Number(i.amount_invested)), backgroundColor: 'rgba(26,36,114,0.7)', borderRadius: 4 },
      { label: 'Returns',  data: investments.slice(0, 8).map(i => Number(i.actual_return || 0)), backgroundColor: investments.slice(0, 8).map(i => Number(i.actual_return || 0) >= Number(i.amount_invested) ? 'rgba(13,156,94,0.8)' : 'rgba(220,53,69,0.7)'), borderRadius: 4 },
    ]
  }), [investments])

  const chartOptions = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } }, tooltip: { callbacks: { label: ctx => ` KES ${ctx.raw.toLocaleString()}` } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
      y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 }, callback: v => `${(v/1000).toFixed(0)}k` } }
    }
  }), [])

  // ── Admin delete investment ──────────────────────────────────
  const handleDeleteInvestment = async (inv) => {
    if (!window.confirm(`Delete "${inv.title}"?\n\nAll associated dividends and ownership snapshots will also be deleted.`)) return
    const { error } = await supabase.from('investments').delete().eq('id', inv.id)
    if (error) toast.error('Delete failed: ' + error.message)
    else { toast.success('Investment deleted'); await fetchData() }
  }

  return (
    <div>
      <PageHeader
        title="Investments"
        subtitle="Group investment portfolio and profit distribution engine"
        onRefresh={fetchData}
        loading={loading}
      >
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Add Investment
          </button>
        )}
      </PageHeader>

      {/* ── Summary cards ── */}
      <div className="grid-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {[
          { label: 'Total Invested', value: formatCurrency(summary.totalInvested), color: 'var(--navy-light)' },
          { label: 'Total Returns',  value: formatCurrency(summary.totalReturns),  color: summary.totalReturns >= summary.totalInvested ? 'var(--accent-emerald)' : 'var(--accent-red)' },
          { label: 'Net Profit',     value: formatCurrency(summary.netProfit),      color: summary.netProfit >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' },
          { label: 'Active Now',     value: summary.activeCount,                    color: 'var(--olive)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
            <div className="card-title mb-2">{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Best / Worst performers */}
      {(summary.best || summary.worst) && (
        <div className="grid-2 mb-6">
          {summary.best && (
            <div className="card" style={{ borderLeft: '3px solid var(--accent-emerald)', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>🏆 Best Performer</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{summary.best.title}</div>
              <div style={{ fontSize: 13, color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>▲ {Math.abs(Number(summary.best.roi_pct)).toFixed(1)}% ROI</div>
            </div>
          )}
          {summary.worst && summary.worst.id !== summary.best?.id && (
            <div className="card" style={{ borderLeft: '3px solid var(--accent-red)', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>⚠️ Lowest Performer</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{summary.worst.title}</div>
              <div style={{ fontSize: 13, color: 'var(--accent-red)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>▼ {Math.abs(Number(summary.worst.roi_pct)).toFixed(1)}% ROI</div>
            </div>
          )}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="page-tab-bar">
        {[['portfolio', 'Portfolio'], ['analytics', 'Analytics'], ['dividends', 'Dividends']].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-main)', fontSize: 14, fontWeight: 600,
            borderBottom: activeTab === id ? '2px solid var(--olive)' : '2px solid transparent',
            color: activeTab === id ? 'var(--olive)' : 'var(--text-muted)',
            position: 'relative', bottom: -1, transition: 'all 0.15s'
          }}>
            {label}
            {id === 'dividends' && dividends.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--olive)', color: '#fff', borderRadius: 99, padding: '1px 6px' }}>{dividends.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── PORTFOLIO TAB ── */}
      {activeTab === 'portfolio' && (
        <>
          {/* Filters */}
          <div className="card mb-4" style={{ padding: '12px 16px' }}>
            <div className="filter-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="form-select" style={{ flex: 1, minWidth: 0 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">All Status</option>
                {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select className="form-select" style={{ flex: 1, minWidth: 0 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
                <option value="">All Types</option>
                {investmentTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {(filterStatus || filterType) && (
                <button className="btn btn-secondary btn-sm" onClick={() => { setFilterStatus(''); setFilterType('') }}>Clear</button>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? (
              <div className="flex justify-center" style={{ padding: 48 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                <p style={{ fontWeight: 600 }}>No investments found</p>
                <p className="text-sm">{investments.length > 0 ? 'Try adjusting your filters' : 'Record your first investment to get started'}</p>
              </div>
            ) : (
              <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Investment</th>
                      <th>Type</th>
                      <th>Invested</th>
                      <th>Returns</th>
                      <th>Net Profit</th>
                      <th>ROI</th>
                      <th>Status</th>
                      <th style={{ width: 160 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(inv => {
                      const status = computeStatus(inv)
                      const scfg = STATUS_CFG[status] || STATUS_CFG.active
                      const netProfit = Number(inv.net_profit || 0)
                      const roi = Number(inv.roi_pct || 0)
                      const hasSnapshot = !!snapshotMap[inv.id]
                      const hasDistributed = inv.distribution_completed

                      return (
                        <tr key={inv.id}>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{inv.title}</div>
                            <div className="text-xs text-muted">
                              {formatDate(inv.start_date)}{inv.end_date ? ` → ${formatDate(inv.end_date)}` : ''}
                            </div>
                            {inv.description && <div className="text-xs text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.description}</div>}
                          </td>
                          <td className="text-sm">{inv.investment_type}</td>
                          <td className="text-mono" style={{ fontSize: 13 }}>{formatCurrency(inv.amount_invested)}</td>
                          <td className="text-mono" style={{ fontSize: 13, color: Number(inv.actual_return) > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                            {Number(inv.actual_return) > 0 ? formatCurrency(inv.actual_return) : '—'}
                          </td>
                          <td className="text-mono" style={{ fontSize: 13, fontWeight: 700, color: netProfit >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                            {Number(inv.actual_return) > 0 ? (netProfit >= 0 ? '+' : '') + formatCurrency(netProfit) : '—'}
                          </td>
                          <td>
                            {Number(inv.actual_return) > 0 ? (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: roi >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                                {roi >= 0 ? '▲' : '▼'} {Math.abs(roi).toFixed(1)}%
                              </span>
                            ) : <span className="text-muted text-xs">—</span>}
                          </td>
                          <td><span className={`badge ${scfg.badge}`}>{scfg.label}</span></td>
                          <td>
                            <div className="row-actions">
                              <button className="btn btn-secondary btn-sm" onClick={() => setShowDetail(inv)} title="View details">
                                <Eye size={12} />
                              </button>
                              {isAdmin && !hasDistributed && (
                                <button className="btn-row-edit" onClick={() => setShowEditReturns(inv)} title="Record returns">
                                  <Edit2 size={11} /> Returns
                                </button>
                              )}
                              {isAdmin && Number(inv.actual_return) > 0 && !hasDistributed && (
                                <button className="btn btn-primary btn-sm" onClick={() => setShowDistribute(inv)} title="Distribute profit">
                                  <DollarSign size={11} /> Distribute
                                </button>
                              )}
                              {hasDistributed && (
                                <span style={{ fontSize: 10, color: 'var(--accent-emerald)', fontWeight: 700 }}>✓ Paid</span>
                              )}
                              {isAdmin && (
                                <button className="btn-row-delete" onClick={() => handleDeleteInvestment(inv)} title="Delete">
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── ANALYTICS TAB ── */}
      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {investments.length === 0 ? (
            <div className="card"><div className="empty-state"><BarChart2 size={40} style={{ opacity: 0.2 }} /><p>No investment data yet</p></div></div>
          ) : (
            <>
              {/* Profit vs Invested chart */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Invested vs Returns by Investment</span>
                </div>
                <div style={{ height: 260 }}>
                  <Bar data={chartData} options={chartOptions} />
                </div>
              </div>

              {/* ROI breakdown table */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">ROI Performance Breakdown</span>
                </div>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Investment</th>
                        <th>Type</th>
                        <th>Invested</th>
                        <th>Returns</th>
                        <th>Net Profit</th>
                        <th>ROI %</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...investments]
                        .sort((a, b) => Number(b.roi_pct || 0) - Number(a.roi_pct || 0))
                        .map(inv => {
                          const roi = Number(inv.roi_pct || 0)
                          const net = Number(inv.net_profit || 0)
                          return (
                            <tr key={inv.id}>
                              <td style={{ fontWeight: 600 }}>{inv.title}</td>
                              <td className="text-sm text-muted">{inv.investment_type}</td>
                              <td className="text-mono text-sm">{formatCurrency(inv.amount_invested)}</td>
                              <td className="text-mono text-sm" style={{ color: Number(inv.actual_return) > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                                {Number(inv.actual_return) > 0 ? formatCurrency(inv.actual_return) : '—'}
                              </td>
                              <td className="text-mono text-sm" style={{ fontWeight: 700, color: net >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                                {Number(inv.actual_return) > 0 ? (net >= 0 ? '+' : '') + formatCurrency(net) : '—'}
                              </td>
                              <td>
                                {Number(inv.actual_return) > 0 ? (
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: roi >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)', fontFamily: 'var(--font-mono)' }}>
                                      {roi >= 0 ? '▲' : '▼'} {Math.abs(roi).toFixed(2)}%
                                    </div>
                                    <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 99, marginTop: 4, width: 60, overflow: 'hidden' }}>
                                      <div style={{ height: '100%', background: roi >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)', width: `${Math.min(100, Math.abs(roi))}%`, borderRadius: 99 }} />
                                    </div>
                                  </div>
                                ) : <span className="text-muted text-xs">Pending</span>}
                              </td>
                              <td><span className={`badge ${(STATUS_CFG[computeStatus(inv)] || STATUS_CFG.active).badge}`}>{(STATUS_CFG[computeStatus(inv)] || STATUS_CFG.active).label}</span></td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── DIVIDENDS TAB ── */}
      {activeTab === 'dividends' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {dividends.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">💰</div>
              <p>No dividends distributed yet</p>
            </div>
          ) : (
            <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Investment</th>
                    <th>Ownership at Time</th>
                    <th>Dividend</th>
                    <th>Date</th>
                    <th>Reinvested?</th>
                    {isAdmin && <th style={{ width: 70 }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {dividends.map(d => (
                    <tr key={d.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <MemberAvatar name={d.profiles?.name} avatarUrl={d.profiles?.avatar_url} size={28} fontSize={10} />
                          {d.profiles?.name?.split(' ')[0]}
                        </div>
                      </td>
                      <td className="text-sm">{d.investments?.title || '—'}</td>
                      <td className="text-mono text-sm">{formatPercentage(d.ownership_percentage)}</td>
                      <td className="text-mono font-bold" style={{ color: 'var(--accent-emerald)' }}>{formatCurrency(d.amount)}</td>
                      <td className="text-sm text-muted">{formatDate(d.distribution_date)}</td>
                      <td><span className={`badge badge-${d.reinvested ? 'blue' : 'gray'}`}>{d.reinvested ? 'Yes' : 'No'}</span></td>
                      {isAdmin && (
                        <td>
                          <AdminActions
                            onDelete={async () => {
                              if (!window.confirm('Delete this dividend record?')) return
                              const { error } = await supabase.from('dividends').delete().eq('id', d.id)
                              if (error) toast.error(error.message)
                              else { toast.success('Dividend deleted'); fetchData() }
                            }}
                            size="xs"
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {showAdd && <AddInvestmentModal onClose={() => setShowAdd(false)} onSuccess={fetchData} />}
      {showDetail && <InvestmentDetailModal investment={showDetail} snapshots={snapshotMap[showDetail.id] || []} dividends={dividends.filter(d => d.investment_id === showDetail.id)} onClose={() => setShowDetail(null)} />}
      {showDistribute && <DistributeProfitModal investment={showDistribute} snapshots={snapshotMap[showDistribute.id] || []} onClose={() => setShowDistribute(null)} onSuccess={fetchData} />}
      {showEditReturns && <EditReturnsModal investment={showEditReturns} onClose={() => setShowEditReturns(null)} onSuccess={fetchData} />}
    </div>
  )
}

// ── ADD INVESTMENT MODAL ──────────────────────────────────────
function AddInvestmentModal({ onClose, onSuccess }) {
  const { profile } = useAuth()
  const [form, setForm] = useState({
    title: '', investment_type: '', description: '', notes: '',
    amount_invested: '', expected_return: '',
    start_date: new Date().toISOString().slice(0, 10), end_date: '',
  })
  const [loading, setLoading] = useState(false)
  const handleChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (Number(form.amount_invested) <= 0) { toast.error('Amount must be greater than zero'); return }
    setLoading(true)

    // Insert investment
    const { data: inv, error } = await supabase.from('investments').insert({
      title: form.title.trim(),
      investment_type: form.investment_type,
      description: form.description || null,
      notes: form.notes || null,
      amount_invested: Number(form.amount_invested),
      expected_return: form.expected_return ? Number(form.expected_return) : null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      created_by: profile.id,
      status: 'active',
    }).select().single()

    if (error || !inv) { toast.error(error?.message || 'Failed to create investment'); setLoading(false); return }

    // Capture ownership snapshot at creation time
    const { error: snapErr } = await supabase.rpc('snapshot_ownership_for_investment', { p_investment_id: inv.id })
    if (snapErr) console.warn('Snapshot warning:', snapErr.message)

    // Notify all members
    const { data: allMembers } = await supabase.from('profiles').select('id')
    if (allMembers) {
      await supabase.from('notifications').insert(
        allMembers.map(m => ({
          user_id: m.id,
          title: '📈 New Investment Created',
          message: `A new investment "${form.title}" of ${formatCurrency(Number(form.amount_invested))} has been recorded.`,
          type: 'info',
          action_url: '/investments',
        }))
      )
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: profile.id, action: 'Created investment: ' + form.title,
      table_name: 'investments', record_id: inv.id,
    })

    toast.success('Investment recorded + ownership snapshot captured!')
    setLoading(false)
    onSuccess()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2 className="modal-title">Add Investment</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Investment Title</label>
              <input className="form-input" name="title" value={form.title} onChange={handleChange} placeholder="e.g. Real Estate Plot" required />
            </div>
            <div className="form-group">
              <label className="form-label">Investment Type</label>
              <select className="form-select" name="investment_type" value={form.investment_type} onChange={handleChange} required>
                <option value="">Select type…</option>
                {['Real Estate', 'Stock Market', 'Government Bonds', 'Business', 'Cryptocurrency', 'Fixed Deposit', 'Agriculture', 'Other'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Amount Invested (KES)</label>
                <input className="form-input" name="amount_invested" type="number" min="0.01" step="0.01" value={form.amount_invested} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label className="form-label">Expected Return (KES)</label>
                <input className="form-input" name="expected_return" type="number" min="0" value={form.expected_return} onChange={handleChange} placeholder="Optional" />
              </div>
            </div>

            {/* Smart advisor — checks safe investment capacity */}
            {form.amount_invested && Number(form.amount_invested) > 0 && (
              <div style={{ marginBottom: 12 }}>
                <DecisionPanel amount={form.amount_invested} action="invest" />
              </div>
            )}
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input className="form-input" name="start_date" type="date" value={form.start_date} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label className="form-label">Maturity / End Date</label>
                <input className="form-input" name="end_date" type="date" value={form.end_date} onChange={handleChange} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" name="description" value={form.description} onChange={handleChange} placeholder="Details about this investment…" rows={2} />
            </div>
            <div style={{ background: 'rgba(90,138,30,0.06)', border: '1px solid rgba(90,138,30,0.2)', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
              📸 An <strong>ownership snapshot</strong> will be captured automatically when this investment is saved.
            </div>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
                {loading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : 'Record Investment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── EDIT RETURNS MODAL ───────────────────────────────────────
function EditReturnsModal({ investment, onClose, onSuccess }) {
  const { profile } = useAuth()
  const [actualReturn, setActualReturn] = useState(investment.actual_return || '')
  const [status, setStatus] = useState(investment.status || 'active')
  const [notes, setNotes] = useState(investment.notes || '')
  const [loading, setLoading] = useState(false)

  const roi = actualReturn && Number(investment.amount_invested) > 0
    ? ((Number(actualReturn) - Number(investment.amount_invested)) / Number(investment.amount_invested) * 100).toFixed(2)
    : null

  const handleSave = async () => {
    setLoading(true)
    const { error } = await supabase.from('investments').update({
      actual_return: actualReturn ? Number(actualReturn) : null,
      status,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', investment.id)

    if (error) { toast.error('Update failed: ' + error.message); setLoading(false); return }

    await supabase.from('audit_logs').insert({
      user_id: profile.id, action: `Updated investment returns: ${investment.title}`,
      table_name: 'investments', record_id: investment.id,
    })

    toast.success('Investment updated!')
    setLoading(false)
    onSuccess()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Record Returns</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600 }}>{investment.title}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Invested: {formatCurrency(investment.amount_invested)}</p>
          </div>
          <div className="form-group">
            <label className="form-label">Actual Return (KES)</label>
            <input className="form-input" type="number" min="0" step="0.01" value={actualReturn} onChange={e => setActualReturn(e.target.value)} placeholder="0.00" />
            {roi !== null && (
              <p style={{ fontSize: 12, marginTop: 4, color: Number(roi) >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)', fontWeight: 600 }}>
                {Number(roi) >= 0 ? '▲' : '▼'} {Math.abs(Number(roi))}% ROI · Net {Number(actualReturn) >= Number(investment.amount_invested) ? '+' : ''}{formatCurrency(Number(actualReturn) - Number(investment.amount_invested))}
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Update Status</label>
            <select className="form-select" value={status} onChange={e => setStatus(e.target.value)}>
              {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about the returns…" rows={2} />
          </div>
          <div className="flex gap-3">
            <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary flex-1" onClick={handleSave} disabled={loading}>
              {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><Save size={14} /> Save Returns</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── DISTRIBUTE PROFIT MODAL ──────────────────────────────────
function DistributeProfitModal({ investment, snapshots, onClose, onSuccess }) {
  const { profile } = useAuth()
  const [profit, setProfit] = useState(investment.actual_return || '')
  const [reinvest, setReinvest] = useState(false)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const totalPct = snapshots.reduce((s, m) => s + Number(m.percentage), 0)
  const net = Number(profit) - Number(investment.amount_invested)

  const handleDistribute = async () => {
    if (!profit || Number(profit) <= 0) { toast.error('Enter a valid profit amount'); return }
    if (snapshots.length === 0) { toast.error('No ownership snapshot found. Re-save the investment to capture one.'); return }
    setLoading(true)

    const { data: result, error } = await supabase.rpc('distribute_investment_profit', {
      p_investment_id: investment.id,
      p_profit: Number(profit),
      p_reinvested: reinvest,
      p_notes: notes || null,
    })

    if (error || result?.error) {
      toast.error(error?.message || result?.error)
      setLoading(false)
      return
    }

    await supabase.from('audit_logs').insert({
      user_id: profile.id, action: `Distributed profit for investment: ${investment.title}`,
      table_name: 'investments', record_id: investment.id,
    })

    toast.success(`Dividends distributed to ${result.members_paid} members! 💰`)
    setLoading(false)
    onSuccess()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2 className="modal-title">Distribute Profit</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {/* Investment summary */}
          <div style={{ background: 'rgba(90,138,30,0.07)', border: '1px solid rgba(90,138,30,0.2)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--olive)' }}>{investment.title}</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              Invested: <strong>{formatCurrency(investment.amount_invested)}</strong>
              {profit && <> · Net profit: <strong style={{ color: net >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>{formatCurrency(net)}</strong></>}
            </p>
            {snapshots.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                📸 Using ownership snapshot from {formatDate(snapshots[0]?.snapshot_date)} · {snapshots.length} members · {totalPct.toFixed(1)}% accounted
              </p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Total Amount to Distribute (KES)</label>
            <input className="form-input" type="number" min="0.01" step="0.01" value={profit} onChange={e => setProfit(e.target.value)} placeholder="0.00" />
          </div>

          {/* Distribution preview — uses snapshot, not current ownership */}
          {snapshots.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p className="form-label" style={{ marginBottom: 8 }}>
                Distribution Preview
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>(based on snapshot at investment time)</span>
              </p>
              {snapshots
                .filter(s => Number(s.percentage) > 0)
                .sort((a, b) => Number(b.percentage) - Number(a.percentage))
                .map(s => (
                  <div key={s.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2">
                      <MemberAvatar name={s.name} avatarUrl={s.avatar_url} size={26} fontSize={10} />
                      <span style={{ fontSize: 13 }}>{s.name?.split(' ')[0]}</span>
                      <span className="text-xs text-muted">({formatPercentage(s.percentage)})</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>
                        {profit ? formatCurrency((Number(s.percentage) / 100) * Number(profit)) : '—'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        of {formatCurrency(s.member_invested_amount)} invested
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {snapshots.length === 0 && (
            <div style={{ background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.2)', borderRadius: 8, padding: 10, marginBottom: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--accent-red)' }}>⚠️ No ownership snapshot found for this investment. Distribution will use current equity percentages instead.</p>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Distribution Notes (optional)</label>
            <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes about this distribution…" rows={2} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={reinvest} onChange={e => setReinvest(e.target.checked)} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Mark dividends as reinvested (not paid out in cash)</span>
          </label>

          <div className="flex gap-3">
            <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary flex-1" onClick={handleDistribute} disabled={loading || !profit}>
              {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><DollarSign size={14} /> Distribute to All Members</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── INVESTMENT DETAIL MODAL ──────────────────────────────────
function InvestmentDetailModal({ investment, snapshots, dividends, onClose }) {
  const status = computeStatus(investment)
  const scfg = STATUS_CFG[status] || STATUS_CFG.active
  const roi = Number(investment.roi_pct || 0)
  const net = Number(investment.net_profit || 0)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 600, maxHeight: '90vh' }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{investment.title}</h2>
            <span className={`badge ${scfg.badge}`} style={{ marginTop: 4 }}>{scfg.label}</span>
          </div>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {/* Key stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 18 }}>
            {[
              { label: 'Invested', value: formatCurrency(investment.amount_invested), color: 'var(--navy-light)' },
              { label: 'Returns', value: Number(investment.actual_return) > 0 ? formatCurrency(investment.actual_return) : '—', color: Number(investment.actual_return) > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)' },
              { label: 'Net Profit', value: Number(investment.actual_return) > 0 ? (net >= 0 ? '+' : '') + formatCurrency(net) : '—', color: net >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* ROI bar */}
          {Number(investment.actual_return) > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>ROI</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: roi >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)', fontFamily: 'var(--font-mono)' }}>
                  {roi >= 0 ? '▲' : '▼'} {Math.abs(roi).toFixed(2)}%
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: roi >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)', width: `${Math.min(100, Math.abs(roi))}%`, borderRadius: 99, transition: 'width 0.5s' }} />
              </div>
            </div>
          )}

          {/* Details */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 18, fontSize: 13 }}>
            {[
              ['Type', investment.investment_type],
              ['Start Date', formatDate(investment.start_date)],
              ['End Date', investment.end_date ? formatDate(investment.end_date) : '—'],
              ['Expected Return', investment.expected_return ? formatCurrency(investment.expected_return) : '—'],
              ['Created By', investment.created_by_name || '—'],
              ['Distributed?', investment.distribution_completed ? '✅ Yes' : '⏳ Pending'],
            ].map(([l, v]) => (
              <div key={l} style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>{l}</div>
                <div style={{ fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>

          {investment.description && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>DESCRIPTION</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{investment.description}</p>
            </div>
          )}

          {/* Ownership snapshot */}
          {snapshots.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>OWNERSHIP SNAPSHOT AT INVESTMENT TIME</p>
              {snapshots
                .filter(s => Number(s.percentage) > 0)
                .sort((a, b) => Number(b.percentage) - Number(a.percentage))
                .map(s => (
                  <div key={s.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2">
                      <MemberAvatar name={s.name} avatarUrl={s.avatar_url} size={26} fontSize={10} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{formatPercentage(s.percentage)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatCurrency(s.member_invested_amount)}</div>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Dividends */}
          {dividends.length > 0 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>DIVIDENDS PAID</p>
              {dividends.map(d => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <MemberAvatar name={d.profiles?.name} avatarUrl={d.profiles?.avatar_url} size={24} fontSize={9} />
                    <span style={{ fontSize: 13 }}>{d.profiles?.name?.split(' ')[0]}</span>
                    <span className="text-xs text-muted">({formatPercentage(d.ownership_percentage)})</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(d.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
