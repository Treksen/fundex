import { useState, useEffect, useCallback, useMemo } from 'react'
import { Upload, Check, X, AlertTriangle, Plus, Search, Save } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, formatDateTime } from '../lib/utils'
import PageHeader from '../components/PageHeader'
import AdminActions from '../components/AdminActions'
import toast from 'react-hot-toast'

const STATUS_CONFIG = {
  matched:   { label: '✔ Matched',    badge: 'badge-green', color: 'var(--accent-emerald)' },
  missing:   { label: '❌ Missing',    badge: 'badge-red',   color: 'var(--accent-red)' },
  mismatch:  { label: '⚠️ Mismatch',  badge: 'badge-amber', color: 'var(--accent-amber)' },
  unmatched: { label: '— Unmatched',  badge: 'badge-gray',  color: 'var(--text-muted)' },
}

export default function BankReconciliationPage() {
  const { profile, isAdmin } = useAuth()
  const [entries, setEntries]         = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [showAdd, setShowAdd]         = useState(false)
  const [editEntry, setEditEntry]     = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch]           = useState('')
  const [matchingId, setMatchingId]   = useState(null)
  const [selectedTxId, setSelectedTxId] = useState({})
  const [deletingId, setDeletingId]   = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [reconRes, txRes] = await Promise.all([
      supabase.from('bank_reconciliations')
        .select('*, transactions(amount, type, reference, transaction_date, profiles!transactions_user_id_fkey(name)), profiles!bank_reconciliations_reconciled_by_fkey(name)')
        .order('bank_date', { ascending: false }),
      supabase.from('transactions').select('id, amount, type, reference, transaction_date, status, profiles!transactions_user_id_fkey(name)').eq('status', 'completed').order('transaction_date', { ascending: false }).limit(200),
    ])
    if (reconRes.data) setEntries(reconRes.data)
    if (txRes.data) setTransactions(txRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = useMemo(() => entries.filter(e => {
    if (filterStatus && e.match_status !== filterStatus) return false
    if (search) { const q = search.toLowerCase(); return e.bank_reference?.toLowerCase().includes(q) || e.bank_description?.toLowerCase().includes(q) || String(e.bank_amount).includes(q) }
    return true
  }), [entries, filterStatus, search])

  const summary = useMemo(() => ({
    matched: entries.filter(e => e.match_status === 'matched').length,
    missing: entries.filter(e => e.match_status === 'missing').length,
    mismatch: entries.filter(e => e.match_status === 'mismatch').length,
    unmatched: entries.filter(e => e.match_status === 'unmatched').length,
    total: entries.length,
  }), [entries])

  const autoMatch = async () => {
    if (!isAdmin) return
    let matched = 0
    for (const entry of entries.filter(e => e.match_status === 'unmatched')) {
      const match = transactions.find(tx => {
        const amtMatch = Math.abs(Number(tx.amount) - Number(entry.bank_amount)) <= 1
        const dateMatch = tx.transaction_date && entry.bank_date && Math.abs(new Date(tx.transaction_date) - new Date(entry.bank_date)) <= 3 * 24 * 60 * 60 * 1000
        const refMatch = entry.bank_reference && tx.reference && tx.reference.toLowerCase().includes(entry.bank_reference.toLowerCase())
        return amtMatch && (dateMatch || refMatch)
      })
      if (match) {
        await supabase.from('bank_reconciliations').update({ transaction_id: match.id, match_status: 'matched', reconciled_by: profile?.id, reconciled_at: new Date().toISOString() }).eq('id', entry.id)
        matched++
      }
    }
    toast.success(`Auto-matched ${matched} entries`)
    fetchData()
  }

  const matchEntry = async (entryId, txId) => {
    if (!txId) { toast.error('Select a transaction first'); return }
    const tx = transactions.find(t => t.id === txId)
    const entry = entries.find(e => e.id === entryId)
    const status = Math.abs(Number(tx?.amount) - Number(entry?.bank_amount)) <= 1 ? 'matched' : 'mismatch'
    const { error } = await supabase.from('bank_reconciliations').update({ transaction_id: txId, match_status: status, reconciled_by: profile?.id, reconciled_at: new Date().toISOString() }).eq('id', entryId)
    if (error) toast.error(error.message)
    else { toast.success(status === 'matched' ? 'Entry matched!' : 'Mismatch recorded'); setMatchingId(null); setSelectedTxId({}); fetchData() }
  }

  const deleteEntry = async (id) => {
    if (!window.confirm('Delete this reconciliation entry?')) return
    setDeletingId(id)
    const { error } = await supabase.from('bank_reconciliations').delete().eq('id', id)
    if (error) toast.error('Delete failed: ' + error.message)
    else { toast.success('Entry deleted'); fetchData() }
    setDeletingId(null)
  }

  return (
    <div>
      <PageHeader title="Bank Reconciliation" subtitle="Match bank statements to system transactions" onRefresh={fetchData} loading={loading}>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={autoMatch}>⚡ Auto-Match</button>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={15} /> Add Entry</button>
          </div>
        )}
      </PageHeader>

      {/* Summary stats */}
      <div className="grid-4 mb-4">
        {[['matched','Matched','badge-green'],['unmatched','Unmatched','badge-gray'],['mismatch','Mismatch','badge-amber'],['missing','Missing','badge-red']].map(([key, label, badge]) => (
          <div key={key} className="card" style={{ padding: '12px 16px', cursor: 'pointer', borderColor: filterStatus === key ? 'var(--olive)' : undefined }} onClick={() => setFilterStatus(filterStatus === key ? '' : key)}>
            <div className="card-title mb-1">{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{summary[key]}</div>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div className="card mb-4" style={{ padding: '12px 16px' }}>
        <div className="filter-bar">
          <div style={{ position: 'relative', flex: 2 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="form-input" placeholder="Search reference or description…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
          </div>
          <select className="form-select" style={{ flex: 1 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {(filterStatus || search) && <button className="btn btn-secondary btn-sm" onClick={() => { setFilterStatus(''); setSearch('') }}>Clear</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex justify-center" style={{ padding: 48 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><p>No reconciliation entries{filterStatus || search ? ' matching filters' : ''}</p></div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="table-container" style={{ border: 'none', borderRadius: 0, display: 'none' }} id="recon-desktop">
              <table>
                <thead><tr><th>Bank Date</th><th>Description</th><th>Bank Amount</th><th>Reference</th><th>Status</th><th>Matched To</th>{isAdmin && <th>Actions</th>}</tr></thead>
                <tbody>
                  {filtered.map(entry => {
                    const scfg = STATUS_CONFIG[entry.match_status] || STATUS_CONFIG.unmatched
                    return (
                      <tr key={entry.id} style={{ opacity: deletingId === entry.id ? 0.4 : 1 }}>
                        <td className="text-sm">{formatDate(entry.bank_date)}</td>
                        <td className="text-sm">{entry.bank_description || '—'}</td>
                        <td className="text-mono font-bold">{formatCurrency(entry.bank_amount)}</td>
                        <td className="text-sm text-muted">{entry.bank_reference || '—'}</td>
                        <td><span className={`badge ${scfg.badge}`}>{scfg.label}</span></td>
                        <td className="text-sm text-secondary">
                          {entry.transactions ? `${formatCurrency(entry.transactions.amount)} — ${entry.transactions.profiles?.name?.split(' ')[0]}` : (
                            isAdmin && entry.match_status === 'unmatched' && matchingId === entry.id ? (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <select className="form-select" style={{ fontSize: 11 }} value={selectedTxId[entry.id] || ''} onChange={e => setSelectedTxId(p => ({ ...p, [entry.id]: e.target.value }))}>
                                  <option value="">Select transaction…</option>
                                  {transactions.map(t => <option key={t.id} value={t.id}>{formatDate(t.transaction_date)} — {formatCurrency(t.amount)} ({t.profiles?.name?.split(' ')[0]})</option>)}
                                </select>
                                <button className="btn btn-primary btn-sm" onClick={() => matchEntry(entry.id, selectedTxId[entry.id])}>Match</button>
                              </div>
                            ) : isAdmin ? (
                              <button className="recon-match-btn" onClick={() => setMatchingId(entry.id)}>Match →</button>
                            ) : '—'
                          )}
                        </td>
                        {isAdmin && <td><AdminActions onEdit={() => setEditEntry(entry)} onDelete={() => deleteEntry(entry.id)} deleting={deletingId === entry.id} size="xs" /></td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile + all-screen cards */}
            <div>
              {filtered.map(entry => {
                const scfg = STATUS_CONFIG[entry.match_status] || STATUS_CONFIG.unmatched
                return (
                  <div key={`m-${entry.id}`} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', opacity: deletingId === entry.id ? 0.4 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 15 }}>{formatCurrency(entry.bank_amount)}</span>
                          <span className={`badge ${scfg.badge}`} style={{ fontSize: 10 }}>{scfg.label}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          {formatDate(entry.bank_date)} · {entry.bank_description || entry.bank_reference || '—'}
                        </div>
                        {entry.transactions && (
                          <div style={{ fontSize: 12, color: 'var(--accent-emerald)', marginTop: 2 }}>
                            ✓ Matched: {formatCurrency(entry.transactions.amount)} — {entry.transactions.profiles?.name?.split(' ')[0]}
                          </div>
                        )}
                      </div>
                      {isAdmin && <AdminActions onEdit={() => setEditEntry(entry)} onDelete={() => deleteEntry(entry.id)} deleting={deletingId === entry.id} size="xs" />}
                    </div>
                    {isAdmin && entry.match_status === 'unmatched' && (
                      matchingId === entry.id ? (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                          <select className="form-select" style={{ flex: 1, fontSize: 12 }} value={selectedTxId[entry.id] || ''} onChange={e => setSelectedTxId(p => ({ ...p, [entry.id]: e.target.value }))}>
                            <option value="">Select transaction…</option>
                            {transactions.map(t => <option key={t.id} value={t.id}>{formatDate(t.transaction_date)} — {formatCurrency(t.amount)} ({t.profiles?.name?.split(' ')[0]})</option>)}
                          </select>
                          <button className="btn btn-primary btn-sm" onClick={() => matchEntry(entry.id, selectedTxId[entry.id])}>Match</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setMatchingId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="recon-match-btn" style={{ marginTop: 6 }} onClick={() => setMatchingId(entry.id)}>Link to Transaction →</button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {showAdd && <ReconEntryModal onClose={() => setShowAdd(false)} onSuccess={fetchData} />}
      {editEntry && <ReconEntryModal entry={editEntry} onClose={() => setEditEntry(null)} onSuccess={fetchData} />}
    </div>
  )
}

function ReconEntryModal({ entry, onClose, onSuccess }) {
  const isEdit = !!entry
  const [form, setForm] = useState({ bank_date: entry?.bank_date || new Date().toISOString().slice(0, 10), bank_amount: entry?.bank_amount || '', bank_reference: entry?.bank_reference || '', bank_description: entry?.bank_description || '', match_status: entry?.match_status || 'unmatched' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const payload = { bank_date: form.bank_date, bank_amount: Number(form.bank_amount), bank_reference: form.bank_reference || null, bank_description: form.bank_description || null, match_status: form.match_status }
    const { error } = isEdit
      ? await supabase.from('bank_reconciliations').update(payload).eq('id', entry.id)
      : await supabase.from('bank_reconciliations').insert(payload)
    setLoading(false)
    if (error) { toast.error(error.message); return }
    toast.success(isEdit ? 'Entry updated!' : 'Entry added!')
    onSuccess(); onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Edit Bank Entry' : 'Add Bank Entry'}</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">Bank Date *</label><input className="form-input" type="date" value={form.bank_date} onChange={e => setForm(p => ({ ...p, bank_date: e.target.value }))} required /></div>
              <div className="form-group"><label className="form-label">Amount (KES) *</label><input className="form-input" type="number" min="0" step="0.01" value={form.bank_amount} onChange={e => setForm(p => ({ ...p, bank_amount: e.target.value }))} required /></div>
            </div>
            <div className="form-group"><label className="form-label">Reference</label><input className="form-input" value={form.bank_reference} onChange={e => setForm(p => ({ ...p, bank_reference: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Description</label><input className="form-input" value={form.bank_description} onChange={e => setForm(p => ({ ...p, bank_description: e.target.value }))} /></div>
            {isEdit && (
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-select" value={form.match_status} onChange={e => setForm(p => ({ ...p, match_status: e.target.value }))}>
                  <option value="unmatched">Unmatched</option>
                  <option value="matched">Matched</option>
                  <option value="mismatch">Mismatch</option>
                  <option value="missing">Missing</option>
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
                {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><Save size={14} /> {isEdit ? 'Save Changes' : 'Add Entry'}</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
