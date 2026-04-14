import { useState, useEffect, useCallback, useMemo } from 'react'
import { CheckCircle, XCircle, Vote, Plus, Save, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDateTime } from '../lib/utils'
import PageHeader from '../components/PageHeader'
import MemberAvatar from '../components/MemberAvatar'
import AdminActions from '../components/AdminActions'
import toast from 'react-hot-toast'

const ACTION_LABELS = {
  investment_create:     { label: 'New Investment',       icon: '📈', color: 'var(--navy-light)' },
  investment_distribute: { label: 'Profit Distribution',  icon: '💰', color: 'var(--accent-emerald)' },
  large_deposit:         { label: 'Large Deposit',        icon: '💵', color: 'var(--olive)' },
  adjustment:            { label: 'Adjustment',           icon: '⚙️', color: 'var(--accent-amber)' },
  dividend_distribute:   { label: 'Dividend Distribution',icon: '🏦', color: 'var(--navy-light)' },
}
const STATUS_CFG = {
  pending:  { badge: 'badge-amber', label: '⏳ Pending',   color: 'var(--accent-amber)' },
  approved: { badge: 'badge-green', label: '✅ Approved',  color: 'var(--accent-emerald)' },
  rejected: { badge: 'badge-red',   label: '❌ Rejected',  color: 'var(--accent-red)' },
  cancelled:{ badge: 'badge-gray',  label: '🚫 Cancelled', color: 'var(--text-muted)' },
}

