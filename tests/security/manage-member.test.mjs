import assert from 'node:assert/strict'
import { handle, makeTemporaryPassword, safeRedirect, ACTIONS } from './manage-logic.mjs'

let n = 0
const test = async (name, fn) => { await fn(); console.log('PASS', ++n, name) }

const ADMIN = '00000000-0000-0000-0000-00000000000a'
const ADMIN2 = '00000000-0000-0000-0000-0000000000a2'
const BOB = '00000000-0000-0000-0000-00000000000b'
const GONE = '00000000-0000-0000-0000-00000000000d'
const SUSP = '00000000-0000-0000-0000-00000000000e'

function world(over = {}) {
  const members = {
    [ADMIN]:  { id: ADMIN,  name: 'Ann Admin', email: 'ann@x.co', phone: null, role: 'admin', is_active: true, login_disabled: false },
    [ADMIN2]: { id: ADMIN2, name: 'Al Admin',  email: 'al@x.co',  phone: null, role: 'admin', is_active: true, login_disabled: false },
    [BOB]:    { id: BOB,    name: 'Bob Member', email: 'bob@x.co', phone: '0700', role: 'member', is_active: true, login_disabled: false },
    [GONE]:   { id: GONE,   name: 'Dan Gone',  email: 'dan@x.co', phone: null, role: 'member', is_active: false, login_disabled: true },
    [SUSP]:   { id: SUSP,   name: 'Sue Susp',  email: 'sue@x.co', phone: null, role: 'member', is_active: true, login_disabled: true },
  }
  const c = { banned: [], unbanned: [], passwords: [], emails: [], profile: [], rpc: [], resets: [], notes: [], audits: [], logs: [], verified: [] }
  const deps = {
    getCaller: async (jwt) => ({ ADMIN_JWT: { id: ADMIN, email: 'ann@x.co' }, MEMBER_JWT: { id: BOB, email: 'bob@x.co' } }[jwt] ?? null),
    getMember: async (id) => (members[id] ? { ...members[id] } : null),
    verifyPassword: async (email, pw) => { c.verified.push(email); return pw === 'admin-pw' ? 'ok' : 'wrong' },
    setBanned: async (id, b) => { (b ? c.banned : c.unbanned).push(id); return null },
    setAuthPassword: async (id, pw) => { c.passwords.push([id, pw]); return null },
    setAuthEmail: async (id, e) => { c.emails.push([id, e]); return {} },
    updateProfile: async (id, p) => { c.profile.push([id, p]); return null },
    rpc: async (fn, a) => { c.rpc.push([fn, a]); return { data: { ok: true } } },
    sendResetEmail: async (e, r) => { c.resets.push([e, r]); return null },
    notify: async (id, x) => { c.notes.push([id, x]) },
    audit: async (a) => { c.audits.push(a) },
    randomBytes: (k) => { const b = new Uint8Array(k); for (let i = 0; i < k; i++) b[i] = (i * 37 + 11) % 256; return b },
    log: (m) => c.logs.push(m),
    ...over,
  }
  return { deps, c, members }
}
const req = (body, { jwt = 'ADMIN_JWT', method = 'POST' } = {}) =>
  new Request('http://x/fn', { method, headers: jwt ? { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined })
const call = async (body, opts, over) => { const w = world(over); const r = await handle(req(body, opts), w.deps); return { ...w, r, status: r.status, body: await r.json().catch(() => null) } }
const P = { admin_password: 'admin-pw' }

// ── who may call ─────────────────────────────────────────────
await test('no token -> 401', async () => { assert.equal((await call({ action: 'summary', member_id: BOB }, { jwt: null })).status, 401) })
await test('a MEMBER is refused (403), even claiming to be admin, and nothing changes', async () => {
  const x = await call({ action: 'deactivate', member_id: GONE, isAdmin: true, role: 'admin', ...P }, { jwt: 'MEMBER_JWT' })
  assert.equal(x.status, 403); assert.equal(x.c.banned.length + x.c.rpc.length, 0) })
await test('unknown action / bad member id -> 400', async () => {
  assert.equal((await call({ action: 'view_password', member_id: BOB, ...P })).status, 400)
  assert.equal((await call({ action: 'summary', member_id: "x' OR 1=1" })).status, 400) })
await test('there is NO action that reveals a password', async () => { assert.ok(!ACTIONS.some((a) => /view|get|show|read/.test(a))) })
await test('an admin cannot use the tools on their own account', async () => { assert.equal((await call({ action: 'set_role', member_id: ADMIN, role: 'member', ...P })).status, 400) })
await test('unknown member -> 404', async () => { assert.equal((await call({ action: 'summary', member_id: '00000000-0000-0000-0000-000000000999' })).status, 404) })

// ── password re-entry ───────────────────────────────────────
for (const action of ['set_role', 'suspend', 'deactivate', 'send_reset', 'temp_password']) {
  await test(`${action}: needs the admin's own password; wrong password changes nothing`, async () => {
    const missing = await call({ action, member_id: BOB, role: 'admin' })
    assert.equal(missing.status, 401); assert.equal(missing.body.needs_password, true)
    const wrong = await call({ action, member_id: BOB, role: 'admin', admin_password: 'nope' })
    assert.equal(wrong.status, 401)
    for (const k of ['banned', 'passwords', 'profile', 'rpc', 'resets', 'notes', 'audits']) assert.equal(wrong.c[k].length, 0, k)
    assert.deepEqual(wrong.c.verified, ['ann@x.co'], 'checked against the CALLER\'s email') })
}
await test('password check rate-limited -> 429', async () => { assert.equal((await call({ action: 'suspend', member_id: BOB, ...P }, {}, { verifyPassword: async () => 'rate_limited' })).status, 429) })
await test('editing name/phone does NOT need the password; changing the email DOES', async () => {
  assert.equal((await call({ action: 'edit_details', member_id: BOB, name: 'Bob M' })).status, 200)
  assert.equal((await call({ action: 'edit_details', member_id: BOB, email: 'new@x.co' })).status, 401)
  assert.equal((await call({ action: 'edit_details', member_id: BOB, email: 'BOB@x.co' })).status, 400, 'same email (case) is not a change') })

// ── protecting admins ───────────────────────────────────────
for (const action of ['suspend', 'deactivate', 'send_reset', 'temp_password']) {
  await test(`${action} on ANOTHER ADMIN is refused (demote first)`, async () => {
    const x = await call({ action, member_id: ADMIN2, ...P }); assert.equal(x.status, 403); assert.match(x.body.error, /member first/)
    assert.equal(x.c.verified.length, 0, 'refused before even checking the password') })
}
await test('changing another admin\'s EMAIL is refused; their name is fine', async () => {
  assert.equal((await call({ action: 'edit_details', member_id: ADMIN2, email: 'evil@x.co', ...P })).status, 403)
  assert.equal((await call({ action: 'edit_details', member_id: ADMIN2, name: 'Alan Admin' })).status, 200) })
await test('demoting another admin is allowed; the database\'s last-admin guard is reported clearly', async () => {
  assert.equal((await call({ action: 'set_role', member_id: ADMIN2, role: 'member', ...P })).status, 200)
  const x = await call({ action: 'set_role', member_id: ADMIN2, role: 'member', ...P }, {}, { updateProfile: async () => 'You cannot remove the last admin' })
  assert.equal(x.status, 409); assert.match(x.body.error, /last admin/) })

// ── deactivated / suspended members ─────────────────────────
await test('a deactivated member: only reactivate, summary and name/phone edits', async () => {
  for (const action of ['suspend', 'deactivate', 'send_reset', 'temp_password', 'set_role', 'restore_login']) {
    assert.equal((await call({ action, member_id: GONE, role: 'admin', ...P })).status, 409, action) }
  assert.equal((await call({ action: 'edit_details', member_id: GONE, email: 'x@y.co', ...P })).status, 409)
  assert.equal((await call({ action: 'reactivate', member_id: GONE, ...P })).status, 200) })
await test('a suspended member cannot get a reset email / temp password, or be made admin, until restored', async () => {
  for (const [action, extra] of [['send_reset', {}], ['temp_password', {}], ['set_role', { role: 'admin' }]]) {
    assert.equal((await call({ action, member_id: SUSP, ...extra, ...P })).status, 409, action) } })

// ── each action does the right thing, in the right order ────
await test('suspend: blocks sign-in FIRST, then records it in the database', async () => {
  const x = await call({ action: 'suspend', member_id: BOB, reason: ' lost phone ', ...P })
  assert.equal(x.status, 200); assert.deepEqual(x.c.banned, [BOB])
  assert.deepEqual(x.c.rpc, [['admin_set_login_disabled', { p_member: BOB, p_admin: ADMIN, p_disabled: true, p_reason: 'lost phone' }]]) })
await test('deactivate: database refusal (e.g. already inactive) UNDOES the sign-in block', async () => {
  const x = await call({ action: 'deactivate', member_id: BOB, ...P }, {}, { rpc: async () => ({ data: { error: 'This member is already deactivated' } }) })
  assert.equal(x.status, 409); assert.deepEqual(x.c.banned, [BOB]); assert.deepEqual(x.c.unbanned, [BOB]) })
await test('deactivate: database crash also undoes the block, generic message', async () => {
  const x = await call({ action: 'deactivate', member_id: BOB, ...P }, {}, { rpc: async () => ({ error: 'connection reset' }) })
  assert.equal(x.status, 500); assert.deepEqual(x.c.unbanned, [BOB]); assert.ok(!JSON.stringify(x.body).includes('connection')) })
await test('deactivate: if sign-in cannot be blocked, the database is not touched', async () => {
  const x = await call({ action: 'deactivate', member_id: BOB, ...P }, {}, { setBanned: async () => 'auth down' })
  assert.equal(x.status, 500); assert.equal(x.c.rpc.length, 0) })
await test('deactivate: success returns what happened to pending withdrawals', async () => {
  const result = { ok: true, removed_votes: 2, withdrawals_completed: 1, withdrawals_needing_decision: [] }
  const x = await call({ action: 'deactivate', member_id: BOB, ...P }, {}, { rpc: async () => ({ data: result }) })
  assert.equal(x.status, 200); assert.deepEqual(x.body.result, result) })
await test('reactivate / restore_login: unblock, then database; a database failure re-blocks', async () => {
  const ok = await call({ action: 'restore_login', member_id: SUSP, ...P }); assert.equal(ok.status, 200); assert.deepEqual(ok.c.unbanned, [SUSP])
  const bad = await call({ action: 'reactivate', member_id: GONE, ...P }, {}, { rpc: async () => ({ error: 'x' }) })
  assert.equal(bad.status, 500); assert.deepEqual(bad.c.unbanned, [GONE]); assert.deepEqual(bad.c.banned, [GONE])
  assert.equal((await call({ action: 'restore_login', member_id: BOB, ...P })).status, 409, 'not suspended') })
await test('temp password: returned ONCE, flagged for forced change, never logged or put in audit/notification', async () => {
  const x = await call({ action: 'temp_password', member_id: BOB, ...P })
  assert.equal(x.status, 200); const temp = x.body.temporary_password
  assert.match(temp, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/)
  assert.deepEqual(x.c.passwords, [[BOB, temp]]); assert.deepEqual(x.c.profile, [[BOB, { must_change_password: true }]])
  assert.equal(x.body.forced_change, true)
  const elsewhere = JSON.stringify([x.c.logs, x.c.audits, x.c.notes, x.c.profile]); assert.ok(!elsewhere.includes(temp))
  assert.ok(!JSON.stringify(x.c).includes('admin-pw'), 'admin password never stored') })
await test('temp password: auth failure -> nothing shown, password not logged', async () => {
  let seen; const x = await call({ action: 'temp_password', member_id: BOB, ...P }, {}, { setAuthPassword: async (id, pw) => { seen = pw; return `weak password ${pw}` } })
  assert.equal(x.status, 500); assert.equal(x.body.temporary_password, undefined); assert.ok(!JSON.stringify(x.c.logs).includes(seen)) })
await test('temp password: if the forced-change flag fails, the admin is warned (and still gets the password)', async () => {
  const x = await call({ action: 'temp_password', member_id: BOB, ...P }, {}, { updateProfile: async () => 'nope' })
  assert.equal(x.status, 200); assert.equal(x.body.forced_change, false); assert.match(x.body.message, /NOT be forced/) })
await test('send_reset: uses the MEMBER\'s email, only a safe redirect, audited and notified', async () => {
  const x = await call({ action: 'send_reset', member_id: BOB, redirect_to: 'https://evil.example/steal', ...P })
  assert.equal(x.status, 200); assert.deepEqual(x.c.resets, [['bob@x.co', undefined]]); assert.equal(x.c.audits.length, 1); assert.equal(x.c.notes.length, 1)
  const y = await call({ action: 'send_reset', member_id: BOB, redirect_to: 'https://nitalink.app/reset-password?x=1', ...P })
  assert.deepEqual(y.c.resets, [['bob@x.co', 'https://nitalink.app/reset-password']]) })
await test('send_reset: Supabase rate limit -> 429', async () => {
  assert.equal((await call({ action: 'send_reset', member_id: BOB, ...P }, {}, { sendResetEmail: async () => 'For security purposes, you can only request this after 60 seconds' })).status, 429) })
await test('set_role: validated, audited with old/new role, member notified', async () => {
  assert.equal((await call({ action: 'set_role', member_id: BOB, role: 'owner', ...P })).status, 400)
  assert.equal((await call({ action: 'set_role', member_id: BOB, role: 'member', ...P })).status, 400, 'no-op')
  const x = await call({ action: 'set_role', member_id: BOB, role: 'admin', ...P }); assert.equal(x.status, 200)
  assert.deepEqual(x.c.profile, [[BOB, { role: 'admin' }]]); assert.deepEqual(x.c.audits[0].oldValues, { role: 'member' }); assert.equal(x.c.notes[0][0], BOB) })
await test('edit_details: email changes the LOGIN first, then the profile; duplicate email -> 409', async () => {
  const x = await call({ action: 'edit_details', member_id: BOB, email: ' New@X.co ', name: 'Bob M', ...P })
  assert.equal(x.status, 200); assert.deepEqual(x.c.emails, [[BOB, 'new@x.co']]); assert.deepEqual(x.c.profile, [[BOB, { name: 'Bob M', email: 'new@x.co' }]])
  assert.deepEqual(x.c.audits[0].oldValues, { name: 'Bob Member', email: 'bob@x.co' })
  const d = await call({ action: 'edit_details', member_id: BOB, email: 'al@x.co', ...P }, {}, { setAuthEmail: async () => ({ error: 'already registered', duplicate: true }) })
  assert.equal(d.status, 409); assert.equal(d.c.profile.length, 0) })
await test('edit_details: profile failure restores the old sign-in email', async () => {
  const x = await call({ action: 'edit_details', member_id: BOB, email: 'new@x.co', ...P }, {}, { updateProfile: async () => 'boom' })
  assert.equal(x.status, 500); assert.deepEqual(x.c.emails, [[BOB, 'new@x.co'], [BOB, 'bob@x.co']]) })
await test('edit_details: validation (name, phone, email) and "nothing to change"', async () => {
  for (const b of [{ name: 'A' }, { phone: 'call me maybe' }, { email: 'nope', ...P }, {}]) {
    assert.equal((await call({ action: 'edit_details', member_id: BOB, ...b })).status, 400, JSON.stringify(b)) }
  const x = await call({ action: 'edit_details', member_id: BOB, phone: '' }); assert.deepEqual(x.c.profile, [[BOB, { phone: null }]]) })

await test('REGRESSION: reactivating an ACTIVE member / suspending a SUSPENDED one is refused before sign-in is touched', async () => {
  const a = await call({ action: 'reactivate', member_id: BOB, ...P }, {}, { rpc: async () => ({ data: { error: 'This member is already active' } }) })
  assert.equal(a.status, 409); assert.equal(a.c.banned.length + a.c.unbanned.length, 0, 'an active member must never end up banned')
  const s2 = await call({ action: 'suspend', member_id: SUSP, ...P }); assert.equal(s2.status, 409); assert.equal(s2.c.banned.length + s2.c.unbanned.length, 0)
  assert.equal((await call({ action: 'restore_login', member_id: GONE, ...P })).status, 409, 'deactivated: use reactivate') })
await test('REGRESSION: a failed deactivation of a SUSPENDED member leaves them blocked (undo restores the previous state)', async () => {
  const x = await call({ action: 'deactivate', member_id: SUSP, ...P }, {}, { rpc: async () => ({ error: 'db down' }) })
  assert.equal(x.status, 500); assert.deepEqual(x.c.unbanned, []); assert.deepEqual(x.c.banned, [SUSP, SUSP]) })

// ── plumbing ────────────────────────────────────────────────
await test('CORS preflight, wrong method, malformed JSON', async () => {
  const { deps } = world()
  assert.equal((await handle(new Request('http://x', { method: 'OPTIONS' }), deps)).status, 204)
  assert.equal((await handle(new Request('http://x', { method: 'GET' }), deps)).status, 405)
  assert.equal((await handle(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer ADMIN_JWT' }, body: '{nope' }), deps)).status, 400) })
await test('an unexpected crash returns a generic 500 and is logged', async () => {
  const x = await call({ action: 'set_role', member_id: BOB, role: 'admin', ...P }, {}, { updateProfile: async () => { throw new Error('kaboom') } })
  assert.equal(x.status, 500); assert.ok(x.c.logs.some((l) => l.includes('kaboom'))) })
await test('makeTemporaryPassword: format, no look-alike characters, unbiased rejection of high bytes', () => {
  const real = (k) => { const b = new Uint8Array(k); for (let i = 0; i < k; i++) b[i] = Math.floor(Math.random() * 256); return b }
  const seen = new Set()
  for (let i = 0; i < 300; i++) { const p = makeTemporaryPassword(real); assert.match(p, /^[^0O1lI]{4}-[^0O1lI]{4}-[^0O1lI]{4}$/); seen.add(p) }
  assert.equal(seen.size, 300)
  assert.match(makeTemporaryPassword((k) => new Uint8Array(k).fill(255).map((v, i) => (i % 2 ? 255 : 3))), /^DDDD-DDDD-DDDD$/) })
await test('safeRedirect: only https (or localhost) /reset-password, query/fragments dropped', () => {
  assert.equal(safeRedirect('http://localhost:5173/reset-password'), 'http://localhost:5173/reset-password')
  for (const bad of ['javascript:alert(1)', 'http://evil.com/reset-password', 'https://x.co/login', 'https://u:p@x.co/reset-password', null]) assert.equal(safeRedirect(bad), undefined, String(bad)) })

console.log(`\nAll ${n} member-management tests passed`)
