// Usage (from the project root): node tests/errors/errorCapture.test.mjs
import assert from 'node:assert/strict'
import { classifyResponse, capturingFetch, createReporter, installErrorCapture } from '../../src/lib/errorCapture.js'

let n = 0
const test = async (name, fn) => { await fn(); console.log('PASS', ++n, name) }
const BASE = 'https://abc.supabase.co'
const tick = () => new Promise((r) => setTimeout(r, 0))

// a reporter with a fake clock and manual flushing
function rig({ online = true } = {}) {
  let t = 1_000_000
  const sent = []
  const state = { online }
  const rep = createReporter({ send: async (r) => { sent.push(r) }, now: () => t, schedule: () => 1, isOnline: () => state.online })
  return { rep, sent, state, advance: (ms) => { t += ms } }
}

// ── classifyResponse ─────────────────────────────────────────
await test('database read failure -> error row with table, page, code; NO query string kept', () => {
  const r = classifyResponse({ url: `${BASE}/rest/v1/transactions?select=*&user_id=eq.secret-id&email=eq.jane@x.co`, method: 'GET', status: 400,
    body: { code: '42703', message: 'column transactions.foo does not exist', hint: 'Perhaps you meant bar' }, page: '/transactions' })
  assert.equal(r.context, '/transactions › read transactions'); assert.equal(r.severity, 'error'); assert.equal(r.error_code, '42703')
  assert.equal(r.details.endpoint, '/rest/v1/transactions'); assert.ok(!JSON.stringify(r).includes('jane@x.co')); assert.ok(!JSON.stringify(r).includes('secret-id')) })
await test('permission denied on update -> error; rpc failure -> source rpc', () => {
  assert.equal(classifyResponse({ url: `${BASE}/rest/v1/profiles?id=eq.1`, method: 'PATCH', status: 403, body: { code: '42501', message: 'Roles are changed from Admin Panel' } }).context, 'update profiles')
  const r = classifyResponse({ url: `${BASE}/rest/v1/rpc/verify_deposit`, method: 'POST', status: 400, body: { code: 'P0001', message: 'Bank code already used' }, page: '/transactions' })
  assert.equal(r.source, 'rpc'); assert.equal(r.context, '/transactions › rpc verify_deposit') })
await test('duplicates / constraint violations are warnings, server errors are errors', () => {
  assert.equal(classifyResponse({ url: `${BASE}/rest/v1/transactions`, method: 'POST', status: 409, body: { code: '23505', message: 'duplicate key' } }).severity, 'warning')
  assert.equal(classifyResponse({ url: `${BASE}/rest/v1/transactions`, method: 'POST', status: 500, body: {} }).severity, 'error') })
await test('NOT logged: the logger itself, "no rows" from .single(), expired tokens, 406', () => {
  assert.equal(classifyResponse({ url: `${BASE}/rest/v1/rpc/log_error`, method: 'POST', status: 500, body: {} }), null)
  assert.equal(classifyResponse({ url: `${BASE}/rest/v1/x`, status: 406, body: { code: 'PGRST116' } }), null)
  assert.equal(classifyResponse({ url: `${BASE}/rest/v1/x`, status: 401, body: { code: 'PGRST303', message: 'JWT expired' } }), null) })
await test('functions and auth: only server failures (4xx are wrong passwords / business rules shown to the user)', () => {
  assert.equal(classifyResponse({ url: `${BASE}/functions/v1/admin-manage-member`, method: 'POST', status: 401, body: { error: 'Your password is not correct' } }), null)
  assert.equal(classifyResponse({ url: `${BASE}/auth/v1/token?grant_type=password`, method: 'POST', status: 400, body: { error: 'invalid_grant' } }), null)
  const f = classifyResponse({ url: `${BASE}/functions/v1/admin-manage-member`, method: 'POST', status: 500, body: { error: 'Something went wrong' } })
  assert.equal(f.source, 'edge_function'); assert.equal(f.context, 'function admin-manage-member')
  assert.equal(classifyResponse({ url: `${BASE}/auth/v1/user`, method: 'GET', status: 503, body: { msg: 'down' } }).context, 'auth user') })
await test('storage failures are logged; other hosts and bad URLs are ignored', () => {
  assert.equal(classifyResponse({ url: `${BASE}/storage/v1/object/avatars/a.png`, method: 'POST', status: 413, body: { message: 'Payload too large' } }).context, 'storage insert')
  assert.equal(classifyResponse({ url: 'https://example.com/other', status: 500 }), null)
  assert.equal(classifyResponse({ url: 'not a url', status: 500 }), null) })

// ── capturingFetch ───────────────────────────────────────────
await test('capturingFetch returns the SAME response untouched and reports failures in the background', async () => {
  const got = []
  const body = JSON.stringify({ code: '42501', message: 'permission denied for table x' })
  const f = capturingFetch(async () => new Response(body, { status: 403 }), (r) => got.push(r), { getPage: () => '/members' })
  const res = await f(`${BASE}/rest/v1/x?id=eq.1`, { method: 'DELETE', body: '{"password":"hunter2"}' })
  assert.equal(res.status, 403); assert.equal((await res.json()).code, '42501', 'caller can still read the body')
  await tick(); await tick()
  assert.equal(got.length, 1); assert.equal(got[0].context, '/members › delete x'); assert.ok(!JSON.stringify(got).includes('hunter2'), 'request body never recorded') })
