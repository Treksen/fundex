// Usage (from the project root): node tests/mpesa/ui.test.mjs
import assert from 'node:assert/strict'
import { displayPhone, looksLikeKenyanMobile, describeResult, FINAL, REQUEST_COLUMNS, mpesaEnabled } from '../../src/lib/mpesa.js'
let n = 0
const test = (name, fn) => { fn(); console.log('PASS', ++n, name) }
test('profile phones are shown the way people type them', () => {
  assert.equal(displayPhone('+254712345678'), '0712345678'); assert.equal(displayPhone('254112345678'), '0112345678')
  assert.equal(displayPhone('0712345678'), '0712345678'); assert.equal(displayPhone(null), '') })
test('phone check in the form matches what the server accepts', () => {
  for (const ok of ['0712 345 678', '+254712345678', '0112345678', '712345678']) assert.ok(looksLikeKenyanMobile(ok), ok)
  for (const bad of ['0202345678', '07123', '', 'phone']) assert.ok(!looksLikeKenyanMobile(bad), bad) })
test('every outcome has a clear message; paid mentions the code and verification', () => {
  const paid = describeResult({ status: 'paid', amount: 5000, mpesa_receipt: 'SKL1ABC234' })
  assert.equal(paid.tone, 'ok'); assert.match(paid.text, /SKL1ABC234/); assert.match(paid.text, /verification/); assert.match(paid.text, /5,000/)
  assert.match(describeResult({ status: 'failed', result_code: 1 }).text, /Not enough money/)
  assert.match(describeResult({ status: 'failed', result_code: 2001 }).text, /PIN was wrong/)
  assert.match(describeResult({ status: 'cancelled' }).text, /cancelled/)
  assert.match(describeResult({ status: 'pending', phone: '254712345678', amount: 10 }).text, /0712345678/)
  for (const s of FINAL) assert.ok(describeResult({ status: s }).title, s) })
test('the browser never asks for the secret hash column', () => { assert.ok(!REQUEST_COLUMNS.includes('secret')) })
test('hidden unless the website is built with VITE_MPESA_ENABLED=true', () => { assert.equal(mpesaEnabled(), false) })
console.log(`\nAll ${n} M-Pesa screen tests passed`)
