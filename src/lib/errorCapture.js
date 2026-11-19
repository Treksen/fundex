// Automatic Error Log capture. Three sources feed one reporter:
//   1. failed requests to Supabase (database, RPCs, edge functions, storage), via a wrapped fetch
//   2. every error message shown to a user (toast.error)
//   3. uncaught JavaScript errors and unhandled promise rejections
// The reporter merges a shown message into the failed request that caused it, drops duplicates, rate-limits,
// waits while offline, and never records request bodies (they can hold passwords) or query strings (filters can
// hold personal data). No React and no Supabase import, so it can be unit-tested.

const MERGE_WINDOW_MS = 3000      // a toast this soon after a failed request is the same problem
const FLUSH_DELAY_MS = 1500
const DEDUPE_MS = 60_000
const MAX_PER_WINDOW = 30
const RATE_WINDOW_MS = 10 * 60_000

const ACTION = { GET: 'read', HEAD: 'read', POST: 'insert', PATCH: 'update', PUT: 'upsert', DELETE: 'delete' }
const TOAST_WORTH_LOGGING = /fail|error|could not|couldn't|unable|went wrong|network|not load|problem/i
// Expected, not bugs: "no rows" from .single(), and an expired token that supabase-js refreshes by itself.
const BENIGN_CODES = new Set(['PGRST116', 'PGRST301', 'PGRST303'])

const clip = (v, n = 500) => (v == null ? v : String(v).slice(0, n))

// Turns a failed Supabase response into a log row, or null when it is not worth logging.
export function classifyResponse({ url, method = 'GET', status, body, page }) {
  let u
  try { u = new URL(url) } catch { return null }
  const path = u.pathname
  const m = String(method).toUpperCase()
  const b = body && typeof body === 'object' ? body : {}
  const code = b.code != null ? String(b.code) : null
  const message = b.message || b.error_description || b.msg || b.error || `HTTP ${status}`

  if (path.includes('/rest/v1/rpc/log_error')) return null                 // never log the logger
  if (code && BENIGN_CODES.has(code)) return null
  if (status === 406) return null

  let context, source = 'frontend'
  if (path.startsWith('/rest/v1/rpc/')) { context = `rpc ${path.slice('/rest/v1/rpc/'.length)}`; source = 'rpc' }
  else if (path.startsWith('/rest/v1/')) context = `${ACTION[m] || m.toLowerCase()} ${path.slice('/rest/v1/'.length).split('/')[0]}`
  else if (path.startsWith('/functions/v1/')) {
    if (status < 500) return null    // our functions answer 4xx for wrong passwords / business rules; the user sees why
    context = `function ${path.slice('/functions/v1/'.length).split('/')[0]}`; source = 'edge_function'
  } else if (path.startsWith('/auth/v1/')) {
    if (status < 500) return null    // wrong password, expired link, rate limit: shown to the user, not a bug
    context = `auth ${path.slice('/auth/v1/'.length).split('/')[0]}`; source = 'other'
  } else if (path.startsWith('/storage/v1/')) context = `storage ${ACTION[m] || m.toLowerCase()}`
  else return null

  const severity = status >= 500 ? 'error'
    : (status === 409 || (code && code.startsWith('23'))) ? 'warning'   // duplicates / constraint checks
    : 'error'
  return {
    kind: 'request', severity, source,
    context: page ? `${page} › ${context}` : context,
    message: clip(message),
    error_code: code || String(status),
    details: { status, method: m, endpoint: path, page: page || null, hint: clip(b.hint), db_details: clip(b.details) },
  }
}

// fetch wrapper for the Supabase client. Reports failures without slowing or changing the response.
export function capturingFetch(baseFetch, report, { getPage = () => null, isOnline = () => true } = {}) {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url
    const method = init?.method || (typeof input === 'object' && input?.method) || 'GET'
    let res
    try {
      res = await baseFetch(input, init)
    } catch (err) {
      if (isOnline() && !String(url || '').includes('/rpc/log_error')) {
        let path = ''
        try { path = new URL(url).pathname } catch { /* ignore */ }
        report({ kind: 'request', severity: 'warning', source: 'frontend', context: `${getPage() || ''} › network`.replace(/^ › /, ''),
          message: clip(`Request failed: ${err?.message || err}`), error_code: 'network', details: { endpoint: path, method: String(method).toUpperCase(), page: getPage() } })
      }
      throw err
    }
    if (res && res.status >= 400) {
      const page = getPage()
      res.clone().json().catch(() => null).then((body) => {
        const row = classifyResponse({ url, method, status: res.status, body, page })
        if (row) report(row)
      }).catch(() => {})
    }
    return res
  }
}

