/* global __APP_VERSION__, __APP_BUILD_TIME__ */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

// Injected at build time by vite.config.js (package.json version + build timestamp)
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const APP_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : null

const CHECK_EVERY_MS = 30 * 60 * 1000 // look for a new version every 30 minutes

const UpdateContext = createContext(null)

export const isStandaloneApp = () =>
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true)

// Resolves when a newly found service worker has finished installing (or after a timeout)
const waitForInstall = (worker) =>
  new Promise((resolve) => {
    if (!worker) return resolve()
    const timer = setTimeout(resolve, 10000)
    worker.addEventListener('statechange', () => {
      if (['installed', 'activated', 'redundant'].includes(worker.state)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })

export function UpdateProvider({ children }) {
  // Service workers only run in the production build
  const supported =
    import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator

  const [needRefresh, setNeedRefresh] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [lastChecked, setLastChecked] = useState(null)

  const registrationRef = useRef(null)
  const updateSWRef = useRef(null)
  const needRefreshRef = useRef(false)

  useEffect(() => {
    if (!supported) return undefined

    updateSWRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        needRefreshRef.current = true
        setNeedRefresh(true)
        setDismissed(false)
      },
      onRegisteredSW(_url, registration) {
        registrationRef.current = registration || null
        setLastChecked(new Date())
      },
      onRegisterError(err) {
        console.error('Service worker registration failed:', err)
      },
    })

    const tick = () => {
      registrationRef.current
        ?.update()
        .then(() => setLastChecked(new Date()))
        .catch(() => {})
    }
    const timer = setInterval(tick, CHECK_EVERY_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [supported])

  // Manual check (Settings → App & Updates). Returns { ok, found, reason }
  const checkForUpdate = useCallback(async () => {
    const registration = registrationRef.current
    if (!supported || !registration) return { ok: false, reason: 'unsupported' }
    setChecking(true)
    try {
      await registration.update()
      setLastChecked(new Date())
      await waitForInstall(registration.installing)
      await new Promise((r) => setTimeout(r, 300)) // let onNeedRefresh fire first
      const found = needRefreshRef.current || !!registration.waiting
      if (found && !needRefreshRef.current) {
        needRefreshRef.current = true
        setNeedRefresh(true)
        setDismissed(false)
      }
      return { ok: true, found }
    } catch {
      return { ok: false, reason: 'network' }
    } finally {
      setChecking(false)
    }
  }, [supported])

  // Activates the waiting version and reloads the app
  const applyUpdate = useCallback(async () => {
    setApplying(true)
    try {
      await updateSWRef.current?.(true)
    } catch {
      /* fall through to the reload below */
    }
    setTimeout(() => window.location.reload(), 4000) // safety net if the reload event never fires
  }, [])

  // Last-resort fix for a stuck install: drop the service worker + cached files, keep the login
  const resetAppCache = useCallback(async () => {
    try {
      const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
      await Promise.all(registrations.map((r) => r.unregister()))
      if (window.caches) {
        const keys = await window.caches.keys()
        await Promise.all(keys.map((k) => window.caches.delete(k)))
      }
    } finally {
      window.location.reload()
    }
  }, [])

  const value = useMemo(
    () => ({
      version: APP_VERSION,
      buildTime: APP_BUILD_TIME,
      supported,
      needRefresh,
      dismissed,
      dismiss: () => setDismissed(true),
      checking,
      applying,
      lastChecked,
      checkForUpdate,
      applyUpdate,
      resetAppCache,
    }),
    [supported, needRefresh, dismissed, checking, applying, lastChecked, checkForUpdate, applyUpdate, resetAppCache]
  )

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export const useAppUpdate = () => {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error('useAppUpdate must be used within UpdateProvider')
  return ctx
}
