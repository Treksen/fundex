import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatDateTime } from '../lib/utils'
import PageHeader from '../components/PageHeader'
import {
  AlertTriangle, AlertCircle, Info, Zap,
  CheckCircle, RotateCcw, Trash2, ChevronDown, ChevronUp,
  Filter, RefreshCw, ShieldAlert,
} from 'lucide-react'
import toast from 'react-hot-toast'

const PAGE_SIZE = 25

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', badge: 'badge-red',   icon: Zap,           color: 'var(--accent-red)' },
  error:    { label: 'Error',    badge: 'badge-red',   icon: AlertCircle,   color: 'var(--accent-red)' },
  warning:  { label: 'Warning',  badge: 'badge-amber', icon: AlertTriangle, color: 'var(--accent-amber)' },
  info:     { label: 'Info',     badge: 'badge-blue',  icon: Info,          color: 'var(--accent-blue, #3a4db5)' },
}

const SOURCE_LABELS = {
  frontend:      'Frontend',
  rpc:           'RPC',
  trigger:       'DB Trigger',
  edge_function: 'Edge Function',
  other:         'Other',
}

export default function ErrorLogPage() {
  const { isAdmin, profile } = useAuth()

  const [logs, setLogs]             = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading]       = useState(true)
  const [page, setPage]             = useState(1)
  const [expanded, setExpanded]     = useState({})
  const [resolving, setResolving]   = useState({})
  const [deleting, setDeleting]     = useState({})
  const [clearing, setClearing]     = useState(false)

  const [filter, setFilter] = useState({
    severity: '',
    source:   '',
    resolved: 'false', // default: show unresolved only
    search:   '',
  })

  // Stats for the summary row
  const [stats, setStats] = useState({
    critical: 0, error: 0, warning: 0, info: 0, unresolved: 0
  })

  const fetchLogs = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)

    let q = supabase
      .from('error_logs')
      .select(
        `id, created_at, severity, source, context, message,
         details, error_code, resolved, resolved_at, resolution_note,
         profiles!error_logs_user_id_fkey(name, role),
         resolver:profiles!error_logs_resolved_by_fkey(name)`,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (filter.severity) q = q.eq('severity', filter.severity)
    if (filter.source)   q = q.eq('source',   filter.source)
    if (filter.resolved !== '') q = q.eq('resolved', filter.resolved === 'true')
    if (filter.search)   q = q.ilike('message', `%${filter.search}%`)

    const { data, count, error } = await q
    if (!error) {
      setLogs(data || [])
      setTotalCount(count || 0)
    } else {
      toast.error('Failed to load error logs: ' + error.message)
    }
    setLoading(false)
  }, [isAdmin, page, filter])

  const fetchStats = useCallback(async () => {
    if (!isAdmin) return
    const { data } = await supabase
      .from('error_logs')
      .select('severity, resolved')
    if (!data) return
    const s = { critical: 0, error: 0, warning: 0, info: 0, unresolved: 0 }
    data.forEach(r => {
      if (s[r.severity] !== undefined) s[r.severity]++
      if (!r.resolved) s.unresolved++
    })
    setStats(s)
  }, [isAdmin])

  useEffect(() => { fetchLogs(); fetchStats() }, [fetchLogs, fetchStats])
  useEffect(() => { setPage(1) }, [filter])

  const handleResolve = async (log, note = '') => {
    setResolving(r => ({ ...r, [log.id]: true }))
    const { data, error } = await supabase.rpc('resolve_error', {
      p_error_id: log.id,
      p_note:     note || null,
    })
    if (error || data?.success === false) {
      toast.error(data?.error || error?.message || 'Failed to resolve')
    } else {
      toast.success('Marked as resolved')
      await Promise.all([fetchLogs(), fetchStats()])
    }
    setResolving(r => ({ ...r, [log.id]: false }))
  }

  const handleReopen = async (log) => {
    setResolving(r => ({ ...r, [log.id]: true }))
    const { data, error } = await supabase.rpc('reopen_error', { p_error_id: log.id })
    if (error || data?.success === false) {
      toast.error(data?.error || error?.message || 'Failed to reopen')
    } else {
      toast.success('Reopened')
      await Promise.all([fetchLogs(), fetchStats()])
    }
    setResolving(r => ({ ...r, [log.id]: false }))
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this error log entry permanently?')) return
    setDeleting(d => ({ ...d, [id]: true }))
    const { error } = await supabase.from('error_logs').delete().eq('id', id)
    if (error) {
      toast.error('Delete failed: ' + error.message)
      setDeleting(d => ({ ...d, [id]: false }))
    } else {
      toast.success('Entry deleted')
      await Promise.all([fetchLogs(), fetchStats()])
    }
  }

  const handleClearResolved = async () => {
    if (!window.confirm('Permanently delete all resolved log entries?')) return
    setClearing(true)
    const { error } = await supabase
      .from('error_logs')
      .delete()
      .eq('resolved', true)
    if (error) {
      toast.error('Clear failed: ' + error.message)
    } else {
      toast.success('Resolved entries cleared')
      await Promise.all([fetchLogs(), fetchStats()])
    }
    setClearing(false)
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }))

  if (!isAdmin) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        <ShieldAlert size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
        <p>Admin access required.</p>
      </div>
    )
  }

  return (
    <div className="page-container">
      <PageHeader
        title="Error Log"
        subtitle="Runtime errors, failed operations, and unhandled exceptions"
        icon={<AlertTriangle size={20} />}
      />

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { key: 'unresolved', label: 'Unresolved', color: 'var(--accent-red)',            icon: AlertCircle },
          { key: 'critical',   label: 'Critical',   color: 'var(--accent-red)',            icon: Zap },
          { key: 'error',      label: 'Errors',     color: 'var(--accent-red)',            icon: AlertCircle },
          { key: 'warning',    label: 'Warnings',   color: 'var(--accent-amber)',          icon: AlertTriangle },
          { key: 'info',       label: 'Info',       color: 'var(--accent-blue, #3a4db5)', icon: Info },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.key} className="card" style={{ flex: '1 1 120px', padding: '12px 16px', minWidth: 100 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon size={16} style={{ color: s.color, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: s.key === 'unresolved' && stats[s.key] > 0 ? s.color : 'var(--text-primary)' }}>
                    {stats[s.key]}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="form-input"
            placeholder="Search message…"
            value={filter.search}
            onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            style={{ flex: '1 1 180px', minWidth: 140 }}
          />
          <select
            className="form-select"
            value={filter.severity}
            onChange={e => setFilter(f => ({ ...f, severity: e.target.value }))}
            style={{ flex: '0 0 140px' }}
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <select
            className="form-select"
            value={filter.source}
            onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}
            style={{ flex: '0 0 150px' }}
          >
            <option value="">All Sources</option>
            <option value="frontend">Frontend</option>
            <option value="rpc">RPC</option>
            <option value="trigger">DB Trigger</option>
            <option value="edge_function">Edge Function</option>
            <option value="other">Other</option>
          </select>
          <select
            className="form-select"
            value={filter.resolved}
            onChange={e => setFilter(f => ({ ...f, resolved: e.target.value }))}
            style={{ flex: '0 0 150px' }}
          >
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
            <option value="">All</option>
          </select>
          <button
            className="btn btn-secondary btn-sm"
            onClick={fetchLogs}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={13} /> Refresh
          </button>
          {stats.unresolved === 0 && (
            <button
              className="btn btn-sm"
              disabled={clearing}
              onClick={handleClearResolved}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 6,
              }}
            >
              <Trash2 size={13} /> Clear resolved
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
        {loading ? 'Loading…' : `${totalCount.toLocaleString()} entr${totalCount === 1 ? 'y' : 'ies'}`}
        {filter.resolved === 'false' && stats.unresolved > 0 && ` — ${stats.unresolved} unresolved`}
      </div>

      {/* Desktop table */}
      <div className="table-container error-log-table-view" style={{ border: 'none', borderRadius: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th style={{ width: 150 }}>Time</th>
              <th style={{ width: 90 }}>Severity</th>
              <th style={{ width: 110 }}>Source</th>
              <th style={{ width: 180 }}>Context</th>
              <th>Message</th>
              <th style={{ width: 130 }}>User</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {filter.resolved === 'false'
                    ? '✅ No unresolved errors'
                    : 'No entries match the current filter'}
                </td>
              </tr>
            )}
            {logs.map(log => {
              const scfg = SEVERITY_CONFIG[log.severity] || SEVERITY_CONFIG.error
              const Icon = scfg.icon
              const isExpanded = expanded[log.id]
              const hasDetails = log.details && Object.keys(log.details).length > 0

              return (
                <>
                  <tr
                    key={log.id}
                    style={{
                      opacity: deleting[log.id] ? 0.4 : 1,
                      background: log.resolved ? undefined : 'rgba(220,53,69,0.02)',
                      borderLeft: log.resolved ? '3px solid transparent' : `3px solid ${scfg.color}`,
                      cursor: hasDetails ? 'pointer' : undefined,
                    }}
                    onClick={() => hasDetails && toggle(log.id)}
                  >
                    <td style={{ textAlign: 'center', color: scfg.color }}>
                      <Icon size={14} />
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                      {formatDateTime(log.created_at)}
                    </td>
                    <td>
                      <span className={`badge ${scfg.badge}`} style={{ fontSize: 10 }}>
                        {scfg.label}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {SOURCE_LABELS[log.source] || log.source}
                    </td>
                    <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.context || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                          {log.message}
                        </span>
                        {log.error_code && (
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', background: 'var(--bg-elev-1)', padding: '1px 5px', borderRadius: 4 }}>
                            {log.error_code}
                          </span>
                        )}
                        {hasDetails && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {log.profiles?.name || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>
                      {log.resolved ? (
                        <span className="badge badge-green" style={{ fontSize: 10 }}>Resolved</span>
                      ) : (
                        <span className="badge badge-red" style={{ fontSize: 10 }}>Open</span>
                      )}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {!log.resolved ? (
                          <button
                            title="Mark resolved"
                            className="btn-row-edit"
                            disabled={resolving[log.id]}
                            onClick={() => handleResolve(log)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          >
                            {resolving[log.id]
                              ? <div className="spinner" style={{ width: 11, height: 11 }} />
                              : <><CheckCircle size={11} /> Resolve</>
                            }
                          </button>
                        ) : (
                          <button
                            title="Re-open"
                            className="btn-row-edit"
                            disabled={resolving[log.id]}
                            onClick={() => handleReopen(log)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          >
                            <RotateCcw size={11} /> Reopen
                          </button>
                        )}
                        <button
                          title="Delete entry"
                          className="btn-row-delete"
                          disabled={deleting[log.id]}
                          onClick={() => handleDelete(log.id)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded details row */}
                  {isExpanded && hasDetails && (
                    <tr key={`${log.id}-detail`} style={{ background: 'var(--bg-elev-1, rgba(0,0,0,0.02))' }}>
                      <td colSpan={9} style={{ padding: '10px 16px 14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <pre style={{
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-secondary)',
                            background: 'var(--bg-elev-2, rgba(0,0,0,0.04))',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            padding: 12,
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            margin: 0,
                            maxHeight: 300,
                          }}>
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                          {log.resolved && log.resolution_note && (
                            <div style={{ fontSize: 12, color: 'var(--accent-emerald)' }}>
                              <strong>Resolution note:</strong> {log.resolution_note}
                              {log.resolver?.name && ` — resolved by ${log.resolver.name}`}
                              {log.resolved_at && ` on ${formatDateTime(log.resolved_at)}`}
                            </div>
                          )}
                          {!log.resolved && (
                            <ResolveWithNoteRow log={log} onResolve={handleResolve} busy={resolving[log.id]} />
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="mobile-error-list">
        {!loading && logs.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            {filter.resolved === 'false' ? '✅ No unresolved errors' : 'No entries match'}
          </div>
        )}
        {logs.map(log => {
          const scfg = SEVERITY_CONFIG[log.severity] || SEVERITY_CONFIG.error
          const Icon = scfg.icon
          const isExp = expanded[log.id]
          const hasDetails = log.details && Object.keys(log.details).length > 0

          return (
            <div
              key={`mob-${log.id}`}
              className="mobile-error-card"
              style={{
                borderLeft: log.resolved ? '3px solid transparent' : `3px solid ${scfg.color}`,
                opacity: deleting[log.id] ? 0.4 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <Icon size={16} style={{ color: scfg.color, marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {log.message}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {formatDateTime(log.created_at)}
                    {log.context && ` · ${log.context}`}
                    {log.profiles?.name && ` · ${log.profiles.name}`}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <span className={`badge ${scfg.badge}`} style={{ fontSize: 10 }}>{scfg.label}</span>
                    <span className="badge badge-gray" style={{ fontSize: 10 }}>
                      {SOURCE_LABELS[log.source] || log.source}
                    </span>
                    {log.resolved
                      ? <span className="badge badge-green" style={{ fontSize: 10 }}>Resolved</span>
                      : <span className="badge badge-red" style={{ fontSize: 10 }}>Open</span>
                    }
                  </div>
                </div>
              </div>

              {hasDetails && (
                <button
                  style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 6, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => toggle(log.id)}
                >
                  {isExp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {isExp ? 'Hide details' : 'Show details'}
                </button>
              )}

              {isExp && hasDetails && (
                <pre style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                  background: 'var(--bg-elev-2, rgba(0,0,0,0.04))', border: '1px solid var(--border)',
                  borderRadius: 6, padding: 10, overflowX: 'auto', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', margin: '8px 0 0', maxHeight: 200,
                }}>
                  {JSON.stringify(log.details, null, 2)}
                </pre>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {!log.resolved ? (
                  <button
                    className="btn btn-sm"
                    disabled={resolving[log.id]}
                    onClick={() => handleResolve(log)}
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'var(--accent-emerald)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, padding: '6px' }}
                  >
                    {resolving[log.id] ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <><CheckCircle size={12} /> Resolve</>}
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    disabled={resolving[log.id]}
                    onClick={() => handleReopen(log)}
                  >
                    <RotateCcw size={12} /> Reopen
                  </button>
                )}
                <button
                  className="btn-row-delete"
                  style={{ padding: '6px 10px' }}
                  disabled={deleting[log.id]}
                  onClick={() => handleDelete(log.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 20 }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            ← Prev
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Page {page} of {totalPages}
          </span>
          <button className="btn btn-secondary btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}


// ── Inline "Resolve with note" row ───────────────────────────
function ResolveWithNoteRow({ log, onResolve, busy }) {
  const [note, setNote] = useState('')
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        className="form-input"
        placeholder="Optional resolution note…"
        value={note}
        onChange={e => setNote(e.target.value)}
        style={{ flex: '1 1 220px', fontSize: 12 }}
      />
      <button
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={() => onResolve(log, note)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        {busy ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <><CheckCircle size={12} /> Mark Resolved</>}
      </button>
    </div>
  )
}
