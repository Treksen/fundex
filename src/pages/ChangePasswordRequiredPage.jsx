import { useState } from 'react'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { validateNewPassword, MIN_PASSWORD } from '../lib/passwordRules'
import { friendlyResetError } from '../lib/passwordReset'
import BrandLogo from '../components/BrandLogo'

// Shown instead of the app while an admin-set temporary password is still in use.
// The flag is cleared by the database only when the password really changes (migration 034).
export default function ChangePasswordRequiredPage() {
  const { profile, fetchProfile, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const invalid = validateNewPassword(password, confirm)
    if (invalid) { setError(invalid); return }
    setError(''); setSaving(true)
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password })
      if (upErr) { setError(friendlyResetError(upErr.message)); return }
      await fetchProfile()
      toast.success('Password changed. Welcome back!')
    } catch {
      setError('Could not update your password. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <BrandLogo size={56} />
          <h1 style={{ margin: '10px 0 6px', fontSize: 22 }}>Choose your own password</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            {profile?.name ? `Hi ${profile.name.split(' ')[0]}, an` : 'An'} admin gave you a temporary password.
            Set a new one that only you know to continue.
          </p>
        </div>
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label" htmlFor="forced-new-password">New password</label>
            <div style={{ position: 'relative' }}>
              <input id="forced-new-password" className="form-input" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus required minLength={MIN_PASSWORD}
                value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 40 }} />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>At least {MIN_PASSWORD} characters, different from the temporary one.</div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="forced-confirm-password">Confirm new password</label>
            <input id="forced-confirm-password" className="form-input" type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <p role="alert" style={{ color: 'var(--accent-red)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving}>{saving ? 'Saving…' : 'Set password and continue'}</button>
        </form>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => signOut()} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}>Sign out</button>
      </div>
    </div>
  )
}