// Collects events and sends them as Error Log rows. Sending waits a moment so a shown message can be merged
// into the failed request that caused it, whichever of the two arrives first.
export function createReporter({ send, now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), isOnline = () => true }) {
  let queue = []
  const recent = new Map()          // dedupe key -> time sent
  let sentTimes = []
  let lastSentRequestAt = -Infinity
  let timer = null

  const flush = async () => {
    timer = null
    if (!isOnline()) return          // kept; sent when the 'online' event calls flush again
    const batch = queue; queue = []
    const requests = batch.filter((r) => r.kind === 'request')
    const rows = []
    for (const row of batch) {
      if (row.kind === 'toast') {
        const cause = requests.find((r) => Math.abs(r.at - row.at) < MERGE_WINDOW_MS)
        if (cause) { cause.details.shown_to_user = cause.details.shown_to_user || row.message; continue }
        if (row.at - lastSentRequestAt < MERGE_WINDOW_MS) continue        // its request was sent in the previous batch
        if (!TOAST_WORTH_LOGGING.test(row.message)) continue               // e.g. "Passwords do not match": not a bug
      }
      rows.push(row)
    }
    for (const row of rows) {
      const t = now()
      sentTimes = sentTimes.filter((x) => t - x < RATE_WINDOW_MS)
      if (sentTimes.length >= MAX_PER_WINDOW) break
      const key = `${row.context}|${row.message}`
      if (recent.has(key) && t - recent.get(key) < DEDUPE_MS) continue
      recent.set(key, t); sentTimes.push(t)
      if (row.kind === 'request') lastSentRequestAt = Math.max(lastSentRequestAt, row.at)
      const { kind: _kind, at: _at, ...rest } = row
      try { await send(rest) } catch { /* never let logging break the app */ }
    }
  }

  return {
    report(row) {
      if (!row || !row.message) return
      queue.push({ ...row, at: now(), details: { ...(row.details || {}) } })
      if (!timer) timer = schedule(flush, FLUSH_DELAY_MS)
    },
    flush,
    pending: () => queue.length,
  }
}

// Wires the toast and window listeners. Returns an uninstall function.
export function installErrorCapture({ toast, win, report, getPage }) {
  const uninstall = []
  if (toast && typeof toast.error === 'function' && !toast.error.__nitalinkCaptured) {
    const original = toast.error
    const wrapped = (message, opts) => {
      try {
        const text = typeof message === 'string' ? message : (message?.message || null)
        if (text) report({ kind: 'toast', severity: 'warning', source: 'frontend', context: `${getPage() || 'app'} › message shown`, message: clip(text), details: { page: getPage() } })
      } catch { /* ignore */ }
      return original(message, opts)
    }
    wrapped.__nitalinkCaptured = true
    toast.error = wrapped
    uninstall.push(() => { toast.error = original })
  }
  if (win?.addEventListener) {
    const onError = (e) => {
      const msg = e?.message || e?.error?.message || ''
      const where = `${e?.filename || ''} ${e?.error?.stack || ''}`
      if (!msg || msg === 'Script error.' || /ResizeObserver loop/i.test(msg) || /(chrome|moz|safari)-extension:/.test(where)) return
      const chunk = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(msg)
      report({ kind: 'crash', severity: chunk ? 'warning' : 'error', source: 'frontend', context: `${getPage() || 'app'} › uncaught error`,
        message: clip(msg), details: { page: getPage(), file: clip(e?.filename, 200), line: e?.lineno, column: e?.colno, stack: clip(e?.error?.stack, 2000),
          ...(chunk ? { hint: 'Usually right after an update: reloading fixes it.' } : {}) } })
    }
    const onRejection = (e) => {
      const r = e?.reason
      const msg = typeof r === 'string' ? r : (r?.message || '')
      if (!msg || /(chrome|moz|safari)-extension:/.test(String(r?.stack || ''))) return
      report({ kind: 'crash', severity: 'error', source: 'frontend', context: `${getPage() || 'app'} › unhandled promise`, message: clip(msg), details: { page: getPage(), stack: clip(r?.stack, 2000) } })
    }
    win.addEventListener('error', onError)
    win.addEventListener('unhandledrejection', onRejection)
    uninstall.push(() => { win.removeEventListener('error', onError); win.removeEventListener('unhandledrejection', onRejection) })
  }
  return () => uninstall.forEach((f) => f())
}
