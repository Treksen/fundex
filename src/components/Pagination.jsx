import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Pagination bar.
 * Props: page, totalPages, totalItems, pageSize, onChange(newPage)
 */
export default function Pagination({ page, totalPages, totalItems, pageSize, onChange }) {
  if (totalPages <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalItems)

  // Build page numbers with ellipsis
  const pages = []
  const delta = 1
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…')
    }
  }

  return (
    <div className="pagination">
      <span className="pagination-info">
        Showing {from}–{to} of {totalItems} records
      </span>
      <div className="pagination-controls">
        <button className="page-btn" onClick={() => onChange(page - 1)} disabled={page === 1}>
          <ChevronLeft size={14} />
        </button>
        {pages.map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} style={{ padding: '0 4px', fontSize: 12, color: 'var(--text-muted)' }}>…</span>
            : <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => onChange(p)}>{p}</button>
        )}
        <button className="page-btn" onClick={() => onChange(page + 1)} disabled={page === totalPages}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
