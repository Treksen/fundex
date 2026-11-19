import assert from 'node:assert/strict'
import * as S from './shared.mjs'
import { handle as stk } from './stk.mjs'
import { handle as callback } from './callback.mjs'

let n = 0
const test = async (name, fn) => { await fn(); console.log('PASS', ++n, name) }

// ── shared helpers ──────────────────────────────────────────
await test('normalizePhone: common Kenyan formats; rejects landlines/foreign/junk', () => {
  for (const [i, o] of [['0712345678', '254712345678'], ['0712 345 678', '254712345678'], ['+254712345678', '254712345678'], ['254112345678', '254112345678'], ['0112345678', '254112345678'], ['712345678', '254712345678'], ['(0712)-345-678', '254712345678']]) assert.equal(S.normalizePhone(i), o, i)
  for (const bad of ['020123456', '0812345678', '25571234567', '07123456', '', null, 'call me']) assert.equal(S.normalizePhone(bad), null, String(bad)) })
await test('parseAmount: whole shillings only, at least 1', () => {
  assert.equal(S.parseAmount('500').value, 500); assert.equal(S.parseAmount(250000).value, 250000)
  for (const bad of ['0', '10.50', '-5', '1e3', '', 'abc', '1000000']) assert.ok(S.parseAmount(bad).error, bad) })
await test('invoice number: "<account>-<ref>", never longer than the limit, always keeps a reference character', () => {
  assert.equal(S.buildInvoiceNumber('1351460749', 'ABC123', 12), '1351460749-A')
  assert.equal(S.buildInvoiceNumber('1351460749', 'ABC123', 30), '1351460749-ABC123')
  assert.equal(S.buildInvoiceNumber('1351460749', 'ABC123', 5), '1351460749-A') })
await test('callback address: secret as the last segment; read back from path or ?t=', () => {
  assert.equal(S.callbackUrlFor('https://finance.geotreks.co.ke/m/', 'AbCdEfGhIjKlMnOp'), 'https://finance.geotreks.co.ke/m/AbCdEfGhIjKlMnOp')
  assert.ok(S.callbackUrlFor('https://finance.geotreks.co.ke/m', 'AbCdEfGhIjKlMnOp').length <= 50, 'fits KCB\'s 50-character limit')
  assert.equal(S.secretFromUrl('https://x.supabase.co/functions/v1/mpesa-callback/AbCdEfGhIjKlMnOp'), 'AbCdEfGhIjKlMnOp')
  assert.equal(S.secretFromUrl('https://x.supabase.co/functions/v1/mpesa-callback?t=AbCdEfGhIjKlMnOp'), 'AbCdEfGhIjKlMnOp')
  assert.equal(S.secretFromUrl('https://x.supabase.co/functions/v1/mpesa-callback'), null, '"mpesa-callback" itself is too short to be a secret')
  assert.equal(S.secretFromUrl('https://x/m/../../etc'), null) })
