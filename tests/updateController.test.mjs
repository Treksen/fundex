import { createUpdateController } from './updateController.mjs'
import assert from 'node:assert/strict'

class Worker extends EventTarget { constructor(){ super(); this.state='installing'; this.sent=[] } postMessage(m){ this.sent.push(m) }
  go(s){ this.state=s; this.dispatchEvent(new Event('statechange')) } }
class Reg extends EventTarget { constructor(){ super(); this.waiting=null; this.installing=null; this.updates=0; this.onUpdate=null; this.fail=false }
  async update(){ this.updates++; if(this.fail) throw new Error('offline'); this.onUpdate?.() }
  found(w){ this.installing=w; this.dispatchEvent(new Event('updatefound')) } }
function world({ controlled=true, waiting=false } = {}) {
  const reg = new Reg(); if (waiting) reg.waiting = new Worker()
  const sw = new EventTarget(); sw.controller = controlled ? {} : null
  sw.register = async () => reg; sw.getRegistrations = async () => [{ unregister: async () => true }]
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const store = new Map(); const storage = { getItem:k=>store.get(k)??null, setItem:(k,v)=>store.set(k,v) }
  let reloads = 0; const timers = []
  const env = { serviceWorker: sw, location: { reload(){ reloads++ } }, documentRef: doc, storage, caches: { keys: async()=>['a'], delete: async()=>true },
    setTimeout: (f, ms)=>{ if (ms >= 4000) timers.push(f); else setImmediate(f); return timers.length }, setInterval: (f)=>f, clearInterval: ()=>{} }
  const c = createUpdateController(env); const stop = c.start()
  return { c, reg, sw, doc, storage, store, env, timers, stop, reloads: () => reloads, s: () => c.getSnapshot() }
}
const tick = () => new Promise(r => setImmediate(r))
let n = 0; const test = async (name, fn) => { await fn(); console.log('PASS', ++n, name) }

await test('update already waiting at load -> banner state on', async () => {
  const w = world({ waiting: true }); await tick()
  assert.equal(w.s().needRefresh, true); assert.equal(w.s().reason, 'waiting'); assert.equal(w.s().dismissed, false) })

await test('new version found while open -> installed -> banner on', async () => {
  const w = world(); await tick(); assert.equal(w.s().needRefresh, false)
  const nw = new Worker(); w.reg.found(nw); nw.go('installed'); assert.equal(w.s().needRefresh, true) })

await test('first-ever install (no controller) does NOT show a banner', async () => {
  const w = world({ controlled: false }); await tick()
  const nw = new Worker(); w.reg.found(nw); nw.go('installed'); assert.equal(w.s().needRefresh, false) })

await test('banner stays through timer ticks, tab switches and re-checks', async () => {
  const w = world({ waiting: true }); await tick()
  for (let i = 0; i < 5; i++) { w.doc.dispatchEvent(new Event('visibilitychange')); await w.c.checkForUpdate() }
  assert.equal(w.s().needRefresh, true); assert.equal(w.s().dismissed, false); assert.equal(w.reloads(), 0) })

await test('KEY: another tab/redeploy activates a new version -> NO auto reload, banner appears instead', async () => {
  const w = world({ waiting: true }); await tick()
  w.sw.dispatchEvent(new Event('controllerchange'))
  assert.equal(w.reloads(), 0, 'page must not reload by itself'); assert.equal(w.s().needRefresh, true); assert.equal(w.s().reason, 'activated') })

await test('Update now with waiting worker -> SKIP_WAITING sent, reload only after switch', async () => {
  const w = world({ waiting: true }); await tick(); const waiting = w.reg.waiting
  w.c.applyUpdate()
  assert.deepEqual(waiting.sent, [{ type: 'SKIP_WAITING' }]); assert.equal(w.s().applying, true); assert.equal(w.reloads(), 0)
  w.sw.dispatchEvent(new Event('controllerchange')); assert.equal(w.reloads(), 1) })

await test('Update now when already active elsewhere -> reloads immediately', async () => {
  const w = world(); await tick(); w.c.applyUpdate(); assert.equal(w.reloads(), 1) })

await test('Later hides it; a newer version brings it back', async () => {
  const w = world({ waiting: true }); await tick(); w.c.dismiss(); assert.equal(w.s().dismissed, true)
  const nw = new Worker(); w.reg.found(nw); nw.go('installed'); assert.equal(w.s().dismissed, false) })

await test('manual check: nothing new -> found:false, no banner', async () => {
  const w = world(); await tick(); const r = await w.c.checkForUpdate()
  assert.deepEqual(r, { ok: true, found: false }); assert.equal(w.s().needRefresh, false); assert.equal(w.reg.updates, 1) })

await test('manual check: new version appears -> found:true', async () => {
  const w = world(); await tick()
  w.reg.onUpdate = () => { const nw = new Worker(); w.reg.found(nw); setImmediate(() => { w.reg.waiting = nw; nw.go('installed') }) }
  const r = await w.c.checkForUpdate(); assert.equal(r.found, true); assert.equal(w.s().needRefresh, true) })

await test('manual check offline -> ok:false network, checking resets', async () => {
  const w = world(); await tick(); w.reg.fail = true
  const r = await w.c.checkForUpdate(); assert.deepEqual(r, { ok: false, reason: 'network' }); assert.equal(w.s().checking, false) })

await test('event log is kept across a reload for troubleshooting', async () => {
  const w = world({ waiting: true }); await tick()
  w.sw.dispatchEvent(new Event('controllerchange'))
  const again = createUpdateController(w.env); assert.ok(again.getSnapshot().events.some(e => e.includes('reload held back'))) })

await test('reset cache -> reloads', async () => { const w = world(); await tick(); await w.c.resetAppCache(); assert.equal(w.reloads(), 1) })

await test('BRIDGE: brand-new visitor gets claimed by the worker -> NO banner, NO reload', async () => {
  const w = world({ controlled: false }); await tick()
  w.sw.controller = {}; w.sw.dispatchEvent(new Event('controllerchange'))
  assert.equal(w.s().needRefresh, false); assert.equal(w.reloads(), 0) })

await test('BRIDGE: after that first claim, a later takeover DOES show the banner (still no reload)', async () => {
  const w = world({ controlled: false }); await tick()
  w.sw.controller = {}; w.sw.dispatchEvent(new Event('controllerchange'))
  w.sw.dispatchEvent(new Event('controllerchange'))
  assert.equal(w.s().needRefresh, true); assert.equal(w.s().reason, 'activated'); assert.equal(w.reloads(), 0) })

await test('BRIDGE: existing member, new version activates instantly -> banner, no reload', async () => {
  const w = world({ controlled: true }); await tick()
  w.sw.dispatchEvent(new Event('controllerchange'))
  assert.equal(w.s().needRefresh, true); assert.equal(w.reloads(), 0) })
console.log(`\nAll ${n} scenarios passed`)
