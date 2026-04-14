import { Edit2, Trash2 } from 'lucide-react'

/**
 * Reusable admin Edit + Delete button pair.
 * Used on every table row AND every mobile card.
 *
 * Props:
 *   onEdit    — fn() — opens edit modal (omit to hide)
 *   onDelete  — fn() — triggers delete (omit to hide)
 *   deleting  — bool — shows spinner on delete button
 *   editLabel — string — override "Edit" text
 *   size      — 'sm' | 'xs' — default 'sm'
 *   stacked   — bool — stack vertically (for mobile cards)
 */
export default function AdminActions({
  onEdit,
  onDelete,
  deleting = false,
  editLabel = 'Edit',
  deleteLabel = 'Delete',
  size = 'sm',
  stacked = false,
}) {
  const pad   = size === 'xs' ? '3px 8px'  : '4px 10px'
  const fsize = size === 'xs' ? 10          : 11
  const isize = size === 'xs' ? 10          : 11

  return (
    <div style={{
      display: 'flex',
      flexDirection: stacked ? 'column' : 'row',
      gap: stacked ? 6 : 4,
      alignItems: stacked ? 'stretch' : 'center',
    }}>
      {onEdit && (
        <button
          className="btn-row-edit"
          onClick={onEdit}
          style={{ padding: pad, fontSize: fsize, display: 'flex', alignItems: 'center', gap: 4, justifyContent: stacked ? 'center' : undefined }}
        >
          <Edit2 size={isize} /> {editLabel}
        </button>
      )}
      {onDelete && (
        <button
          className="btn-row-delete"
          onClick={onDelete}
          disabled={deleting}
          style={{ padding: pad, fontSize: fsize, display: 'flex', alignItems: 'center', gap: 4, justifyContent: stacked ? 'center' : undefined, opacity: deleting ? 0.6 : 1 }}
        >
          {deleting
            ? <div className="spinner" style={{ width: isize, height: isize }} />
            : <Trash2 size={isize} />
          }
          {deleteLabel}
        </button>
      )}
    </div>
  )
}
