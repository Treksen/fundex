import MemberAvatar from '../components/MemberAvatar'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import DocumentAttachments from '../components/DocumentAttachments'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Filter, Check, X, ChevronDown, ChevronUp, AlertCircle, Edit2, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDateTime, getMemberColor } from '../lib/utils'
import AddTransactionModal from '../components/transactions/AddTransactionModal'
import toast from 'react-hot-toast'
import { useSearchParams } from 'react-router-dom'

const PAGE_SIZE = 20

export default function TransactionsPage() {
  const { profile, isAdmin } = useAuth()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('pending')

  const [transactions, setTransactions] = useState([])
  const [approvals, setApprovals] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState({ type: '', status: '', member: '' })
  const [members, setMembers] = useState([])
  const [expandedRows, setExpandedRows] = useState({})
  const [voting, setVoting] = useState({})
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Admin edit/delete state
  const [editingTx, setEditingTx] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => { fetchMembers() }, [])
  useEffect(() => { setPage(1) }, [filter])
  useEffect(() => { fetchData() }, [filter, page])

  useEffect(() => {
    if (highlightId) {
      setExpandedRows(prev => ({ ...prev, [highlightId]: true }))
      setTimeout(() => {
        const el = document.getElementById(`tx-row-${highlightId}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 600)
    }
  }, [highlightId, loading])

  useEffect(() => {
    if (!profile) return
    const channel = supabase.channel('approval-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawal_approvals' }, () => fetchData())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, () => fetchData())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile])

  const fetchMembers = async () => {
    const { data } = await supabase.from('profiles').select('id, name')
    if (data) setMembers(data)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase.from('transactions')
        .select('*, profiles!transactions_user_id_fkey(name, id, avatar_url)', { count: 'exact' })
        .order('transaction_date', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

      if (filter.type) query = query.eq('type', filter.type)
      if (filter.status) query = query.eq('status', filter.status)
      if (filter.member) query = query.eq('user_id', filter.member)

      const { data, error, count } = await query
      if (!error && data) {
        setTransactions(data)
        setTotalCount(count || 0)
        const withdrawalIds = data.filter(t => t.type === 'withdrawal').map(t => t.id)
        if (withdrawalIds.length > 0) {
          const { data: appData } = await supabase
            .from('withdrawal_approvals')
            .select('*, profiles!withdrawal_approvals_approver_id_fkey(name, id, avatar_url)')
            .in('transaction_id', withdrawalIds)
          if (appData) {
            const grouped = {}
            appData.forEach(a => {
              if (!grouped[a.transaction_id]) grouped[a.transaction_id] = []
              grouped[a.transaction_id].push(a)
            })
            setApprovals(grouped)
          }
        }
      } else if (error) {
        toast.error('Failed to load transactions')
      }
    } catch (err) {
      toast.error('Network error loading transactions')
    }
    setLoading(false)
  }, [filter, page])

  const handleVote = async (transactionId, approve, reason = '') => {
    setVoting(v => ({ ...v, [transactionId]: true }))
    const { error } = await supabase.from('withdrawal_approvals')
      .update({ status: approve ? 'approved' : 'rejected', voted_at: new Date().toISOString(), rejection_reason: !approve ? reason : null })
      .eq('transaction_id', transactionId).eq('approver_id', profile.id)

    if (error) { toast.error('Failed to submit vote'); setVoting(v => ({ ...v, [transactionId]: false })); return }

    const tx = transactions.find(t => t.id === transactionId)
    const othersToNotify = members.filter(m => m.id !== profile.id)
    if (othersToNotify.length > 0) {
      await supabase.from('notifications').insert(othersToNotify.map(m => ({
        user_id: m.id,
        title: approve ? `${profile.name?.split(' ')[0]} approved a withdrawal` : `${profile.name?.split(' ')[0]} rejected a withdrawal`,
        message: approve
          ? `${profile.name} has approved the KES ${Number(tx?.amount || 0).toLocaleString()} withdrawal by ${tx?.profiles?.name?.split(' ')[0]}.`
          : `${profile.name} has rejected the KES ${Number(tx?.amount || 0).toLocaleString()} withdrawal by ${tx?.profiles?.name?.split(' ')[0]}.`,
        type: approve ? 'info' : 'warning',
        action_url: `/transactions?pending=${transactionId}`,
      })))
    }
    const { data: result } = await supabase.rpc('process_withdrawal_approval', { p_transaction_id: transactionId })
    if (result?.status === 'completed') toast.success('All members approved — withdrawal processed! ✅')
    else if (result?.status === 'rejected') toast.error('Withdrawal has been rejected.')
    else if (approve) { const rem = (result?.total || 0) - (result?.approved_count || 0); toast.success(`Approval recorded. ${rem} more needed.`) }
    else toast('Vote recorded.', { icon: '📝' })
    setVoting(v => ({ ...v, [transactionId]: false }))
    await fetchData()
  }

  // ── ADMIN EDIT ──────────────────────────────────────────────
  const startEdit = (tx) => {
    setEditingTx(tx.id)
    setEditForm({
      amount: tx.amount,
      reference: tx.reference || '',
      description: tx.description || '',
      status: tx.status,
      type: tx.type,
    })
  }

  const saveEdit = async () => {
    if (!editingTx) return
    if (Number(editForm.amount) <= 0) { toast.error('Amount must be greater than zero'); return }
    setSavingEdit(true)
    const { error } = await supabase.from('transactions')
      .update({
        amount: Number(editForm.amount),
        reference: editForm.reference || null,
        description: editForm.description || null,
        status: editForm.status,
        type: editForm.type,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingTx)

    if (error) { toast.error('Update failed: ' + error.message) }
    else {
      toast.success('Transaction updated')
      await supabase.from('audit_logs').insert({
        user_id: profile.id, action: 'Admin updated transaction',
        table_name: 'transactions', record_id: editingTx,
      })
      setEditingTx(null)
      await fetchData()
    }
    setSavingEdit(false)
  }

  // ── ADMIN DELETE ────────────────────────────────────────────
  // Uses admin_delete_transaction() RPC (migration 010) which:
  //  • Handles all FK cascades safely (ownership_snapshots, ledger, etc.)
  //  • Writes an audit log server-side
  //  • Recalculates equity for all members after deletion
  const handleDelete = async (txId, txType, txAmount, memberName) => {
    const reason = window.prompt(
      `Delete this ${txType} of ${formatCurrency(txAmount)} for ${memberName}?\n\nEnter a reason for deletion (required):`,
      'Admin correction'
    )
    if (reason === null) return  // user cancelled
    if (!reason.trim()) { toast.error('A reason is required to delete a transaction.'); return }

    setDeletingId(txId)
    const { data, error } = await supabase.rpc('admin_delete_transaction', {
      p_tx_id:          txId,
      p_admin_user_id:  profile.id,
      p_reason:         reason.trim(),
    })
    if (error || data?.success === false) {
      toast.error('Delete failed: ' + (error?.message || data?.error))
    } else {
      toast.success('Transaction deleted and equity recalculated ✅')
      await fetchData()
    }
    setDeletingId(null)
  }

  const myApproval = (txId) => approvals[txId]?.find(a => a.approver_id === profile?.id)
  const canVote = (txId) => {
    const tx = transactions.find(t => t.id === txId)
    if (!tx || tx.user_id === profile?.id) return false
    return myApproval(txId)?.status === 'pending'
  }
  const getApprovalSummary = (txId) => {
    const txApprovals = approvals[txId] || []
    return {
      approved: txApprovals.filter(a => a.status === 'approved'),
      rejected: txApprovals.filter(a => a.status === 'rejected'),
      pending: txApprovals.filter(a => a.status === 'pending'),
      total: txApprovals.length
    }
  }
  const toggleExpand = (id) => setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }))
  const getStatusBadge = (s) => ({ completed: 'badge-green', approved: 'badge-blue', pending: 'badge-amber', rejected: 'badge-red' }[s] || 'badge-gray')

  const ApproverChip = ({ approval }) => {
    const color = approval.status === 'approved' ? 'var(--accent-emerald)' : approval.status === 'rejected' ? 'var(--accent-red)' : 'var(--accent-amber)'
    const bg = approval.status === 'approved' ? 'rgba(13,156,94,0.10)' : approval.status === 'rejected' ? 'rgba(220,53,69,0.10)' : 'rgba(230,144,10,0.10)'
    const icon = approval.status === 'approved' ? '✓' : approval.status === 'rejected' ? '✕' : '…'
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, background: bg, border: `1px solid ${color}22`, fontSize: 12, fontWeight: 600, color }}>
        <MemberAvatar name={approval.profiles?.name} avatarUrl={approval.profiles?.avatar_url} size={18} fontSize={8} />
        {approval.profiles?.name?.split(' ')[0]}
        <span style={{ fontSize: 11 }}>{icon}</span>
        {approval.voted_at && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{new Date(approval.voted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
    )
  }

  const ApprovalPanel = ({ tx }) => {
    const [rejectReason, setRejectReason] = useState('')
    const [showRejectInput, setShowRejectInput] = useState(false)
    const summary = getApprovalSummary(tx.id)
    const isVoting = voting[tx.id]
    const isRequester = tx.user_id === profile?.id
    const mine = myApproval(tx.id)
    const pct = summary.total > 0 ? Math.round((summary.approved.length / summary.total) * 100) : 0
    return (
      <div style={{ background: highlightId === tx.id ? 'rgba(90,138,30,0.04)' : 'rgba(245,247,245,0.8)', border: `1px solid ${highlightId === tx.id ? 'rgba(90,138,30,0.25)' : 'var(--border)'}`, borderRadius: 10, padding: '14px 16px', marginTop: 2 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Approval Progress</span>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{summary.approved.length} / {summary.total} approved</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: summary.rejected.length > 0 ? 'var(--accent-red)' : 'var(--olive)', transition: 'width 0.4s' }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {(approvals[tx.id] || []).map(a => <ApproverChip key={a.id} approval={a} />)}
        </div>
        {isRequester ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} style={{ color: 'var(--olive)', flexShrink: 0 }} />
            Awaiting {summary.pending.length} approval{summary.pending.length !== 1 ? 's' : ''} from: <strong>{summary.pending.map(a => a.profiles?.name?.split(' ')[0]).join(', ')}</strong>
          </div>
        ) : mine?.status === 'pending' ? (
          <div>
            {showRejectInput ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <input className="form-input" placeholder="Reason (optional)" value={rejectReason} onChange={e => setRejectReason(e.target.value)} style={{ fontSize: 13 }} />
                </div>
                <button className="btn btn-danger btn-sm" disabled={isVoting} onClick={() => handleVote(tx.id, false, rejectReason)}>{isVoting ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <><X size={13} /> Confirm Reject</>}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowRejectInput(false)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-success btn-sm" disabled={isVoting} onClick={() => handleVote(tx.id, true)} style={{ flex: 1, minWidth: 100, justifyContent: 'center' }}>{isVoting ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <><Check size={14} /> Approve</>}</button>
                <button className="btn btn-danger btn-sm" disabled={isVoting} onClick={() => setShowRejectInput(true)} style={{ flex: 1, minWidth: 100, justifyContent: 'center' }}><X size={14} /> Reject</button>
              </div>
            )}
          </div>
        ) : mine ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: mine.status === 'approved' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
            {mine.status === 'approved' ? <Check size={14} /> : <X size={14} />}
            You {mine.status} this withdrawal
            {summary.pending.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— waiting for {summary.pending.map(a => a.profiles?.name?.split(' ')[0]).join(', ')}</span>}
          </div>
        ) : null}
      </div>
    )
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle={`${totalCount} total records`}
        onRefresh={fetchData}
        loading={loading}
      >
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={15} /> Add Transaction
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="card mb-4">
        <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Filter size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <select className="form-select" style={{ flex: 1, minWidth: 0 }} value={filter.type} onChange={e => setFilter(p => ({ ...p, type: e.target.value }))}>
            <option value="">All Types</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="adjustment">Adjustment</option>
          </select>
          <select className="form-select" style={{ flex: 1, minWidth: 0 }} value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))}>
            <option value="">All Status</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
          <select className="form-select" style={{ flex: 1, minWidth: 0 }} value={filter.member} onChange={e => setFilter(p => ({ ...p, member: e.target.value }))}>
            <option value="">All Members</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name?.split(' ')[0]}</option>)}
          </select>
          {(filter.type || filter.status || filter.member) && (
            <button className="btn btn-secondary btn-sm" onClick={() => setFilter({ type: '', status: '', member: '' })}>Clear</button>
          )}
        </div>
      </div>

      {/* Pending approvals banner */}
      {transactions.some(t => t.type === 'withdrawal' && t.status === 'pending' && canVote(t.id)) && (
        <div style={{ background: 'rgba(230,144,10,0.08)', border: '1px solid rgba(230,144,10,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={16} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent-amber)' }}>You have pending withdrawal approvals — click a row to review</span>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex items-center justify-center" style={{ padding: 48 }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💳</div>
            <p style={{ fontWeight: 600 }}>No transactions found</p>
            <p className="text-sm">Adjust filters or record your first transaction</p>
          </div>
        ) : (
          <>
            <div className="table-container tx-table-view" style={{ borderRadius: 0, border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Member</th><th>Type</th><th>Amount</th><th>Reference</th>
                    <th>Date</th><th>Status</th><th style={{ width: 100 }}>Approvals</th>
                    <th style={{ width: isAdmin ? 110 : 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => {
                    const summary = getApprovalSummary(tx.id)
                    const isWithdrawalPending = tx.type === 'withdrawal' && tx.status === 'pending'
                    const needsMyVote = canVote(tx.id)
                    const isExpanded = expandedRows[tx.id]
                    const isEditing = editingTx === tx.id
                    const isDeleting = deletingId === tx.id

                    return (
                      <>
                        <tr key={tx.id} id={`tx-row-${tx.id}`}
                          style={{
                            background: highlightId === tx.id ? 'rgba(90,138,30,0.05)' : needsMyVote ? 'rgba(230,144,10,0.04)' : undefined,
                            cursor: isWithdrawalPending ? 'pointer' : undefined,
                            borderLeft: highlightId === tx.id ? '3px solid var(--olive)' : needsMyVote ? '3px solid var(--accent-amber)' : '3px solid transparent',
                            opacity: isDeleting ? 0.4 : 1,
                          }}
                          onClick={() => !isEditing && isWithdrawalPending && toggleExpand(tx.id)}
                        >
                          <td>
                            <div className="flex items-center gap-2">
                              <MemberAvatar name={tx.profiles?.name} avatarUrl={tx.profiles?.avatar_url} size={30} fontSize={11} />
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{tx.profiles?.name?.split(' ').slice(0,2).join(' ')}</div>
                                {tx.description && <div className="text-xs text-muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description}</div>}
                              </div>
                            </div>
                          </td>
                          <td><span className={`badge badge-${tx.type === 'deposit' ? 'green' : tx.type === 'withdrawal' ? 'red' : 'amber'}`}>{tx.type === 'deposit' ? '↑' : tx.type === 'withdrawal' ? '↓' : '±'} {tx.type}</span></td>
                          <td className="text-mono font-semibold" style={{ color: tx.type === 'deposit' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>{tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}</td>
                          <td className="text-sm text-secondary">{tx.reference || '—'}</td>
                          <td className="text-sm text-muted">{formatDateTime(tx.transaction_date)}</td>
                          <td><span className={`badge ${getStatusBadge(tx.status)}`}>{tx.status}</span></td>
                          <td>
                            {isWithdrawalPending && summary.total > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ display: 'flex', gap: 3 }}>
                                  {(approvals[tx.id] || []).map(a => (
                                    <div key={a.id} title={`${a.profiles?.name?.split(' ')[0]}: ${a.status}`} style={{ borderRadius: '50%', overflow: 'hidden', border: a.status === 'approved' ? '2px solid rgba(13,156,94,0.6)' : a.status === 'rejected' ? '2px solid rgba(220,53,69,0.6)' : '2px solid var(--border)', opacity: a.status === 'pending' ? 0.45 : 1 }}>
                                      <MemberAvatar name={a.profiles?.name} avatarUrl={a.profiles?.avatar_url} size={22} fontSize={8} />
                                    </div>
                                  ))}
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{summary.approved.length}/{summary.total}</span>
                              </div>
                            ) : tx.type === 'withdrawal' && tx.status === 'completed' ? (
                              <span style={{ fontSize: 11, color: 'var(--accent-emerald)' }}>✓ All approved</span>
                            ) : tx.type === 'withdrawal' && tx.status === 'rejected' ? (
                              <span style={{ fontSize: 11, color: 'var(--accent-red)' }}>✕ Rejected</span>
                            ) : <span className="text-muted text-xs">—</span>}
                          </td>
                          <td onClick={e => e.stopPropagation()}>
                            <div className="row-actions">
                              {isWithdrawalPending && (
                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }} onClick={() => toggleExpand(tx.id)}>
                                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                              )}
                              {needsMyVote && !isExpanded && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-amber)', display: 'inline-block' }} />}
                              {isAdmin && (
                                <>
                                  <button className="btn-row-edit" onClick={() => isEditing ? setEditingTx(null) : startEdit(tx)} title="Edit transaction">
                                    <Edit2 size={11} />
                                  </button>
                                  <button className="btn-row-delete" disabled={isDeleting} onClick={() => handleDelete(tx.id, tx.type, tx.amount, tx.profiles?.name)} title="Delete transaction">
                                    {isDeleting ? <div className="spinner" style={{ width: 10, height: 10 }} /> : <Trash2 size={11} />}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Admin inline edit row */}
                        {isAdmin && isEditing && (
                          <tr key={`${tx.id}-edit`}>
                            <td colSpan={8} style={{ padding: '8px 16px 14px', background: 'rgba(58,77,181,0.03)' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, alignItems: 'end' }}>
                                <div>
                                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Amount (KES)</p>
                                  <input className="form-input" type="number" min="0.01" step="0.01" value={editForm.amount} onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))} style={{ fontSize: 13 }} />
                                </div>
                                <div>
                                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Type</p>
                                  <select className="form-select" value={editForm.type} onChange={e => setEditForm(p => ({ ...p, type: e.target.value }))} style={{ fontSize: 13 }}>
                                    <option value="deposit">Deposit</option>
                                    <option value="withdrawal">Withdrawal</option>
                                    <option value="adjustment">Adjustment</option>
                                  </select>
                                </div>
                                <div>
                                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Status</p>
                                  <select className="form-select" value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))} style={{ fontSize: 13 }}>
                                    <option value="completed">Completed</option>
                                    <option value="pending">Pending</option>
                                    <option value="rejected">Rejected</option>
                                  </select>
                                </div>
                                <div>
                                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Reference</p>
                                  <input className="form-input" value={editForm.reference} onChange={e => setEditForm(p => ({ ...p, reference: e.target.value }))} style={{ fontSize: 13 }} />
                                </div>
                                <div>
                                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Description</p>
                                  <input className="form-input" value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} style={{ fontSize: 13 }} />
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button className="btn btn-primary btn-sm" disabled={savingEdit} onClick={saveEdit} style={{ flex: 1 }}>
                                    {savingEdit ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <><Check size={12} /> Save</>}
                                  </button>
                                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingTx(null)}>Cancel</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Approval panel */}
                        {isWithdrawalPending && isExpanded && (
                          <tr key={`${tx.id}-panel`}>
                            <td colSpan={8} style={{ padding: '0 16px 14px' }}><ApprovalPanel tx={tx} /></td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div>
              {transactions.map(tx => {
                const summary = getApprovalSummary(tx.id)
                const isWithdrawalPending = tx.type === 'withdrawal' && tx.status === 'pending'
                const needsMyVote = canVote(tx.id)
                const isExpanded = expandedRows[tx.id]
                return (
                  <div key={`mob-${tx.id}`} className="mobile-tx-card"
                    style={{ background: highlightId === tx.id ? 'rgba(90,138,30,0.04)' : needsMyVote ? 'rgba(230,144,10,0.03)' : undefined, borderLeft: highlightId === tx.id ? '3px solid var(--olive)' : needsMyVote ? '3px solid var(--accent-amber)' : '3px solid transparent', cursor: isWithdrawalPending ? 'pointer' : 'default' }}
                    onClick={() => isWithdrawalPending && toggleExpand(tx.id)}>
                    <div className="mobile-tx-card-row">
                      <div className="mobile-tx-card-member">
                        <MemberAvatar name={tx.profiles?.name} avatarUrl={tx.profiles?.avatar_url} size={38} fontSize={13} />
                        <div className="mobile-tx-card-info">
                          <div className="mobile-tx-card-name">{tx.profiles?.name?.split(' ').slice(0,2).join(' ')}</div>
                          <div className="mobile-tx-card-sub">{tx.reference || tx.description || '—'}</div>
                        </div>
                      </div>
                      <span className="mobile-tx-card-amount" style={{ color: tx.type === 'deposit' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                        {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </div>
                    <div className="mobile-tx-card-meta">
                      <span className={`badge badge-${tx.type === 'deposit' ? 'green' : tx.type === 'withdrawal' ? 'red' : 'amber'}`} style={{ fontSize: 10 }}>{tx.type}</span>
                      <span className={`badge ${getStatusBadge(tx.status)}`} style={{ fontSize: 10 }}>{tx.status}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{formatDateTime(tx.transaction_date)}</span>
                      {isWithdrawalPending && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{summary.approved.length}/{summary.total} {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>}
                    </div>
                    {/* Admin actions on mobile */}
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                        <button className="btn-row-edit" style={{ flex: 1 }} onClick={() => { startEdit(tx); toggleExpand(tx.id) }}><Edit2 size={11} /> Edit</button>
                        <button className="btn-row-delete" style={{ flex: 1 }} onClick={() => handleDelete(tx.id, tx.type, tx.amount, tx.profiles?.name)}><Trash2 size={11} /> Delete</button>
                      </div>
                    )}
                    {isWithdrawalPending && isExpanded && (
                      <div className="mobile-approval-panel" onClick={e => e.stopPropagation()}><ApprovalPanel tx={tx} /></div>
                    )}
                  </div>
                )
              })}
            </div>

            <Pagination page={page} totalPages={totalPages} totalItems={totalCount} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </div>

      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} onSuccess={fetchData} />}
    </div>
  )
}
