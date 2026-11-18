import assert from 'node:assert/strict'
import { handle, validateNewMember } from './logic.mjs'
let n = 0; const test = async (name, fn) => { await fn(); console.log('PASS', ++n, name) }
const mk = (over = {}) => { const calls = { created: [], profile: [], deleted: [], recorded: [], logs: [] }
  const deps = { getCallerId: async (j) => (j === 'ADMIN_JWT' ? 'admin1' : j === 'MEMBER_JWT' ? 'mem1' : null), getRole: async (id) => ({ admin1: 'admin', mem1: 'member' }[id] ?? null),
    createUser: async (a) => { calls.created.push(a); return { id: 'new1' } }, setProfile: async (id, p) => { calls.profile.push([id, p]); return null },
    deleteUser: async (id) => { calls.deleted.push(id) }, record: async (r) => { calls.recorded.push(r) }, log: (m) => calls.logs.push(m), ...over }
  return { deps, calls } }
const req = (body, { jwt = 'ADMIN_JWT', method = 'POST' } = {}) => new Request('http://x/fn', { method, headers: jwt ? { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined })
const good = { email: ' Jane@Example.com ', name: ' Jane Doe ', role: 'member', password: 'Sup3rSecret!' }

await test('no token -> 401, nothing created', async () => { const { deps, calls } = mk(); const r = await handle(req(good, { jwt: null }), deps); assert.equal(r.status, 401); assert.equal(calls.created.length, 0) })
await test('invalid/expired token -> 401', async () => { const { deps } = mk(); assert.equal((await handle(req(good, { jwt: 'junk' }), deps)).status, 401) })
await test('a MEMBER is refused (403) and nothing is created', async () => { const { deps, calls } = mk(); const r = await handle(req(good, { jwt: 'MEMBER_JWT' }), deps); assert.equal(r.status, 403); assert.equal(calls.created.length, 0) })
await test('a user with no profile is refused', async () => { const { deps } = mk({ getCallerId: async () => 'ghost' }); assert.equal((await handle(req(good), deps)).status, 403) })
await test('KEY: the role comes from the database, so a member cannot grant themselves admin by sending role:"admin" or fake flags', async () => {
  const { deps, calls } = mk(); const r = await handle(req({ ...good, isAdmin: true, callerRole: 'admin' }, { jwt: 'MEMBER_JWT' }), deps); assert.equal(r.status, 403); assert.equal(calls.created.length, 0) })
await test('admin creates a member: email lower-cased, name trimmed, profile role set server-side, audit recorded', async () => {
  const { deps, calls } = mk(); const r = await handle(req(good), deps); assert.equal(r.status, 200)
  assert.deepEqual(calls.created, [{ email: 'jane@example.com', password: 'Sup3rSecret!', name: 'Jane Doe' }])
  assert.deepEqual(calls.profile, [['new1', { name: 'Jane Doe', role: 'member' }]]); assert.deepEqual(calls.recorded[0], { adminId: 'admin1', memberId: 'new1', email: 'jane@example.com', name: 'Jane Doe', role: 'member' }) })
await test('admin can create another admin (role applied by the server)', async () => { const { deps, calls } = mk(); const r = await handle(req({ ...good, role: 'admin' }), deps); assert.equal(r.status, 200); assert.equal(calls.profile[0][1].role, 'admin') })
await test('the password is NEVER returned or logged', async () => {
  const { deps, calls } = mk(); const r = await handle(req(good), deps); const text = await r.text(); assert.ok(!text.includes('Sup3rSecret!'), 'password echoed'); assert.ok(!JSON.stringify(calls.logs).includes('Sup3rSecret!'), 'password logged')
  const f = mk({ setProfile: async () => 'boom' }); await handle(req(good), f.deps); assert.ok(f.calls.logs.length > 0); assert.ok(!JSON.stringify(f.calls.logs).includes('Sup3rSecret!')) })
await test('validation: bad email / short name / bad role / short + long password', async () => {
  for (const [patch, msg] of [[{ email: 'nope' }, /email/i], [{ name: 'A' }, /Name/], [{ role: 'owner' }, /Role/], [{ password: 'short' }, /8/], [{ password: 'x'.repeat(73) }, /72/]]) {
    const { deps, calls } = mk(); const r = await handle(req({ ...good, ...patch }), deps); assert.equal(r.status, 400); assert.match((await r.json()).error, msg); assert.equal(calls.created.length, 0) } })
await test('duplicate email -> 409 and no profile/audit work', async () => { const { deps, calls } = mk({ createUser: async () => ({ error: 'User already registered', duplicate: true }) }); const r = await handle(req(good), deps); assert.equal(r.status, 409); assert.equal(calls.profile.length, 0); assert.equal(calls.recorded.length, 0) })
await test('createUser fails -> 500 with a generic message (no internals leaked)', async () => { const { deps } = mk({ createUser: async () => ({ error: 'db password=hunter2 failed' }) }); const r = await handle(req(good), deps); assert.equal(r.status, 500); assert.ok(!(await r.text()).includes('hunter2')) })
await test('profile step fails -> the new login is DELETED (no half-created account) and the admin is told', async () => {
  const { deps, calls } = mk({ setProfile: async () => 'constraint violation' }); const r = await handle(req(good), deps); assert.equal(r.status, 500); assert.deepEqual(calls.deleted, ['new1']); assert.equal(calls.recorded.length, 0) })
await test('audit/record failure does not undo a successfully created account', async () => { const { deps, calls } = mk({ record: async () => { throw new Error('audit down') } }); const r = await handle(req(good), deps); assert.equal(r.status, 200); assert.equal(calls.deleted.length, 0) })
await test('CORS preflight and wrong HTTP method', async () => { const { deps } = mk(); const o = await handle(new Request('http://x', { method: 'OPTIONS' }), deps); assert.equal(o.status, 204); assert.ok(o.headers.get('Access-Control-Allow-Headers').includes('authorization')); assert.equal((await handle(new Request('http://x', { method: 'GET' }), deps)).status, 405) })
await test('malformed JSON body -> 400', async () => { const { deps } = mk(); const r = await handle(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer ADMIN_JWT' }, body: '{not json' }), deps); assert.equal(r.status, 400) })
await test('validateNewMember: defaults role to member, trims, rejects non-string junk', () => { assert.equal(validateNewMember({ email: 'a@b.co', name: 'Bo', password: '12345678' }).value.role, 'member'); assert.ok(validateNewMember({ email: {}, name: [], password: 5 }).error) })
console.log(`\nAll ${n} server-function tests passed`)
