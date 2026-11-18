import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { requestPasswordReset } from '../lib/passwordReset'

// Shown on the login page when a member taps "Forgot password?"
export default function ForgotPasswordForm({ onBack }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setSending(true)
    const result = await requestPasswordReset(supabase, email, `${window.location.origin}/reset-password`)
    setSending(false)
    if (result.ok) setSent(true)
    else setError(result.error)
  }

  if (sent) {
    return (
      <div role="status" style={{ textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Check your email</h3>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          If an account exists for <strong>{email.trim().toLowerCase()}</strong>, we have sent a link to reset the password.
          Check your inbox and spam folder. The link expires soon.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onBack}>Back to sign in</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>Reset your password</h3>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>Enter the email you use for Nitalink and we will send you a reset link.</p>
      <div className="form-group">
        <label className="form-label" htmlFor="forgot-email">Email address</label>
        <input id="forgot-email" className="form-input" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      {error && <p role="alert" style={{ color: 'var(--accent-red)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
      <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={sending}>
        {sending ? 'Sending…' : 'Send reset link'}
      </button>
      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--olive)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Back to sign in</button>
      </div>
    </form>
  )
}
