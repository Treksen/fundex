import { useState, useEffect } from 'react'

// Apply theme immediately (outside React) to prevent flash
const STORED = typeof localStorage !== 'undefined' ? localStorage.getItem('fundex-theme') : null
const INITIAL = STORED || 'light'
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', INITIAL)
}

export function useTheme() {
  const [theme, setTheme] = useState(INITIAL)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('fundex-theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light')

  return { theme, toggle, isDark: theme === 'dark' }
}
