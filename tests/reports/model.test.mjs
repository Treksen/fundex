process.env.TZ = 'Africa/Nairobi'
import assert from 'node:assert/strict'
import { buildReportModel } from './reportModel.mjs'
import { monthPeriod, allTimePeriod, listMonthKeys, lastCompletedMonthKey } from './reportPeriod.mjs'
import { raw, members, transactions } from './fixtures.mjs'
const NOW = new Date('2026-11-07T07:00:00+03:00')
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`)
let n = 0; const test = (name, fn) => { fn(); console.log('PASS', ++n, name) }
const M = buildReportModel(raw, monthPeriod('2026-10'), NOW)

test('time zone: 00:30 Nairobi on 1 Oct is October, 00:30 on 1 Nov is NOT', () => {
  assert.equal(M.kpis.periodDeposits, 7900)               // 4000 + 3000 + 900 (t13 in, t12 out)
})
test('roll-forward: opening 17,000 + 7,900 - 2,500 - 200 = closing 22,200', () => {
  assert.deepEqual([M.rollForward.openingPool, M.rollForward.deposits, M.rollForward.withdrawals, M.rollForward.adjustments, M.rollForward.closingPool], [17000, 7900, 2500, -200, 22200])
  assert.equal(M.rollForward.difference, 0); assert.equal(M.checks.rollForwardBalanced, true)
})
test('pending / pending_verification / rejected money is never counted', () => {
  assert.equal(M.kpis.periodWithdrawals, 2500)             // t7 (1,000 pending) excluded
  assert.equal(M.members.find((m) => m.id === 'D').closingEquity, 0)   // t8 awaiting verification
  assert.equal(M.members.find((m) => m.id === 'B').closingEquity, 8000) // t10 rejected, t12 after period
})
test('members: equity, ownership (app formula), loan, counts', () => {
  const by = (id) => M.members.find((m) => m.id === id)
  assert.deepEqual([by('A').closingEquity, by('B').closingEquity, by('C').closingEquity], [14700, 8000, -500])
  near(by('A').ownershipPct, 64.7577, 0.001); near(by('B').ownershipPct, 35.2423, 0.001)
  assert.equal(by('C').ownershipPct, 0); assert.equal(by('C').loanBalance, 500)
  assert.deepEqual([by('A').deposits, by('A').depositCount, by('A').avgDeposit], [4900, 2, 2450])
  assert.equal(by('B').pendingWithdrawals, 1000)
  assert.equal(M.checks.ownershipTotalsHundred, true)
  assert.equal(M.members[0].id, 'A')                       // sorted by equity desc
})
test('monthly series: 12 months, correct sums, closing balances chain', () => {
  assert.equal(M.monthly.length, 12); assert.equal(M.monthly[11].key, '2026-10'); assert.equal(M.monthly[0].key, '2025-11')
  const oct = M.monthly[11], sep = M.monthly[10], aug = M.monthly[9]
  assert.deepEqual([oct.deposits, oct.withdrawals, oct.net, oct.closingBalance], [7900, 2500, 5200, 22200])
  assert.deepEqual([sep.deposits, sep.closingBalance, aug.deposits, aug.closingBalance], [7000, 17000, 10000, 10000])
})
test('KPIs: growth vs previous month, awaiting verification, pending withdrawals', () => {
  assert.equal(M.kpis.prevMonthDeposits, 7000); near(M.kpis.depositGrowthPct, 12.86)
  assert.deepEqual([M.kpis.awaitingVerification.count, M.kpis.awaitingVerification.amount, M.kpis.awaitingVerification.oldestDays], [1, 1500, 12])
  assert.deepEqual(M.kpis.pendingWithdrawals, { count: 1, amount: 1000 })
  assert.equal(M.kpis.activeContributors, 2)
})
test('verification: buckets, median hours (excludes un-timed), legacy count', () => {
  const v = M.verification
  assert.deepEqual([v.recorded.count, v.verified.count, v.completedNoCode.count, v.awaiting.count, v.rejected.count], [5, 2, 1, 1, 1])
  assert.deepEqual([v.verified.amount, v.completedNoCode.amount, v.awaiting.amount, v.rejected.amount], [7000, 900, 1500, 700])
  assert.equal(v.medianHoursToVerify, 7)
  assert.deepEqual(v.legacyMissingCode, { count: 3, amount: 6700 })   // t2 + t13 + t12 (all time)
  assert.deepEqual(v.verifiedByVerifier.map((x) => x.name).sort(), ['Alice', 'Bob'])
})
test('reconciliation: only October rows, variance flagged, unreconciled deposits found', () => {
  const r = M.reconciliation
  assert.deepEqual([r.entries, r.matched, r.unmatched, r.other, r.totalBankAmount], [4, 3, 1, 0, 10800])
  assert.equal(r.mismatches.length, 1); assert.equal(r.mismatches[0].variance, 100)
  assert.deepEqual([r.unreconciledDeposits.count, r.unreconciledDeposits.amount], [1, 900])
  assert.equal(r.unmatchedRows[0].bankAmount, 1200)
})
test('reserve: period movement only', () => {
  assert.deepEqual([M.reserve.periodAllocated, M.reserve.periodWithdrawn, M.reserve.periodNet], [500, 200, 300]); assert.equal(M.reserve.status.pctOfTarget, 50)
})
test('liquidity + investments: active+maturing counts as deployed', () => {
  assert.deepEqual([M.liquidity.invested, M.liquidity.notInvested, M.liquidity.investedPct], [10000, 12200, 45.05])
  assert.deepEqual([M.investments.totalInvested, M.investments.totalReturns, M.investments.totalNetProfit, M.investments.active, M.investments.maturing, M.investments.completed], [15000, 5500, 500, 1, 1, 1])
  near(M.investments.rows[0].sharePct, 53.33)
})
test('goals: progress vs pool, pace-based ETA, achieved goal', () => {
  const [g1, g2] = M.goals
  assert.deepEqual([g1.progressPct, g1.remaining, g1.achieved], [50, 22200, false]); assert.equal(M.avgMonthlyNet, 7400)
  assert.deepEqual([g1.monthsToTarget, g1.onTrack], [3, true])
  assert.deepEqual([g2.progressPct, g2.achieved, g2.monthsToTarget], [100, true, 0])
})
test('ledger: after-period entries excluded, trial balance balanced, Dr/Cr', () => {
  const cash = M.ledger.rows.find((r) => r.name === 'Cash'), eq = M.ledger.rows.find((r) => r.name === 'Member Equity')
  assert.deepEqual([cash.debitTotal, cash.debitPeriod, cash.balance, cash.side], [12000, 7000, 12000, 'Dr'])
  assert.deepEqual([eq.creditTotal, eq.balance, eq.side], [12000, 12000, 'Cr']); assert.equal(M.ledger.balanced, true)
})
test('transaction log: October only, all statuses, verification columns', () => {
  const ids = M.transactionLog.map((t) => t.id)
  assert.deepEqual(ids, ['t13', 't4', 't5', 't6', 't7', 't8', 't9', 't10'])   // by date; t12 (1 Nov local) and t11 excluded
  const t4 = M.transactionLog.find((t) => t.id === 't4'); assert.deepEqual([t4.depositRef, t4.bankRef, t4.verifiedBy], ['REF-t4', 'BNK4', 'Bob'])
})
test('member statement: running balance chains, pending rows have no balance', () => {
  const s = M.statements.B
  assert.deepEqual([s.openingBalance, s.closingBalance], [5000, 8000])
  const rows = s.rows.map((r) => [r.id, r.runningBalance]); assert.deepEqual(rows, [['t5', 8000], ['t7', null], ['t10', null]])
  const a = M.statements.A.rows.filter((r) => r.runningBalance !== null)
  assert.equal(a[a.length - 1].runningBalance, M.statements.A.closingBalance)
})
test('INDEPENDENT CHECK: matches an SQL-style re-implementation of member_equity_summary / ownership_percentages', () => {
  const cutoff = monthPeriod('2026-10').end
  const eq = {}; for (const m of members) eq[m.id] = 0
  for (const t of transactions) if (t.status === 'completed' && new Date(t.transaction_date) < cutoff) eq[t.user_id] += t.type === 'withdrawal' ? -t.amount : t.amount
  const grand = Object.values(eq).reduce((s, v) => s + Math.max(0, v), 0)
  for (const m of M.members) { near(m.closingEquity, eq[m.id]); near(m.ownershipPct, grand ? (Math.max(0, eq[m.id]) / grand) * 100 : 0, 0.0001) }
})
test('PROPERTY: for every month, roll-forward balances and months chain (closing = next opening)', () => {
  const keys = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']
  let prevClose = null
  for (const k of keys) {
    const m = buildReportModel(raw, monthPeriod(k), NOW)
    assert.equal(m.checks.rollForwardBalanced, true, k); assert.equal(m.checks.ownershipTotalsHundred, true, k)
    if (prevClose !== null) assert.equal(m.rollForward.openingPool, prevClose, `${k} opening = previous closing`)
    prevClose = m.rollForward.closingPool
  }
})
test('all-time period + month list + default month', () => {
  const first = new Date('2026-08-15T10:00:00+03:00')
  const all = buildReportModel(raw, allTimePeriod(first, NOW), NOW)
  assert.equal(all.rollForward.openingPool, 0); assert.equal(all.kpis.depositGrowthPct, null); assert.equal(all.checks.rollForwardBalanced, true)
  assert.deepEqual(listMonthKeys(first, NOW), ['2026-11', '2026-10', '2026-09', '2026-08']); assert.equal(lastCompletedMonthKey(NOW), '2026-10')
  assert.equal(lastCompletedMonthKey(new Date('2027-01-05T10:00:00+03:00')), '2026-12')
})
test('robust to empty / messy data (no crash, no NaN)', () => {
  const e = buildReportModel({ members: [], transactions: [] }, monthPeriod('2026-10'), NOW)
  assert.equal(e.kpis.closingPool, 0); assert.equal(e.checks.ledgerBalanced, null)
  const messy = buildReportModel({ members, transactions: [{ id: 'z', user_id: 'A', type: 'deposit', amount: 'abc', status: 'completed', transaction_date: '2026-10-05T10:00:00+03:00' }, { id: 'q', user_id: 'GHOST', type: 'deposit', amount: 5, status: 'completed', transaction_date: '2026-10-05T10:00:00+03:00' }] }, monthPeriod('2026-10'), NOW)
  assert.equal(messy.kpis.periodDeposits, 0); assert.equal(messy.meta.orphanTransactions, 1)
  assert.ok(!JSON.stringify(M).includes('NaN') && !JSON.stringify(M).includes('Infinity'))
})
test('out-of-balance ledger is detected', () => {
  const bad = buildReportModel({ ...raw, ledger: [{ entry_date: '2026-10-05', account_name: 'Cash', account_type: 'asset', debit: 100, credit: 0 }] }, monthPeriod('2026-10'), NOW)
  assert.equal(bad.checks.ledgerBalanced, false)
})
test('dividends: only in-period rows counted, reinvested split, per-member totals on statements', () => {
  const d = M.dividends
  assert.deepEqual([d.rows.length, d.periodCount, d.periodTotal, d.periodReinvested, d.allTimeTotal], [3, 2, 500, 200, 600])
  assert.deepEqual([M.statements.A.totals.dividends, M.statements.B.totals.dividends, M.statements.C.totals.dividends], [300, 200, 0])
  assert.equal(d.rows[0].date.getDate(), 14)   // newest first
})
console.log(`\nAll ${n} model tests passed`)
