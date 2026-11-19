import assert from 'node:assert/strict'
import { accountGate, memberStatus, availableActions, friendlySignInError, callMemberAdmin } from './memberAdmin.mjs'
import { handle } from './manage-logic.mjs'

let n = 0
const test = async (name, fn) => { await fn(); console.log('PASS', ++n, name) }
const ME = { id: '00000000-0000-0000-0000-00000000000a', role: 'admin', name: 'Ann Admin', email: 'ann@x.co', is_active: true, login_disabled: false }
const mk = (id, over) => ({ id: `00000000-0000-0000-0000-00000000000${id}`, name: 'Test Person', email: `${id}@x.co`, phone: null, role: 'member', is_active: true, login_disabled: false, ...over })
const STATES = {
  'active member': mk('b', {}),
  'active admin': mk('c', { role: 'admin' }),
  'suspended member': mk('d', { login_disabled: true }),
  'deactivated member': mk('e', { is_active: false, login_disabled: true }),
}

await test('accountGate: blocked when deactivated or suspended, forced change when flagged, ok otherwise (and before migration 034)', () => {
  assert.equal(accountGate({ is_active: false, login_disabled: true }), 'blocked')
  assert.equal(accountGate({ is_active: true, login_disabled: true }), 'blocked')
  assert.equal(accountGate({ is_active: true, login_disabled: false, must_change_password: true }), 'must_change')
  assert.equal(accountGate({ is_active: true, login_disabled: false, must_change_password: false }), 'ok')
  assert.equal(accountGate({ id: 'x', role: 'member' }), 'ok', 'old rows without the new columns keep working')
  assert.equal(accountGate(null), 'ok') })
await test('memberStatus labels', () => {
  assert.equal(memberStatus(STATES['deactivated member']).key, 'inactive')
  assert.equal(memberStatus(STATES['suspended member']).key, 'suspended')
  assert.equal(memberStatus(STATES['active member']).key, 'active')
  assert.equal(memberStatus(undefined).key, 'active') })
await test('no tools on your own account, and none for non-admins', () => {
  assert.deepEqual(availableActions(ME, ME), [])
  assert.deepEqual(availableActions(STATES['active member'], { ...ME, role: 'member' }), []) })
await test('friendlySignInError: a banned login gets a clear message', () => {
  assert.match(friendlySignInError('User is banned'), /cannot sign in/)
  assert.equal(friendlySignInError('Invalid login credentials'), 'Wrong email or password.') })

// The screen must offer exactly what the server allows: nothing that will be refused, nothing missing.
const POLICY_ACTIONS = ['edit_details', 'set_role', 'suspend', 'restore_login', 'deactivate', 'reactivate', 'send_reset', 'temp_password']
for (const [label, member] of Object.entries(STATES)) {
  await test(`screen matches server rules for: ${label}`, async () => {
    const offered = availableActions(member, ME)
    for (const action of POLICY_ACTIONS) {
      const members = { [ME.id]: ME, [member.id]: member }
      const deps = {
        getCaller: async () => ({ id: ME.id, email: ME.email }), getMember: async (id) => members[id] ?? null,
        verifyPassword: async () => 'ok', setBanned: async () => null, setAuthPassword: async () => null, setAuthEmail: async () => ({}),
        updateProfile: async () => null, rpc: async () => ({ data: { ok: true } }), sendResetEmail: async () => null,
        notify: async () => {}, audit: async () => {}, randomBytes: (k) => new Uint8Array(k).fill(7), log: () => {},
      }
      const body = { action, member_id: member.id, admin_password: 'pw', name: 'Changed Name', role: member.role === 'admin' ? 'member' : 'admin' }
      const r = await handle(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) }), deps)
      const allowed = r.status === 200
      assert.equal(offered.includes(action), allowed, `${label} / ${action}: screen ${offered.includes(action) ? 'offers' : 'hides'} it, server says ${r.status} ${JSON.stringify(await r.json())}`)
    }
  })
}

await test('callMemberAdmin: passes the server\'s error message and needs_password through', async () => {
  const fake = (data, error) => ({ functions: { invoke: async () => ({ data, error }) } })
  const ok = await callMemberAdmin(fake({ ok: true, message: 'Done' }, null), 'summary', 'id'); assert.equal(ok.ok, true)
  const httpErr = { context: { json: async () => ({ error: 'Your password is not correct', needs_password: true }) } }
  const bad = await callMemberAdmin(fake(null, httpErr), 'suspend', 'id', { admin_password: 'x' })
  assert.deepEqual([bad.ok, bad.error, bad.needsPassword], [false, 'Your password is not correct', true])
  const crash = await callMemberAdmin({ functions: { invoke: async () => { throw new Error('net') } } }, 'summary', 'id')
  assert.equal(crash.ok, false); assert.match(crash.error, /server/) })

console.log(`\nAll ${n} member-admin screen tests passed`)
