import AdminActions from '../components/AdminActions'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatDateTime } from '../lib/utils'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import toast from 'react-hot-toast'

const PAGE_SIZE = 50

export default function AuditPage() {
  const { isAdmin } = useAuth()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [filterAction, setFilterAction] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('audit_logs')
      .select('*, profiles!audit_logs_user_id_fkey(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (filterAction) query = query.ilike('action', `%${filterAction}%`)

    const { data, count } = await query
    if (data) setLogs(data)
    setTotalCount(count || 0)
    setLoading(false)
  }, [page, filterAction])

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => { setPage(1) }, [filterAction])

  const getActionColor = (action) => {
    if (action?.toLowerCase().includes('delete')) return 'var(--accent-red)'
    if (action?.toLowerCase().includes('creat')) return 'var(--accent-emerald)'
    if (action?.toLowerCase().includes('updat')) return 'var(--accent-amber)'
    return 'var(--text-secondary)'
  }
  const getActionBadgeClass = (action) => {
    if (action?.toLowerCase().includes('delete')) return 'badge-red'
    if (action?.toLowerCase().includes('creat')) return 'badge-green'
    if (action?.toLowerCase().includes('updat')) return 'badge-amber'
    return 'badge-gray'
  }

  const deleteLog = async (id) => {
    if (!window.confirm('Delete this audit log entry?')) return
    setDeletingId(id)
    const { data, error } = await supabase
      .from('audit_logs').delete().eq('id', id).select('id')
    if (error) {
      toast.error('Delete failed: ' + error.message)
    } else if (!data || data.length === 0) {
      // RLS blocked direct delete — use SECURITY DEFINER RPC
      const { error: rpcErr } = await supabase.rpc('admin_delete_audit_log', { p_log_id: id })
      if (rpcErr) toast.error('Delete failed: ' + rpcErr.message)
      else { toast.success('Log deleted'); fetchLogs() }
    } else {
      toast.success('Log deleted')
      fetchLogs()
    }
    setDeletingId(null)
  }

  const clearAllLogs = async () => {
    if (!window.confirm('⚠️ Clear ALL audit logs? This cannot be undone.')) return
    const { data, error } = await supabase
      .from('audit_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('id')
    if (error) {
      toast.error('Failed: ' + error.message)
    } else if (!data || data.length === 0) {
      // RLS blocked — use RPC
      const { error: rpcErr } = await supabase.rpc('admin_clear_audit_logs')
      if (rpcErr) toast.error('Failed: ' + rpcErr.message)
      else { toast.success('All logs cleared'); fetchLogs() }
    } else {
      toast.success(`Cleared ${data.length} log${data.length !== 1 ? 's' : ''}`)
      fetchLogs()
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Audit Log" subtitle={`${totalCount} total system actions recorded`} onRefresh={fetchLogs} loading={loading}>
        {isAdmin && totalCount > 0 && (
          <button className="btn btn-danger btn-sm" onClick={clearAllLogs}>🗑️ Clear All</button>
        )}
      </PageHeader>

      {/* Filter bar */}
      <div className="card mb-4">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, flexShrink: 0 }}>Filter action:</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['', 'create', 'update', 'delete', 'withdrawal', 'deposit'].map(f => (
              <button
                key={f}
                onClick={() => setFilterAction(f)}
                style={{
                  padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: filterAction === f ? 'var(--olive)' : 'var(--bg-elevated)',
                  color: filterAction === f ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${filterAction === f ? 'var(--olive)' : 'var(--border)'}`,
                }}
              >
                {f || 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex justify-center" style={{ padding: 48 }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <Shield size={40} style={{ opacity: 0.3 }} />
            <p>No audit records found</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="table-container audit-table-view" style={{ borderRadius: 0, border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Table</th>
                    <th>Record ID</th>
                    {isAdmin && <th style={{ width: 80 }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="text-xs text-muted text-mono">{formatDateTime(log.created_at)}</td>
                      <td style={{ fontSize: 13, fontWeight: 600 }}>{log.profiles?.name?.split(' ')[0] || 'System'}</td>
                      <td style={{ fontSize: 13, color: getActionColor(log.action) }}>{log.action}</td>
                      <td><span className="badge badge-gray">{log.table_name || '—'}</span></td>
                      <td className="text-xs text-muted text-mono">{log.record_id ? log.record_id.substring(0, 8) + '…' : '—'}</td>
                      {isAdmin && (
                        <td>
                          <AdminActions onDelete={() => deleteLog(log.id)} deleting={deletingId === log.id} size="xs" />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile audit cards */}
            <div>
              {logs.map(log => (
                <div key={`mob-${log.id}`} className="mobile-audit-card" style={{ opacity: deletingId === log.id ? 0.4 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                        {(log.profiles?.name?.split(' ')[0] || 'S')[0]}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{log.profiles?.name?.split(' ')[0] || 'System'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDateTime(log.created_at)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`badge ${getActionBadgeClass(log.action)}`} style={{ fontSize: 10, flexShrink: 0 }}>{log.action}</span>
                      {isAdmin && <AdminActions onDelete={() => deleteLog(log.id)} deleting={deletingId === log.id} size="xs" />}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    {log.table_name && <span className="badge badge-gray" style={{ fontSize: 10 }}>{log.table_name}</span>}
                    {log.record_id && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{log.record_id.substring(0, 12)}…</span>}
                  </div>
                </div>
              ))}
            </div>

            <Pagination page={page} totalPages={totalPages} totalItems={totalCount} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}
