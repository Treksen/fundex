// Framework-free update logic (no React, no libraries) so it can be unit-tested.
// Rule: the page is NEVER reloaded unless the member tapped "Update now".

const EVENTS_KEY = 'nitalink-update-events'
const CHECK_EVERY_MS = 30 * 60 * 1000

export function createUpdateController(env) {
  const { serviceWorker, location, documentRef, storage, caches } = env
  const now = env.now || (() => new Date())
  const timeout = env.setTimeout || setTimeout
  const interval = env.setInterval || setInterval
  const clearTimer = env.clearInterval || clearInterval

  const listeners = new Set()
  let registration = null
  let applying = false
  let hadController = false // was this page already controlled by a service worker?

  const loadEvents = () => {
    try { return JSON.parse(storage?.getItem(EVENTS_KEY) || '[]') } catch { return [] }
  }
  let state = {
    needRefresh: false,
    reason: null,          // 'waiting' = new version downloaded, 'activated' = a new version took over elsewhere
    dismissed: false,
    checking: false,
    applying: false,
    lastChecked: null,
    sw: { controlled: false, waiting: false },
    events: loadEvents(),  // last few update events, kept across reloads for troubleshooting
  }

  const emit = () => listeners.forEach((l) => l())
  const set = (patch) => { state = { ...state, ...patch }; emit() }
  const swInfo = () => ({ controlled: !!serviceWorker?.controller, waiting: !!registration?.waiting })

  const log = (msg) => {
    const time = now().toLocaleTimeString([], { hour12: false })
    const events = [...state.events, `${time} ${msg}`].slice(-10)
    try { storage?.setItem(EVENTS_KEY, JSON.stringify(events)) } catch { /* storage unavailable */ }
    set({ events })
  }
  const markReady = (reason) => {
    set({ needRefresh: true, reason, dismissed: false, sw: swInfo() })
  }

  const onUpdateFound = () => {
    const worker = registration?.installing
    if (!worker) return
    log('new version found, downloading')
    worker.addEventListener('statechange', () => {
      log(`new version ${worker.state}`)
      if (worker.state === 'installed' && serviceWorker.controller) markReady('waiting')
      else set({ sw: swInfo() })
    })
  }

  const onControllerChange = () => {
    const firstClaim = !hadController
    hadController = true
    if (applying) {
      log('switching to the new version (you tapped Update)')
      location.reload()
    } else if (firstClaim) {
      // Brand-new install: the worker simply took control of this page. Nothing to update.
      log('offline support switched on for this page')
      set({ sw: swInfo() })
    } else {
      // Another tab/window or a redeploy activated a new version. Do NOT reload on our own.
      log('a new version took over without being asked; reload held back')
      markReady('activated')
    }
  }

  const tick = () => { registration?.update().then(() => set({ lastChecked: now() })).catch(() => {}) }
  const onVisible = () => { if (documentRef?.visibilityState === 'visible') tick() }

  const waitForInstall = (worker) => new Promise((resolve) => {
    if (!worker) return resolve()
    const timer = timeout(resolve, 10000)
    worker.addEventListener('statechange', () => {
      if (['installed', 'activated', 'redundant'].includes(worker.state)) { clearTimer(timer); resolve() }
    })
  })

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    getSnapshot: () => state,

    start() {
      if (!serviceWorker) return () => {}
      hadController = !!serviceWorker.controller
      serviceWorker.addEventListener('controllerchange', onControllerChange)
      documentRef?.addEventListener('visibilitychange', onVisible)
      const timer = interval(tick, CHECK_EVERY_MS)
      serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
        registration = reg
        set({ lastChecked: now(), sw: swInfo() })
        log('app registered')
        reg.addEventListener('updatefound', onUpdateFound)
        if (reg.waiting && serviceWorker.controller) { log('an update is already waiting'); markReady('waiting') }
      }).catch((err) => log(`registration failed: ${err?.message || err}`))
      return () => {
        clearTimer(timer)
        serviceWorker.removeEventListener('controllerchange', onControllerChange)
        documentRef?.removeEventListener('visibilitychange', onVisible)
      }
    },

    async checkForUpdate() {
      if (!registration) return { ok: false, reason: 'unsupported' }
      set({ checking: true })
      try {
        await registration.update()
        set({ lastChecked: now() })
        await waitForInstall(registration.installing)
        await new Promise((r) => timeout(r, 300))
        const found = !!registration.waiting && !!serviceWorker.controller
        if (found && !state.needRefresh) markReady('waiting')
        return { ok: true, found: found || state.needRefresh }
      } catch {
        return { ok: false, reason: 'network' }
      } finally {
        set({ checking: false })
      }
    },

    applyUpdate() {
      applying = true
      set({ applying: true })
      log('update requested')
      const waiting = registration?.waiting
      if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' })
      else location.reload() // already active (updated elsewhere): a reload is all that is needed
      timeout(() => location.reload(), 4000) // safety net if the switch event never arrives
    },

    dismiss() { set({ dismissed: true }) },

    async resetAppCache() {
      try {
        const regs = (await serviceWorker?.getRegistrations?.()) ?? []
        await Promise.all(regs.map((r) => r.unregister()))
        if (caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)))
      } finally {
        location.reload()
      }
    },
  }
}
