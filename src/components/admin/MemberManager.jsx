import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, Search, Settings2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import MemberAvatar from '../MemberAvatar'
import MemberActionsModal from './MemberActionsModal'
import { memberStatus } from '../../lib/memberAdmin'

const FILTERS = [['all', 'All'], ['active', 'Active'], ['suspended', 'Suspended'], ['inactive', 'Deactivated']]
const COLUMNS = 'id, name, email, phone, role, avatar_url, is_active, login_disabled, must_change_password, deactivated_at, deactivation_reason'

// Admin Panel > Manage members: every account with its status, and the tools for each.
export default function MemberManager() {
  const { profile } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase.from('profiles').select(COLUMNS).order('name')
    if (err) setError(/is_active|login_disabled|must_change_password|column/i.test(err.message)
      ? 'The database update for member tools (migration 034) has not been run yet.'
      : 'Could not load members.')
    else { setError(''); setMembers(data || []) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c = { all: members.length, active: 0, suspended: 0, inactive: 0 }
    for (const m of members) c[memberStatus(m).key]++
    return c
  }, [members])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((m) =>
      (filter === 'all' || memberStatus(m).key === filter) &&
      (!q || `${m.name} ${m.email} ${m.phone || ''}`.toLowerCase().includes(q)))
  }, [members, query, filter])

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Users size={16} style={{ color: 'var(--olive)' }} />
        <h3 style={{ fontWeight: 700, fontSize: 15 }}>Manage Members</h3>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
        Edit details, change roles, help with passwords, suspend sign-in or deactivate members who have left.
        Sensitive actions ask for your own password. Members are never deleted, so their history stays complete.
      </p>

      {error ? (
        <div role="alert" style={{ padding: 12, borderRadius: 8, background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.25)', fontSize: 13, color: 'var(--accent-red)' }}>{error}</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ position: 'relative', flex: '1 1 200px' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" placeholder="Search name, email or phone" value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 30 }} aria-label="Search members" />
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {FILTERS.map(([id, label]) => (
                <button key={id} type="button" className={`btn btn-sm ${filter === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(id)} aria-pressed={filter === id}>
                  {label} ({counts[id]})
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>
          ) : shown.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>No members match.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {shown.map((m) => {
                const st = memberStatus(m)
                const isMe = m.id === profile?.id
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)', opacity: st.key === 'inactive' ? 0.65 : 1 }}>
                    <MemberAvatar name={m.name} avatarUrl={m.avatar_url} size={36} fontSize={13} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}{isMe && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (you)</span>}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                        <span className={`badge ${m.role === 'admin' ? 'badge-olive' : 'badge-blue'}`}>{m.role === 'admin' ? 'Admin' : 'Member'}</span>
                        {st.key !== 'active' && <span className={`badge ${st.badge}`}>{st.label}</span>}
                        {m.must_change_password && <span className="badge badge-amber">Temporary password</span>}
                      </div>
                    </div>
                    {!isMe && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(m)} aria-label={`Manage ${m.name}`}>
                        <Settings2 size={12} /> Manage
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {selected && (
        <MemberActionsModal member={selected} me={profile} onClose={() => setSelected(null)} onChanged={load} />
      )}
    </div>
  )
}
