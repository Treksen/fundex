import { format, isValid } from 'date-fns'

export const formatCurrency = (amount, currency = 'KES') => {
  if (amount === null || amount === undefined) return `${currency} 0.00`
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currency === 'KES' ? 'KES' : 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}

export const formatDate = (date, fmt = 'dd MMM yyyy') => {
  if (!date) return '—'
  let d
  if (typeof date === 'string') {
    if (date.includes('T')) {
      const [datePart] = date.split('T')
      const [year, month, day] = datePart.split('-')
      d = new Date(year, month - 1, day)
    } else {
      const [year, month, day] = date.split('-')
      d = new Date(year, month - 1, day)
    }
  } else {
    d = date
  }
  if (!isValid(d)) return '—'
  return format(d, fmt)
}

export const formatDateTime = (date) => {
  if (!date) return ''
  let d
  if (typeof date === 'string') {
    const str = date.trim()
    if (str.length === 10) {
      // Plain date "2026-04-17" — no time, treat as local midnight
      const [year, month, day] = str.split('-')
      d = new Date(Number(year), Number(month) - 1, Number(day))
    } else {
      // All other formats — let the browser parse it
      // Supabase returns UTC with Z: "2026-04-17T16:45:00Z" → browser converts to local
      // datetime-local strings "2026-04-17T19:45" → treated as local (correct)
      d = new Date(str.includes('Z') || str.includes('+') || str.includes('-', 10)
        ? str              // has TZ info — parse as-is
        : str + 'Z')       // no TZ info from Supabase — it's UTC, append Z
    }
  } else {
    d = date
  }
  if (!isValid(d)) return '—'
  return format(d, 'dd MMM yyyy, HH:mm')
}

export const formatPercentage = (value, decimals = 2) => {
  if (value === null || value === undefined) return '0.00%'
  return `${Number(value).toFixed(decimals)}%`
}

export const getMemberInitials = (name) => {
  if (!name) return '??'
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export const getMemberColor = (name) => {
  if (!name) return '#6b7280'
  const firstName = name.split(' ')[0].trim()
  const colorMap = {
    Collins: '#0771f3',
    Amos: '#0d9c5e',
    Gilbert: '#f59e0b',
  }
  return colorMap[firstName] || '#6b7280'
}

export const getTransactionSign = (type) => {
  return type === 'withdrawal' ? -1 : 1
}

export const classNames = (...classes) => {
  return classes.filter(Boolean).join(' ')
}
