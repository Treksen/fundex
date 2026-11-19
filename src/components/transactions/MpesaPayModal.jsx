import { useEffect, useRef, useState } from 'react'
import { X as XIcon, Smartphone, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { displayPhone, looksLikeKenyanMobile, describeResult, FINAL, REQUEST_COLUMNS } from '../../lib/mpesa'

const POLL_MS = 3000
const GIVE_UP_MS = 120_000

// "Pay with M-Pesa": sends the PIN prompt to the phone, then waits for KCB's confirmation.
// The deposit itself is created by the server when M-Pesa confirms, and then awaits verification as usual.
export default function MpesaPayModal({ onClose, onDone }) {
  const { profile, isAdmin } = useAuth()
  const [members, setMembers] = useState([])
  const [form, setForm] = useState({ member_id: profile?.id || '', amount: '', phone: displayPhone(profile?.phone) })
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [request, setRequest] = useState(null)      // the mpesa_requests row being watched
  const [gaveUp, setGaveUp] = useState(false)
  const timer = useRef(null)
  const started = useRef(0)

  useEffect(() => {
    if (!isAdmin) return
    supabase.from('profiles').select('id, name, phone, is_active').order('name')
      .then(({ data }) => setMembers((data || []).filter((m) => m.is_active !== false)))
  }, [isAdmin])

  useEffect(() => () => clearTimeout(timer.current), [])

  const chooseMember = (id) => {
    const m = members.find((x) => x.id === id)
    setForm((f) => ({ ...f, member_id: id, phone: displayPhone(m?.phone ?? (id === profile?.id ? profile?.phone : '')) }))
  }

  const poll = async (id) => {
    const { data } = await supabase.from('mpesa_requests').select(REQUEST_COLUMNS).eq('id', id).maybeSingle()
    if (data) setRequest(data)
    if (data && FINAL.includes(data.status)) { if (data.status === 'paid') onDone?.(); return }
    if (Date.now() - started.current > GIVE_UP_MS) { setGaveUp(true); return }
    timer.current = setTimeout(() => poll(id), POLL_MS)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^\d+$/.test(form.amount.trim()) || Number(form.amount) < 1) { setError('Enter a whole number of shillings, at least 1'); return }
    if (!looksLikeKenyanMobile(form.phone)) { setError('Enter a Safaricom number, e.g. 0712 345 678'); return }
    setSending(true)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('mpesa-stk-push', {
        body: { amount: form.amount.trim(), phone: form.phone, member_id: form.member_id || profile?.id },
      })
      let body = data
      if (fnErr?.context && typeof fnErr.context.json === 'function') { try { body = await fnErr.context.json() } catch { /* generic */ } }
      if (fnErr || !body?.ok) { setError(body?.error || 'Could not start the payment. Please try again.'); return }
      setRequest({ id: body.request_id, status: 'pending', amount: body.amount, phone: body.phone })
      started.current = Date.now()
      setGaveUp(false)
      timer.current = setTimeout(() => poll(body.request_id), POLL_MS)
    } catch {
      setError('Could not reach the server. Check your connection.')
    } finally {
      setSending(false)
    }
  }

  const result = describeResult(request)
  const waiting = request && !FINAL.includes(request.status) && !gaveUp
  const Icon = result.tone === 'ok' ? CheckCircle : result.tone === 'warn' ? AlertTriangle : result.tone === 'error' ? XCircle : Smartphone
  const color = result.tone === 'ok' ? 'var(--accent-emerald)' : result.tone === 'warn' ? 'var(--accent-amber)' : result.tone === 'error' ? 'var(--accent-red)' : 'var(--olive)'
  const payingFor = members.find((m) => m.id === form.member_id)

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !waiting && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mpesa-title" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h2 className="modal-title" id="mpesa-title">Pay with M-Pesa</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close"><XIcon size={14} /></button>
        </div>
        <div className="modal-body">
          {!request ? (
            <form onSubmit={submit}>
              {isAdmin && members.length > 0 && (
                <div className="form-group">
                  <label className="form-label" htmlFor="mp-member">Deposit for</label>
                  <select id="mp-member" className="form-select" value={form.member_id} onChange={(e) => chooseMember(e.target.value)}>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === profile?.id ? ' (you)' : ''}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label className="form-label" htmlFor="mp-amount">Amount (KES)</label>
                <input id="mp-amount" className="form-input" inputMode="numeric" autoFocus required value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d]/g, '') }))} placeholder="e.g. 5000" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="mp-phone">M-Pesa phone number</label>
                <input id="mp-phone" className="form-input" inputMode="tel" autoComplete="tel" required value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="0712 345 678" />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
                  The PIN prompt goes to this phone. You can use another Safaricom number, e.g. someone paying on {payingFor && payingFor.id !== profile?.id ? `${payingFor.name.split(' ')[0]}'s` : 'your'} behalf.
                </div>
              </div>
              {error && <p role="alert" style={{ color: 'var(--accent-red)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={sending}>
                {sending ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Sending prompt…</> : <><Smartphone size={14} /> Send M-Pesa prompt</>}
              </button>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.45 }}>
                Paid to KCB paybill, account 135 146 0749. The M-Pesa code is recorded automatically; the deposit then awaits verification by an admin.
              </p>
            </form>
          ) : (
            <div role="status" aria-live="polite" style={{ textAlign: 'center', padding: '8px 0' }}>
              {waiting ? <div className="spinner" style={{ width: 36, height: 36, margin: '0 auto 14px' }} /> : <Icon size={40} style={{ color, marginBottom: 10 }} />}
              <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{gaveUp ? 'No answer from M-Pesa yet' : result.title}</p>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 16px' }}>
                {gaveUp
                  ? 'If you entered your PIN, the payment will still be recorded automatically as soon as M-Pesa confirms, and you will get a notification. You can close this window.'
                  : result.text}
              </p>
              {!waiting && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {['cancelled', 'failed', 'timeout', 'send_failed'].includes(request.status) && (
                    <button className="btn btn-secondary" onClick={() => { setRequest(null); setError('') }}>Try again</button>
                  )}
                  <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
