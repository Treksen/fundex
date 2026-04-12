import { RefreshCw } from 'lucide-react'

export default function PageHeader({ title, subtitle, onRefresh, loading = false, children }) {
  return (
    <div className="page-header">
      <div className="page-header-left">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="page-header-actions">
        {onRefresh && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh data"
            style={{ gap: 6, whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none', flexShrink: 0 }} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
