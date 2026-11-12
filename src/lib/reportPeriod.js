// Month helpers for monthly reports. All boundaries are LOCAL time (the same clock the app displays),
// and `end` is exclusive: a period is [start, end).

export const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function monthPeriod(key) {
  const [y, m] = key.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 1)
  return {
    kind: 'month',
    key,
    start,
    end,
    label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  }
}

export function allTimePeriod(firstDate, now = new Date()) {
  const first = firstDate || now
  return {
    kind: 'all',
    key: 'all',
    label: 'All time',
    start: new Date(first.getFullYear(), first.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
  }
}

// Newest first, from the current month back to the month of the first transaction
export function listMonthKeys(firstDate, now = new Date()) {
  const keys = []
  const first = firstDate || now
  let y = now.getFullYear()
  let m = now.getMonth()
  while (y > first.getFullYear() || (y === first.getFullYear() && m >= first.getMonth())) {
    keys.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    m -= 1
    if (m < 0) { m = 11; y -= 1 }
  }
  return keys
}

// Monthly reports default to the last completed month
export function lastCompletedMonthKey(now = new Date()) {
  return monthKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1))
}
