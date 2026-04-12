import { getMemberColor, getMemberInitials } from '../lib/utils'

/**
 * Renders a circular member avatar.
 * Shows the member's photo if avatarUrl is provided; falls back to coloured initials.
 */
export default function MemberAvatar({ name, avatarUrl, size = 36, fontSize, style = {} }) {
  const fs = fontSize || Math.round(size * 0.36)

  const baseStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...style,
  }

  if (avatarUrl) {
    return (
      <div style={{ ...baseStyle, position: 'relative', background: getMemberColor(name) }}>
        <img
          src={avatarUrl}
          alt={name || 'member'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={e => {
            // Hide broken image, show initials fallback
            e.currentTarget.style.display = 'none'
            e.currentTarget.nextElementSibling.style.display = 'flex'
          }}
        />
        {/* Initials fallback — hidden unless image errors */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          background: getMemberColor(name),
          fontSize: fs,
          fontWeight: 700,
          color: '#fff',
          borderRadius: '50%',
        }}>
          {getMemberInitials(name)}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      ...baseStyle,
      background: getMemberColor(name),
      fontSize: fs,
      fontWeight: 700,
      color: '#fff',
    }}>
      {getMemberInitials(name)}
    </div>
  )
}
