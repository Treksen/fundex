import AdminActions from '../components/AdminActions'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { BookOpen, ArrowUpRight, ArrowDownRight, RotateCcw, Filter, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDateTime, getMemberColor } from '../lib/utils'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import MemberAvatar from '../components/MemberAvatar'

const PAGE_SIZE = 25

export default function LedgerPage() {
  const { profile, isAdmin } = useAuth()
  const [entries, setEntries] = useState([])
  const [statement, setStatement] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('statement')    // 'statement' | 'ledger'
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [filter, setFilter] = useState({ type: '', member: '' })
  const [members, setMembers] = useState([])
  const [reversalModal, setReversalModal] = useState(null)

  const fetchMembers = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, name')
    if (data) setMembers(data)
  }, [])

  const fetchStatement = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('transaction_statement')
      .select('*', { count: 'exact' })
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (filter.type) q = q.eq('type', filter.type)
    if (filter.member) q = q.eq('user_id', filter.member)
    const { data, count } = await q
    if (data) setStatement(data)
    setTotalCount(count || 0)
    setLoading(false)
  }, [page, filter])

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('ledger_entries')
      .select('*, profiles!ledger_entries_member_id_fkey(name, avatar_url)')
      .order('entry_date', { ascending: false })
      .limit(200)
    if (data) setEntries(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchMembers() }, [fetchMembers])
  useEffect(() => {
    if (tab === 'statement') fetchStatement()
    else fetchLedger()
  }, [tab, fetchStatement, fetchLedger])
  useEffect(() => { setPage(1) }, [filter])

  // Real-time: transactions update instantly
  useEffect(() => {
    const channel = supabase.channel('ledger-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        if (tab === 'statement') fetchStatement()
        else fetchLedger()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_entries' }, () => {
        if (tab === 'ledger') fetchLedger()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tab])

  // Ledger account summary (totals per account)
  const ledgerSummary = useMemo(() => {
    const map = {}
    entries.forEach(e => {
      if (!map[e.account_name]) map[e.account_name] = { name: e.account_name, type: e.account_type, debit: 0, credit: 0 }
      map[e.account_name].debit += Number(e.debit)
      map[e.account_name].credit += Number(e.credit)
    })
    return Object.values(map).sort((a, b) => (b.debit + b.credit) - (a.debit + a.credit))
  }, [entries])

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const ReversalModal = ({ tx, onClose }) => {
    const [reason, setReason] = useState('')
    const [loading, setLoading] = useState(false)

    const handleReverse = async () => {
      if (!reason.trim()) { toast.error('Please provide a reason for the reversal'); return }
      setLoading(true)
      const { data, error } = await supabase.rpc('reverse_transaction', {
        p_tx_id: tx.id,
        p_reason: reason.trim(),
        p_reversed_by_user: profile.id,
      })
      if (error) { toast.error('Reversal failed: ' + error.message); setLoading(false); return }
      toast.success(`Reversed ✅ — Statement #${data} created. Equity and reserve recalculated.`)
      setLoading(false)
      onClose()
      fetchStatement()
    }

    return (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 480 }}>
          <div className="modal-header">
            <h2 className="modal-title">Reverse Transaction</h2>
            <button className="btn btn-secondary btn-icon" onClick={onClose}><RotateCcw size={16} /></button>
          </div>
          <div className="modal-body">
            <div style={{ background: 'rgba(220,53,69,0.07)', border: '1px solid rgba(220,53,69,0.2)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-red)' }}>⚠️ This will create a counter-transaction</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                A reversal entry will be recorded that offsets the original transaction. The original record is preserved for audit. Equity, reserve balance, and all linked skim contributions will be automatically recalculated.
              </p>
            </div>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span className="text-muted">Statement #</span><strong>{tx.statement_no || tx.id?.slice(0,8)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                <span className="text-muted">Type</span><span style={{ textTransform: 'capitalize' }}>{tx.type}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                <span className="text-muted">Amount</span><strong>{formatCurrency(tx.amount)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                <span className="text-muted">Member</span><span>{tx.member_name}</span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Reason for Reversal *</label>
              <textarea className="form-textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Duplicate entry, incorrect amount, data entry error…" rows={3} required />
            </div>
            <div className="flex gap-3">
              <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button className="btn btn-danger flex-1" onClick={handleReverse} disabled={loading || !reason.trim()}>
                {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><RotateCcw size={14} /> Confirm Reversal</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Ledger & Statement"
        subtitle="Double-entry accounting ledger with running balance"
        onRefresh={() => tab === 'statement' ? fetchStatement() : fetchLedger()}
        loading={loading}
      />

      {/* Tabs */}
      <div className="page-tab-bar">
        {[['statement', '📄 Account Statement'], ['ledger', '📒 Double-Entry Ledger']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-main)', fontSize: 14, fontWeight: 600,
            borderBottom: tab === id ? '2px solid var(--olive)' : '2px solid transparent',
            color: tab === id ? 'var(--olive)' : 'var(--text-muted)',
            position: 'relative', bottom: -1, transition: 'all 0.15s'
          }}>{label}</button>
        ))}
      </div>

      {/* ── STATEMENT TAB ── */}
      {tab === 'statement' && (
        <>
          {/* Filters */}
          <div className="card mb-4">
            <div className="filter-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Filter size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <select className="form-select" style={{ flex: 1, minWidth: 0 }} value={filter.type} onChange={e => setFilter(p => ({ ...p, type: e.target.value }))}>
                <option value="">All Types</option>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="adjustment">Adjustment</option>
              </select>
              <select className="form-select" style={{ flex: 1, minWidth: 0 }} value={filter.member} onChange={e => setFilter(p => ({ ...p, member: e.target.value }))}>
                <option value="">All Members</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name?.split(' ')[0]}</option>)}
              </select>
              {(filter.type || filter.member) && (
                <button className="btn btn-secondary btn-sm" onClick={() => setFilter({ type: '', member: '' })}>Clear</button>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? (
              <div className="flex justify-center" style={{ padding: 48 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
            ) : statement.length === 0 ? (
              <div className="empty-state"><BookOpen size={40} style={{ opacity: 0.2 }} /><p>No transactions recorded</p></div>
            ) : (
              <>
                <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Statement #</th>
                        <th>Member</th>
                        <th>Date & Time</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th style={{ textAlign: 'right' }}>Debit (Out)</th>
                        <th style={{ textAlign: 'right' }}>Credit (In)</th>
                        <th style={{ textAlign: 'right' }}>Running Balance</th>
                        <th>Status</th>
                        {isAdmin && <th style={{ width: 80 }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {statement.map(tx => {
                        const isDebit = tx.type === 'withdrawal'
                        const isReversal = tx.is_reversal
                        const isReversed = !!tx.reversed_by
                        return (
                          <tr key={tx.id} style={{
                            background: isReversal ? 'rgba(220,53,69,0.04)' : isReversed ? 'rgba(128,128,128,0.04)' : undefined,
                            opacity: isReversed ? 0.65 : 1,
                          }}>
                            <td>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--navy-light)' }}>
                                {tx.statement_no || tx.id?.slice(0, 8)}
                              </div>
                              {isReversal && <div style={{ fontSize: 10, color: 'var(--accent-red)', fontWeight: 600 }}>↩ REVERSAL</div>}
                              {isReversed && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>reversed</div>}
                            </td>
                            <td>
                              <div className="flex items-center gap-2">
                                <MemberAvatar name={tx.member_name} avatarUrl={tx.avatar_url} size={26} fontSize={10} />
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{tx.member_name?.split(' ')[0]}</span>
                              </div>
                            </td>
                            <td className="text-xs text-muted">{formatDateTime(tx.transaction_date)}</td>
                            <td className="text-sm text-secondary" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tx.description || tx.reference || '—'}
                            </td>
                            <td>
                              <span className={`badge badge-${tx.type === 'deposit' ? 'green' : tx.type === 'withdrawal' ? 'red' : 'amber'}`} style={{ fontSize: 10 }}>
                                {tx.type === 'deposit' ? <ArrowUpRight size={10} /> : tx.type === 'withdrawal' ? <ArrowDownRight size={10} /> : '±'} {tx.type}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent-red)' }}>
                              {isDebit ? formatCurrency(tx.amount) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                              {!isDebit ? formatCurrency(tx.amount) : '—'}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span style={{
                                fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 800,
                                color: Number(tx.running_balance) >= 0 ? 'var(--navy-light)' : 'var(--accent-red)'
                              }}>
                                {tx.status === 'completed' ? formatCurrency(tx.running_balance) : '—'}
                              </span>
                            </td>
                            <td>
                              <span className={`badge badge-${tx.status === 'completed' ? 'green' : tx.status === 'pending' ? 'amber' : 'red'}`} style={{ fontSize: 10 }}>
                                {tx.status}
                              </span>
                            </td>
                            {isAdmin && (
                              <td>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                  {tx.status === 'completed' && !tx.is_reversal && !tx.reversed_by && (
                                    <button
                                      className="btn-row-delete"
                                      onClick={() => setReversalModal(tx)}
                                      title="Reverse transaction"
                                      style={{ display: 'flex', alignItems: 'center', gap: 3 }}
                                    >
                                      <RotateCcw size={10} /> Reverse
                                    </button>
                                  )}
                                  <AdminActions
                                    onDelete={async () => {
                                      if (!window.confirm(`Delete transaction ${tx.statement_no || tx.id.slice(0,8)}?\n\nThis will:\n• Remove the transaction permanently\n• Remove any auto-skim reserve contributions linked to it\n• Recalculate equity and reserve balance for all members\n\nThis cannot be undone.`)) return
                                      const { data, error } = await supabase.rpc('admin_delete_transaction', { p_transaction_id: tx.id })
                                      if (error || data?.success === false) {
                                        toast.error('Delete failed: ' + (error?.message || data?.error))
                                      } else {
                                        toast.success('Transaction deleted — equity and reserve recalculated ✅')
                                        fetchStatement()
                                      }
                                    }}
                                    size="xs"
                                  />
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} totalPages={totalPages} totalItems={totalCount} pageSize={PAGE_SIZE} onChange={setPage} />
              </>
            )}
          </div>
        </>
      )}

      {/* ── LEDGER TAB ── */}
      {tab === 'ledger' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Account balances summary */}
          {ledgerSummary.length > 0 && (
            <div className="card">
              <div className="card-header" style={{ marginBottom: 12 }}>
                <span className="card-title">Chart of Accounts</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Debits must equal Credits</span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'right' }}>Total Debit</th>
                      <th style={{ textAlign: 'right' }}>Total Credit</th>
                      <th style={{ textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerSummary.map(acc => {
                      const balance = acc.debit - acc.credit
                      return (
                        <tr key={acc.name}>
                          <td style={{ fontWeight: 600, fontSize: 14 }}>{acc.name}</td>
                          <td><span className="badge badge-gray" style={{ fontSize: 10, textTransform: 'capitalize' }}>{acc.type}</span></td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-red)', fontSize: 13 }}>{formatCurrency(acc.debit)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)', fontSize: 13 }}>{formatCurrency(acc.credit)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: balance >= 0 ? 'var(--navy-light)' : 'var(--accent-red)', fontSize: 13 }}>
                            {formatCurrency(Math.abs(balance))} {balance < 0 ? 'Cr' : 'Dr'}
                          </td>
                        </tr>
                      )
                    })}
                    {/* Trial balance totals */}
                    {ledgerSummary.length > 0 && (() => {
                      const totalDebit = ledgerSummary.reduce((s, a) => s + a.debit, 0)
                      const totalCredit = ledgerSummary.reduce((s, a) => s + a.credit, 0)
                      const balanced = Math.abs(totalDebit - totalCredit) < 0.01
                      return (
                        <tr style={{ background: balanced ? 'rgba(13,156,94,0.06)' : 'rgba(220,53,69,0.06)', borderTop: '2px solid var(--border)' }}>
                          <td colSpan={2} style={{ fontWeight: 800, fontSize: 13 }}>
                            {balanced ? '✅ Trial Balance — Books Balanced' : '⚠️ Trial Balance — OUT OF BALANCE'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{formatCurrency(totalDebit)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{formatCurrency(totalCredit)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: balanced ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                            {formatCurrency(Math.abs(totalDebit - totalCredit))}
                          </td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detailed ledger entries */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
              <span className="card-title">Detailed Ledger Entries</span>
            </div>
            {loading ? (
              <div className="flex justify-center" style={{ padding: 48 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
            ) : entries.length === 0 ? (
              <div className="empty-state">
                <BookOpen size={40} style={{ opacity: 0.2 }} />
                <p>No ledger entries yet</p>
                <p className="text-sm">Ledger entries are created automatically when transactions complete</p>
              </div>
            ) : (
              <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Account</th>
                      <th>Account Type</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Debit</th>
                      <th style={{ textAlign: 'right' }}>Credit</th>
                      {isAdmin && <th style={{ width: 70 }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id}>
                        <td className="text-xs text-muted">{formatDateTime(e.entry_date)}</td>
                        <td style={{ fontWeight: 600, fontSize: 13 }}>{e.account_name}</td>
                        <td><span className="badge badge-gray" style={{ fontSize: 10, textTransform: 'capitalize' }}>{e.account_type}</span></td>
                        <td className="text-sm text-secondary">{e.description || '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: Number(e.debit) > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          {Number(e.debit) > 0 ? formatCurrency(e.debit) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: Number(e.credit) > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                          {Number(e.credit) > 0 ? formatCurrency(e.credit) : '—'}
                        </td>
                        {isAdmin && (
                          <td>
                            <AdminActions
                              onDelete={async () => {
                                if (!window.confirm('Delete this ledger entry?')) return
                                const { error } = await supabase.from('ledger_entries').delete().eq('id', e.id)
                                if (error) toast.error(error.message)
                                else { toast.success('Entry deleted'); fetchLedger() }
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
        </div>
      )}

      {reversalModal && <ReversalModal tx={reversalModal} onClose={() => setReversalModal(null)} />}
    </div>
  )
}
