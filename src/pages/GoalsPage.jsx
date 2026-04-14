import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Target, CheckCircle, AlertCircle, Save } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate } from '../lib/utils'
import PageHeader from '../components/PageHeader'
import AdminActions from '../components/AdminActions'
import toast from 'react-hot-toast'

export default function GoalsPage() {
  const { profile, isAdmin } = useAuth()
  const [goals, setGoals] = useState([])
  const [totalPool, setTotalPool] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editGoal, setEditGoal] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [goalsRes, poolRes] = await Promise.all([
      supabase.from('savings_goals').select('*, profiles!savings_goals_created_by_fkey(name)').order('created_at', { ascending: false }),
      supabase.from('member_contribution_summary').select('net_contribution')
    ])
    if (goalsRes.data) setGoals(goalsRes.data)
    if (poolRes.data) setTotalPool(poolRes.data.reduce((s, m) => s + Number(m.net_contribution), 0))
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleActive = async (goal) => {
    const { error } = await supabase.from('savings_goals').update({ is_active: !goal.is_active }).eq('id', goal.id)
    if (!error) { toast.success('Goal updated'); fetchData() }
  }

  const deleteGoal = async (id) => {
    if (!window.confirm('Delete this goal? This cannot be undone.')) return
    setDeletingId(id)
    const { error } = await supabase.from('savings_goals').delete().eq('id', id)
    if (error) toast.error('Delete failed: ' + error.message)
    else { toast.success('Goal deleted'); fetchData() }
    setDeletingId(null)
  }

  const getProgress = (goal) => Math.min((totalPool / Number(goal.target_amount)) * 100, 100)
  const activeGoals = goals.filter(g => g.is_active)

  return (
    <div>
      <PageHeader title="Savings Goals" subtitle="Track progress toward your financial targets" onRefresh={fetchData} loading={loading}>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={15} /> Add Goal</button>}
      </PageHeader>

      <div className="grid-3 mb-6">
        <div className="card"><div className="card-title mb-3">Current Pool</div><div className="stat-value gold text-mono">{formatCurrency(totalPool)}</div></div>
        <div className="card"><div className="card-title mb-3">Active Goals</div><div className="stat-value">{activeGoals.length}</div></div>
        <div className="card"><div className="card-title mb-3">Goals Achieved</div><div className="stat-value green">{goals.filter(g => getProgress(g) >= 100).length}</div></div>
      </div>

      {loading ? (
        <div className="flex justify-center" style={{ padding: 60 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : goals.length === 0 ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon"><Target size={40} /></div>
          <p style={{ fontWeight: 600 }}>No goals yet</p>
          {isAdmin && <button className="btn btn-primary mt-4" onClick={() => setShowAdd(true)}><Plus size={15} /> Create Goal</button>}
        </div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {goals.map(goal => {
            const progress = getProgress(goal)
            const achieved = progress >= 100
            const remaining = Math.max(Number(goal.target_amount) - totalPool, 0)
            return (
              <div key={goal.id} className="card" style={{ borderColor: achieved ? 'rgba(16,185,129,0.3)' : 'var(--border)', opacity: deletingId === goal.id ? 0.5 : 1 }}>
                <div className="flex items-start justify-between mb-4" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <div className="flex items-center gap-3" style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: achieved ? 'rgba(16,185,129,0.15)' : 'rgba(122,140,58,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {achieved ? <CheckCircle size={20} style={{ color: 'var(--accent-emerald)' }} /> : <Target size={20} style={{ color: 'var(--olive)' }} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontWeight: 700, fontSize: 16 }}>{goal.title}</h3>
                      {goal.description && <p className="text-sm text-muted mt-1">{goal.description}</p>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                    {achieved && <span className="badge badge-green">✓ Achieved</span>}
                    {!goal.is_active && !achieved && <span className="badge badge-gray">Inactive</span>}
                    {isAdmin && (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(goal)} style={{ whiteSpace: 'nowrap' }}>
                          {goal.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <AdminActions
                          onEdit={() => setEditGoal(goal)}
                          onDelete={() => deleteGoal(goal.id)}
                          deleting={deletingId === goal.id}
                        />
                      </>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-secondary">{formatCurrency(Math.min(totalPool, Number(goal.target_amount)))} of {formatCurrency(goal.target_amount)}</span>
                    <span className="text-mono font-bold" style={{ color: achieved ? 'var(--accent-emerald)' : 'var(--olive-light)', fontSize: 14 }}>{progress.toFixed(1)}%</span>
                  </div>
                  <div className="progress-bar" style={{ height: 10 }}>
                    <div className="progress-fill" style={{ width: `${progress}%`, background: achieved ? 'linear-gradient(90deg, var(--accent-emerald), #34d399)' : 'linear-gradient(90deg, var(--olive-dim), var(--olive-light))' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div><p className="text-xs text-muted">Target</p><p className="text-mono font-semibold" style={{ fontSize: 13 }}>{formatCurrency(goal.target_amount)}</p></div>
                  {remaining > 0 && <div><p className="text-xs text-muted">Still Needed</p><p className="text-mono font-semibold text-red" style={{ fontSize: 13 }}>{formatCurrency(remaining)}</p></div>}
                  {goal.target_date && <div><p className="text-xs text-muted">Target Date</p><p style={{ fontSize: 13, fontWeight: 600 }}>{formatDate(goal.target_date)}</p></div>}
                  <div><p className="text-xs text-muted">Created by</p><p style={{ fontSize: 13 }}>{goal.profiles?.name?.split(' ')[0]}</p></div>
                </div>

                {goal.target_date && !achieved && goal.is_active && progress < 50 && (
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8 }}>
                    <AlertCircle size={14} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
                    <p style={{ fontSize: 12, color: 'var(--accent-red)' }}>Below 50% — group may need to increase contributions to hit target.</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <GoalModal onClose={() => setShowAdd(false)} onSuccess={fetchData} />}
      {editGoal && <GoalModal goal={editGoal} onClose={() => setEditGoal(null)} onSuccess={fetchData} />}
    </div>
  )
}

function GoalModal({ goal, onClose, onSuccess }) {
  const { profile } = useAuth()
  const isEdit = !!goal
  const [form, setForm] = useState({
    title: goal?.title || '',
    description: goal?.description || '',
    target_amount: goal?.target_amount || '',
    target_date: goal?.target_date || '',
    month_year: goal?.month_year || '',
  })
  const [loading, setLoading] = useState(false)
  const handleChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const payload = { title: form.title, description: form.description || null, target_amount: Number(form.target_amount), target_date: form.target_date || null, month_year: form.month_year || null }
    const { error } = isEdit
      ? await supabase.from('savings_goals').update(payload).eq('id', goal.id)
      : await supabase.from('savings_goals').insert({ ...payload, created_by: profile.id })
    setLoading(false)
    if (error) { toast.error(error.message); return }
    toast.success(isEdit ? 'Goal updated!' : 'Goal created!')
    onSuccess(); onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Edit Goal' : 'Create Savings Goal'}</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group"><label className="form-label">Goal Title</label><input className="form-input" name="title" value={form.title} onChange={handleChange} required /></div>
            <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" name="description" value={form.description} onChange={handleChange} /></div>
            <div className="form-group"><label className="form-label">Target Amount (KES)</label><input className="form-input" name="target_amount" type="number" min="1" value={form.target_amount} onChange={handleChange} required /></div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">Target Date</label><input className="form-input" name="target_date" type="date" value={form.target_date} onChange={handleChange} /></div>
              <div className="form-group"><label className="form-label">Month</label><input className="form-input" name="month_year" type="month" value={form.month_year} onChange={handleChange} /></div>
            </div>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
                {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <><Save size={14} /> {isEdit ? 'Save Changes' : 'Create Goal'}</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
