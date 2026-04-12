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
    // Check for explicit timezone info: Z, +HH:MM, or +HH
    const hasTZ = str.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(str) || /[+-]\d{2}$/.test(str)
    if (hasTZ) {
      // Has TZ info — browser converts UTC → local automatically
      d = new Date(str)
    } else if (str.includes('T')) {
      // Supabase timestamptz without TZ suffix — always UTC, append Z
      d = new Date(str + 'Z')
    } else {
      // Plain date or datetime-local "2026-04-12 09:20" — treat as local
      const normalised = str.replace(' ', 'T')
      const [datePart, timePart = '00:00'] = normalised.split('T')
      const [year, month, day] = datePart.split('-')
      const [hour, minute] = timePart.split(':')
      d = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
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