await test('interpretStkResponse: success (incl. KCB\'s "CheckoutRequestID: false" sample), refusals, auth faults', () => {
  const ok = S.interpretStkResponse(200, { header: { statusCode: '0', statusDescription: 'Success' }, response: { MerchantRequestID: 'm1', ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing', CheckoutRequestID: 'ws_CO_1' } })
  assert.deepEqual([ok.ok, ok.checkoutRequestId], [true, 'ws_CO_1'])
  assert.equal(S.interpretStkResponse(200, { header: { statusCode: '0' }, response: { ResponseCode: 0, CheckoutRequestID: false } }).checkoutRequestId, null)
  assert.match(S.interpretStkResponse(200, { header: { statusCode: '1', statusDescription: 'STK Push Backend Posting Failure: Bad Request - Invalid Remarks' }, response: {} }).error, /Invalid Remarks/)
  assert.equal(S.interpretStkResponse(401, { fault: { code: 900901, message: 'Invalid Credentials' } }).error, 'Invalid Credentials')
  assert.equal(S.interpretStkResponse(500, null).ok, false) })
const SUCCESS = { Body: { stkCallback: { MerchantRequestID: '17684-56147665-1', CheckoutRequestID: 'ws_CO_21072023153404650713165445', ResultCode: 0, ResultDesc: 'The service request is processed successfully.',
  CallbackMetadata: { Item: [{ Name: 'Amount', Value: 1.0 }, { Name: 'MpesaReceiptNumber', Value: 'ABCDE12345' }, { Name: 'Balance' }, { Name: 'TransactionDate', Value: 20230721153232 }, { Name: 'PhoneNumber', Value: 254700000000 }] } } } }
await test('parseStkCallback: KCB\'s documented success sample', () => {
  assert.deepEqual(S.parseStkCallback(SUCCESS), { merchantRequestId: '17684-56147665-1', checkoutRequestId: 'ws_CO_21072023153404650713165445', resultCode: 0,
    resultDesc: 'The service request is processed successfully.', receipt: 'ABCDE12345', amount: 1, phone: '254700000000', paidAt: '2023-07-21T15:32:32+03:00' }) })
await test('parseStkCallback: documented failures (cancelled 1032, unreachable 1037, wrong PIN 2001) and junk', () => {
  for (const code of [1032, 1037, 2001]) { const r = S.parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_x', ResultCode: code, ResultDesc: 'x' } } }); assert.equal(r.resultCode, code); assert.equal(r.receipt, null) }
  for (const junk of [null, {}, { Body: {} }, { Body: { stkCallback: { ResultCode: 'abc' } } }]) assert.equal(S.parseStkCallback(junk), null)
  const weird = S.parseStkCallback({ Body: { stkCallback: { ResultCode: 0, CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: "x'; drop table--" }] } } } })
  assert.equal(weird.receipt, null, 'a receipt must look like an M-Pesa code') })
await test('sha256Hex is a real SHA-256', async () => { assert.equal(await S.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') })

// ── mpesa-stk-push ──────────────────────────────────────────
const ME = 'me', ADMIN = 'adm', OTHER = 'other', GONE = 'gone', SUSP = 'susp'
const PROFILES = {
  me: { id: ME, role: 'member', name: 'Mary Member', is_active: true, login_disabled: false },
  adm: { id: ADMIN, role: 'admin', name: 'Ann Admin', is_active: true, login_disabled: false },
  other: { id: OTHER, role: 'member', name: 'Otto Other', is_active: true, login_disabled: false },
  gone: { id: GONE, role: 'member', name: 'Dan Gone', is_active: false, login_disabled: true },
  susp: { id: SUSP, role: 'member', name: 'Sue Susp', is_active: true, login_disabled: true },
}
function stkWorld(over = {}) {
  const c = { created: [], updates: [], posts: [], tokens: [], logs: [] }
  let tokenN = 0
  const deps = {
    config: { enabled: true, accountNumber: '1351460749', callbackBase: 'https://finance.geotreks.co.ke/m', invoiceMax: 12 },
    getCaller: async (j) => ({ ME_JWT: ME, ADMIN_JWT: ADMIN, SUSP_JWT: SUSP }[j] ?? null),
    getProfile: async (id) => PROFILES[id] ?? null,
    countRecent: async () => 0,
    createRequest: async (row) => { c.created.push(row); return { id: 'req1' } },
    updateRequest: async (id, p) => { c.updates.push([id, p]) },
    getToken: async (force) => { c.tokens.push(!!force); return `tok${++tokenN}` },
    postStk: async (tok, body) => { c.posts.push([tok, body]); return { status: 200, json: { header: { statusCode: '0', statusDescription: 'Success' }, response: { MerchantRequestID: 'm1', ResponseCode: '0', CheckoutRequestID: 'ws_CO_1', CustomerMessage: 'Success. Request accepted for processing' } } } },
    randomBytes: (k) => new Uint8Array(k).map((_, i) => (i * 37 + 5) % 256),
    sha256Hex: async (s) => `hash(${s})`,
    now: () => Date.parse('2026-11-19T19:00:00Z'),
    log: (m) => c.logs.push(m),
    ...over,
  }
  return { deps, c }
}
const post = (body, jwt = 'ME_JWT') => new Request('http://x/fn', { method: 'POST', headers: jwt ? { Authorization: `Bearer ${jwt}` } : {}, body: JSON.stringify(body) })
const callStk = async (body, jwt, over) => { const w = stkWorld(over); const r = await stk(post(body, jwt), w.deps); return { ...w, status: r.status, body: await r.json() } }

await test('happy path: member pays for themselves; KCB gets exactly the documented fields', async () => {
  const x = await callStk({ amount: '500', phone: '0712 345 678' })
  assert.equal(x.status, 200); assert.equal(x.body.request_id, 'req1'); assert.match(x.body.message, /0712345678/)
  const row = x.c.created[0]
  assert.deepEqual([row.member_id, row.initiated_by, row.phone, row.amount, row.status], [ME, ME, '254712345678', 500, 'sending'])
  assert.match(row.invoice_number, /^1351460749-[A-Z2-9]$/); assert.ok(row.invoice_number.length <= 12)
  const [tok, body] = x.c.posts[0]
  assert.equal(tok, 'tok1')
  assert.deepEqual(Object.keys(body).sort(), ['amount', 'callbackUrl', 'invoiceNumber', 'orgPassKey', 'orgShortCode', 'phoneNumber', 'sharedShortCode', 'transactionDescription'])
  assert.equal(body.amount, '500'); assert.equal(body.sharedShortCode, true); assert.ok(body.transactionDescription.length <= 13)
  assert.ok(body.callbackUrl.startsWith('https://finance.geotreks.co.ke/m/')); assert.ok(body.callbackUrl.length <= 50, `callback ${body.callbackUrl.length} chars`)
  const secret = body.callbackUrl.split('/').pop()
  assert.equal(row.secret_hash, `hash(${secret})`, 'only the hash is stored'); assert.ok(!JSON.stringify(row).includes(`"${secret}"`))
  assert.deepEqual(x.c.updates[0], ['req1', { status: 'pending', merchant_request_id: 'm1', checkout_request_id: 'ws_CO_1', customer_message: 'Success. Request accepted for processing' }])
  assert.ok(!JSON.stringify(x.body).includes(secret), 'the secret is never sent to the browser') })
await test('who may pay: member only for self; admin for any active member; never for a deactivated one', async () => {
  assert.equal((await callStk({ amount: 100, phone: '0712345678', member_id: OTHER })).status, 403)
  const a = await callStk({ amount: 100, phone: '0712345678', member_id: OTHER }, 'ADMIN_JWT'); assert.equal(a.status, 200); assert.deepEqual([a.c.created[0].member_id, a.c.created[0].initiated_by], [OTHER, ADMIN])
  assert.equal((await callStk({ amount: 100, phone: '0712345678', member_id: GONE }, 'ADMIN_JWT')).status, 409)
  assert.equal((await callStk({ amount: 100, phone: '0712345678', member_id: 'nobody' }, 'ADMIN_JWT')).status, 404)
  assert.equal((await callStk({ amount: 100, phone: '0712345678' }, 'SUSP_JWT')).status, 403, 'a suspended login cannot pay') })
await test('sign-in, setup and validation are checked before anything is created', async () => {
  for (const [body, jwt, code] of [[{ amount: 1, phone: '0712345678' }, null, 401], [{ amount: 1, phone: '0712345678' }, 'junk', 401],
    [{ amount: '10.5', phone: '0712345678' }, 'ME_JWT', 400], [{ amount: 0, phone: '0712345678' }, 'ME_JWT', 400], [{ amount: 10, phone: '0202345678' }, 'ME_JWT', 400]]) {
    const x = await callStk(body, jwt); assert.equal(x.status, code, JSON.stringify(body)); assert.equal(x.c.created.length, 0) }
  const off = await callStk({ amount: 10, phone: '0712345678' }, 'ME_JWT', { config: { enabled: false, accountNumber: '', callbackBase: '', invoiceMax: 12 } })
  assert.equal(off.status, 503); assert.match(off.body.error, /not set up/) })
await test('double tap: a second prompt within a minute is refused', async () => {
  const x = await callStk({ amount: 10, phone: '0712345678' }, 'ME_JWT', { countRecent: async () => 1 })
  assert.equal(x.status, 409); assert.equal(x.c.created.length, 0); assert.equal(x.c.posts.length, 0) })
await test('expired token: renewed once and retried', async () => {
  let calls = 0
  const x = await callStk({ amount: 10, phone: '0712345678' }, 'ME_JWT', { postStk: async (tok) => { calls++; return calls === 1 ? { status: 401, json: { fault: { code: 900901, message: 'Invalid Credentials' } } } : { status: 200, json: { header: { statusCode: '0' }, response: { ResponseCode: '0', CheckoutRequestID: 'ws_CO_2' } } } } })
  assert.equal(x.status, 200); assert.deepEqual(x.c.tokens, [false, true]); assert.equal(calls, 2) })
await test('KCB refuses / is unreachable / no token: request marked send_failed, friendly message, details logged not shown', async () => {
  const refused = await callStk({ amount: 10, phone: '0712345678' }, 'ME_JWT', { postStk: async () => ({ status: 200, json: { header: { statusCode: '1', statusDescription: 'STK Push Backend Posting Failure: Bad Request - Invalid Remarks' }, response: {} } }) })
  assert.equal(refused.status, 502); assert.equal(refused.c.updates[0][1].status, 'send_failed'); assert.match(refused.c.updates[0][1].result_desc, /Invalid Remarks/)
  assert.ok(!refused.body.error.includes('Backend')); assert.ok(refused.c.logs.some((l) => l.includes('Invalid Remarks')))
  const down = await callStk({ amount: 10, phone: '0712345678' }, 'ME_JWT', { postStk: async () => { throw new Error('ECONNRESET') } })
  assert.equal(down.status, 502); assert.equal(down.c.updates[0][1].status, 'send_failed')
  const notoken = await callStk({ amount: 10, phone: '0712345678' }, 'ME_JWT', { getToken: async () => null })
  assert.equal(notoken.status, 502); assert.equal(notoken.c.posts.length, 0) })
await test('the consumer secret / token never appear in responses or logs', async () => {
  const x = await callStk({ amount: 10, phone: '0712345678' }, 'ME_JWT', { postStk: async () => ({ status: 500, json: null }) })
  assert.ok(!JSON.stringify([x.body, x.c.logs]).includes('tok1')) })
await test('CORS preflight / wrong method / bad JSON', async () => {
  const { deps } = stkWorld()
  assert.equal((await stk(new Request('http://x', { method: 'OPTIONS' }), deps)).status, 204)
  assert.equal((await stk(new Request('http://x', { method: 'GET' }), deps)).status, 405)
  assert.equal((await stk(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer ME_JWT' }, body: '{nope' }), deps)).status, 400) })

// ── mpesa-callback ──────────────────────────────────────────
function cbWorld(over = {}) {
  const c = { stored: [], recorded: [], logs: [] }
  const deps = {
    findRequestBySecretHash: async () => null,
    storeCallback: async (row) => { c.stored.push(row) },
    recordResult: async (a) => { c.recorded.push(a); return { data: { outcome: 'paid' } } },
    log: (m) => c.logs.push(m),
    ...over,
  }
  return { deps, c }
}
const SECRET = 'AbCdEfGhIjKlMnOp'
const known = async () => ({ findRequestBySecretHash: async (h) => (h === (await S.sha256Hex(SECRET)) ? { id: 'req1' } : null) })
const cbReq = (url, payload, method = 'POST') => new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : undefined })

await test('callback success: matched by the secret\'s hash, result recorded with the receipt, KCB acknowledged', async () => {
  const { deps, c } = cbWorld(await known())
  const r = await callback(cbReq(`https://x/functions/v1/mpesa-callback/${SECRET}`, SUCCESS), deps)
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ResultCode: 0, ResultDesc: 'Accepted' })
  assert.deepEqual(c.recorded[0], { p_request_id: 'req1', p_checkout_id: 'ws_CO_21072023153404650713165445', p_result_code: 0, p_result_desc: 'The service request is processed successfully.',
    p_receipt: 'ABCDE12345', p_amount: 1, p_phone: '254700000000', p_paid_at: '2023-07-21T15:32:32+03:00' })
  assert.deepEqual([c.stored[0].request_id, c.stored[0].matched, c.stored[0].outcome], ['req1', true, 'paid']) })
await test('callback via the short website address (/m/<secret>) works the same', async () => {
  const { deps, c } = cbWorld(await known())
  assert.equal((await callback(cbReq(`https://finance.geotreks.co.ke/m/${SECRET}`, SUCCESS), deps)).status, 200); assert.equal(c.recorded.length, 1) })
await test('FORGED callback (no / wrong secret): nothing recorded, kept for review, KCB still gets 200', async () => {
  for (const url of ['https://x/functions/v1/mpesa-callback', 'https://x/functions/v1/mpesa-callback/WrongSecretWrong1']) {
    const { deps, c } = cbWorld(await known())
    const r = await callback(cbReq(url, SUCCESS), deps)
    assert.equal(r.status, 200); assert.equal(c.recorded.length, 0); assert.equal(c.stored[0].matched, false); assert.equal(c.stored[0].request_id, null) } })
await test('unreadable body: stored, not recorded; failures are recorded with their result code', async () => {
  const a = cbWorld(await known()); await callback(cbReq(`https://x/m/${SECRET}`, '{broken'), a.deps)
  assert.equal(a.c.recorded.length, 0); assert.equal(a.c.stored[0].outcome, 'unreadable')
  const b = cbWorld(await known()); await callback(cbReq(`https://x/m/${SECRET}`, { Body: { stkCallback: { CheckoutRequestID: 'ws_CO_x', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } }), b.deps)
  assert.deepEqual([b.c.recorded[0].p_result_code, b.c.recorded[0].p_receipt], [1032, null]) })
await test('database down: 500 so KCB retries (safe: recording is idempotent)', async () => {
  const { deps, c } = cbWorld({ ...(await known()), recordResult: async () => ({ error: 'connection refused' }) })
  const r = await callback(cbReq(`https://x/m/${SECRET}`, SUCCESS), deps)
  assert.equal(r.status, 500); assert.ok(c.logs.some((l) => l.includes('connection refused'))) })
await test('callback: only POST, size-limited', async () => {
  const { deps } = cbWorld(await known())
  assert.equal((await callback(cbReq(`https://x/m/${SECRET}`, null, 'GET'), deps)).status, 405)
  assert.equal((await callback(cbReq(`https://x/m/${SECRET}`, 'x'.repeat(70_000)), deps)).status, 413) })

console.log(`\nAll ${n} M-Pesa tests passed`)
