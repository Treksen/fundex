import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { X as XIcon, Mail, KeyRound, Ban, UserCheck, UserX, Shield, Save, Copy, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import MemberAvatar from '../MemberAvatar'
import { callMemberAdmin, availableActions, memberStatus } from '../../lib/memberAdmin'
import { formatCurrency } from '../../lib/utils'

const first = (s) => String(s || '').split(' ')[0]

// Admin tools for one member. Every sensitive step asks for the admin's OWN password; the server function
// re-checks everything (role, password, admin-protection) no matter what this screen shows.
export default function MemberActionsModal({ member, me, onClose, onChanged }) {
  const actions = availableActions(member, me)
  const status = memberStatus(member)
  const [details, setDetails] = useState({ name: member.name || '', phone: member.phone || '', email: member.email || '' })
  const [role, setRole] = useState(member.role)
  const [pending, setPending] = useState(null)      // { action, extra, title, body, danger, askReason }
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState(null)
  const [tempPassword, setTempPassword] = useState(null)
  const [deactivation, setDeactivation] = useState(null)
  // Refresh the parent list only when the dialog closes: refreshing earlier can unmount this dialog
  // (the Members page shows a spinner while loading) and a one-time password would be lost.
  const changed = useRef(false)
  const close = () => { if (changed.current) onChanged?.(); onClose() }

  // Close on Escape (but never while a one-time password is on screen without the admin confirming).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy && !tempPassword) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const loadSummary = async () => {
    const r = await callMemberAdmin(supabase, 'summary', member.id)
    if (r.ok) setSummary(r.data.summary)
  }

  const run = async (action, extra = {}) => {
    setBusy(true)
    const r = await callMemberAdmin(supabase, action, member.id, {
      ...extra,
      ...(password ? { admin_password: password } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    })
    setBusy(false)
    if (!r.ok) {
      if (r.needsPassword) setPassword('')
      toast.error(r.error)
      return
    }
    setPassword(''); setReason(''); setPending(null)
    toast.success(r.data.message || 'Done')
    changed.current = true
    if (action === 'temp_password') { setTempPassword({ value: r.data.temporary_password, forced: r.data.forced_change, message: r.data.message }); return }
    if (action === 'deactivate') { setDeactivation(r.data.result || {}); return }
    close()
  }

  const ask = (p) => { setPassword(''); setReason(''); setPending(p); if (p.action === 'deactivate' || p.action === 'suspend') loadSummary() }

  const saveDetails = (e) => {
    e.preventDefault()
    const extra = { name: details.name.trim(), phone: details.phone.trim() }
    const emailChanged = details.email.trim().toLowerCase() !== String(member.email || '').toLowerCase()
    if (!emailChanged) { run('edit_details', extra); return }
    ask({
      action: 'edit_details', extra: { ...extra, email: details.email.trim() },
      title: 'Change sign-in email',
      body: `${first(member.name)} will sign in with ${details.email.trim()} from now on. The old address stops working at once. They get a notification about the change.`,
    })
  }

  const CONFIRM = {
    set_role: () => ({
      action: 'set_role', extra: { role },
      title: role === 'admin' ? `Make ${first(member.name)} an admin` : `Change ${first(member.name)} to a member`,
      body: role === 'admin'
        ? 'Admins can verify deposits, record transactions for anyone, manage members and see the Admin section.'
        : 'They lose access to the Admin section and admin-only actions. The last admin can never be removed.',
    }),
    send_reset: () => ({
      action: 'send_reset', extra: { redirect_to: `${window.location.origin}/reset-password` },
      title: 'Send a password reset email',
      body: `A link to set a new password goes to ${member.email}. Their current password keeps working until they use the link. If emails are not arriving, use a temporary password instead.`,
    }),
    temp_password: () => ({
      action: 'temp_password', title: 'Set a temporary password',
      body: `${first(member.name)}'s current password stops working immediately. You will see the temporary password ONCE: give it to them privately (in person or by phone call). They must choose their own password when they sign in.`,
    }),
    suspend: () => ({
      action: 'suspend', askReason: true, danger: true, title: 'Suspend sign-in',
      body: `${first(member.name)} will not be able to sign in. They stay a member: balances, votes and notifications are unchanged. Use this for a lost phone or a temporary problem.`,
    }),
    restore_login: () => ({ action: 'restore_login', title: 'Restore sign-in', body: `${first(member.name)} will be able to sign in again with their current password.` }),
    deactivate: () => ({
      action: 'deactivate', askReason: true, danger: true, title: `Deactivate ${first(member.name)}`,
      body: `Use this when ${first(member.name)} leaves the group. Their sign-in is blocked, they stop receiving group notifications and are no longer asked to approve withdrawals. Their transaction history and balance stay on record. You can reactivate them later.`,
    }),
    reactivate: () => ({ action: 'reactivate', title: `Reactivate ${first(member.name)}`, body: 'They can sign in again with their old password and are included in new withdrawal approvals. Votes removed when they were deactivated are not restored.' }),
  }

  const copyTemp = async () => {
    try { await navigator.clipboard.writeText(tempPassword.value); toast.success('Copied') } catch { toast.error('Copy failed: select it and copy by hand') }
  }

  const has = (a) => actions.includes(a)
  const section = { borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }
  const hint = { fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !busy && !tempPassword && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="member-admin-title" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2 className="modal-title" id="member-admin-title">Manage member</h2>
          {!tempPassword && <button className="btn btn-secondary btn-sm" onClick={close} disabled={busy} aria-label="Close"><XIcon size={14} /></button>}
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <MemberAvatar name={member.name} avatarUrl={member.avatar_url} size={44} fontSize={15} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{member.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.email}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <span className={`badge ${member.role === 'admin' ? 'badge-olive' : 'badge-blue'}`}>{member.role === 'admin' ? 'Admin' : 'Member'}</span>
                <span className={`badge ${status.badge}`}>{status.label}</span>
                {member.must_change_password && <span className="badge badge-amber">Temporary password</span>}
              </div>
            </div>
          </div>
          {status.key === 'inactive' && (
            <p style={hint}>
              Deactivated{member.deactivated_at ? ` on ${new Date(member.deactivated_at).toLocaleDateString()}` : ''}{member.deactivation_reason ? `: ${member.deactivation_reason}` : ''}
            </p>
          )}

          {/* ── one-time temporary password ── */}
          {tempPassword && (
            <div style={{ ...section }}>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Temporary password for {first(member.name)}</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 20, letterSpacing: 1, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', userSelect: 'all' }}>
                  {tempPassword.value}
                </code>
                <button className="btn btn-secondary btn-sm" onClick={copyTemp}><Copy size={13} /> Copy</button>
              </div>
              <p style={{ ...hint, color: tempPassword.forced ? 'var(--text-muted)' : 'var(--accent-red)' }}>{tempPassword.message}</p>
              <p style={hint}>This is shown only once and is not saved anywhere. Give it to {first(member.name)} privately. Do not post it in a group chat.</p>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => { setTempPassword(null); close() }}>
                I have given it to them. Close
              </button>
            </div>
          )}

          {/* ── deactivation result ── */}
          {deactivation && !tempPassword && (
            <div style={{ ...section }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>{first(member.name)} was deactivated</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <li>Pending votes removed: {deactivation.removed_votes ?? 0}</li>
                <li>Withdrawals completed as a result: {deactivation.withdrawals_completed ?? 0}</li>
                {(deactivation.withdrawals_rejected ?? 0) > 0 && <li>Withdrawals now rejected: {deactivation.withdrawals_rejected}</li>}
              </ul>
              {(deactivation.withdrawals_needing_decision || []).length > 0 && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(230,144,10,0.08)', border: '1px solid rgba(230,144,10,0.25)', fontSize: 13 }}>
                  <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {deactivation.withdrawals_needing_decision.length} withdrawal(s) now have nobody left to vote. An admin must approve or reject them:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {deactivation.withdrawals_needing_decision.map((id) => (
                      <li key={id}><Link to={`/transactions?pending=${id}`} onClick={close}>Open withdrawal</Link></li>
                    ))}
                  </ul>
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={close}>Done</button>
            </div>
          )}

          {/* ── confirm step with the admin's password ── */}
          {pending && !tempPassword && !deactivation && (
            <form style={{ ...section }} onSubmit={(e) => { e.preventDefault(); run(pending.action, pending.extra || {}) }}>
              <p style={{ fontWeight: 700, marginBottom: 6, color: pending.danger ? 'var(--accent-red)' : 'var(--text-primary)' }}>{pending.title}</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 10px' }}>{pending.body}</p>
              {(pending.action === 'deactivate' || pending.action === 'suspend') && summary && (
                <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {pending.action === 'deactivate' && <li>Pending withdrawal votes that will be removed: <strong>{summary.pending_votes}</strong> (those withdrawals are re-checked at once)</li>}
                  {pending.action === 'suspend' && summary.pending_votes > 0 && <li><strong>{summary.pending_votes}</strong> withdrawal(s) are waiting for their vote and will stay blocked while they cannot sign in. Deactivate instead if they have left.</li>}
                  {summary.own_pending_withdrawals > 0 && <li>Their own pending withdrawal requests: <strong>{summary.own_pending_withdrawals}</strong> (unchanged)</li>}
                  {summary.available_equity !== null && summary.available_equity !== undefined && <li>Balance on record: <strong>{formatCurrency(Number(summary.available_equity))}</strong></li>}
                </ul>
              )}
              {pending.askReason && (
                <div className="form-group">
                  <label className="form-label" htmlFor="member-admin-reason">Reason (optional, kept in the audit log)</label>
                  <input id="member-admin-reason" className="form-input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={pending.action === 'deactivate' ? 'e.g. Left the group, paid out' : 'e.g. Lost phone'} />
                </div>
              )}
              <div className="form-group">
                <label className="form-label" htmlFor="member-admin-password">Your password</label>
                <input id="member-admin-password" className="form-input" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                <div style={hint}>To confirm it is really you. This is your own password, not {first(member.name)}'s.</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
                <button type="submit" className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`} style={{ flex: 1, justifyContent: 'center' }} disabled={busy || !password}>
                  {busy ? <div className="spinner" style={{ width: 14, height: 14 }} /> : 'Confirm'}
                </button>
              </div>
            </form>
          )}

          {/* ── tools ── */}
          {!pending && !tempPassword && !deactivation && (
            <>
              {actions.length === 0 && <p style={hint}>This is your own account. Use Profile and Security instead.</p>}

              {has('edit_details') && (
                <form style={section} onSubmit={saveDetails}>
                  <p style={{ fontWeight: 700, marginBottom: 10 }}>Details</p>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="ma-name">Full name</label>
                      <input id="ma-name" className="form-input" value={details.name} maxLength={80} onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="ma-phone">Phone</label>
                      <input id="ma-phone" className="form-input" value={details.phone} maxLength={20} onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))} placeholder="+254…" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ma-email">Sign-in email</label>
                    <input id="ma-email" className="form-input" type="email" value={details.email} disabled={member.role === 'admin' || status.key === 'inactive'}
                      onChange={(e) => setDetails((d) => ({ ...d, email: e.target.value }))} />
                    {member.role === 'admin' && <div style={hint}>An admin's email can only be changed after they are made a member, or by themselves.</div>}
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}><Save size={12} /> Save details</button>
                </form>
              )}

              {has('set_role') && (
                <div style={section}>
                  <p style={{ fontWeight: 700, marginBottom: 10 }}>Role</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className="form-select" value={role} onChange={(e) => setRole(e.target.value)} style={{ flex: 1 }} aria-label="Role">
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button className="btn btn-secondary btn-sm" disabled={busy || role === member.role} onClick={() => ask(CONFIRM.set_role())}><Shield size={12} /> Change role</button>
                  </div>
                </div>
              )}

              {(has('send_reset') || has('temp_password') || has('suspend') || has('restore_login')) && (
                <div style={section}>
                  <p style={{ fontWeight: 700, marginBottom: 10 }}>Sign-in</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {has('send_reset') && <button className="btn btn-secondary btn-sm" onClick={() => ask(CONFIRM.send_reset())}><Mail size={12} /> Send reset email</button>}
                    {has('temp_password') && <button className="btn btn-secondary btn-sm" onClick={() => ask(CONFIRM.temp_password())}><KeyRound size={12} /> Set temporary password</button>}
                    {has('suspend') && <button className="btn btn-danger btn-sm" onClick={() => ask(CONFIRM.suspend())}><Ban size={12} /> Suspend sign-in</button>}
                    {has('restore_login') && <button className="btn btn-primary btn-sm" onClick={() => ask(CONFIRM.restore_login())}><UserCheck size={12} /> Restore sign-in</button>}
                  </div>
                </div>
              )}
              {member.role === 'admin' && !has('send_reset') && status.key === 'active' && (
                <p style={{ ...hint, ...section }}>Reset, temporary password, suspend and deactivate are not available for another admin. Change them to a member first.</p>
              )}

              {(has('deactivate') || has('reactivate')) && (
                <div style={section}>
                  <p style={{ fontWeight: 700, marginBottom: 10 }}>Membership</p>
                  {has('deactivate') && <button className="btn btn-danger btn-sm" onClick={() => ask(CONFIRM.deactivate())}><UserX size={12} /> Deactivate member</button>}
                  {has('reactivate') && <button className="btn btn-primary btn-sm" onClick={() => ask(CONFIRM.reactivate())}><UserCheck size={12} /> Reactivate member</button>}
                  <p style={hint}>Members are never deleted, so the group's financial history stays complete.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
