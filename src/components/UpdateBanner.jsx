import { RefreshCw } from 'lucide-react'
import { useAppUpdate } from '../hooks/useAppUpdate'

// Shown at the top of every page while a newer version is waiting to be installed.
export default function UpdateBanner() {
  const { needRefresh, dismissed, dismiss, applyUpdate, applying } = useAppUpdate()
  if (!needRefresh || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        padding: '12px 16px',
        borderRadius: 12,
        background: 'rgba(90,138,30,0.10)',
        border: '1px solid rgba(90,138,30,0.35)',
      }}
    >
      <RefreshCw size={18} style={{ color: 'var(--olive)', flexShrink: 0 }} />
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
          A new version of Nitalink is available
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          Updating reloads the app, so finish anything you are typing first.
        </div>
      </div>
      <button className="btn btn-primary btn-sm" onClick={applyUpdate} disabled={applying}>
        {applying ? 'Updating…' : 'Update now'}
      </button>
      <button className="btn btn-secondary btn-sm" onClick={dismiss} disabled={applying}>
        Later
      </button>
    </div>
  )
}
