import MemberAvatar from '../components/MemberAvatar'
import PageHeader from '../components/PageHeader'
import MemberActionsModal from '../components/admin/MemberActionsModal'
import { memberStatus } from '../lib/memberAdmin'
import { useState, useEffect, useCallback } from 'react'
import {
  Award, AlertTriangle, AlertCircle, CheckCircle,
  Settings2, Star
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatPercentage, getMemberColor, formatDate } from '../lib/utils'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import toast from 'react-hot-toast'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const EQUITY_STATUS = {
  safe:       { label: '🟢 Safe',       color: 'var(--accent-emerald)', bg: 'rgba(13,156,94,0.10)',  border: 'rgba(13,156,94,0.25)',  icon: CheckCircle },
  near_limit: { label: '🟡 Near Limit', color: 'var(--accent-amber)',   bg: 'rgba(230,144,10,0.10)', border: 'rgba(230,144,10,0.25)', icon: AlertCircle },
  overdrawn:  { label: '🔴 Overdrawn',  color: 'var(--accent-red)',     bg: 'rgba(220,53,69,0.10)',  border: 'rgba(220,53,69,0.25)',  icon: AlertTriangle },
}

export default function MembersPage() {
  const { isAdmin, profile: currentProfile } = useAuth()
  const [members, setMembers]         = useState([])
  const [reliability, setReliability] = useState([])
  const [loading, setLoading]         = useState(true)
  const [activeTab, setActiveTab]     = useState('equity')
  const [managing, setManaging]       = useState(null)   // admin tools for one member
  const [accounts, setAccounts]       = useState({})     // id -> account fields (status, email) for the admin tools

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [equityRes, relRes, accRes] = await Promise.all([
      supabase.from('member_equity_summary').select('*'),
      supabase.from('member_reliability_scores').select('*'),
      supabase.from('profiles').select('id, name, email, phone, role, avatar_url, is_active, login_disabled, must_change_password, deactivated_at, deactivation_reason'),
    ])
    if (accRes.data) setAccounts(Object.fromEntries(accRes.data.map(a => [a.id, a])))
    if (equityRes.error) { toast.error('Failed to load members'); setLoading(false); return }
    if (equityRes.data) {
      const totalEquity = equityRes.data.reduce((s, m) => s + Math.max(0, Number(m.available_equity || 0)), 0)
      setMembers(equityRes.data.map(m => ({
        ...m,
        ownership_pct: totalEquity > 0
          ? (Math.max(0, Number(m.available_equity || 0)) / totalEquity) * 100
          : 0
      })))
    }
    if (relRes.data) setReliability(relRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const totalPool = members.reduce((s, m) => s + Math.max(0, Number(m.available_equity || 0)), 0)
  const overdrawns = members.filter(m => m.equity_status === 'overdrawn')

  const barData = {
    labels: members.map(m => m.name?.split(' ')[0]),
    datasets: [{ label: 'Total Deposits', data: members.map(m => Number(m.total_deposits || 0)), backgroundColor: members.map(m => getMemberColor(m.name) + 'cc'), borderColor: members.map(m => getMemberColor(m.name)), borderWidth: 2, borderRadius: 6 }]
  }
  const barOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` KES ${ctx.raw.toLocaleString()}` } } },
    scales: { x: { grid: { display: false }, ticks: { color: '#8a9a90' } }, y: { grid: { color: 'rgba(128,128,128,0.1)' }, ticks: { color: '#8a9a90', callback: v => `${(v/1000).toFixed(0)}k` } } }
  }

  if (loading) return (
    <div className="flex justify-center items-center" style={{ padding: 80 }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Members & Ownership"
        subtitle="Equity positions, ownership shares, and reliability scores"
        onRefresh={fetchData}
        loading={loading}
      />

      {/* Overdrawn alert */}
      {overdrawns.length > 0 && (
        <div style={{ background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={18} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-red)' }}>{overdrawns.length} member{overdrawns.length !== 1 ? 's are' : ' is'} overdrawn — Admin review required</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{overdrawns.map(m => `${m.name?.split(' ')[0]} (owes ${formatCurrency(Math.abs(Number(m.available_equity)))})`).join(' · ')}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="page-tab-bar">
        {[['equity', '💰 Equity & Ownership'], ['reliability', '⭐ Reliability Scores']].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-main)', fontSize: 14, fontWeight: 600,
            borderBottom: activeTab === id ? '2px solid var(--olive)' : '2px solid transparent',
            color: activeTab === id ? 'var(--olive)' : 'var(--text-muted)',
            position: 'relative', bottom: -1, transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {/* ── EQUITY TAB ── */}
      {activeTab === 'equity' && (
        <>
          <div className="grid-3 mb-6">
            {members.map((member) => {
              const status = member.equity_status || 'safe'
              const statusCfg = EQUITY_STATUS[status] || EQUITY_STATUS.safe
              const StatusIcon = statusCfg.icon
              const available = Number(member.available_equity || 0)
              const totalDeposits = Number(member.total_deposits || 0)
              const totalWithdrawals = Number(member.total_withdrawals || 0)
              const loanBalance = Number(member.loan_balance || 0)
              const rank = [...members].sort((a, b) => Number(b.ownership_pct) - Number(a.ownership_pct)).findIndex(m => m.id === member.id)
              const account = accounts[member.id]
              const accStatus = memberStatus(account)

              return (
                <div key={member.id} className="card" style={{ borderColor: status === 'overdrawn' ? 'rgba(220,53,69,0.3)' : status === 'near_limit' ? 'rgba(230,144,10,0.3)' : 'var(--border)', borderWidth: status !== 'safe' ? 1.5 : 1, opacity: accStatus.key === 'inactive' ? 0.7 : 1 }}>
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <MemberAvatar name={member.name} avatarUrl={member.avatar_url} size={48} fontSize={16}
                        style={{ outline: status === 'overdrawn' ? '2px solid var(--accent-red)' : status === 'near_limit' ? '2px solid var(--accent-amber)' : 'none', outlineOffset: 2 }} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{member.name}</div>
                        <div className="text-xs text-muted">{member.role === 'admin' ? '👑 Admin' : 'Member'}</div>
                        {accStatus.key !== 'active' && <span className={`badge ${accStatus.badge}`} style={{ marginTop: 3 }}>{accStatus.label}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                      {rank === 0 && <span className="badge badge-amber"><Award size={11} /> Top</span>}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 99, background: statusCfg.bg, border: `1px solid ${statusCfg.border}`, fontSize: 11, fontWeight: 700, color: statusCfg.color }}>
                        <StatusIcon size={11} /> {statusCfg.label}
                      </span>
                    </div>
                  </div>

                      {/* Ownership ring */}
                      <div style={{ textAlign: 'center', marginBottom: 16 }}>
                        <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 8px' }}>
                          <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bg-elevated)" strokeWidth="3" />
                            <circle cx="18" cy="18" r="15.9" fill="none"
                              stroke={status === 'overdrawn' ? 'var(--accent-red)' : getMemberColor(member.name)}
                              strokeWidth="3"
                              strokeDasharray={`${Math.max(0, Number(member.ownership_pct))} ${100 - Math.max(0, Number(member.ownership_pct))}`}
                              strokeLinecap="round" style={{ transition: 'stroke-dasharray 1s ease' }} />
                          </svg>
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: status === 'overdrawn' ? 'var(--accent-red)' : getMemberColor(member.name) }}>
                              {formatPercentage(member.ownership_pct, 1)}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-muted">Ownership Share</p>
                      </div>

                      <div className="divider" />
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                        <div><p className="text-xs text-muted mb-1">Total Deposited</p><p className="text-mono font-bold" style={{ fontSize: 13, color: 'var(--accent-emerald)' }}>{formatCurrency(totalDeposits)}</p></div>
                        <div><p className="text-xs text-muted mb-1">Available Equity</p><p className="text-mono font-bold" style={{ fontSize: 13, color: available >= 0 ? 'var(--text-primary)' : 'var(--accent-red)' }}>{formatCurrency(available)}</p></div>
                        <div><p className="text-xs text-muted mb-1">Withdrawals</p><p className="text-mono font-bold" style={{ fontSize: 13, color: 'var(--accent-red)' }}>{formatCurrency(totalWithdrawals)}</p></div>
                        <div><p className="text-xs text-muted mb-1">Pool Share</p><p className="text-mono font-bold" style={{ fontSize: 13, color: 'var(--olive-light)' }}>{totalPool > 0 ? formatCurrency(Number(member.ownership_pct) / 100 * totalPool) : '—'}</p></div>
                        {loanBalance > 0 && (
                          <div style={{ gridColumn: '1 / -1', background: 'rgba(220,53,69,0.07)', borderRadius: 6, padding: '8px 10px', border: '1px solid rgba(220,53,69,0.15)' }}>
                            <p className="text-xs" style={{ color: 'var(--accent-red)', marginBottom: 2, fontWeight: 600 }}>Internal Loan / Debt</p>
                            <p className="text-mono font-bold" style={{ fontSize: 13, color: 'var(--accent-red)' }}>-{formatCurrency(loanBalance)}</p>
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Equity used</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: statusCfg.color }}>{totalDeposits > 0 ? Math.min(100, Math.round((totalWithdrawals / totalDeposits) * 100)) : 0}%</span>
                        </div>
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: `${totalDeposits > 0 ? Math.min(100, (totalWithdrawals / totalDeposits) * 100) : 0}%`, background: status === 'overdrawn' ? 'var(--accent-red)' : status === 'near_limit' ? 'var(--accent-amber)' : getMemberColor(member.name) }} />
                        </div>
                      </div>

                  {/* Admin actions */}
                  {isAdmin && account && member.id !== currentProfile?.id && (
                    <div className="row-actions" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <button className="btn-row-edit" style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setManaging(account)}>
                        <Settings2 size={11} /> Manage
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Contribution chart */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Contribution Comparison</span>
              <div className="text-sm text-muted">Total Pool: <span style={{ color: 'var(--olive)', fontWeight: 700 }}>{formatCurrency(totalPool)}</span></div>
            </div>
            <div style={{ height: 200 }}>
              {members.length > 0 ? <Bar data={barData} options={barOptions} /> : <div className="empty-state"><p>No data yet</p></div>}
            </div>
          </div>
        </>
      )}

      {/* ── RELIABILITY TAB ── */}
      {activeTab === 'reliability' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* <div style={{ background: 'rgba(26,36,114,0.06)', border: '1px solid rgba(26,36,114,0.14)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>
            ⭐ Reliability scores are calculated from: <strong>Consistency</strong> (40pts — months active/12), <strong>Punctuality</strong> (30pts — early vs late deposits), and <strong>Retention</strong> (30pts — how much they keep vs withdraw). Max score: 100.
          </div> */}

          <div className="grid-3">
            {reliability.map(m => {
              const score = m.reliability_score || 0
              const scoreColor = score >= 80 ? 'var(--accent-emerald)' : score >= 60 ? 'var(--olive)' : score >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)'
              return (
                <div key={m.id} className="card">
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <MemberAvatar name={m.name} avatarUrl={m.avatar_url} size={44} fontSize={15} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{m.name}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor }}>{m.reliability_icon} {m.reliability_label}</div>
                    </div>
                  </div>

                  {/* Score ring */}
                  <div style={{ textAlign: 'center', marginBottom: 14 }}>
                    <div style={{ position: 'relative', width: 90, height: 90, margin: '0 auto 6px' }}>
                      <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bg-elevated)" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke={scoreColor} strokeWidth="3"
                          strokeDasharray={`${score} ${100 - score}`} strokeLinecap="round"
                          style={{ transition: 'stroke-dasharray 1s ease' }} />
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                        <span style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-mono)', color: scoreColor, lineHeight: 1 }}>{score}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>/100</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted">Reliability Score</p>
                  </div>

                  <div className="divider" />

                  {/* Score breakdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    {[
                      { label: 'Consistency', pts: m.consistency_pts, max: 40, desc: `${m.active_months_12}/12 months active` },
                      { label: 'Punctuality', pts: m.punctuality_pts, max: 30, desc: `${m.early_deposits} early · ${m.late_deposits} late` },
                      { label: 'Retention',   pts: m.retention_pts,   max: 30, desc: `Kept ${formatPercentage(m.total_deposited > 0 ? (1 - m.total_withdrawn/m.total_deposited)*100 : 100, 0)}` },
                    ].map(s => (
                      <div key={s.label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{s.label}</span>
                          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{s.pts}/{s.max}</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 99, width: `${(s.pts / s.max) * 100}%`, background: scoreColor, transition: 'width 0.8s ease' }} />
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{s.desc}</div>
                      </div>
                    ))}
                  </div>

                  {/* Behaviour stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <div>
                      <p className="text-xs text-muted mb-1">Total Deposits</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-emerald)' }}>{m.deposit_count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-1">Withdrawals</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: m.withdrawal_count > m.deposit_count * 0.5 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{m.withdrawal_count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-1">Total Deposited</p>
                      <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatCurrency(m.total_deposited)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-1">Total Withdrawn</p>
                      <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent-red)' }}>{formatCurrency(m.total_withdrawn)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {reliability.length === 0 && (
            <div className="card"><div className="empty-state">
              <Star size={40} style={{ opacity: 0.2 }} />
              <p style={{ fontWeight: 600 }}>No reliability data yet</p>
              <p className="text-sm">Scores are computed from transaction history — make some transactions first.</p>
            </div></div>
          )}
        </div>
      )}

      {managing && (
        <MemberActionsModal member={managing} me={currentProfile} onClose={() => setManaging(null)} onChanged={fetchData} />
      )}
    </div>
  )
}