await test('capturingFetch: successes report nothing; a network failure is re-thrown and reported only when online', async () => {
  const got = []
  await capturingFetch(async () => new Response('[]', { status: 200 }), (r) => got.push(r))(`${BASE}/rest/v1/x`)
  const boom = capturingFetch(async () => { throw new TypeError('Failed to fetch') }, (r) => got.push(r), { isOnline: () => true, getPage: () => '/' })
  await assert.rejects(boom(`${BASE}/rest/v1/x?a=1`), /Failed to fetch/)
  const offline = capturingFetch(async () => { throw new TypeError('Failed to fetch') }, (r) => got.push(r), { isOnline: () => false })
  await assert.rejects(offline(`${BASE}/rest/v1/x`))
  await tick()
  assert.equal(got.length, 1); assert.equal(got[0].error_code, 'network'); assert.equal(got[0].details.endpoint, '/rest/v1/x') })

// ── reporter ─────────────────────────────────────────────────
const req = (over = {}) => ({ kind: 'request', severity: 'error', source: 'frontend', context: '/t › read transactions', message: 'column does not exist', details: {}, ...over })
const toastRow = (message) => ({ kind: 'toast', severity: 'warning', source: 'frontend', context: '/t › message shown', message, details: {} })

await test('the message shown to the user is merged into the failed request (either order), one row only', async () => {
  for (const order of ['request-first', 'toast-first']) {
    const { rep, sent } = rig()
    if (order === 'request-first') { rep.report(req()); rep.report(toastRow('Failed to load transactions')) }
    else { rep.report(toastRow('Failed to load transactions')); rep.report(req()) }
    await rep.flush()
    assert.equal(sent.length, 1, order); assert.equal(sent[0].details.shown_to_user, 'Failed to load transactions')
    assert.equal(sent[0].kind, undefined); assert.equal(sent[0].at, undefined)
  } })
await test('a toast that follows a request sent in the PREVIOUS batch is not logged twice', async () => {
  const { rep, sent, advance } = rig()
  rep.report(req()); await rep.flush(); advance(1000); rep.report(toastRow('Failed to save')); await rep.flush()
  assert.equal(sent.length, 1) })
await test('a toast on its own: logged if it reads like a failure, ignored if it is just input validation', async () => {
  const { rep, sent } = rig()
  rep.report(toastRow('Passwords do not match')); rep.report(toastRow('Name cannot be empty'))
  rep.report(toastRow('Could not process the withdrawal')); await rep.flush()
  assert.deepEqual(sent.map((r) => r.message), ['Could not process the withdrawal']) })
await test('identical errors within a minute are sent once; again after a minute', async () => {
  const { rep, sent, advance } = rig()
  for (let i = 0; i < 5; i++) rep.report(req()); await rep.flush()
  advance(30_000); rep.report(req()); await rep.flush()
  assert.equal(sent.length, 1)
  advance(61_000); rep.report(req()); await rep.flush(); assert.equal(sent.length, 2) })
await test('rate limit: at most 30 rows per 10 minutes, so a broken loop cannot flood the log', async () => {
  const { rep, sent, advance } = rig()
  for (let i = 0; i < 100; i++) { rep.report(req({ message: `err ${i}` })); advance(5000) }
  await rep.flush(); assert.equal(sent.length, 30) })
await test('offline: nothing is sent and nothing is lost; sent when back online', async () => {
  const { rep, sent, state } = rig({ online: false })
  rep.report(req()); await rep.flush(); assert.equal(sent.length, 0); assert.equal(rep.pending(), 1)
  state.online = true; await rep.flush(); assert.equal(sent.length, 1) })
await test('a failing logger never throws into the app', async () => {
  const rep = createReporter({ send: async () => { throw new Error('db down') }, schedule: () => 1 })
  rep.report(req()); await rep.flush() })

// ── installErrorCapture ─────────────────────────────────────
function fakeWin() { const l = {}; return { addEventListener: (t, f) => { (l[t] ||= []).push(f) }, removeEventListener: (t, f) => { l[t] = (l[t] || []).filter((x) => x !== f) }, fire: (t, e) => (l[t] || []).forEach((f) => f(e)), count: (t) => (l[t] || []).length } }
await test('toast.error is still shown AND reported; installing twice does not double-wrap; uninstall restores', async () => {
  const shown = []; const got = []
  const toast = { error: (m) => { shown.push(m); return 'id1' } }
  const un = installErrorCapture({ toast, win: null, report: (r) => got.push(r), getPage: () => '/members' })
  installErrorCapture({ toast, win: null, report: (r) => got.push(r), getPage: () => '/members' })
  assert.equal(toast.error('Update failed: x'), 'id1'); assert.deepEqual(shown, ['Update failed: x'])
  assert.equal(got.length, 1); assert.equal(got[0].context, '/members › message shown')
  un(); toast.error('again'); assert.equal(got.length, 1) })
await test('uncaught errors and rejections are reported; extension noise, ResizeObserver and cross-origin "Script error." are not', () => {
  const got = []; const win = fakeWin()
  installErrorCapture({ toast: null, win, report: (r) => got.push(r), getPage: () => '/' })
  win.fire('error', { message: 'x is not a function', filename: 'https://app/assets/index.js', lineno: 3, colno: 9, error: { stack: 'at foo' } })
  win.fire('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })
  win.fire('error', { message: 'Script error.' })
  win.fire('error', { message: 'boom', filename: 'chrome-extension://abc/content.js' })
  win.fire('unhandledrejection', { reason: new Error('async fail') })
  win.fire('error', { message: 'Failed to fetch dynamically imported module: /assets/Page.js' })
  assert.deepEqual(got.map((r) => [r.context, r.severity]), [['/ › uncaught error', 'error'], ['/ › unhandled promise', 'error'], ['/ › uncaught error', 'warning']])
  assert.match(got[2].details.hint, /update/) })

console.log(`\nAll ${n} error-capture tests passed`)
