import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { completePasswordReset, waitForRecovery } from '../lib/passwordReset'
import { MIN_PASSWORD } from '../lib/passwordRules'

// Where the emailed reset link lands. Works signed out (the link signs the member in temporarily).
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const { clearRecovery } = useAuth()
  const [state, setState] = useState('checking') // checking | ready | expired | invalid
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { waitForRecovery(supabase).then(setState) }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setSaving(true)
    const result = await completePasswordReset(supabase, password, confirm)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    toast.success('Password updated. Sign in with your new password.')
    clearRecovery?.()
    navigate('/login', { replace: true })
  }
  const backToLogin = () => { clearRecovery?.(); navigate('/login', { replace: true }) }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <img src="/logo-tile.svg" alt="Nitalink" style={{ width: 56, height: 56 }} />
          <h1 style={{ margin: '10px 0 0', fontSize: 22 }}>Set a new password</h1>
        </div>

        {state === 'checking' && <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Checking your reset link…</p>}

        {(state === 'expired' || state === 'invalid') && (
          <div role="alert" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {state === 'expired' ? 'This reset link has expired or was already used.' : 'This reset link is not valid.'} Request a new one from the sign-in page.
            </p>
            <button className="btn btn-primary" onClick={backToLogin}>Back to sign in</button>
          </div>
        )}

        {state === 'ready' && (
          <form onSubmit={submit}>
            <div className="form-group">
              <label className="form-label" htmlFor="new-password">New password</label>
              <div style={{ position: 'relative' }}>
                <input id="new-password" className="form-input" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus required minLength={MIN_PASSWORD}
                  value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 40 }} />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>At least {MIN_PASSWORD} characters.</div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="confirm-password">Confirm new password</label>
              <input id="confirm-password" className="form-input" type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && <p role="alert" style={{ color: 'var(--accent-red)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving}>{saving ? 'Saving…' : 'Update password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