export default function GovernancePage() {
  const { profile, isAdmin } = useAuth()
  const [approvals, setApprovals] = useState([])
  const [votes, setVotes]         = useState({})
  const [members, setMembers]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [voting, setVoting]       = useState({})
  const [filterStatus, setFilterStatus] = useState('pending')
  const [showCreate, setShowCreate]     = useState(false)
  const [editApproval, setEditApproval] = useState(null)
  const [deletingId, setDeletingId]     = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [apprRes, voteRes, memRes] = await Promise.all([
      supabase.from('action_approvals').select('*, profiles!action_approvals_requested_by_fkey(name,avatar_url)').order('created_at', { ascending: false }),
      supabase.from('action_approval_votes').select('*, profiles!action_approval_votes_voter_id_fkey(name,avatar_url)'),
      supabase.from('profiles').select('id,name,avatar_url,role'),
    ])
    if (apprRes.data) setApprovals(apprRes.data)
    if (voteRes.data) {
      const map = {}
      voteRes.data.forEach(v => { if (!map[v.approval_id]) map[v.approval_id] = []; map[v.approval_id].push(v) })
      setVotes(map)
    }
    if (memRes.data) setMembers(memRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    const ch = supabase.channel('governance-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_approvals' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_approval_votes' }, fetchData)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [fetchData])

  const handleVote = async (approvalId, vote) => {
    setVoting(v => ({ ...v, [approvalId]: true }))
    const { data, error } = await supabase.rpc('cast_action_vote', { p_approval_id: approvalId, p_voter_id: profile.id, p_vote: vote })
    if (error) toast.error(error.message)
    else if (data?.status === 'approved') toast.success('✅ Action approved by quorum!')
    else if (data?.status === 'rejected') toast.error('❌ Action rejected by quorum.')
    else toast.success(`Vote recorded — ${data?.approved || 0}/${data?.needed || 2} approvals`)
    setVoting(v => ({ ...v, [approvalId]: false }))
    fetchData()
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this proposal? This cannot be undone.')) return
    setDeletingId(id)
    // Delete votes first then proposal
    await supabase.from('action_approval_votes').delete().eq('approval_id', id)
    const { error } = await supabase.from('action_approvals').delete().eq('id', id)
    if (error) toast.error('Delete failed: ' + error.message)
    else { toast.success('Proposal deleted'); fetchData() }
    setDeletingId(null)
  }

  const handleCancelApproval = async (id) => {
    const { error } = await supabase.from('action_approvals').update({ status: 'cancelled' }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Proposal cancelled'); fetchData() }
  }

  const myVote = (approvalId) => votes[approvalId]?.find(v => v.voter_id === profile?.id)
  const canVote = (appr) => appr.status === 'pending' && appr.requested_by !== profile?.id && !myVote(appr.id)
  const filtered = useMemo(() => filterStatus ? approvals.filter(a => a.status === filterStatus) : approvals, [approvals, filterStatus])
  const pendingCount = approvals.filter(a => a.status === 'pending' && a.requested_by !== profile?.id && !myVote(a.id)).length

  return (
    <div>
      <PageHeader title="Governance" subtitle="Multi-signature approval workflows — 2-of-3 required" onRefresh={fetchData} loading={loading}>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> New Proposal</button>}
      </PageHeader>

      {pendingCount > 0 && (
        <div style={{ background: 'rgba(230,144,10,0.08)', border: '1px solid rgba(230,144,10,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Vote size={16} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent-amber)' }}>{pendingCount} proposal{pendingCount !== 1 ? 's' : ''} awaiting your vote</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {['', 'pending', 'approved', 'rejected', 'cancelled'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: filterStatus === s ? 'var(--olive)' : 'var(--bg-elevated)', color: filterStatus === s ? '#fff' : 'var(--text-secondary)', border: `1px solid ${filterStatus === s ? 'var(--olive)' : 'var(--border)'}` }}>
            {s || 'All'} {s === 'pending' && approvals.filter(a => a.status === 'pending').length > 0 ? `(${approvals.filter(a => a.status === 'pending').length})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center" style={{ padding: 48 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty-state"><Vote size={40} style={{ opacity: 0.2 }} /><p style={{ fontWeight: 600 }}>No {filterStatus} proposals</p></div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(appr => {
            const cfg = ACTION_LABELS[appr.action_type] || { label: appr.action_type, icon: '📋', color: 'var(--text-primary)' }
            const scfg = STATUS_CFG[appr.status] || STATUS_CFG.pending
            const apprVotes = votes[appr.id] || []
            const mine = myVote(appr.id)
            const votable = canVote(appr)
            const isVoting = voting[appr.id]
            const pct = appr.min_approvals > 0 ? Math.round((appr.approved_count / appr.min_approvals) * 100) : 0

            return (
              <div key={appr.id} className="card" style={{ borderLeft: `4px solid ${appr.status === 'pending' && votable ? 'var(--accent-amber)' : scfg.color}`, opacity: deletingId === appr.id ? 0.5 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{appr.title}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={`badge ${scfg.badge}`} style={{ fontSize: 11 }}>{scfg.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDateTime(appr.created_at)}</span>
                      {appr.amount && <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: cfg.color }}>{formatCurrency(appr.amount)}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MemberAvatar name={appr.profiles?.name} avatarUrl={appr.profiles?.avatar_url} size={28} fontSize={11} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{appr.profiles?.name?.split(' ')[0]}</span>
                    {isAdmin && (
                      <AdminActions
                        onEdit={() => setEditApproval(appr)}
                        onDelete={() => handleDelete(appr.id)}
                        deleting={deletingId === appr.id}
                        editLabel="Edit"
                      />
                    )}
                  </div>
                </div>

                {appr.status === 'pending' && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Approval Progress (need {appr.min_approvals}-of-3)</span>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{appr.approved_count}/{appr.min_approvals}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(100, pct)}%`, background: appr.rejected_count >= appr.min_approvals ? 'var(--accent-red)' : 'var(--olive)', transition: 'width 0.4s' }} />
                    </div>
                  </div>
                )}

                {apprVotes.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {apprVotes.map(v => (
                      <div key={v.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: v.vote === 'approve' ? 'rgba(13,156,94,0.10)' : 'rgba(220,53,69,0.10)', border: `1px solid ${v.vote === 'approve' ? 'rgba(13,156,94,0.25)' : 'rgba(220,53,69,0.25)'}`, color: v.vote === 'approve' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                        <MemberAvatar name={v.profiles?.name} avatarUrl={v.profiles?.avatar_url} size={16} fontSize={7} />
                        {v.profiles?.name?.split(' ')[0]} <span>{v.vote === 'approve' ? '✓' : '✕'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {votable && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-success btn-sm" style={{ flex: 1, minWidth: 100, justifyContent: 'center' }} disabled={isVoting} onClick={() => handleVote(appr.id, 'approve')}>
                      {isVoting ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <><CheckCircle size={13} /> Approve</>}
                    </button>
                    <button className="btn btn-danger btn-sm" style={{ flex: 1, minWidth: 100, justifyContent: 'center' }} disabled={isVoting} onClick={() => handleVote(appr.id, 'reject')}>
                      <XCircle size={13} /> Reject
                    </button>
                    {isAdmin && appr.status === 'pending' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleCancelApproval(appr.id)}>Cancel</button>
                    )}
                  </div>
                )}
                {mine && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: mine.vote === 'approve' ? 'var(--accent-emerald)' : 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {mine.vote === 'approve' ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    You {mine.vote === 'approve' ? 'approved' : 'rejected'} this proposal
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showCreate && <ProposalModal members={members} onClose={() => setShowCreate(false)} onSuccess={fetchData} />}
      {editApproval && <ProposalModal proposal={editApproval} members={members} onClose={() => setEditApproval(null)} onSuccess={fetchData} />}
    </div>
  )
}

function ProposalModal({ proposal, members, onClose, onSuccess }) {
  const { profile } = useAuth()
  const isEdit = !!proposal
  const [form, setForm] = useState({
    title: proposal?.title || '',
    action_type: proposal?.action_type || 'investment_create',
    amount: proposal?.amount || '',
    metadata: proposal?.metadata?.notes || '',
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Title is required'); return }
    setLoading(true)
    const payload = { title: form.title.trim(), action_type: form.action_type, amount: form.amount ? Number(form.amount) : null, metadata: form.metadata ? { notes: form.metadata } : {} }
    const { error } = isEdit
      ? await supabase.from('action_approvals').update(payload).eq('id', proposal.id)
      : await supabase.from('action_approvals').insert({ ...payload, reference_id: '00000000-0000-0000-0000-000000000000', reference_type: form.action_type.startsWith('invest') ? 'investment' : 'transaction', requested_by: profile.id, min_approvals: 2 })
    if (error) { toast.error(error.message); setLoading(false); return }
    if (!isEdit) {
      const others = members.filter(m => m.id !== profile.id)
      if (others.length > 0) await supabase.from('notifications').insert(others.map(m => ({ user_id: m.id, title: '🗳️ New Governance Proposal', message: `${profile.name?.split(' ')[0]} submitted: "${form.title.trim()}" — your vote is needed.`, type: 'approval', action_url: '/governance' })))
    }
    toast.success(isEdit ? 'Proposal updated!' : 'Proposal submitted!')
    setLoading(false); onSuccess(); onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Edit Proposal' : 'Submit Proposal'}</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {!isEdit && <div style={{ background: 'rgba(26,36,114,0.06)', border: '1px solid rgba(26,36,114,0.15)', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>🗳️ Requires <strong>2 approvals out of 3 members</strong> to proceed.</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required /></div>
            <div className="form-group">
              <label className="form-label">Action Type</label>
              <select className="form-select" value={form.action_type} onChange={e => setForm(p => ({ ...p, action_type: e.target.value }))}>
                {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Amount (KES) — optional</label><input className="form-input" type="number" min="0" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.metadata} onChange={e => setForm(p => ({ ...p, metadata: e.target.value }))} rows={3} /></div>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
                {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><Save size={14} /> {isEdit ? 'Save Changes' : 'Submit'}</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
