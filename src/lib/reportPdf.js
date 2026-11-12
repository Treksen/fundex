// Builds the monthly PDF. jsPDF and jspdf-autotable are passed in (ctx.jsPDF / ctx.autoTable) instead of being
// imported here, so this file can be tested with recording fakes. Charts are drawn as vector shapes.
const COL = {
  olive: [74, 112, 24], navy: [27, 31, 122], pale: [227, 237, 203], ink: [27, 42, 18], muted: [95, 107, 85],
  rule: [217, 230, 188], red: [185, 28, 28], green: [22, 120, 70], amber: [180, 110, 10], stripe: [246, 249, 239],
}
const MARGIN = 14
const statusLabel = (s) => ({ pending_verification: 'Awaiting verification', completed: 'Completed', pending: 'Pending', rejected: 'Rejected' }[s] || s)
const pct = (n) => `${Number(n || 0).toFixed(2)}%`
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}.` : t }
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)))
const right = (...idx) => Object.fromEntries(idx.map((i) => [i, { halign: 'right' }]))
const cap = (rows, n) => rows.slice(0, n)

function create(ctx) {
  const doc = new ctx.jsPDF({ unit: 'mm', format: 'a4' })
  return { doc, ctx, fmt: ctx.fmt, W: doc.internal.pageSize.getWidth(), H: doc.internal.pageSize.getHeight(), y: 32 }
}
function header(st, title, subtitle) {
  const { doc, W, ctx } = st
  if (ctx.logo) { try { doc.addImage(ctx.logo, 'PNG', MARGIN, 9, 13, 13) } catch { /* the logo is optional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...COL.navy)
  doc.text('Nita', MARGIN + 16, 18)
  doc.setTextColor(...COL.olive); doc.text('link', MARGIN + 16 + doc.getTextWidth('Nita'), 18)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...COL.muted)
  doc.text('Group savings and investments', MARGIN + 16, 22.5)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...COL.olive)
  doc.text(title, W - MARGIN, 15, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...COL.muted)
  doc.text(subtitle, W - MARGIN, 20.5, { align: 'right' })
  doc.setDrawColor(...COL.olive); doc.setLineWidth(0.6); doc.line(MARGIN, 26, W - MARGIN, 26)
  st.y = 33
}
function ensureSpace(st, needed) {
  if (st.y + needed > st.H - 16) { st.doc.addPage(); st.y = 18 }
}
function section(st, title, needed = 34) {
  ensureSpace(st, needed)
  st.doc.setFont('helvetica', 'bold'); st.doc.setFontSize(11); st.doc.setTextColor(...COL.navy)
  st.doc.text(title, MARGIN, st.y)
  st.doc.setFillColor(...COL.olive); st.doc.rect(MARGIN, st.y + 1.6, 22, 0.8, 'F')
  st.y += 7
}
function note(st, text, color = COL.muted) {
  const lines = st.doc.splitTextToSize(text, st.W - 2 * MARGIN)
  ensureSpace(st, lines.length * 3.8 + 3)
  st.doc.setFont('helvetica', 'normal'); st.doc.setFontSize(7.5); st.doc.setTextColor(...color)
  st.doc.text(lines, MARGIN, st.y)
  st.y += lines.length * 3.8 + 2.5
}
function kpiCards(st, cards) {
  const cols = 4, gap = 3, h = 19
  const w = (st.W - 2 * MARGIN - gap * (cols - 1)) / cols
  ensureSpace(st, Math.ceil(cards.length / cols) * (h + gap))
  cards.forEach((c, i) => {
    const col = i % cols
    if (i && col === 0) st.y += h + gap
    const x = MARGIN + col * (w + gap)
    st.doc.setFillColor(255, 255, 255); st.doc.setDrawColor(...COL.rule); st.doc.setLineWidth(0.3)
    st.doc.roundedRect(x, st.y, w, h, 2, 2, 'FD')
    st.doc.setFont('helvetica', 'normal'); st.doc.setFontSize(7); st.doc.setTextColor(...COL.muted); st.doc.text(c.label, x + 3, st.y + 5.5)
    st.doc.setFont('helvetica', 'bold'); st.doc.setFontSize(11); st.doc.setTextColor(...(c.color || COL.ink)); st.doc.text(clip(c.value, 20), x + 3, st.y + 12.5)
    st.doc.setFont('helvetica', 'normal'); st.doc.setFontSize(6.5); st.doc.setTextColor(...COL.muted); st.doc.text(clip(c.sub || '', 34), x + 3, st.y + 16.5)
  })
  st.y += h + 7
}
function table(st, head, body, opts = {}) {
  st.ctx.autoTable(st.doc, {
    startY: st.y, head: [head], body, foot: opts.foot ? [opts.foot] : undefined, showFoot: opts.foot ? 'lastPage' : 'never',
    theme: 'striped', styles: { fontSize: opts.fontSize || 8, cellPadding: 1.6, textColor: COL.ink, lineColor: COL.rule },
    headStyles: { fillColor: COL.olive, textColor: 255, fontStyle: 'bold' }, footStyles: { fillColor: COL.pale, textColor: COL.ink, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COL.stripe }, margin: { left: MARGIN, right: MARGIN, bottom: 16 }, columnStyles: opts.columnStyles || {},
  })
  st.y = st.doc.lastAutoTable.finalY + 6
}
const kv = (st, rows) => table(st, ['Measure', 'Value'], rows, { columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } } })

function barChart(st, { labels, a, b, height = 46 }) {
  ensureSpace(st, height + 16)
  const { doc } = st
  const x0 = MARGIN + 11, w = st.W - 2 * MARGIN - 11, y0 = st.y + 5
  const max = Math.max(1, ...a.values, ...b.values)
  doc.setLineWidth(0.2); doc.setDrawColor(...COL.rule); doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...COL.muted)
  for (const f of [0, 0.5, 1]) { const yy = y0 + height - f * height; doc.line(x0, yy, x0 + w, yy); doc.text(compact(max * f), x0 - 1.5, yy + 1, { align: 'right' }) }
  const slot = w / labels.length, bw = slot * 0.32
  labels.forEach((lab, i) => {
    const bx = x0 + i * slot + slot * 0.14
    const ha = (a.values[i] / max) * height, hb = (b.values[i] / max) * height
    if (ha > 0) { doc.setFillColor(...a.color); doc.rect(bx, y0 + height - ha, bw, ha, 'F') }
    if (hb > 0) { doc.setFillColor(...b.color); doc.rect(bx + bw + 0.8, y0 + height - hb, bw, hb, 'F') }
    doc.setTextColor(...COL.muted); doc.text(lab, x0 + i * slot + slot / 2, y0 + height + 4, { align: 'center' })
  })
  doc.setFillColor(...a.color); doc.rect(x0, st.y, 3, 3, 'F'); doc.setTextColor(...COL.ink); doc.text(a.name, x0 + 4.5, st.y + 2.5)
  doc.setFillColor(...b.color); doc.rect(x0 + 32, st.y, 3, 3, 'F'); doc.text(b.name, x0 + 36.5, st.y + 2.5)
  st.y = y0 + height + 9
}
function hBars(st, items, color = COL.olive) {
  const trackW = 78
  items.forEach((it) => {
    ensureSpace(st, 8)
    st.doc.setFont('helvetica', 'normal'); st.doc.setFontSize(8); st.doc.setTextColor(...COL.ink); st.doc.text(clip(it.label, 30), MARGIN, st.y + 3.6)
    st.doc.setFillColor(...COL.pale); st.doc.rect(MARGIN + 54, st.y + 0.8, trackW, 3.6, 'F')
    const f = Math.max(0, Math.min(100, it.pct)) / 100
    if (f > 0) { st.doc.setFillColor(...(it.color || color)); st.doc.rect(MARGIN + 54, st.y + 0.8, trackW * f, 3.6, 'F') }
    st.doc.setTextColor(...COL.muted); st.doc.text(it.text, MARGIN + 54 + trackW + 3, st.y + 3.6)
    st.y += 6.5
  })
  st.y += 3
}
function footers(st, model) {
  const n = st.doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    st.doc.setPage(i); st.doc.setFont('helvetica', 'normal'); st.doc.setFontSize(7); st.doc.setTextColor(...COL.muted)
    st.doc.text(`Nitalink  |  ${model.meta.periodLabel}  |  Generated ${st.fmt.dateTime(model.meta.generatedAt)}`, MARGIN, st.H - 8)
    st.doc.text(`Page ${i} of ${n}`, st.W - MARGIN, st.H - 8, { align: 'right' })
  }
}
function warnings(st, model) {
  if (model.meta.failedSources.length) note(st, `Not loaded: ${model.meta.failedSources.join(', ')}. Sections that depend on them are incomplete.`, COL.red)
  if (model.meta.orphanTransactions) note(st, `${model.meta.orphanTransactions} transaction(s) belong to members that no longer exist and are excluded.`, COL.amber)
}

export function buildReportPdf(model, ctx) {
  const st = create(ctx), { fmt } = st
  const k = model.kpis, rf = model.rollForward, V = model.verification, R = model.reconciliation
  const asAt = fmt.date(model.meta.generatedAt)
  header(st, 'Monthly Financial Report', `${model.meta.periodLabel}  |  Generated ${fmt.dateTime(model.meta.generatedAt)}`)
  warnings(st, model)

  kpiCards(st, [
    { label: 'CLOSING POOL BALANCE', value: fmt.currency(k.closingPool), sub: `Opening ${fmt.currency(k.openingPool)}` },
    { label: 'DEPOSITS IN PERIOD', value: fmt.currency(k.periodDeposits), color: COL.green, sub: k.depositGrowthPct === null ? `${k.activeContributors} members contributed` : `${k.depositGrowthPct >= 0 ? '+' : ''}${k.depositGrowthPct}% vs last month` },
    { label: 'WITHDRAWALS IN PERIOD', value: fmt.currency(k.periodWithdrawals), color: COL.red, sub: `${k.pendingWithdrawals.count} pending (${fmt.currency(k.pendingWithdrawals.amount)})` },
    { label: 'NET MOVEMENT', value: fmt.currency(k.netMovement), sub: `Adjustments ${fmt.currency(k.periodAdjustments)}` },
    { label: 'AWAITING VERIFICATION', value: fmt.currency(k.awaitingVerification.amount), color: COL.amber, sub: `${k.awaitingVerification.count} deposit(s)${k.awaitingVerification.oldestDays === null ? '' : `, oldest ${k.awaitingVerification.oldestDays}d`}` },
    { label: 'MEMBERS', value: String(k.memberCount), sub: `${k.activeContributors} contributed this period` },
    { label: 'CURRENTLY INVESTED', value: fmt.currency(model.liquidity.invested), sub: `${pct(model.liquidity.investedPct)} of pool (estimate)` },
    { label: 'RESERVE FUND', value: model.reserve.status ? fmt.currency(model.reserve.status.currentBalance) : 'n/a', sub: model.reserve.status ? `${pct(model.reserve.status.pctOfTarget)} of target` : '' },
  ])

  section(st, 'Balance roll-forward')
  table(st, ['Line', 'Amount'], [
    ['Opening pool balance (start of period)', fmt.currency(rf.openingPool)],
    ['+ Deposits (completed)', fmt.currency(rf.deposits)],
    ['- Withdrawals (completed)', fmt.currency(rf.withdrawals)],
    ['+/- Adjustments', fmt.currency(rf.adjustments)],
  ], { foot: ['Closing pool balance (end of period)', fmt.currency(rf.closingPool)], columnStyles: right(1) })
  note(st, model.checks.rollForwardBalanced
    ? 'Check passed: the closing balance equals the sum of all member equity at the end of the period. Pending, awaiting-verification and rejected items are not counted.'
    : `Check FAILED: closing balance differs from member equity by ${fmt.currency(rf.difference)}. Do not rely on these figures until this is explained.`,
  model.checks.rollForwardBalanced ? COL.green : COL.red)

  section(st, 'Monthly activity (last 12 months)', 70)
  barChart(st, { labels: model.monthly.map((m) => m.label), a: { name: 'Deposits', color: COL.olive, values: model.monthly.map((m) => m.deposits) }, b: { name: 'Withdrawals', color: COL.navy, values: model.monthly.map((m) => m.withdrawals) } })
  table(st, ['Month', 'Deposits', 'Withdrawals', 'Net', 'Closing balance'],
    model.monthly.map((m) => [m.label, fmt.currency(m.deposits), fmt.currency(m.withdrawals), fmt.currency(m.net), fmt.currency(m.closingBalance)]), { columnStyles: right(1, 2, 3, 4) })

  section(st, 'Members', 50)
  table(st, ['Member', 'Own. %', 'Equity', 'Deposits', 'Withdrawn', '#', 'Avg dep.', 'Last deposit', 'Loan', 'Pending wd.'],
    model.members.map((m) => [`${m.name}${m.role === 'admin' ? ' (admin)' : ''}`, pct(m.ownershipPct), fmt.currency(m.closingEquity), fmt.currency(m.deposits), fmt.currency(m.withdrawals), m.depositCount, fmt.currency(m.avgDeposit), m.lastDepositDate ? fmt.date(m.lastDepositDate) : '-', fmt.currency(m.loanBalance), fmt.currency(m.pendingWithdrawals)]),
    { fontSize: 7, columnStyles: right(1, 2, 3, 4, 5, 6, 8, 9) })
  hBars(st, model.members.filter((m) => m.ownershipPct > 0).map((m) => ({ label: m.name, pct: m.ownershipPct, text: pct(m.ownershipPct) })))

  section(st, `Group position (as at ${asAt})`, 60)
  const rs = model.reserve.status
  kv(st, [
    ['Reserve fund balance', rs ? fmt.currency(rs.currentBalance) : 'n/a'], ['Reserve target', rs ? fmt.currency(rs.targetBalance) : 'n/a'],
    ['Reserve % of target', rs ? pct(rs.pctOfTarget) : 'n/a'], ['Reserve status', rs ? String(rs.healthStatus || '-') : 'n/a'],
    ['Reserve: allocated in period', fmt.currency(model.reserve.periodAllocated)], ['Reserve: withdrawn in period', fmt.currency(model.reserve.periodWithdrawn)],
    ['Pool balance (end of period)', fmt.currency(k.closingPool)], ['Capital in active / maturing investments', fmt.currency(model.liquidity.invested)],
    ['Not invested (estimate)', fmt.currency(model.liquidity.notInvested)], ['Share of pool invested', pct(model.liquidity.investedPct)],
  ])
  note(st, model.liquidity.note)
  if (model.health) kv(st, [
    ['Risk level', String(model.health.riskLevel || '-')], ['Savings strength', String(model.health.savingsStrength)], ['Growth rate', pct(model.health.growthRate)],
    ['Overdrawn members', String(model.health.overdrawnCount)], ['Members near their limit', String(model.health.nearLimitCount)], ['Items pending', String(model.health.pendingCount)],
  ])
  else note(st, 'Group health indicators were not available.', COL.amber)

  section(st, 'Deposit verification', 60)
  const b = (x) => `${x.count}  (${fmt.currency(x.amount)})`
  kv(st, [
    ['Deposits recorded in period', b(V.recorded)], ['Verified with a bank reference', b(V.verified)], ['Completed without a bank reference', b(V.completedNoCode)],
    ['Awaiting verification', b(V.awaiting)], ['Rejected', b(V.rejected)],
    ['Median time to verify', V.medianHoursToVerify === null ? 'n/a' : `${V.medianHoursToVerify} hours`],
    ['Oldest deposit still awaiting verification', k.awaitingVerification.oldestDays === null ? 'none' : `${k.awaitingVerification.oldestDays} days`],
    ['Older deposits still missing a bank reference (all time)', b(V.legacyMissingCode)],
  ])
  if (V.verifiedByVerifier.length) table(st, ['Verified by', 'Deposits'], V.verifiedByVerifier.map((v) => [v.name, v.count]), { columnStyles: right(1) })

  section(st, 'Bank reconciliation', 60)
  kv(st, [
    ['Bank entries in period', String(R.entries)], ['Matched', String(R.matched)], ['Unmatched', String(R.unmatched)], ['Other status', String(R.other)],
    ['Total bank amount', fmt.currency(R.totalBankAmount)], ['Amount differences found', String(R.mismatches.length)],
    ['Completed deposits with no bank entry', b(R.unreconciledDeposits)],
  ])
  if (R.mismatches.length) { note(st, 'Matched entries where the bank amount differs from the recorded amount:'); table(st, ['Bank date', 'Reference', 'Bank amount', 'Recorded', 'Difference'], cap(R.mismatches, 15).map((r) => [fmt.date(r.bankDate), r.bankReference || '-', fmt.currency(r.bankAmount), fmt.currency(r.recordedAmount), fmt.currency(r.variance)]), { columnStyles: right(2, 3, 4) }) }
  if (R.unmatchedRows.length) { note(st, 'Bank entries not matched to any transaction:'); table(st, ['Bank date', 'Reference', 'Amount', 'Description'], cap(R.unmatchedRows, 15).map((r) => [fmt.date(r.bankDate), r.bankReference || '-', fmt.currency(r.bankAmount), clip(r.description, 40)]), { columnStyles: right(2) }) }
  if (R.unreconciledDeposits.rows.length) { note(st, 'Completed deposits with no bank entry:'); table(st, ['Date', 'Member', 'Amount', 'Deposit ref'], cap(R.unreconciledDeposits.rows, 15).map((r) => [fmt.date(r.date), r.member, fmt.currency(r.amount), r.reference || '-']), { columnStyles: right(2) }) }

  section(st, 'Investments', 60)
  const iv = model.investments
  kv(st, [['Total invested', fmt.currency(iv.totalInvested)], ['Total returns received', fmt.currency(iv.totalReturns)], ['Net profit on completed', fmt.currency(iv.totalNetProfit)], ['Total distributed to members', fmt.currency(iv.totalDistributed)], ['Dividends paid in this period', `${model.dividends.periodCount}  (${fmt.currency(model.dividends.periodTotal)})`], ['Active / maturing / completed', `${iv.active} / ${iv.maturing} / ${iv.completed}`]])
  if (iv.rows.length) table(st, ['Investment', 'Type', 'Invested', 'Share', 'Expected', 'Actual', 'ROI', 'Status', 'Distributed'],
    iv.rows.map((i) => [clip(i.title, 22), clip(String(i.type || '').replace(/_/g, ' '), 14), fmt.currency(i.invested), pct(i.sharePct), fmt.currency(i.expectedReturn), i.actualReturn === null ? '-' : fmt.currency(i.actualReturn), pct(i.roiPct), i.status, fmt.currency(i.totalDistributed)]),
    { fontSize: 7, columnStyles: right(2, 3, 4, 5, 6, 8) })
  else note(st, 'No investments recorded.')
  if (model.dividends.periodRows.length) {
    note(st, 'Dividends paid in this period:')
    table(st, ['Date', 'Member', 'Investment', 'Ownership', 'Amount', 'Reinvested'],
      cap(model.dividends.periodRows, 25).map((d) => [fmt.date(d.date), clip(d.member, 20), clip(d.investment, 24), pct(d.ownershipPct), fmt.currency(d.amount), d.reinvested ? 'Yes' : 'No']), { columnStyles: right(3, 4) })
  }

  section(st, 'Savings goals', 50)
  if (model.goals.length) {
    hBars(st, model.goals.map((g) => ({ label: g.title, pct: g.progressPct, text: pct(g.progressPct), color: g.achieved ? COL.green : COL.olive })))
    table(st, ['Goal', 'Target', 'Remaining', 'Target date', 'Months at current pace', 'On track?'],
      model.goals.map((g) => [clip(g.title, 28), fmt.currency(g.target), fmt.currency(g.remaining), g.targetDate ? fmt.date(g.targetDate) : '-', g.achieved ? 'Achieved' : g.monthsToTarget === null ? 'n/a' : String(g.monthsToTarget), g.achieved ? 'Yes' : g.onTrack === null ? '-' : g.onTrack ? 'Yes' : 'No']), { columnStyles: right(1, 2, 4) })
    note(st, `Pace is the average net monthly movement of the last 3 months (${fmt.currency(model.avgMonthlyNet)}). Progress is measured against the pool balance at the end of the period.`)
  } else note(st, 'No savings goals set.')

  section(st, 'Ledger and trial balance', 60)
  if (model.ledger.rows.length) {
    table(st, ['Account', 'Type', 'Period Dr', 'Period Cr', 'Total Dr', 'Total Cr', 'Balance'],
      model.ledger.rows.map((a) => [clip(a.name, 26), a.type, fmt.currency(a.debitPeriod), fmt.currency(a.creditPeriod), fmt.currency(a.debitTotal), fmt.currency(a.creditTotal), `${fmt.currency(a.balance)} ${a.side}`]),
      { foot: ['Total', '', fmt.currency(model.ledger.periodDebit), fmt.currency(model.ledger.periodCredit), fmt.currency(model.ledger.totalDebit), fmt.currency(model.ledger.totalCredit), ''], fontSize: 7, columnStyles: right(2, 3, 4, 5, 6) })
    note(st, model.ledger.balanced ? 'Trial balance check passed: total debits equal total credits.' : `Trial balance check FAILED: debits ${fmt.currency(model.ledger.totalDebit)} vs credits ${fmt.currency(model.ledger.totalCredit)}.`, model.ledger.balanced ? COL.green : COL.red)
  } else note(st, 'No ledger entries up to the end of this period.')

  section(st, `Transaction log (${model.transactionLog.length})`, 40)
  if (model.transactionLog.length) table(st, ['Ref', 'Date', 'Member', 'Type', 'Status', 'Amount', 'Deposit ref', 'Bank ref', 'Verified by'],
    model.transactionLog.map((t) => [clip(t.statementNo, 12), fmt.date(t.date), clip(t.member, 16), t.type, statusLabel(t.status), fmt.currency(t.amount), clip(t.depositRef, 14), clip(t.bankRef, 14), clip(t.verifiedBy, 12)]),
    { fontSize: 6.5, columnStyles: right(5) })
  else note(st, 'No transactions in this period.')

  footers(st, model)
  return st.doc
}

export function buildStatementsPdf(model, memberIds, ctx) {
  const st = create(ctx), { fmt } = st
  const ids = memberIds.filter((id) => model.statements[id])
  ids.forEach((id, idx) => {
    if (idx) { st.doc.addPage() }
    const s = model.statements[id], m = s.member
    header(st, 'Member Statement', `${model.meta.periodLabel}  |  Generated ${fmt.dateTime(model.meta.generatedAt)}`)
    st.doc.setFont('helvetica', 'bold'); st.doc.setFontSize(13); st.doc.setTextColor(...COL.ink); st.doc.text(m.name, MARGIN, st.y)
    st.doc.setFont('helvetica', 'normal'); st.doc.setFontSize(8.5); st.doc.setTextColor(...COL.muted); st.doc.text(m.role === 'admin' ? 'Administrator' : 'Member', MARGIN, st.y + 5)
    st.y += 10
    kpiCards(st, [
      { label: 'OPENING BALANCE', value: fmt.currency(s.openingBalance) }, { label: 'DEPOSITS', value: fmt.currency(s.totals.deposits), color: COL.green },
      { label: 'WITHDRAWALS', value: fmt.currency(s.totals.withdrawals), color: COL.red }, { label: 'ADJUSTMENTS', value: fmt.currency(s.totals.adjustments) },
      { label: 'CLOSING BALANCE', value: fmt.currency(s.closingBalance) }, { label: 'OWNERSHIP SHARE', value: pct(m.ownershipPct), sub: 'Of the group pool' },
      { label: 'LOAN BALANCE', value: fmt.currency(m.loanBalance), color: m.loanBalance > 0 ? COL.red : COL.ink }, { label: 'PENDING WITHDRAWALS', value: fmt.currency(m.pendingWithdrawals) },
      { label: 'DIVIDENDS RECEIVED', value: fmt.currency(s.totals.dividends), sub: 'Paid in this period' },
    ])
    section(st, 'Transactions', 30)
    if (s.rows.length) table(st, ['Ref', 'Date', 'Type', 'Deposit ref', 'Bank ref', 'Status', 'Amount', 'Balance'],
      s.rows.map((r) => [clip(r.statementNo, 12), fmt.date(r.date), r.type, clip(r.depositRef, 14), clip(r.bankRef, 14), statusLabel(r.status), fmt.currency(r.signedAmount === null ? r.amount : r.signedAmount), r.runningBalance === null ? '-' : fmt.currency(r.runningBalance)]),
      { fontSize: 7, columnStyles: right(6, 7) })
    else note(st, 'No transactions in this period.')
    note(st, 'Only completed transactions change your balance. Deposits awaiting verification, pending withdrawals and rejected items are listed for information and are not counted.')
  })
  footers(st, model)
  return st.doc
}
