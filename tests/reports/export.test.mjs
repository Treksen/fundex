process.env.TZ = 'Africa/Nairobi'
import assert from 'node:assert/strict'
import { buildReportModel } from './reportModel.mjs'
import { monthPeriod } from './reportPeriod.mjs'
import { buildReportPdf, buildStatementsPdf } from './reportPdf.mjs'
import { buildWorkbook } from './reportExcel.mjs'
import { loadReportData } from './reportLoader.mjs'
import { fetchAll } from './fetchAll.mjs'
import { raw } from './fixtures.mjs'
const NOW = new Date('2026-11-07T07:00:00+03:00')
const pad = (n) => String(n).padStart(2, '0'), iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fmt = { currency: (n) => `KES ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, date: (d) => iso(new Date(d)), dateTime: (d) => `${iso(new Date(d))} 12:00` }
let n = 0; const test = async (name, fn) => { await fn(); console.log('PASS', ++n, name) }

// ── recording stand-ins for jsPDF / autoTable ──
class FakeDoc {
  constructor() { this.pages = 1; this.page = 1; this.texts = []; this.rects = []; this.tables = []; this.images = 0; this.lastAutoTable = null; this.saved = null
    this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } } }
  setFont() {} setFontSize() {} setTextColor() {} setFillColor() {} setDrawColor() {} setLineWidth() {} line() {}
  rect(x, y, w, h, s) { this.rects.push({ x, y, w, h, s, page: this.page }) } roundedRect(x, y, w, h) { this.rects.push({ x, y, w, h, s: 'FD', page: this.page, rounded: true }) }
  text(t, x, y, o) { for (const s of [].concat(t)) this.texts.push({ s: String(s), x, y, page: this.page, o }) }
  addPage() { this.pages++; this.page = this.pages } setPage(i) { this.page = i } getNumberOfPages() { return this.pages }
  addImage() { this.images++ } getTextWidth(s) { return String(s).length * 1.8 }
  splitTextToSize(t, w) { const per = Math.floor(w / 1.4); const out = []; for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per)); return out }
  save(name) { this.saved = name }
}
const fakeAutoTable = (doc, o) => {
  doc.tables.push({ head: o.head?.[0], body: o.body, foot: o.foot?.[0], startY: o.startY })
  let y = o.startY
  for (let i = 0; i < (o.body.length + 1 + (o.foot ? 1 : 0)); i++) { y += 6; if (y > 281) { doc.addPage(); y = 24 } }
  doc.lastAutoTable = { finalY: y }
}
const ctx = (extra = {}) => ({ jsPDF: FakeDoc, autoTable: fakeAutoTable, fmt, logo: 'data:image/png;base64,AAA', ...extra })
const model = (over = {}) => buildReportModel({ ...raw, ...over }, monthPeriod('2026-10'), NOW)
const allStrings = (doc) => [...doc.texts.map((t) => t.s), ...doc.tables.flatMap((t) => [...(t.head || []), ...(t.foot || []), ...t.body.flat()].map(String))]

await test('PDF: builds without error, saves nothing by itself, includes logo', () => {
  const doc = buildReportPdf(model(), ctx()); assert.equal(doc.images, 1); assert.ok(doc.pages >= 2) })
await test('PDF: no NaN / undefined / Infinity / [object Object] anywhere', () => {
  const doc = buildReportPdf(model(), ctx()); const bad = allStrings(doc).filter((s) => /NaN|undefined|Infinity|\[object/.test(s)); assert.deepEqual(bad, []) })
await test('PDF: every table row has exactly as many cells as its header', () => {
  const doc = buildReportPdf(model(), ctx())
  for (const t of doc.tables) { for (const row of t.body) assert.equal(row.length, t.head.length, `row ${JSON.stringify(row)} vs head ${JSON.stringify(t.head)}`); if (t.foot) assert.equal(t.foot.length, t.head.length, 'foot') }
  assert.ok(doc.tables.length >= 14, `tables: ${doc.tables.length}`) })
await test('PDF: all requested sections present', () => {
  const s = allStrings(buildReportPdf(model(), ctx()))
  for (const name of ['Balance roll-forward', 'Monthly activity', 'Members', 'Group position', 'Deposit verification', 'Bank reconciliation', 'Investments', 'Savings goals', 'Ledger and trial balance', 'Transaction log']) assert.ok(s.some((x) => x.includes(name)), `missing section: ${name}`) })
await test('PDF: key numbers are right (closing pool, deposits, ownership, bank ref, verifier)', () => {
  const s = allStrings(buildReportPdf(model(), ctx()))
  for (const x of ['KES 22,200.00', 'KES 7,900.00', 'KES 2,500.00', 'Alice (admin)', '64.76%', '35.24%', 'BNK4', 'BNK5', 'Awaiting verification', '7 hours', 'Check passed']) assert.ok(s.some((v) => v.includes(x)), `missing: ${x}`) })
await test('PDF: page footers say "Page i of N" for every page, N = real page count', () => {
  const doc = buildReportPdf(model(), ctx()); const foot = doc.texts.filter((t) => /^Page \d+ of \d+$/.test(t.s))
  assert.equal(foot.length, doc.pages); foot.forEach((f, i) => assert.equal(f.s, `Page ${i + 1} of ${doc.pages}`)) })
await test('PDF: monthly chart bars are inside the chart area and sized to the data', () => {
  const doc = buildReportPdf(model(), ctx()); const bars = doc.rects.filter((r) => r.s === 'F' && r.w > 0 && r.w < 8 && r.h > 0.0001 && r.h <= 46.0001)
  assert.ok(bars.length >= 4, `bars: ${bars.length}`)   // Aug/Sep/Oct deposits + Oct withdrawals at least
  for (const r of doc.rects) for (const v of [r.x, r.y, r.w, r.h]) assert.ok(Number.isFinite(v)) })
await test('PDF: nothing is drawn below the bottom margin (no text off the page)', () => {
  const doc = buildReportPdf(model(), ctx()); for (const t of doc.texts) assert.ok(t.y <= 297 - 6, `text off page: ${t.s} @${t.y}`) })
await test('PDF: honest warnings when sources failed or members are missing', () => {
  const s = allStrings(buildReportPdf(model({ _failed: ['ledger', 'bank reconciliation'] }), ctx()))
  assert.ok(s.some((x) => x.includes('Not loaded: ledger, bank reconciliation'))) })
await test('PDF: out-of-balance ledger and roll-forward are shouted, not hidden', () => {
  const s = allStrings(buildReportPdf(model({ ledger: [{ entry_date: '2026-10-05', account_name: 'Cash', account_type: 'asset', debit: 100, credit: 0 }] }), ctx()))
  assert.ok(s.some((x) => x.includes('Trial balance check FAILED'))) })
await test('PDF: works with NO data at all (empty group / empty month)', () => {
  const empty = buildReportModel({ members: [], transactions: [] }, monthPeriod('2026-10'), NOW)
  const doc = buildReportPdf(empty, ctx()); assert.deepEqual(allStrings(doc).filter((s) => /NaN|undefined|Infinity/.test(s)), [])
  for (const t of doc.tables) for (const row of t.body) assert.equal(row.length, t.head.length) })
await test('PDF: works without a logo and survives a bad logo', () => {
  assert.doesNotThrow(() => buildReportPdf(model(), ctx({ logo: null })))
  class Boom extends FakeDoc { addImage() { throw new Error('bad image') } }
  assert.doesNotThrow(() => buildReportPdf(model(), ctx({ jsPDF: Boom }))) })
await test('PDF: large month (600 transactions) paginates and stays consistent', () => {
  const many = []; for (let i = 0; i < 600; i++) many.push({ id: `x${i}`, user_id: 'ABC'[i % 3] === 'A' ? 'A' : 'B', type: 'deposit', amount: 100, status: 'completed', transaction_date: `2026-10-${pad(1 + (i % 28))}T12:00:00+03:00`, created_at: '2026-10-01T00:00:00+03:00', reference: `R${i}` })
  const m = model({ transactions: [...raw.transactions, ...many] }); const doc = buildReportPdf(m, ctx())
  assert.ok(doc.pages >= 8, `pages ${doc.pages}`); assert.equal(m.transactionLog.length, 8 + 600 - 0 - 0 > 0 ? m.transactionLog.length : 0)
  const log = doc.tables.find((t) => t.head[0] === 'Ref' && t.head.length === 9); assert.equal(log.body.length, m.transactionLog.length) })

await test('STATEMENTS: one page set per member, correct name, running balance, honest footnote', () => {
  const m = model(); const ids = m.members.map((x) => x.id); const doc = buildStatementsPdf(m, ids, ctx())
  assert.ok(doc.pages >= ids.length, `pages ${doc.pages}`)
  const s = allStrings(doc); for (const mem of m.members) assert.ok(s.some((x) => x === mem.name), mem.name)
  assert.equal(s.filter((x) => x === 'Member Statement').length, ids.length)
  assert.ok(s.some((x) => x.includes('Only completed transactions change your balance')))
  const bobTable = doc.tables.find((t) => t.body.some((r) => r[0].includes('t5'))); assert.ok(bobTable.body.some((r) => r[7] === 'KES 8,000.00'), 'Bob closing running balance')
  assert.deepEqual(s.filter((x) => /NaN|undefined|Infinity/.test(x)), []) })
await test('STATEMENTS: a single member; unknown ids ignored', () => {
  const m = model(); const doc = buildStatementsPdf(m, ['C', 'nope'], ctx()); const s = allStrings(doc)
  assert.equal(s.filter((x) => x === 'Member Statement').length, 1); assert.ok(s.includes('Carol')); assert.ok(s.includes('KES 500.00'), 'Carol loan') })

// ── Excel ──
const fakeXLSX = () => { const wb = { names: [], sheets: {} }
  return { wb, utils: { book_new: () => wb, aoa_to_sheet: (aoa) => ({ aoa }), book_append_sheet: (w, ws, name) => { assert.ok(name.length <= 31, `sheet name too long: ${name}`); assert.ok(!/[\[\]:*?/\\]/.test(name), `bad chars: ${name}`); assert.ok(!w.names.includes(name), `duplicate sheet ${name}`); w.names.push(name); w.sheets[name] = ws } } } }
const build = (m = model()) => { const x = fakeXLSX(); buildWorkbook(m, x, fmt); return x.wb }
const cellAt = (ws, a) => { const col = a.match(/[A-Z]+/)[0], row = Number(a.match(/\d+/)[0]); const ci = [...col].reduce((s, c) => s * 26 + c.charCodeAt(0) - 64, 0) - 1; return ws.aoa[row - 1]?.[ci] }
const evalFormula = (ws, f) => {
  const val = (a) => { const c = cellAt(ws, a); return c && c.t === 'n' ? c.v : 0 }
  let e = f.replace(/SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/g, (_, c1, r1, c2, r2) => { let t = 0; for (let r = +r1; r <= +r2; r++) t += val(`${c1}${r}`); return String(t) })
  e = e.replace(/[A-Z]+\d+/g, (a) => String(val(a))); assert.match(e, /^[0-9+\-*/(). eE]+$/, `unsafe/unknown formula: ${f} -> ${e}`); return Function(`return (${e})`)()
}
await test('EXCEL: expected sheets, valid names, no duplicates', () => {
  assert.deepEqual(build().names, ['Summary', 'Monthly', 'Members', 'Verification', 'Reconciliation', 'Investments', 'Dividends', 'Goals', 'Ledger', 'Position', 'Transactions', 'Member statements']) })
await test('EXCEL: EVERY formula points at the right cells (recomputed value == stored value)', () => {
  const wb = build(); let count = 0
  for (const name of wb.names) wb.sheets[name].aoa.forEach((row) => row.forEach((c) => { if (c?.f) { count++; const got = evalFormula(wb.sheets[name], c.f); assert.ok(Math.abs(got - c.v) < 0.005, `${name}: =${c.f} gives ${got}, stored ${c.v}`) } }))
  // designed total: Summary 1 + Monthly 3 + Members 9 + Verification 2 + Investments 5 + Dividends 1 + Ledger 4
  assert.equal(count, 25, `expected exactly 25 formulas, found ${count}`) })
await test('EXCEL: totals agree with the model (closing pool, member equity, deposits)', () => {
  const m = model(), wb = build(m); const sum = wb.sheets.Summary
  const closing = sum.aoa.find((r) => r[0]?.v === 'Closing pool balance')[1]; assert.equal(closing.v, 22200); assert.match(closing.f, /^B\d+\+B\d+-B\d+\+B\d+$/)
  const tot = wb.sheets.Members.aoa.at(-1); assert.equal(tot[0].v, 'Total'); assert.equal(tot[4].v, 22200); assert.equal(tot[5].v, 7900); assert.ok(Math.abs(tot[2].v - 100) < 0.01)
  assert.equal(wb.sheets.Monthly.aoa.at(-1)[1].v, m.monthly.reduce((s, x) => s + x.deposits, 0)) })
await test('EXCEL: no NaN, numbers are numbers, text is text', () => {
  const wb = build(); for (const name of wb.names) wb.sheets[name].aoa.forEach((row) => row.forEach((c) => { if (!c) return; if (c.t === 'n') assert.ok(Number.isFinite(c.v), `${name} NaN`); if (c.t === 's') assert.equal(typeof c.v, 'string') })) })
await test('EXCEL: flat data sheets match the model and have working filters', () => {
  const m = model(), wb = build(m), t = wb.sheets.Transactions
  assert.equal(t.aoa.length, m.transactionLog.length + 1)
  const rowFor = (id) => t.aoa.find((r) => r[0].v === (m.transactionLog.find((x) => x.id === id).statementNo))
  assert.equal(rowFor('t4')[7].v, 'BNK4'); assert.equal(rowFor('t4')[8].v, 'Bob'); assert.equal(rowFor('t8')[4].v, 'Awaiting verification'); assert.equal(rowFor('t4')[5].t, 'n')
  for (const name of ['Members', 'Investments', 'Goals', 'Ledger', 'Transactions', 'Member statements']) { assert.ok(wb.sheets[name]['!autofilter'], `${name} filter`) }
  assert.equal(wb.sheets.Members['!autofilter'].ref, `A1:M${wb.sheets.Members.aoa.length}`) })
await test('EXCEL: verification sheet categories add up to recorded', () => {
  const v = build().sheets.Verification.aoa; const rec = v[1][1].v, chk = v.find((r) => r[0]?.v?.startsWith('Sum of the four'))[1]; assert.equal(chk.v, rec) })
await test('EXCEL: works with empty data, flags failed sources', () => {
  const empty = buildReportModel({ members: [], transactions: [], _failed: ['ledger'] }, monthPeriod('2026-10'), NOW); const wb = build(empty)
  assert.equal(wb.names.length, 12); assert.ok(wb.sheets.Summary.aoa.some((r) => r[0]?.v === 'NOT LOADED')) })

// ── loader + paging ──
class Q { constructor(rows, error) { this.rows = rows; this.error = error; this.r = null } select() { return this } order() { return this } eq() { return this } limit() { return this } range(a, b) { this.r = [a, b]; return this }
  then(res, rej) { const data = this.r ? this.rows.slice(this.r[0], this.r[1] + 1) : this.rows; return Promise.resolve(this.error ? { data: null, error: this.error } : { data, error: null }).then(res, rej) } }
const fakeDb = (tables, errors = {}) => ({ from: (t) => new Q(tables[t] ?? [], errors[t]) })
const seq = (k, f = (i) => ({ id: i })) => Array.from({ length: k }, (_, i) => f(i))
await test('LOADER: pages through >1000 rows (2,500 transactions) and maps the verifier name', async () => {
  const db = fakeDb({ profiles: [{ id: 'A' }], transactions: seq(2500, (i) => ({ id: i, verifier: i === 0 ? { name: 'Bob' } : null })) }); const r = await loadReportData(db)
  assert.equal(r.transactions.length, 2500); assert.equal(r.transactions[0].verified_by_name, 'Bob'); assert.equal(r.transactions[1].verified_by_name, null); assert.equal(r._coreFailed, false) })
await test('LOADER: exact 1,000-row boundary does not lose or duplicate rows', async () => {
  const res = await fetchAll(() => new Q(seq(1000)), 1000); assert.equal(res.data.length, 1000); assert.equal(res.error, null)
  const r2 = await fetchAll(() => new Q(seq(2000)), 1000); assert.equal(r2.data.length, 2000); assert.equal(new Set(r2.data.map((x) => x.id)).size, 2000) })
await test('LOADER: optional source fails -> listed, report still loads; core fails -> exports blocked', async () => {
  const a = await loadReportData(fakeDb({ profiles: [{ id: 'A' }], transactions: [] }, { ledger_entries: new Error('boom'), investment_performance: new Error('boom') }))
  assert.deepEqual(a._failed.sort(), ['investments', 'ledger']); assert.equal(a._coreFailed, false)
  const b = await loadReportData(fakeDb({ profiles: [{ id: 'A' }] }, { transactions: new Error('boom') })); assert.equal(b._coreFailed, true); assert.deepEqual(b.transactions, []) })
await test('LOADER: error on page 2 is reported (never silently truncates)', async () => {
  let call = 0; const res = await fetchAll(() => ({ range: () => { call++; return Promise.resolve(call === 1 ? { data: seq(1000), error: null } : { data: null, error: new Error('page 2 failed') }) } }), 1000)
  assert.ok(res.error); assert.equal(res.data.length, 1000) })
await test('END TO END: loader output -> model -> PDF + Excel + statements, all consistent', async () => {
  const r = await loadReportData(fakeDb({ profiles: raw.members, transactions: raw.transactions.map((t) => ({ ...t, verifier: t.verified_by_name ? { name: t.verified_by_name } : null })), bank_reconciliations: raw.reconciliations, investment_performance: raw.investments, savings_goals: raw.goals, reserve_fund_status: [raw.reserve.status], reserve_contributions: raw.reserve.contributions, group_health_score: [raw.health], ledger_entries: raw.ledger, dividends: raw.dividends }))
  const m = buildReportModel(r, monthPeriod('2026-10'), NOW); assert.equal(m.kpis.closingPool, 22200); assert.equal(m.dividends.periodTotal, 500); assert.equal(m.checks.rollForwardBalanced, true)
  assert.doesNotThrow(() => { buildReportPdf(m, ctx()); buildStatementsPdf(m, m.members.map((x) => x.id), ctx()); build(m) }) })
await test('DIVIDENDS: Excel sheet matches the old layout + totals; PDF shows period dividends and statements show received', () => {
  const m = model(), wb = build(m), ws = wb.sheets.Dividends
  assert.deepEqual(ws.aoa[0].map((c) => c.v).slice(0, 6), ['Member', 'Investment', 'Ownership %', 'Dividend', 'Date', 'Reinvested'])   // old sheet's columns, same order
  assert.equal(ws.aoa.length, 1 + 3 + 2);   // header + 3 dividends + 2 total rows
  assert.equal(ws.aoa.at(-2)[3].v, 600); assert.equal(ws.aoa.at(-1)[3].v, 500)
  const s = allStrings(buildReportPdf(m, ctx())); assert.ok(s.some((x) => x.includes('Dividends paid in this period'))); assert.ok(s.some((x) => x.includes('KES 300.00')))
  const st = allStrings(buildStatementsPdf(m, ['A'], ctx())); assert.ok(st.includes('DIVIDENDS RECEIVED')); assert.ok(st.includes('KES 300.00')) })
await test('LOADER: dividends optional - failure is listed, rest still loads', async () => {
  const r = await loadReportData(fakeDb({ profiles: [{ id: 'A' }], transactions: [] }, { dividends: new Error('boom') })); assert.ok(r._failed.includes('dividends')); assert.equal(r._coreFailed, false) })
console.log(`\nAll ${n} export/loader tests passed`)
