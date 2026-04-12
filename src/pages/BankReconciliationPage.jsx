import { useState, useEffect, useCallback, useMemo } from 'react'
import { Upload, Check, X, AlertTriangle, Download, Plus, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, formatDateTime } from '../lib/utils'
import PageHeader from '../components/PageHeader'
import toast from 'react-hot-toast'

const STATUS_CONFIG = {
  matched:   { label: '✔ Matched',   badge: 'badge-green', color: 'var(--accent-emerald)' },
  missing:   { label: '❌ Missing',   badge: 'badge-red',   color: 'var(--accent-red)' },
  mismatch:  { label: '⚠️ Mismatch', badge: 'badge-amber', color: 'var(--accent-amber)' },
  unmatched: { label: '— Unmatched', badge: 'badge-gray',  color: 'var(--text-muted)' },
}

export default function BankReconciliationPage() {
  const { profile, isAdmin } = useAuth()
  const [entries, setEntries] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [matchingId, setMatchingId] = useState(null)
  const [selectedTxId, setSelectedTxId] = useState({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [reconRes, txRes] = await Promise.all([
      supabase.from('bank_reconciliations')
        .select('*, transactions(amount, type, reference, transaction_date, profiles!transactions_user_id_fkey(name)), profiles!bank_reconciliations_reconciled_by_fkey(name)')
        .order('bank_date', { ascending: false }),
      supabase.from('transactions')
        .select('id, amount, type, reference, transaction_date, status, profiles!transactions_user_id_fkey(name)')
        .eq('status', 'completed')
        .order('transaction_date', { ascending: false })
        .limit(200),
    ])
    if (reconRes.data) setEntries(reconRes.data)
    if (txRes.data) setTransactions(txRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = useMemo(() => entries.filter(e => {
    if (filterStatus && e.match_status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return e.bank_reference?.toLowerCase().includes(q) ||
        e.bank_description?.toLowerCase().includes(q) ||
        String(e.bank_amount).includes(q)
    }
    return true
  }), [entries, filterStatus, search])

  const summary = useMemo(() => ({
    matched:   entries.filter(e => e.match_status === 'matched').length,
    missing:   entries.filter(e => e.match_status === 'missing').length,
    mismatch:  entries.filter(e => e.match_status === 'mismatch').length,
    unmatched: entries.filter(e => e.match_status === 'unmatched').length,
    total:     entries.length,
  }), [entries])

  const autoMatch = async () => {
    if (!isAdmin) return
    let matched = 0
    for (const entry of entries.filter(e => e.match_status === 'unmatched')) {
      // Find a transaction with matching amount ± 1 KES and within 3 days
      const match = transactions.find(tx => {
        const amtMatch = Math.abs(Number(tx.amount) - Number(entry.bank_amount)) <= 1
        const dateMatch = tx.transaction_date && entry.bank_date &&
          Math.abs(new Date(tx.transaction_date) - new Date(entry.bank_date)) <= 3 * 24 * 60 * 60 * 1000
        const refMatch = entry.bank_reference && tx.reference &&
          tx.reference.toLowerCase().includes(entry.bank_reference.toLowerCase())
        return amtMatch && (dateMatch || refMatch)
      })
      if (match) {
        await supabase.from('bank_reconciliations').update({
          transaction_id: match.id,
          match_status: 'matched',
          reconciled_by: profile.id,
          reconciled_at: new Date().toISOString(),
        }).eq('id', entry.id)
        matched++
      }
    }
    toast.success(`Auto-matched ${matched} entries`)
    fetchData()
  }

  const setStatus = async (entryId, status, txId = null) => {
    setMatchingId(entryId)
    const update = {
      match_status: status,
      reconciled_by: profile.id,
      reconciled_at: new Date().toISOString(),
    }
    if (txId) update.transaction_id = txId
    const { error } = await supabase.from('bank_reconciliations').update(update).eq('id', entryId)
    if (error) toast.error(error.message)
    else { toast.success('Status updated'); fetchData() }
    setMatchingId(null)
  }

  const exportReconciliation = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const rows = [
      ['Fundex — Bank Reconciliation Report'],
      ['Generated:', formatDateTime(new Date())],
      [],
      ['Date', 'Bank Amount', 'Bank Reference', 'Description', 'Status', 'Matched TX Amount', 'Matched TX Ref', 'Reconciled By'],
      ...entries.map(e => [
        formatDate(e.bank_date),
        Number(e.bank_amount),
        e.bank_reference || '',
        e.bank_description || '',
        e.match_status,
        e.transactions ? Number(e.transactions.amount) : '',
        e.transactions?.reference || '',
        e.profiles?.name || '',
      ]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Reconciliation')
    XLSX.writeFile(wb, `fundex-reconciliation-${formatDate(new Date(), 'yyyy-MM-dd')}.xlsx`)
    toast.success('Reconciliation exported!')
  }

  return (
    <div>
      <PageHeader
        title="Bank Reconciliation"
        subtitle="Match bank statement entries against recorded transactions"
        onRefresh={fetchData}
        loading={loading}
      >
        <button className="btn btn-secondary" onClick={exportReconciliation} title="Export to Excel">
          <Download size={14} /> Export
        </button>
        {isAdmin && (
          <>
            <button className="btn btn-secondary" onClick={autoMatch}>
              <Check size={14} /> Auto-Match
            </button>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add Bank Entry
            </button>
          </>
        )}
      </PageHeader>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setFilterStatus(filterStatus === key ? '' : key)}
            style={{
              padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: filterStatus === key ? cfg.color : 'var(--bg-elevated)',
              color: filterStatus === key ? '#fff' : cfg.color,
              border: `1px solid ${cfg.color}44`,
              transition: 'all 0.15s',
            }}
          >
            {cfg.label} ({summary[key] || 0})
          </button>
        ))}
        {filterStatus && (
          <button className="btn btn-secondary btn-sm" onClick={() => setFilterStatus('')}>Clear</button>
        )}
      </div>

      {/* Search */}
      <div className="card mb-4" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            className="form-input"
            placeholder="Search by reference or description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ border: 'none', background: 'none', padding: 0, fontSize: 13 }}
          />
          {search && <button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Clear</button>}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex justify-center" style={{ padding: 48 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏦</div>
            <p style={{ fontWeight: 600 }}>No bank entries yet</p>
            <p className="text-sm">Add bank statement entries to begin reconciliation</p>
          </div>
        ) : (
          <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Bank Date</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Matched Transaction</th>
                  {isAdmin && <th style={{ width: 200 }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(entry => {
                  const scfg = STATUS_CONFIG[entry.match_status] || STATUS_CONFIG.unmatched
                  const isWorking = matchingId === entry.id
                  return (
                    <tr key={entry.id} style={{ opacity: isWorking ? 0.6 : 1 }}>
                      <td className="text-sm">{formatDate(entry.bank_date)}</td>
                      <td className="text-mono" style={{ fontWeight: 700 }}>{formatCurrency(entry.bank_amount)}</td>
                      <td className="text-sm text-secondary">{entry.bank_reference || '—'}</td>
                      <td className="text-sm text-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.bank_description || '—'}
                      </td>
                      <td><span className={`badge ${scfg.badge}`}>{scfg.label}</span></td>
                      <td>
                        {entry.transactions ? (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{formatCurrency(entry.transactions.amount)} {entry.transactions.type}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {entry.transactions?.profiles?.name?.split(' ')[0]} · {entry.transactions.reference || '—'}
                            </div>
                            {entry.match_status === 'mismatch' && entry.mismatch_reason && (
                              <div style={{ fontSize: 11, color: 'var(--accent-amber)', marginTop: 2 }}>⚠️ {entry.mismatch_reason}</div>
                            )}
                          </div>
                        ) : <span className="text-xs text-muted">—</span>}
                      </td>
                      {isAdmin && (
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {entry.match_status === 'unmatched' && (
                              <select
                                className="form-select"
                                style={{ fontSize: 11, padding: '3px 6px' }}
                                value={selectedTxId[entry.id] || ''}
                                onChange={e => setSelectedTxId(p => ({ ...p, [entry.id]: e.target.value }))}
                              >
                                <option value="">Link to transaction…</option>
                                {transactions
                                  .filter(tx => Math.abs(Number(tx.amount) - Number(entry.bank_amount)) <= 1)
                                  .slice(0, 15)
                                  .map(tx => (
                                    <option key={tx.id} value={tx.id}>
                                      {formatDate(tx.transaction_date)} · {tx.profiles?.name?.split(' ')[0]} · {formatCurrency(tx.amount)}
                                    </option>
                                  ))
                                }
                              </select>
                            )}
                            <div className="row-actions">
                              <button className="btn-row-edit" onClick={() => setStatus(entry.id, 'matched', selectedTxId[entry.id] || entry.transaction_id)}>✔ Match</button>
                              <button className="btn-row-delete" onClick={() => setStatus(entry.id, 'missing')}>❌ Missing</button>
                              <button style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', background: 'rgba(230,144,10,0.1)', color: 'var(--accent-amber)', border: '1px solid rgba(230,144,10,0.2)' }} onClick={() => setStatus(entry.id, 'mismatch')}>⚠️ Mismatch</button>
                            </div>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddBankEntryModal onClose={() => setShowAdd(false)} onSuccess={fetchData} />}
    </div>
  )
}

function AddBankEntryModal({ onClose, onSuccess }) {
  const { profile } = useAuth()
  const [form, setForm] = useState({ bank_date: new Date().toISOString().slice(0, 10), bank_amount: '', bank_reference: '', bank_description: '' })
  const [bulk, setBulk] = useState('')
  const [mode, setMode] = useState('single') // 'single' | 'bulk'
  const [loading, setLoading] = useState(false)
  const handleChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const handleSingle = async (e) => {
    e.preventDefault()
    if (!form.bank_amount || Number(form.bank_amount) <= 0) { toast.error('Amount required'); return }
    setLoading(true)
    const { error } = await supabase.from('bank_reconciliations').insert({
      bank_date: form.bank_date,
      bank_amount: Number(form.bank_amount),
      bank_reference: form.bank_reference || null,
      bank_description: form.bank_description || null,
      match_status: 'unmatched',
    })
    if (error) toast.error(error.message)
    else { toast.success('Bank entry added'); onSuccess(); onClose() }
    setLoading(false)
  }

  const handleBulk = async () => {
    const lines = bulk.trim().split('\n').filter(Boolean)
    if (lines.length === 0) { toast.error('Paste CSV lines: date,amount,reference,description'); return }
    setLoading(true)
    const rows = []
    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim())
      if (parts.length >= 2) {
        rows.push({
          bank_date: parts[0] || new Date().toISOString().slice(0, 10),
          bank_amount: Math.abs(Number(parts[1])) || 0,
          bank_reference: parts[2] || null,
          bank_description: parts[3] || null,
          match_status: 'unmatched',
        })
      }
    }
    const { error } = await supabase.from('bank_reconciliations').insert(rows)
    if (error) toast.error(error.message)
    else { toast.success(`${rows.length} entries imported`); onSuccess(); onClose() }
    setLoading(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Add Bank Entry</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {['single', 'bulk'].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: mode === m ? 'var(--olive)' : 'var(--bg-elevated)',
                color: mode === m ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${mode === m ? 'var(--olive)' : 'var(--border)'}`,
              }}>{m === 'single' ? 'Single Entry' : 'Bulk Import (CSV)'}</button>
            ))}
          </div>

          {mode === 'single' ? (
            <form onSubmit={handleSingle}>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Bank Date</label>
                  <input className="form-input" name="bank_date" type="date" value={form.bank_date} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (KES)</label>
                  <input className="form-input" name="bank_amount" type="number" min="0.01" step="0.01" value={form.bank_amount} onChange={handleChange} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Bank Reference</label>
                <input className="form-input" name="bank_reference" value={form.bank_reference} onChange={handleChange} placeholder="e.g. MPESA-ABC123" />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input className="form-input" name="bank_description" value={form.bank_description} onChange={handleChange} placeholder="e.g. Deposit from Collins" />
              </div>
              <div className="flex gap-3">
                <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
                  {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : 'Add Entry'}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div className="form-group">
                <label className="form-label">Paste CSV (date, amount, reference, description)</label>
                <textarea className="form-textarea" rows={6} value={bulk} onChange={e => setBulk(e.target.value)}
                  placeholder={'2026-04-01, 5000, MPESA-001, Collins deposit\n2026-04-03, 3000, MPESA-002, Gilbert deposit'} />
              </div>
              <div className="flex gap-3">
                <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary flex-1" onClick={handleBulk} disabled={loading}>
                  {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : `Import ${bulk.trim().split('\n').filter(Boolean).length} Lines`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
