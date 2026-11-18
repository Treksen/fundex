import assert from 'node:assert/strict'
import { requestPasswordReset, completePasswordReset, waitForRecovery, linkProblemFromUrl, friendlyResetError } from './passwordReset.mjs'
import { validateNewPassword } from './passwordRules.mjs'
let n = 0; const test = async (name, fn) => { await fn(); console.log('PASS', ++n, name) }

const client = (over = {}) => { const calls = []; let listener = null
  const supabase = { auth: {
    resetPasswordForEmail: async (e, o) => { calls.push(['reset', e, o]); return over.resetError ? { error: over.resetError } : { error: null } },
    updateUser: async (a) => { calls.push(['update', a]); return over.updateError ? { error: over.updateError } : { error: null } },
    signOut: async () => { calls.push(['signOut']); if (over.signOutThrows) throw new Error('net') },
    getSession: async () => ({ data: { session: over.session ?? null } }),
    onAuthStateChange: (cb) => { listener = cb; return { data: { subscription: { unsubscribe: () => calls.push(['unsubscribe']) } } } } } }
  return { supabase, calls, emit: (event, session) => listener(event, session) } }

await test('request: bad email is rejected locally, Supabase is never called', async () => { const { supabase, calls } = client(); const r = await requestPasswordReset(supabase, 'not-an-email', 'x'); assert.equal(r.ok, false); assert.equal(calls.length, 0) })
await test('request: email is trimmed + lower-cased and the redirect target is passed through', async () => {
  const { supabase, calls } = client(); const r = await requestPasswordReset(supabase, '  Jane@Example.COM ', 'https://app/reset-password'); assert.equal(r.ok, true); assert.deepEqual(calls[0], ['reset', 'jane@example.com', { redirectTo: 'https://app/reset-password' }]) })
await test('request: ENUMERATION-SAFE, an unknown account / any non-rate error looks identical to success', async () => {
  const { supabase } = client({ resetError: { message: 'User not found' } }); assert.deepEqual(await requestPasswordReset(supabase, 'ghost@example.com', 'x'), { ok: true }) })
await test('request: rate limiting gives a clear message', async () => {
  const { supabase } = client({ resetError: { message: 'For security purposes, you can only request this after 60 seconds' } }); const r = await requestPasswordReset(supabase, 'a@b.co', 'x'); assert.equal(r.ok, false); assert.match(r.error, /Too many requests/) })
await test('request: network failure gives a friendly message (no crash)', async () => {
  const r = await requestPasswordReset({ auth: { resetPasswordForEmail: async () => { throw new Error('offline') } } }, 'a@b.co', 'x'); assert.equal(r.ok, false); assert.match(r.error, /connection/) })

await test('password rules: min 8, max 72, confirmation must match', () => {
  assert.match(validateNewPassword('short'), /at least 8/); assert.match(validateNewPassword('x'.repeat(73)), /at most 72/); assert.match(validateNewPassword('longenough1', 'different1'), /do not match/)
  assert.equal(validateNewPassword('longenough1', 'longenough1'), null); assert.equal(validateNewPassword('12345678'), null); assert.ok(validateNewPassword(undefined)) })
await test('complete: invalid input never reaches Supabase', async () => { const { supabase, calls } = client(); assert.equal((await completePasswordReset(supabase, 'short', 'short')).ok, false); assert.equal((await completePasswordReset(supabase, 'longenough1', 'nope')).ok, false); assert.equal(calls.length, 0) })
await test('complete: updates the password THEN signs out (so the new password must be used to sign in)', async () => {
  const { supabase, calls } = client(); const r = await completePasswordReset(supabase, 'BrandNew#123', 'BrandNew#123'); assert.equal(r.ok, true)
  assert.deepEqual(calls.map((c) => c[0]), ['update', 'signOut']); assert.deepEqual(calls[0][1], { password: 'BrandNew#123' }) })
await test('complete: same-as-old and expired-session errors get friendly wording, and no sign-out happens on failure', async () => {
  let c = client({ updateError: { message: 'New password should be different from the old password.' } }); let r = await completePasswordReset(c.supabase, 'BrandNew#123', 'BrandNew#123'); assert.match(r.error, /not used before/); assert.ok(!c.calls.some((x) => x[0] === 'signOut'))
  c = client({ updateError: { message: 'Auth session missing!' } }); r = await completePasswordReset(c.supabase, 'BrandNew#123', 'BrandNew#123'); assert.match(r.error, /expired/)
  assert.match(friendlyResetError('something internal: db 500'), /Could not update/) })
await test('complete: a failing sign-out afterwards does not undo a successful change', async () => { const { supabase } = client({ signOutThrows: true }); assert.equal((await completePasswordReset(supabase, 'BrandNew#123', 'BrandNew#123')).ok, true) })

await test('link problems: expired/used links are detected from the hash or the query string', () => {
  assert.equal(linkProblemFromUrl({ hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid', search: '' }), 'otp_expired')
  assert.equal(linkProblemFromUrl({ hash: '', search: '?error=access_denied' }), 'error'); assert.equal(linkProblemFromUrl({ hash: '#access_token=abc&type=recovery', search: '' }), null); assert.equal(linkProblemFromUrl({}), null) })
await test('recover: an expired link is reported without waiting', async () => { const { supabase } = client(); assert.equal(await waitForRecovery(supabase, { location: { hash: '#error_code=otp_expired', search: '' } }), 'expired') })
await test('recover: a session that already exists -> ready immediately', async () => { const { supabase } = client({ session: { user: { id: 'u' } } }); assert.equal(await waitForRecovery(supabase, { location: { hash: '', search: '' } }), 'ready') })
await test('recover: PASSWORD_RECOVERY event arriving late -> ready, timer cleared, listener removed', async () => {
  const { supabase, calls, emit } = client(); let cleared = false, fire = null
  const p = waitForRecovery(supabase, { location: { hash: '', search: '' }, setTimeoutFn: (f) => { fire = f; return 7 }, clearTimeoutFn: () => { cleared = true } })
  await new Promise((r) => setImmediate(r)); emit('PASSWORD_RECOVERY', { user: {} }); assert.equal(await p, 'ready'); assert.ok(cleared); assert.ok(calls.some((c) => c[0] === 'unsubscribe')) })
await test('recover: nothing arrives -> invalid after the timeout, listener removed', async () => {
  const { supabase, calls } = client(); let fire = null
  const p = waitForRecovery(supabase, { location: { hash: '', search: '' }, setTimeoutFn: (f) => { fire = f; return 1 }, clearTimeoutFn: () => {} })
  await new Promise((r) => setImmediate(r)); fire(); assert.equal(await p, 'invalid'); assert.ok(calls.some((c) => c[0] === 'unsubscribe')) })
await test('recover: a SIGNED_IN event with NO session does not count as ready', async () => {
  const { supabase, emit } = client(); let fire = null
  const p = waitForRecovery(supabase, { location: { hash: '', search: '' }, setTimeoutFn: (f) => { fire = f; return 1 }, clearTimeoutFn: () => {} })
  await new Promise((r) => setImmediate(r)); emit('SIGNED_IN', null); emit('TOKEN_REFRESHED', null); fire(); assert.equal(await p, 'invalid') })
console.log(`\nAll ${n} password-reset tests passed`)
