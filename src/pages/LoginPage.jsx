import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(error.message || 'Invalid credentials')
    } else {
      toast.success('Welcome back!')
      navigate('/')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f0f2f0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div className="text-center mb-8">
          {/* <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <img
              src="/logo.jpeg"
              alt="Geotreks / Fundex Savings"
              style={{ width: 150, height: 'auto', objectFit: 'contain' }}
            />
          </div> */}
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--navy)', letterSpacing: '-0.4px' }}>
            Fundex
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
            Group Investment Management Platform
          </p>
        </div>

        {/* Card */}
        <div className="card" style={{ border: '1px solid var(--border-strong)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' }}>
            Sign in to your account
          </h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="form-input"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  style={{ paddingLeft: 36 }}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="form-input"
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  style={{ paddingLeft: 36, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                fontSize: 13, color: 'var(--accent-red)'
              }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Signing in…</> : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Members hint */}
        {/* <div style={{ marginTop: 24, padding: 16, background: 'rgba(122,140,58,0.06)', border: '1px solid rgba(122,140,58,0.12)', borderRadius: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>MEMBER ACCOUNTS</p>
          {[
            { name: 'Collins K. Towett', role: 'Admin', email: 'collins.towett@Fundex.app' },
            { name: 'Gilbert K. Lang\'at', role: 'Member', email: 'gilbert.langat@Fundex.app' },
            { name: 'Amos K. Korir', role: 'Member', email: 'amos.korir@Fundex.app' },
          ].map(m => (
            <div key={m.email} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.name}</span>
              <span className={`badge badge-${m.role === 'Admin' ? 'amber' : 'blue'}`} style={{ fontSize: 10 }}>{m.role}</span>
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Create these accounts in Supabase Auth, then use those credentials to log in.
          </p>
        </div> */}
      </div>
    </div>
  )
}
