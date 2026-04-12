import { useState, useEffect } from 'react'
import { X, AlertTriangle, AlertCircle, CheckCircle, TrendingDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency } from '../../lib/utils'
import DecisionPanel from '../DecisionPanel'
import toast from 'react-hot-toast'

export default function AddTransactionModal({ onClose, onSuccess, preselectedUser }) {
  const getLocalDateTime = () => {
    const now = new Date()
    const offset = now.getTimezoneOffset() * 60000
    const local = new Date(now - offset)
    return local.toISOString().slice(0, 16)
  }

  const { profile, isAdmin } = useAuth()
  const [members, setMembers] = useState([])
  const [equityData, setEquityData] = useState(null)  // equity for selected member
  const [loadingEquity, setLoadingEquity] = useState(false)
  const [form, setForm] = useState({
    user_id: preselectedUser || profile?.id || '',
    amount: '',
    type: 'deposit',
    reference: '',
    description: '',
    transaction_date: getLocalDateTime(),
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchMembers() }, [])

  useEffect(() => {
    if (form.user_id && form.type === 'withdrawal') {
      fetchEquity(form.user_id)
    } else {
      setEquityData(null)
    }
  }, [form.user_id, form.type])

  const fetchMembers = async () => {
    const { data } = await supabase.from('profiles').select('id, name, role')
    if (data) setMembers(data)
  }

  const fetchEquity = async (userId) => {
    setLoadingEquity(true)
    const { data } = await supabase
      .from('member_equity_summary')
      .select('*')
      .eq('id', userId)
      .single()
    setEquityData(data || null)
    setLoadingEquity(false)
  }

  const handleChange = e => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  // Equity analysis for withdrawal
  const getWithdrawalAnalysis = () => {
    if (!equityData || form.type !== 'withdrawal' || !form.amount) return null
    const amount = Number(form.amount)
    const available = Number(equityData.available_equity || 0)
    const totalDeposits = Number(equityData.total_deposits || 0)
    const excess = amount - available
    const isOverdraft = amount > available
    const nearLimit = !isOverdraft && available > 0 && (available - amount) < (totalDeposits * 0.15)
    const pctOfEquity = available > 0 ? Math.min((amount / available) * 100, 200) : 0

    return {
      available,
      amount,
      excess: Math.max(0, excess),
      isOverdraft,
      nearLimit,
      pctOfEquity,
      isLoan: isOverdraft,
      loanAmount: Math.max(0, excess),
      equityAfter: available - amount,
    }
  }

  const analysis = getWithdrawalAnalysis()

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.amount || isNaN(amount) || amount <= 0) {
      toast.error('Amount must be greater than zero')
      return
    }
    if (!form.user_id) {
      toast.error('Please select a member')
      return
    }

    // Block non-admin overdraft
    if (analysis?.isOverdraft && !isAdmin) {
      toast.error('Withdrawal exceeds available equity. Only an admin can authorise overdraft withdrawals.')
      return
    }

    setLoading(true)

    // Server-side validation
    const { data: validation } = await supabase.rpc('validate_transaction', {
      p_user_id: form.user_id,
      p_type: form.type,
      p_amount: amount,
      p_reference: form.reference || null,
    })
    if (validation && !validation.valid) {
      toast.error(validation.error || 'Transaction validation failed')
      setLoading(false)
      return
    }
    const isOverdraft = analysis?.isOverdraft || false
    const loanAmount = analysis?.loanAmount || 0

    const txData = {
      user_id: form.user_id,
      amount,
      type: form.type,
      reference: form.reference || null,
      description: form.description
        ? form.description + (isOverdraft ? ` [OVERDRAFT: KES ${loanAmount.toLocaleString()} treated as loan]` : '')
        : isOverdraft ? `[OVERDRAFT: KES ${loanAmount.toLocaleString()} treated as loan]` : null,
      transaction_date: form.transaction_date,
      created_by: profile.id,
      status: form.type === 'withdrawal' ? 'pending' : 'completed',
      is_loan: isOverdraft,
      loan_amount: isOverdraft ? loanAmount : 0,
    }

    const { data: tx, error } = await supabase
      .from('transactions')
      .insert(txData)
      .select()
      .single()

    if (error) {
      toast.error('Failed to record transaction: ' + error.message)
      setLoading(false)
      return
    }

    // Snapshot ownership after deposit
    if (form.type === 'deposit') {
      await snapshotOwnership(tx.id)
      // NOTE: Deposit notifications to all members are handled by the
      // trg_deposit_notifications database trigger (migration 014).
      // No frontend notification needed here — avoids duplicates.
    }

    // Create withdrawal approval requests for ALL other members
    if (form.type === 'withdrawal') {
      const otherMembers = members.filter(m => m.id !== form.user_id)
      if (otherMembers.length > 0) {
        const { error: approvalError } = await supabase.from('withdrawal_approvals').insert(
          otherMembers.map(m => ({
            transaction_id: tx.id,
            approver_id: m.id,
            status: 'pending'
          }))
        )
        if (approvalError) {
          console.error('Approval insert error:', approvalError)
          toast.error('Warning: approval records could not be created. ' + approvalError.message)
        }

        // Notify approvers
        const overdraftNote = isOverdraft
          ? ` ⚠️ Note: This withdrawal exceeds the member's available equity by ${formatCurrency(loanAmount)} — excess will be treated as a loan.`
          : ''

        await supabase.from('notifications').insert(
          otherMembers.map(m => ({
            user_id: m.id,
            title: isOverdraft ? '⚠️ Overdraft Withdrawal Approval Required' : 'Withdrawal Approval Required 🔔',
            message: `${members.find(x => x.id === form.user_id)?.name || profile.name} has requested a withdrawal of ${formatCurrency(amount)}.${overdraftNote} Tap to review.`,
            type: isOverdraft ? 'warning' : 'approval',
            action_url: `/transactions?pending=${tx.id}`
          }))
        )
      }

      // Update equity status for this member
      await supabase.rpc('recalculate_equity_status', { p_user_id: form.user_id })

      // If overdraft: notify all members about the overdrawn status
      if (isOverdraft) {
        await supabase.from('notifications').insert(
          members.filter(m => m.id !== form.user_id).map(m => ({
            user_id: m.id,
            title: '🔴 Member Overdrawn',
            message: `${members.find(x => x.id === form.user_id)?.name} is now overdrawn by ${formatCurrency(loanAmount)}. Admin review may be required.`,
            type: 'warning',
            action_url: '/members'
          }))
        )
      }
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: profile.id,
      action: `Created ${form.type}${isOverdraft ? ' (OVERDRAFT/LOAN)' : ''} transaction`,
      table_name: 'transactions',
      record_id: tx.id,
      new_values: txData
    })

    toast.success(`${form.type.charAt(0).toUpperCase() + form.type.slice(1)} recorded successfully!`)
    setLoading(false)
    onSuccess?.()
    onClose()
  }

  const snapshotOwnership = async (transactionId) => {
    const { data } = await supabase.from('ownership_percentages').select('*')
    if (!data) return
    await supabase.from('ownership_snapshots').insert(
      data.map(row => ({
        user_id: row.id,
        percentage: Number(row.ownership_pct),
        total_contribution: Number(row.total_deposits),
        transaction_id: transactionId
      }))
    )
  }

  const EquityIndicator = () => {
    if (!equityData || form.type !== 'withdrawal') return null
    if (loadingEquity) return (
      <div style={{ padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Checking available equity…
      </div>
    )

    const available = Number(equityData.available_equity || 0)
    const pending = Number(equityData.pending_withdrawals || 0)
    const status = equityData.equity_status || 'safe'
    const enteredAmount = Number(form.amount) || 0

    const statusConfig = {
      safe: { color: 'var(--accent-emerald)', bg: 'rgba(13,156,94,0.08)', border: 'rgba(13,156,94,0.22)', icon: <CheckCircle size={15} />, label: '🟢 Safe' },
      near_limit: { color: 'var(--accent-amber)', bg: 'rgba(230,144,10,0.08)', border: 'rgba(230,144,10,0.22)', icon: <AlertCircle size={15} />, label: '🟡 Near Limit' },
      overdrawn: { color: 'var(--accent-red)', bg: 'rgba(220,53,69,0.08)', border: 'rgba(220,53,69,0.22)', icon: <AlertTriangle size={15} />, label: '🔴 Overdrawn' },
    }

    // Determine effective status based on what they're entering
    let effectiveStatus = status
    if (enteredAmount > 0) {
      if (enteredAmount > available) effectiveStatus = 'overdrawn'
      else if ((available - enteredAmount) < (Number(equityData.total_deposits) * 0.15)) effectiveStatus = 'near_limit'
      else effectiveStatus = 'safe'
    }

    const cfg = statusConfig[effectiveStatus]

    return (
      <div style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: cfg.color }}>
            {cfg.icon} Equity Status: {cfg.label}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Available Equity</p>
            <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: available > 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
              {formatCurrency(available)}
            </p>
          </div>
          <div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Total Deposited</p>
            <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {formatCurrency(equityData.total_deposits)}
            </p>
          </div>
          {pending > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Pending Withdrawals (not yet approved)</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-amber)' }}>{formatCurrency(pending)}</p>
            </div>
          )}
        </div>
        {/* What will happen */}
        {enteredAmount > 0 && (
          <div style={{ borderTop: `1px solid ${cfg.border}`, marginTop: 10, paddingTop: 10 }}>
            {enteredAmount <= available ? (
              <p style={{ fontSize: 12, color: cfg.color }}>
                After withdrawal: <strong>{formatCurrency(available - enteredAmount)}</strong> remaining equity
              </p>
            ) : (
              <div>
                <p style={{ fontSize: 12, color: 'var(--accent-red)', fontWeight: 700 }}>
                  ⚠️ Exceeds equity by <strong>{formatCurrency(enteredAmount - available)}</strong>
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  The excess <strong>{formatCurrency(enteredAmount - available)}</strong> will be recorded as an internal loan and may affect future profit distribution.
                  {!isAdmin && ' Only an admin can authorise this overdraft withdrawal.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Transact</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            {/* Transaction type selector */}
            <div className="form-group">
              <label className="form-label">Transaction Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                {['deposit', 'withdrawal', 'adjustment'].map((t) => (
                  <button
                    key={t} type="button"
                    onClick={() => setForm(p => ({ ...p, type: t }))}
                    style={{
                      padding: '10px',
                      border: `1px solid ${form.type === t
                        ? t === 'deposit' ? 'rgba(13,156,94,0.4)' : t === 'withdrawal' ? 'rgba(220,53,69,0.4)' : 'rgba(230,144,10,0.4)'
                        : 'var(--border)'}`,
                      borderRadius: 8,
                      background: form.type === t
                        ? t === 'deposit' ? 'rgba(13,156,94,0.1)' : t === 'withdrawal' ? 'rgba(220,53,69,0.1)' : 'rgba(230,144,10,0.1)'
                        : 'var(--bg-base)',
                      color: form.type === t
                        ? t === 'deposit' ? 'var(--accent-emerald)' : t === 'withdrawal' ? 'var(--accent-red)' : 'var(--accent-amber)'
                        : 'var(--text-secondary)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      textTransform: 'capitalize', fontFamily: 'var(--font-main)',
                    }}
                  >
                    {t === 'deposit' ? '↑ Deposit' : t === 'withdrawal' ? '↓ Withdraw' : '± Adjust'}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Member</label>
              <select
                className="form-select" name="user_id"
                value={form.user_id} onChange={handleChange} required
                disabled={!isAdmin && !preselectedUser}
              >
                <option value="">Select member…</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}{m.role === 'admin' ? ' (Admin)' : ''}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Amount (KES)</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>
                  KES
                </span>
                <input
                  className="form-input" name="amount" type="number"
                  min="0.01" step="0.01" placeholder="0.00"
                  value={form.amount} onChange={handleChange} required
                  style={{ paddingLeft: 44 }}
                />
              </div>
            </div>

            {/* Equity indicator appears here for withdrawals */}
            <EquityIndicator />

            {/* Smart decision advisor */}
            {form.amount && Number(form.amount) > 0 && (
              <div style={{ marginBottom: 12 }}>
                <DecisionPanel amount={form.amount} action={form.type === 'deposit' ? 'deposit' : 'withdraw'} />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Transaction Date & Time</label>
              <input className="form-input" name="transaction_date" type="datetime-local"
                value={form.transaction_date} onChange={handleChange} required />
            </div>

            <div className="form-group">
              <label className="form-label">Bank Reference Code</label>
              <input className="form-input" name="reference" type="text"
                placeholder="e.g. TXN20240115001"
                value={form.reference} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label className="form-label">Description (optional)</label>
              <textarea className="form-textarea" name="description"
                placeholder="Notes about this transaction…"
                value={form.description} onChange={handleChange} />
            </div>

            {form.type === 'withdrawal' && !(analysis?.isOverdraft) && (
              <div style={{ background: 'rgba(230,144,10,0.08)', border: '1px solid rgba(230,144,10,0.2)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--accent-amber)' }}>
                  ⚠️ Withdrawals require approval from all other members before processing.
                </p>
              </div>
            )}

            {analysis?.isOverdraft && isAdmin && (
              <div style={{ background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.25)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--accent-red)', fontWeight: 700, marginBottom: 4 }}>
                  🔴 Admin Override: Overdraft Withdrawal
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  You are authorising a withdrawal that exceeds the member's available equity.
                  The excess {formatCurrency(analysis.loanAmount)} will be treated as an internal loan and recorded accordingly.
                  This member will be flagged as overdrawn until the loan is settled.
                </p>
              </div>
            )}

            {analysis?.isOverdraft && !isAdmin && (
              <div style={{ background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.25)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--accent-red)', fontWeight: 700 }}>
                  🔴 Cannot process: Exceeds available equity
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Your available equity is {formatCurrency(Number(equityData?.available_equity || 0))}.
                  You cannot withdraw more than your available balance. Contact your group admin to request an overdraft authorisation.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button
                type="submit"
                className="btn btn-primary flex-1"
                disabled={loading || (analysis?.isOverdraft && !isAdmin)}
              >
                {loading
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
                  : analysis?.isOverdraft && isAdmin
                    ? '⚠️ Record Overdraft Withdrawal'
                    : 'Record Transaction'
                }
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
