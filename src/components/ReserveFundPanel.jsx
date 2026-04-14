import { useState, useEffect, useCallback } from 'react'
import { Shield, ArrowDownCircle, ArrowUpCircle, Settings, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, formatDateTime } from '../lib/utils'
import toast from 'react-hot-toast'

const HEALTH_CFG = {
  healthy:       { label: '✅ Healthy',        color: 'var(--accent-emerald)', bg: 'rgba(13,156,94,0.08)',  border: 'rgba(13,156,94,0.25)' },
  building:      { label: '🔄 Building',       color: 'var(--olive)',          bg: 'rgba(90,138,30,0.08)',  border: 'rgba(90,138,30,0.2)' },
  low:           { label: '🟡 Low',            color: 'var(--accent-amber)',   bg: 'rgba(230,144,10,0.08)', border: 'rgba(230,144,10,0.25)' },
  below_minimum: { label: '⚠️ Below Minimum', color: 'var(--accent-amber)',   bg: 'rgba(230,144,10,0.1)',  border: 'rgba(230,144,10,0.3)' },
  unfunded:      { label: '🔴 Unfunded',       color: 'var(--accent-red)',     bg: 'rgba(220,53,69,0.08)',  border: 'rgba(220,53,69,0.25)' },
}

export default function ReserveFundPanel({ onUpdate }) {
  const { profile, isAdmin } = useAuth()
  const [status, setStatus]     = useState(null)
  const [history, setHistory]   = useState([])
  const [policy, setPolicy]     = useState(null)
  const [loading, setLoading]   = useState(true)

  // Modal state
  const [showFund, setShowFund]       = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showPolicy, setShowPolicy]   = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)

    // Trigger a background sync first so the view is fresh
    try { await supabase.rpc('sync_virtual_account_balances') } catch(_) {}

    const [statusRes, histRes, policyRes, txRes, contribRes] = await Promise.all([
      supabase.from('reserve_fund_status').select('*').single(),
      supabase.from('reserve_contributions')
        .select('*, profiles!reserve_contributions_created_by_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('reserve_policy').select('*').order('updated_at', { ascending: false }).limit(1).single(),
      supabase.from('transactions').select('type,amount,status').eq('status', 'completed'),
      supabase.from('reserve_contributions').select('direction,amount,source'),
    ])

    // Compute balances directly from source data (bypasses stale virtual_accounts view)
    const txs = txRes.data || []
    const contribs = contribRes.data || []
    const policy = policyRes.data

    const totalDeposits = txs.filter(t => t.type === 'deposit').reduce((s, t) => s + Number(t.amount), 0)
    const totalWithdrawals = txs.filter(t => t.type === 'withdrawal').reduce((s, t) => s + Number(t.amount), 0)
    const totalAdjustments = txs.filter(t => t.type === 'adjustment').reduce((s, t) => s + Number(t.amount), 0)
    const reserveAllocatedFromPool = contribs
      .filter(r => r.source === 'group_pool')
      .reduce((s, r) => s + (r.direction === 'allocate' ? Number(r.amount) : -Number(r.amount)), 0)
    const computedPool = totalDeposits - totalWithdrawals + totalAdjustments - reserveAllocatedFromPool
    const computedReserve = contribs
      .reduce((s, r) => s + (r.direction === 'allocate' ? Number(r.amount) : -Number(r.amount)), 0)

    const targetPct = policy?.target_pct_of_pool || 10
    const targetBalance = Math.round(computedPool * targetPct / 100 * 100) / 100
    const vsTarget = computedReserve - targetBalance
    const pctOfTarget = targetBalance > 0 ? Math.round((computedReserve / targetBalance) * 100 * 10) / 10 : 0

    let healthStatus = 'unfunded'
    if (computedReserve > 0) {
      if (computedReserve < (policy?.min_balance || 0)) healthStatus = 'below_minimum'
      else if (computedReserve < targetBalance * 0.5) healthStatus = 'low'
      else if (computedReserve < targetBalance) healthStatus = 'building'
      else healthStatus = 'healthy'
    }

    // Use computed status — fall back to view data if available
    const computedStatus = {
      current_balance: computedReserve,
      group_pool_balance: computedPool,
      target_balance: targetBalance,
      target_pct_of_pool: targetPct,
      vs_target: vsTarget,
      pct_of_target: pctOfTarget,
      health_status: healthStatus,
      min_balance: policy?.min_balance || 0,
    }

    setStatus(statusRes.data && Number(statusRes.data.group_pool_balance) > 0
      ? statusRes.data   // view is fresh — use it
      : computedStatus   // view is stale — use computed
    )
    if (histRes.data) setHistory(histRes.data)
    if (policyRes.data) setPolicy(policyRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return (
    <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
      <div className="spinner" style={{ width: 24, height: 24 }} />
    </div>
  )

  const health = status?.health_status || 'unfunded'
  const hcfg = HEALTH_CFG[health] || HEALTH_CFG.unfunded
  const pct = Math.min(100, Number(status?.pct_of_target || 0))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Status card */}
      <div className="card" style={{ borderLeft: `4px solid ${hcfg.color}` }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: hcfg.bg, border: `1px solid ${hcfg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={20} style={{ color: hcfg.color }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Emergency Reserve Fund</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                Target: {status?.target_pct_of_pool}% of pool ({formatCurrency(status?.target_balance || 0)})
              </div>
            </div>
          </div>
          <span style={{ padding: '4px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: hcfg.bg, border: `1px solid ${hcfg.border}`, color: hcfg.color }}>
            {hcfg.label}
          </span>
        </div>

        {/* Balance */}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'var(--font-mono)', color: hcfg.color, lineHeight: 1 }}>
            {formatCurrency(status?.current_balance || 0)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Current Reserve Balance</div>
        </div>

        {/* Progress toward target */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Progress toward target</span>
            <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: hcfg.color }}>{pct}%</span>
          </div>
          <div style={{ height: 10, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${hcfg.color}aa, ${hcfg.color})`,
              transition: 'width 1s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>KES 0</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Target: {formatCurrency(status?.target_balance || 0)}</span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Group Pool',    value: formatCurrency(status?.group_pool_balance || 0), color: 'var(--navy-light)' },
            { label: 'Vs Target',     value: (Number(status?.vs_target || 0) >= 0 ? '+' : '') + formatCurrency(Number(status?.vs_target || 0)), color: Number(status?.vs_target || 0) >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' },
            { label: 'Min Balance',   value: formatCurrency(policy?.min_balance || 0), color: 'var(--text-secondary)' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Auto-skim status */}
        {policy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: policy.auto_allocate_on_deposit ? 'var(--accent-emerald)' : 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-secondary)' }}>
              Auto-skim: {policy.auto_allocate_on_deposit
                ? <strong style={{ color: 'var(--accent-emerald)' }}>{policy.auto_allocate_pct}% of every deposit is automatically added to reserve</strong>
                : <span style={{ color: 'var(--text-muted)' }}>Off — manually fund the reserve below</span>
              }
            </span>
          </div>
        )}

        {/* Action buttons */}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" style={{ flex: 1, minWidth: 120, justifyContent: 'center' }} onClick={() => setShowFund(true)}>
              <ArrowDownCircle size={13} /> Fund Reserve
            </button>
            <button className="btn btn-secondary btn-sm" style={{ flex: 1, minWidth: 120, justifyContent: 'center' }} onClick={() => setShowWithdraw(true)}
              disabled={Number(status?.current_balance || 0) <= 0}>
              <ArrowUpCircle size={13} /> Withdraw
            </button>
            <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => setShowPolicy(true)} title="Configure policy">
              <Settings size={13} />
            </button>
          </div>
        )}

        {!isAdmin && Number(status?.current_balance || 0) <= 0 && (
          <div style={{ fontSize: 13, color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} /> Reserve is unfunded — ask your group admin to allocate funds.
          </div>
        )}
      </div>

      {/* Contribution history */}
      {history.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={14} style={{ color: 'var(--text-muted)' }} />
            <span className="card-title" style={{ fontSize: 14 }}>Reserve History</span>
          </div>
          <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Direction</th><th>Source</th><th>Notes</th><th>By</th><th style={{ textAlign: 'right' }}>Amount</th>
                  {isAdmin && <th style={{ width: 70 }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td className="text-xs text-muted">{formatDate(h.created_at)}</td>
                    <td>
                      <span className={`badge ${h.direction === 'allocate' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 10 }}>
                        {h.direction === 'allocate' ? '↓ Funded' : '↑ Withdrawn'}
                      </span>
                    </td>
                    <td className="text-sm" style={{ textTransform: 'capitalize' }}>{h.source?.replace('_', ' ')}</td>
                    <td className="text-xs text-muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.notes || '—'}</td>
                    <td className="text-sm">{h.profiles?.name?.split(' ')[0]}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color: h.direction === 'allocate' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                      {h.direction === 'allocate' ? '+' : '-'}{formatCurrency(h.amount)}
                    </td>
                    {isAdmin && (
                      <td>
                        <button
                          className="btn-row-delete"
                          style={{ padding: '3px 8px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}
                          onClick={async () => {
                            if (!window.confirm('Delete this reserve history entry? The balance will be recalculated.')) return
                            const { error } = await supabase.from('reserve_contributions').delete().eq('id', h.id)
                            if (error) { toast.error(error.message); return }
                            toast.success('Entry deleted')
                            fetchData()
                          }}
                        >
                          🗑️
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {showFund     && <FundModal     onClose={() => { setShowFund(false);     fetchData(); onUpdate?.() }} poolBalance={status?.group_pool_balance} />}
      {showWithdraw && <WithdrawModal onClose={() => { setShowWithdraw(false); fetchData(); onUpdate?.() }} reserveBalance={status?.current_balance} />}
      {showPolicy   && <PolicyModal   policy={policy} onClose={() => { setShowPolicy(false); fetchData() }} />}
    </div>
  )
}

// ── FUND MODAL ────────────────────────────────────────────────
function FundModal({ onClose, poolBalance }) {
  const { profile } = useAuth()
  const [form, setForm] = useState({ amount: '', source: 'group_pool', notes: '' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    if (form.source === 'group_pool' && amount > Number(poolBalance || 0)) {
      toast.error(`Amount exceeds available pool balance (${formatCurrency(poolBalance)})`)
      return
    }
    setLoading(true)
    const { data, error } = await supabase.rpc('fund_emergency_reserve', {
      p_amount: amount,
      p_source: form.source,
      p_notes: form.notes || null,
      p_admin_id: profile.id,
      p_reference: null,
    })
    if (error || !data?.success) {
      toast.error(error?.message || data?.error || 'Failed to fund reserve')
    } else {
      toast.success(`✅ KES ${amount.toLocaleString()} allocated to reserve! New balance: ${formatCurrency(data.new_reserve_balance)}`)
      onClose()
    }
    setLoading(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2 className="modal-title">Fund Emergency Reserve</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: 'rgba(90,138,30,0.07)', border: '1px solid rgba(90,138,30,0.2)', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
            🛡️ Funds moved to the reserve are <strong>ring-fenced</strong> — they are separated from the main group pool and can only be accessed through an explicit withdrawal. The group pool balance will decrease by the allocated amount.
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Amount to Allocate (KES) *</label>
              <input className="form-input" type="number" min="1" step="0.01"
                value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                placeholder="0.00" required />
              {form.source === 'group_pool' && poolBalance > 0 && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Available in pool: <strong>{formatCurrency(poolBalance)}</strong>
                </p>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Source of Funds</label>
              <select className="form-select" value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))}>
                <option value="group_pool">💰 Group Main Pool</option>
                <option value="investment_return">📈 Investment Return</option>
                <option value="manual">✍️ Manual / External</option>
              </select>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {form.source === 'group_pool' && 'Funds are transferred from the group wallet to the reserve.'}
                {form.source === 'investment_return' && 'Record a portion of an investment profit allocated to reserve.'}
                {form.source === 'manual' && 'Record an external or manually transferred amount.'}
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Notes (optional)</label>
              <input className="form-input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="e.g. Q1 2026 reserve top-up, emergency preparedness…" />
            </div>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
                {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><ArrowDownCircle size={14} /> Allocate to Reserve</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── WITHDRAW MODAL ────────────────────────────────────────────
function WithdrawModal({ onClose, reserveBalance }) {
  const { profile } = useAuth()
  const [form, setForm] = useState({ amount: '', reason: '' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    if (!form.reason.trim()) { toast.error('Reason is required for reserve withdrawals'); return }
    if (amount > Number(reserveBalance || 0)) {
      toast.error(`Cannot withdraw more than the reserve balance (${formatCurrency(reserveBalance)})`)
      return
    }
    if (!window.confirm(`Withdraw ${formatCurrency(amount)} from the Emergency Reserve?\n\nReason: ${form.reason}\n\nThis action will be logged and all members notified.`)) return

    setLoading(true)
    const { data, error } = await supabase.rpc('withdraw_from_reserve', {
      p_amount: amount,
      p_reason: form.reason.trim(),
      p_admin_id: profile.id,
    })
    if (error || !data?.success) {
      toast.error(error?.message || data?.error || 'Withdrawal failed')
    } else {
      toast.success(`Reserve withdrawal recorded. New balance: ${formatCurrency(data.new_balance)}`)
      onClose()
    }
    setLoading(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h2 className="modal-title">Withdraw from Reserve</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: 'rgba(220,53,69,0.07)', border: '1px solid rgba(220,53,69,0.2)', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
            ⚠️ Reserve withdrawals should only be made for genuine emergencies. All members will be notified and this will be permanently recorded in the audit log.
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Amount to Withdraw (KES) *</label>
              <input className="form-input" type="number" min="1" step="0.01"
                value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                placeholder="0.00" required />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Available: <strong>{formatCurrency(reserveBalance)}</strong>
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Reason / Emergency Description *</label>
              <textarea className="form-textarea" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                placeholder="Describe the emergency or reason for this withdrawal…" rows={3} required />
            </div>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-danger flex-1" disabled={loading}>
                {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><ArrowUpCircle size={14} /> Confirm Withdrawal</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── POLICY MODAL ──────────────────────────────────────────────
function PolicyModal({ policy, onClose }) {
  const { profile } = useAuth()
  const [form, setForm] = useState({
    target_pct_of_pool:       policy?.target_pct_of_pool || 10,
    min_balance:              policy?.min_balance || 0,
    auto_allocate_on_deposit: policy?.auto_allocate_on_deposit || false,
    auto_allocate_pct:        policy?.auto_allocate_pct || 2,
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const { error } = await supabase.from('reserve_policy')
      .upsert({ ...form, updated_by: profile.id, updated_at: new Date().toISOString() })
    if (error) { toast.error('Failed to save policy: ' + error.message) }
    else {
      toast.success('Reserve policy updated!')
      onClose()
    }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h2 className="modal-title">Reserve Fund Policy</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Target — % of Group Pool</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input className="form-input" type="number" min="0" max="50" step="0.5"
                value={form.target_pct_of_pool} onChange={e => setForm(p => ({ ...p, target_pct_of_pool: e.target.value }))} style={{ flex: 1 }} />
              <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>% of pool</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Recommended: 10–15%. The reserve target updates automatically as the pool grows.
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">Minimum Balance Alert (KES)</label>
            <input className="form-input" type="number" min="0" step="100"
              value={form.min_balance} onChange={e => setForm(p => ({ ...p, min_balance: e.target.value }))}
              placeholder="e.g. 10000" />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              You'll be alerted when the reserve drops below this amount.
            </p>
          </div>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: form.auto_allocate_on_deposit ? 12 : 0 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700 }}>Auto-skim on every deposit</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Automatically allocate a % of each deposit to the reserve</p>
              </div>
              <div onClick={() => setForm(p => ({ ...p, auto_allocate_on_deposit: !p.auto_allocate_on_deposit }))}
                style={{ width: 40, height: 22, borderRadius: 99, cursor: 'pointer', position: 'relative', flexShrink: 0,
                  background: form.auto_allocate_on_deposit ? 'var(--olive)' : 'var(--bg-elevated)',
                  border: `1px solid ${form.auto_allocate_on_deposit ? 'var(--olive)' : 'var(--border)'}`,
                  transition: 'background 0.2s' }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
                  left: form.auto_allocate_on_deposit ? 20 : 2, transition: 'left 0.2s' }} />
              </div>
            </div>
            {form.auto_allocate_on_deposit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input className="form-input" type="number" min="0.5" max="20" step="0.5"
                  value={form.auto_allocate_pct} onChange={e => setForm(p => ({ ...p, auto_allocate_pct: e.target.value }))} style={{ flex: 1 }} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>% of each deposit</span>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary flex-1" onClick={handleSave} disabled={saving}>
              {saving ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><Settings size={13} /> Save Policy</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
