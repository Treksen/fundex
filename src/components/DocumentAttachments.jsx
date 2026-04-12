import { useState, useEffect, useRef } from 'react'
import { Paperclip, Upload, Trash2, FileText, Image, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatDateTime } from '../lib/utils'
import toast from 'react-hot-toast'

const FILE_ICONS = {
  'application/pdf': '📄',
  'image/jpeg': '🖼️',
  'image/jpg': '🖼️',
  'image/png': '🖼️',
  'image/webp': '🖼️',
  'application/msword': '📝',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
}

/**
 * Reusable document attachment widget.
 * Props: entityType ('transaction'|'investment'|'goal'|'member'), entityId
 */
export default function DocumentAttachments({ entityType, entityId, compact = false }) {
  const { profile, isAdmin } = useAuth()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (entityId) fetchDocs()
  }, [entityId])

  const fetchDocs = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('document_attachments')
      .select('*, profiles!document_attachments_uploaded_by_fkey(name)')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
    if (data) setDocs(data)
    setLoading(false)
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const ALLOWED = ['image/jpeg','image/jpg','image/png','image/webp','application/pdf',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (!ALLOWED.includes(file.type)) {
      toast.error('File type not allowed. Use JPG, PNG, PDF, or Word.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large (max 10MB)')
      return
    }

    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${entityType}/${entityId}/${Date.now()}_${profile.id}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, file, { contentType: file.type })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)

      const { error: dbErr } = await supabase.from('document_attachments').insert({
        entity_type: entityType,
        entity_id: entityId,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: profile.id,
        transaction_id: entityType === 'transaction' ? entityId : null,
      })
      if (dbErr) throw dbErr

      toast.success('Document uploaded!')
      fetchDocs()
    } catch (err) {
      toast.error('Upload failed: ' + err.message)
    }
    setUploading(false)
  }

  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return
    // Extract storage path from URL
    const urlPath = doc.file_url.split('/documents/')[1]
    if (urlPath) await supabase.storage.from('documents').remove([urlPath])
    await supabase.from('document_attachments').delete().eq('id', doc.id)
    toast.success('Document deleted')
    fetchDocs()
  }

  const formatSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 8 : 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Paperclip size={14} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Documents {docs.length > 0 && `(${docs.length})`}
          </span>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: 'rgba(90,138,30,0.1)', color: 'var(--olive)',
            border: '1px solid rgba(90,138,30,0.25)', cursor: 'pointer'
          }}
        >
          {uploading ? <div className="spinner" style={{ width: 10, height: 10 }} /> : <Upload size={11} />}
          {uploading ? 'Uploading…' : 'Attach File'}
        </button>
        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleUpload} />
      </div>

      {/* Doc list */}
      {loading ? (
        <div style={{ padding: 12, textAlign: 'center' }}><div className="spinner" style={{ width: 16, height: 16, margin: '0 auto' }} /></div>
      ) : docs.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: compact ? '4px 0' : '8px 0' }}>
          No attachments yet — bank slips, contracts, receipts
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map(doc => (
            <div key={doc.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 8,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              minWidth: 0
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{FILE_ICONS[doc.mime_type] || '📎'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a
                  href={doc.file_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-light)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {doc.file_name}
                </a>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                  {formatSize(doc.file_size)} · {doc.profiles?.name?.split(' ')[0]} · {formatDateTime(doc.created_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <a href={doc.file_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)', display: 'flex', padding: 4 }}>
                  <ExternalLink size={13} />
                </a>
                {(isAdmin || doc.uploaded_by === profile?.id) && (
                  <button onClick={() => handleDelete(doc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
