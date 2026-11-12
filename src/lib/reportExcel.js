// Builds the Excel workbook from the report model. XLSX (SheetJS) is passed in so this can be tested.
// Numbers are real numbers, totals are real formulas, dates are ISO text (sort correctly, no time-zone surprises).
// The free SheetJS build cannot write cell colours or frozen panes, so those are not attempted.
const NUM = '#,##0.00', INT = '#,##0', PCT = '0.00"%"'
const pad = (n) => String(n).padStart(2, '0')
const dstr = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '')
const colLetter = (i) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const T = (v) => ({ t: 's', v: String(v ?? '') })
const N = (v, z = NUM) => ({ t: 'n', v: Number(v) || 0, z })
const F = (f, v, z = NUM) => ({ t: 'n', f, v: Number(v) || 0, z })
const status = (s) => ({ pending_verification: 'Awaiting verification', completed: 'Completed', pending: 'Pending', rejected: 'Rejected' }[s] || s)

function sheet(XLSX, rows, widths, filterCols = 0) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map((w) => ({ wch: w }))
  if (filterCols) ws['!autofilter'] = { ref: `A1:${colLetter(filterCols - 1)}${rows.length}` }
  return ws
}

export function buildWorkbook(model, XLSX, fmt) {
  const wb = XLSX.utils.book_new()
  const add = (name, ws) => XLSX.utils.book_append_sheet(wb, ws, name)
  const k = model.kpis, rf = model.rollForward, V = model.verification, R = model.reconciliation

  // Summary: roll-forward closing is a live formula
  const summary = [
    [T('Nitalink - Monthly Financial Report')], [T('Period'), T(model.meta.periodLabel)], [T('Generated'), T(fmt.dateTime(model.meta.generatedAt))],
  ]
  if (model.meta.failedSources.length) summary.push([T('NOT LOADED'), T(model.meta.failedSources.join(', '))])
  summary.push([])
  const rfStart = summary.length + 1 // 1-based row of the header
  summary.push([T('Balance roll-forward'), T('Amount')])
  summary.push([T('Opening pool balance'), N(rf.openingPool)])                     // rfStart+1
  summary.push([T('Deposits (completed)'), N(rf.deposits)])                         // +2
  summary.push([T('Withdrawals (completed)'), N(rf.withdrawals)])                   // +3
  summary.push([T('Adjustments'), N(rf.adjustments)])                               // +4
  const [o, d, w, a] = [1, 2, 3, 4].map((i) => `B${rfStart + i}`)
  summary.push([T('Closing pool balance'), F(`${o}+${d}-${w}+${a}`, rf.closingPool)]) // +5
  summary.push([T('Difference vs member equity (should be 0)'), N(rf.difference)])
  summary.push([])
  summary.push([T('Key figures'), T('Value')])
  summary.push(
    [T('Members'), N(k.memberCount, INT)], [T('Members who contributed'), N(k.activeContributors, INT)],
    [T('Deposits vs previous month (%)'), k.depositGrowthPct === null ? T('n/a') : N(k.depositGrowthPct, PCT)],
    [T('Deposits awaiting verification (count)'), N(k.awaitingVerification.count, INT)], [T('Deposits awaiting verification (amount)'), N(k.awaitingVerification.amount)],
    [T('Pending withdrawals (count)'), N(k.pendingWithdrawals.count, INT)], [T('Pending withdrawals (amount)'), N(k.pendingWithdrawals.amount)],
    [T('Capital in active / maturing investments'), N(model.liquidity.invested)], [T('Not invested (estimate)'), N(model.liquidity.notInvested)],
    [T('Share of pool invested (%)'), N(model.liquidity.investedPct, PCT)],
    [T('Reserve fund balance'), model.reserve.status ? N(model.reserve.status.currentBalance) : T('n/a')],
    [T('Reserve % of target'), model.reserve.status ? N(model.reserve.status.pctOfTarget, PCT) : T('n/a')],
  )
  add('Summary', sheet(XLSX, summary, [46, 20]))

  // Monthly
  const mRows = [['Month', 'Deposits', 'Withdrawals', 'Net', 'Closing balance'].map(T)]
  model.monthly.forEach((m) => mRows.push([T(m.label), N(m.deposits), N(m.withdrawals), N(m.net), N(m.closingBalance)]))
  const mLast = mRows.length
  mRows.push([T('Total'), F(`SUM(B2:B${mLast})`, model.monthly.reduce((s, m) => s + m.deposits, 0)), F(`SUM(C2:C${mLast})`, model.monthly.reduce((s, m) => s + m.withdrawals, 0)), F(`SUM(D2:D${mLast})`, model.monthly.reduce((s, m) => s + m.net, 0)), T('')])
  add('Monthly', sheet(XLSX, mRows, [12, 16, 16, 16, 18]))

  // Members
  const memHead = ['Member', 'Role', 'Ownership %', 'Opening equity', 'Closing equity', 'Deposits', 'Withdrawals', 'Adjustments', 'Deposit count', 'Average deposit', 'Last deposit', 'Loan balance', 'Pending withdrawals']
  const memRows = [memHead.map(T)]
  model.members.forEach((m) => memRows.push([T(m.name), T(m.role), N(m.ownershipPct, PCT), N(m.openingEquity), N(m.closingEquity), N(m.deposits), N(m.withdrawals), N(m.adjustments), N(m.depositCount, INT), N(m.avgDeposit), T(dstr(m.lastDepositDate)), N(m.loanBalance), N(m.pendingWithdrawals)]))
  const last = memRows.length
  const col = (i, key) => model.members.reduce((s, m) => s + m[key], 0)
  memRows.push([T('Total'), T(''), F(`SUM(C2:C${last})`, col(0, 'ownershipPct'), PCT), F(`SUM(D2:D${last})`, col(0, 'openingEquity')), F(`SUM(E2:E${last})`, col(0, 'closingEquity')), F(`SUM(F2:F${last})`, col(0, 'deposits')), F(`SUM(G2:G${last})`, col(0, 'withdrawals')), F(`SUM(H2:H${last})`, col(0, 'adjustments')), F(`SUM(I2:I${last})`, col(0, 'depositCount'), INT), T(''), T(''), F(`SUM(L2:L${last})`, col(0, 'loanBalance')), F(`SUM(M2:M${last})`, col(0, 'pendingWithdrawals'))])
  add('Members', sheet(XLSX, memRows, [22, 10, 13, 16, 16, 14, 14, 14, 13, 15, 13, 14, 18], memHead.length))

  // Verification
  const vRows = [['Measure', 'Count', 'Amount'].map(T)]
  const vb = (label, x) => vRows.push([T(label), N(x.count, INT), N(x.amount)])
  vb('Deposits recorded in period', V.recorded); vb('Verified with a bank reference', V.verified); vb('Completed without a bank reference', V.completedNoCode)
  vb('Awaiting verification', V.awaiting); vb('Rejected', V.rejected)
  vRows.push([T('Sum of the four categories (must equal recorded)'), F('SUM(B3:B6)', V.verified.count + V.completedNoCode.count + V.awaiting.count + V.rejected.count, INT), F('SUM(C3:C6)', V.verified.amount + V.completedNoCode.amount + V.awaiting.amount + V.rejected.amount)])
  vb('Older deposits still missing a bank reference (all time)', V.legacyMissingCode)
  vRows.push([], [T('Median hours to verify'), V.medianHoursToVerify === null ? T('n/a') : N(V.medianHoursToVerify, '0.0')], [T('Oldest awaiting verification (days)'), k.awaitingVerification.oldestDays === null ? T('none') : N(k.awaitingVerification.oldestDays, INT)])
  if (V.verifiedByVerifier.length) { vRows.push([], [T('Verified by'), T('Deposits')]); V.verifiedByVerifier.forEach((x) => vRows.push([T(x.name), N(x.count, INT)])) }
  add('Verification', sheet(XLSX, vRows, [52, 12, 18]))

  // Reconciliation (stacked sections)
  const rRows = [[T('Bank entries in period'), N(R.entries, INT)], [T('Matched'), N(R.matched, INT)], [T('Unmatched'), N(R.unmatched, INT)], [T('Other status'), N(R.other, INT)], [T('Total bank amount'), N(R.totalBankAmount)], [T('Completed deposits with no bank entry'), N(R.unreconciledDeposits.count, INT), N(R.unreconciledDeposits.amount)]]
  if (R.mismatches.length) { rRows.push([], [T('AMOUNT DIFFERENCES')], ['Bank date', 'Reference', 'Bank amount', 'Recorded', 'Difference'].map(T)); R.mismatches.forEach((x) => rRows.push([T(dstr(x.bankDate)), T(x.bankReference || ''), N(x.bankAmount), N(x.recordedAmount), N(x.variance)])) }
  if (R.unmatchedRows.length) { rRows.push([], [T('UNMATCHED BANK ENTRIES')], ['Bank date', 'Reference', 'Amount', 'Description'].map(T)); R.unmatchedRows.forEach((x) => rRows.push([T(dstr(x.bankDate)), T(x.bankReference || ''), N(x.bankAmount), T(x.description || '')])) }
  if (R.unreconciledDeposits.rows.length) { rRows.push([], [T('COMPLETED DEPOSITS WITH NO BANK ENTRY (first 50)')], ['Date', 'Member', 'Amount', 'Deposit ref'].map(T)); R.unreconciledDeposits.rows.forEach((x) => rRows.push([T(dstr(x.date)), T(x.member), N(x.amount), T(x.reference || '')])) }
  add('Reconciliation', sheet(XLSX, rRows, [40, 22, 16, 30, 16]))

  // Investments
  const iHead = ['Investment', 'Type', 'Status', 'Invested', 'Share %', 'Expected return', 'Actual return', 'ROI %', 'Net profit', 'Start', 'End', 'Dividends', 'Distributed']
  const iRows = [iHead.map(T)]
  model.investments.rows.forEach((i) => iRows.push([T(i.title), T(i.type), T(i.status), N(i.invested), N(i.sharePct, PCT), N(i.expectedReturn), i.actualReturn === null ? T('') : N(i.actualReturn), N(i.roiPct, PCT), N(i.netProfit), T(String(i.startDate || '').slice(0, 10)), T(String(i.endDate || '').slice(0, 10)), N(i.dividendCount, INT), N(i.totalDistributed)]))
  const iLast = iRows.length, I = model.investments
  iRows.push([T('Total'), T(''), T(''), F(`SUM(D2:D${iLast})`, I.totalInvested), T(''), F(`SUM(F2:F${iLast})`, I.rows.reduce((s, i) => s + i.expectedReturn, 0)), F(`SUM(G2:G${iLast})`, I.totalReturns), T(''), T(''), T(''), T(''), F(`SUM(L2:L${iLast})`, I.rows.reduce((s, i) => s + i.dividendCount, 0), INT), F(`SUM(M2:M${iLast})`, I.totalDistributed)])
  add('Investments', sheet(XLSX, iRows, [26, 16, 12, 14, 10, 16, 14, 9, 14, 12, 12, 11, 14], iHead.length))

  // Dividends (the old export had this sheet; kept)
  const dHead = ['Member', 'Investment', 'Ownership %', 'Dividend', 'Date', 'Reinvested', 'In report period', 'Notes']
  const dRows = [dHead.map(T)]
  model.dividends.rows.forEach((d) => dRows.push([T(d.member), T(d.investment), N(d.ownershipPct, PCT), N(d.amount), T(dstr(d.date)), T(d.reinvested ? 'Yes' : 'No'), T(d.inPeriod ? 'Yes' : 'No'), T(d.notes)]))
  const dLast = dRows.length
  dRows.push([T('Total (all time)'), T(''), T(''), F(`SUM(D2:D${dLast})`, model.dividends.allTimeTotal), T(''), T(''), T(''), T('')])
  dRows.push([T('Paid in this report period'), T(''), T(''), N(model.dividends.periodTotal), T(''), T(''), T(''), T('')])
  add('Dividends', sheet(XLSX, dRows, [22, 24, 13, 14, 12, 11, 15, 30], dHead.length))

  // Goals
  const gRows = [['Goal', 'Target', 'Progress %', 'Remaining', 'Target date', 'Months at current pace', 'On track?'].map(T)]
  model.goals.forEach((g) => gRows.push([T(g.title), N(g.target), N(g.progressPct, PCT), N(g.remaining), T(String(g.targetDate || '').slice(0, 10)), g.achieved ? T('Achieved') : g.monthsToTarget === null ? T('n/a') : N(g.monthsToTarget, INT), T(g.achieved ? 'Yes' : g.onTrack === null ? '-' : g.onTrack ? 'Yes' : 'No')]))
  add('Goals', sheet(XLSX, gRows, [28, 16, 12, 16, 13, 22, 11], 7))

  // Ledger
  const lHead = ['Account', 'Type', 'Period debit', 'Period credit', 'Total debit', 'Total credit', 'Balance', 'Dr/Cr']
  const lRows = [lHead.map(T)]
  model.ledger.rows.forEach((a) => lRows.push([T(a.name), T(a.type), N(a.debitPeriod), N(a.creditPeriod), N(a.debitTotal), N(a.creditTotal), N(a.balance), T(a.side)]))
  const lLast = lRows.length
  lRows.push([T('Total'), T(''), F(`SUM(C2:C${lLast})`, model.ledger.periodDebit), F(`SUM(D2:D${lLast})`, model.ledger.periodCredit), F(`SUM(E2:E${lLast})`, model.ledger.totalDebit), F(`SUM(F2:F${lLast})`, model.ledger.totalCredit), T(''), T('')])
  lRows.push([T('Trial balance'), T(model.ledger.rows.length ? (model.ledger.balanced ? 'Balanced' : 'OUT OF BALANCE') : 'No entries')])
  add('Ledger', sheet(XLSX, lRows, [28, 12, 15, 15, 15, 15, 15, 7], lHead.length))

  // Position (as at generation)
  const rs = model.reserve.status, h = model.health
  const pRows = [[T('Measure'), T('Value')],
    [T('Reserve balance'), rs ? N(rs.currentBalance) : T('n/a')], [T('Reserve target'), rs ? N(rs.targetBalance) : T('n/a')], [T('Reserve % of target'), rs ? N(rs.pctOfTarget, PCT) : T('n/a')], [T('Reserve status'), T(rs ? rs.healthStatus || '' : 'n/a')],
    [T('Reserve allocated in period'), N(model.reserve.periodAllocated)], [T('Reserve withdrawn in period'), N(model.reserve.periodWithdrawn)],
    [T('Risk level'), T(h ? h.riskLevel || '' : 'n/a')], [T('Savings strength'), h ? N(h.savingsStrength, INT) : T('n/a')], [T('Growth rate'), h ? N(h.growthRate, PCT) : T('n/a')],
    [T('Overdrawn members'), h ? N(h.overdrawnCount, INT) : T('n/a')], [T('Members near their limit'), h ? N(h.nearLimitCount, INT) : T('n/a')], [],
    [T(`Reserve and health figures are as at ${fmt.date(model.meta.generatedAt)}, not the period end.`)], [T(model.liquidity.note)]]
  add('Position', sheet(XLSX, pRows, [34, 22]))

  // Flat data sheets (pivot-friendly)
  const tHead = ['Ref', 'Date', 'Member', 'Type', 'Status', 'Amount', 'Deposit ref', 'Bank ref', 'Verified by', 'Verified at', 'Description']
  const tRows = [tHead.map(T)]
  model.transactionLog.forEach((t) => tRows.push([T(t.statementNo), T(dstr(t.date)), T(t.member), T(t.type), T(status(t.status)), N(t.amount), T(t.depositRef), T(t.bankRef), T(t.verifiedBy), T(t.verifiedAt ? dstr(new Date(t.verifiedAt)) : ''), T(t.description)]))
  add('Transactions', sheet(XLSX, tRows, [14, 12, 22, 12, 22, 14, 18, 18, 16, 12, 36], tHead.length))

  const sHead = ['Member', 'Ref', 'Date', 'Type', 'Status', 'Amount (signed)', 'Running balance', 'Deposit ref', 'Bank ref']
  const sRows = [sHead.map(T)]
  model.members.forEach((m) => model.statements[m.id].rows.forEach((r) => sRows.push([T(m.name), T(r.statementNo), T(dstr(r.date)), T(r.type), T(status(r.status)), r.signedAmount === null ? T('') : N(r.signedAmount), r.runningBalance === null ? T('') : N(r.runningBalance), T(r.depositRef), T(r.bankRef)])))
  add('Member statements', sheet(XLSX, sRows, [22, 14, 12, 12, 22, 16, 16, 18, 18], sHead.length))
  return wb
}
