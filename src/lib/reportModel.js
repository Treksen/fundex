// Pure report calculations: no React, no Supabase, no formatting. Everything the PDF, the Excel file and the
// Reports page show comes from buildReportModel(), so all three always agree.
//
// Money rules mirror the database views exactly (see member_equity_summary / ownership_percentages):
//   equity    = completed deposits - completed withdrawals + completed adjustments
//   ownership = max(0, equity) / sum of every member's max(0, equity)
//   loan      = max(0, -equity)

const DAY = 86400000
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100
const localDate = (s) => {            // 'YYYY-MM-DD...' -> local midnight (a calendar date has no time zone)
  if (!s) return null
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0)

export function buildReportModel(raw, period, now = new Date()) {
  const { start, end } = period
  const inP = (d) => d >= start && d < end
  const beforeStart = (d) => d < start
  const beforeEnd = (d) => d < end

  const members = raw.members || []
  const memberById = new Map(members.map((m) => [m.id, m]))
  const allTx = (raw.transactions || []).map((t) => ({ ...t, amount: num(t.amount), _date: new Date(t.transaction_date) }))
  const txs = allTx.filter((t) => memberById.has(t.user_id))
  const signed = (t) => (t.type === 'withdrawal' ? -t.amount : t.amount)
  const completed = txs.filter((t) => t.status === 'completed')

  // ── per-member figures ──────────────────────────────────────────────────────────────────────────
  const stat = new Map(members.map((m) => [m.id, {
    id: m.id, name: m.name, role: m.role, email: m.email,
    openingEquity: 0, closingEquity: 0, deposits: 0, withdrawals: 0, adjustments: 0,
    depositCount: 0, lastDeposit: null, pendingWithdrawals: 0,
  }]))
  for (const t of completed) {
    const s = stat.get(t.user_id)
    if (beforeStart(t._date)) s.openingEquity += signed(t)
    if (beforeEnd(t._date)) {
      s.closingEquity += signed(t)
      if (t.type === 'deposit' && (!s.lastDeposit || t._date > s.lastDeposit)) s.lastDeposit = t._date
    }
    if (inP(t._date)) {
      if (t.type === 'deposit') { s.deposits += t.amount; s.depositCount += 1 }
      else if (t.type === 'withdrawal') s.withdrawals += t.amount
      else s.adjustments += t.amount
    }
  }
  for (const t of txs) if (t.type === 'withdrawal' && t.status === 'pending') stat.get(t.user_id).pendingWithdrawals += t.amount

  const all = [...stat.values()]
  const positiveTotal = sum(all, (s) => Math.max(0, s.closingEquity))
  const memberRows = all.map((s) => ({
    id: s.id, name: s.name, role: s.role,
    openingEquity: r2(s.openingEquity), closingEquity: r2(s.closingEquity),
    deposits: r2(s.deposits), withdrawals: r2(s.withdrawals), adjustments: r2(s.adjustments),
    depositCount: s.depositCount, avgDeposit: s.depositCount ? r2(s.deposits / s.depositCount) : 0,
    lastDepositDate: s.lastDeposit,
    ownershipPct: positiveTotal > 0 ? Math.round((Math.max(0, s.closingEquity) / positiveTotal) * 1e6) / 1e4 : 0,
    loanBalance: r2(Math.max(0, -s.closingEquity)),
    pendingWithdrawals: r2(s.pendingWithdrawals),
  })).sort((a, b) => b.closingEquity - a.closingEquity)

  // ── balance roll-forward ───────────────────────────────────────────────────────────────────────
  const openingPool = r2(sum(all, (s) => s.openingEquity))
  const periodDeposits = r2(sum(all, (s) => s.deposits))
  const periodWithdrawals = r2(sum(all, (s) => s.withdrawals))
  const periodAdjustments = r2(sum(all, (s) => s.adjustments))
  const closingPool = r2(sum(all, (s) => s.closingEquity))
  const expectedClosing = r2(openingPool + periodDeposits - periodWithdrawals + periodAdjustments)
  const rollForward = {
    openingPool, deposits: periodDeposits, withdrawals: periodWithdrawals, adjustments: periodAdjustments,
    closingPool, difference: r2(closingPool - expectedClosing),
  }

  // ── last 12 months ending at the period's last month ───────────────────────────────────────────
  const endMonth = new Date(end.getTime() - 1)
  const monthly = []
  for (let i = 11; i >= 0; i--) {
    const ms = new Date(endMonth.getFullYear(), endMonth.getMonth() - i, 1)
    const me = new Date(endMonth.getFullYear(), endMonth.getMonth() - i + 1, 1)
    let dep = 0, wd = 0, adj = 0, bal = 0
    for (const t of completed) {
      if (t._date < me) bal += signed(t)
      if (t._date >= ms && t._date < me) {
        if (t.type === 'deposit') dep += t.amount
        else if (t.type === 'withdrawal') wd += t.amount
        else adj += t.amount
      }
    }
    monthly.push({
      key: `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}`,
      label: ms.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      deposits: r2(dep), withdrawals: r2(wd), net: r2(dep - wd + adj), closingBalance: r2(bal),
    })
  }

  // ── KPIs ───────────────────────────────────────────────────────────────────────────────────────
  let prevDeposits = null
  if (period.kind === 'month') {
    const ps = new Date(start.getFullYear(), start.getMonth() - 1, 1)
    prevDeposits = r2(sum(completed.filter((t) => t.type === 'deposit' && t._date >= ps && t._date < start), (t) => t.amount))
  }
  const awaiting = txs.filter((t) => t.type === 'deposit' && t.status === 'pending_verification')
  const oldestAwaiting = awaiting.length
    ? Math.min(...awaiting.map((t) => new Date(t.created_at || t.transaction_date).getTime())) : null
  const pendingW = txs.filter((t) => t.type === 'withdrawal' && t.status === 'pending')
  const kpis = {
    closingPool, openingPool, periodDeposits, periodWithdrawals, periodAdjustments,
    netMovement: r2(periodDeposits - periodWithdrawals + periodAdjustments),
    memberCount: members.length,
    activeContributors: all.filter((s) => s.deposits > 0).length,
    prevMonthDeposits: prevDeposits,
    depositGrowthPct: prevDeposits > 0 ? Math.round(((periodDeposits - prevDeposits) / prevDeposits) * 1e4) / 100 : null,
    awaitingVerification: {
      count: awaiting.length, amount: r2(sum(awaiting, (t) => t.amount)),
      oldestDays: oldestAwaiting === null ? null : Math.floor((now.getTime() - oldestAwaiting) / DAY),
    },
    pendingWithdrawals: { count: pendingW.length, amount: r2(sum(pendingW, (t) => t.amount)) },
  }

  // ── verification summary (deposits RECORDED in the period) ─────────────────────────────────────
  const dPeriod = txs.filter((t) => t.type === 'deposit' && inP(t._date))
  const bucket = (f) => { const a = dPeriod.filter(f); return { count: a.length, amount: r2(sum(a, (t) => t.amount)) } }
  const verifiedInPeriod = dPeriod.filter((t) => t.status === 'completed' && t.bank_verification_code)
  const hours = verifiedInPeriod
    .filter((t) => t.verified_at && t.created_at)
    .map((t) => (new Date(t.verified_at) - new Date(t.created_at)) / 3600000)
    .filter((h) => h >= 0 && h <= 720) // > 30 days = a back-filled legacy deposit, not a real verification time
  const byVerifier = {}
  for (const t of verifiedInPeriod) { const n = t.verified_by_name || 'Unknown'; byVerifier[n] = (byVerifier[n] || 0) + 1 }
  const legacy = completed.filter((t) => t.type === 'deposit' && !t.bank_verification_code)
  const verification = {
    recorded: bucket(() => true),
    verified: bucket((t) => t.status === 'completed' && t.bank_verification_code),
    completedNoCode: bucket((t) => t.status === 'completed' && !t.bank_verification_code),
    awaiting: bucket((t) => t.status === 'pending_verification'),
    rejected: bucket((t) => t.status === 'rejected'),
    medianHoursToVerify: median(hours) === null ? null : Math.round(median(hours) * 10) / 10,
    verifiedByVerifier: Object.entries(byVerifier).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    legacyMissingCode: { count: legacy.length, amount: r2(sum(legacy, (t) => t.amount)) },
  }

  // ── bank reconciliation ────────────────────────────────────────────────────────────────────────
  const recAll = (raw.reconciliations || []).map((r) => ({ ...r, bank_amount: num(r.bank_amount), _date: localDate(r.bank_date) }))
  const recP = recAll.filter((r) => r._date && inP(r._date))
  const countBy = (st) => recP.filter((r) => r.match_status === st).length
  const reconciledIds = new Set(recAll.map((r) => r.transaction_id).filter(Boolean))
  const unreconciled = completed.filter((t) => t.type === 'deposit' && inP(t._date) && !reconciledIds.has(t.id))
  const mismatches = recP.filter((r) => r.transactions && Math.abs(r.bank_amount - num(r.transactions.amount)) > 0.005)
    .map((r) => ({
      bankDate: r._date, bankReference: r.bank_reference, bankAmount: r2(r.bank_amount),
      recordedAmount: r2(r.transactions.amount), variance: r2(r.bank_amount - num(r.transactions.amount)),
    }))
  const reconciliation = {
    entries: recP.length, matched: countBy('matched'), unmatched: countBy('unmatched'),
    other: recP.length - countBy('matched') - countBy('unmatched'),
    totalBankAmount: r2(sum(recP, (r) => r.bank_amount)),
    mismatches,
    unmatchedRows: recP.filter((r) => r.match_status === 'unmatched').map((r) => ({
      bankDate: r._date, bankReference: r.bank_reference, bankAmount: r2(r.bank_amount), description: r.bank_description,
    })),
    unreconciledDeposits: {
      count: unreconciled.length, amount: r2(sum(unreconciled, (t) => t.amount)),
      rows: unreconciled.slice(0, 50).map((t) => ({ date: t._date, member: memberById.get(t.user_id).name, amount: t.amount, reference: t.reference })),
    },
  }

  // ── reserve, health, liquidity ─────────────────────────────────────────────────────────────────
  const rc = (raw.reserve?.contributions || []).filter((c) => inP(new Date(c.created_at)))
  const allocated = r2(sum(rc.filter((c) => c.direction === 'allocate'), (c) => num(c.amount)))
  const withdrawn = r2(sum(rc.filter((c) => c.direction === 'withdraw'), (c) => num(c.amount)))
  const rs = raw.reserve?.status
  const reserve = {
    status: rs ? {
      currentBalance: num(rs.current_balance), groupPoolBalance: num(rs.group_pool_balance), targetBalance: num(rs.target_balance),
      vsTarget: num(rs.vs_target), pctOfTarget: num(rs.pct_of_target), healthStatus: rs.health_status || null,
    } : null,
    periodAllocated: allocated, periodWithdrawn: withdrawn, periodNet: r2(allocated - withdrawn),
  }
  const h = raw.health
  const health = h ? {
    asAt: now, riskLevel: h.risk_level, savingsStrength: num(h.savings_strength), growthRate: num(h.growth_rate),
    memberCount: num(h.member_count), overdrawnCount: num(h.overdrawn_count), nearLimitCount: num(h.near_limit_count),
    activeInvestments: num(h.active_investments), pendingCount: num(h.pending_count),
  } : null

  const investRows = (raw.investments || []).map((i) => ({
    title: i.title, type: i.investment_type, invested: num(i.amount_invested), expectedReturn: num(i.expected_return),
    actualReturn: i.actual_return === null || i.actual_return === undefined ? null : num(i.actual_return),
    roiPct: num(i.roi_pct), netProfit: num(i.net_profit), status: i.computed_status || i.status,
    startDate: i.start_date, endDate: i.end_date, dividendCount: num(i.dividend_count), totalDistributed: num(i.total_distributed),
  }))
  const totalInvested = r2(sum(investRows, (i) => i.invested))
  const deployed = r2(sum(investRows.filter((i) => ['active', 'maturing'].includes(i.status)), (i) => i.invested))
  const investments = {
    rows: investRows.map((i) => ({ ...i, sharePct: totalInvested > 0 ? Math.round((i.invested / totalInvested) * 1e4) / 100 : 0 })),
    totalInvested, totalReturns: r2(sum(investRows, (i) => i.actualReturn || 0)),
    totalNetProfit: r2(sum(investRows.filter((i) => i.actualReturn !== null), (i) => i.netProfit)),
    totalDistributed: r2(sum(investRows, (i) => i.totalDistributed)),
    active: investRows.filter((i) => i.status === 'active').length,
    maturing: investRows.filter((i) => i.status === 'maturing').length,
    completed: investRows.filter((i) => i.status === 'completed').length,
  }
  const liquidity = {
    invested: deployed, notInvested: r2(closingPool - deployed),
    investedPct: closingPool > 0 ? Math.round((deployed / closingPool) * 1e4) / 100 : 0,
    note: 'Estimate: member equity pool minus capital currently in active or maturing investments. Not a bank balance.',
  }

  const divRows = (raw.dividends || []).map((d) => {
    const date = localDate(d.distribution_date)
    return { member: d.profiles?.name || '', memberId: d.user_id, investment: d.investments?.title || '', ownershipPct: num(d.ownership_percentage),
      amount: num(d.amount), date, reinvested: !!d.reinvested, notes: d.notes || '', inPeriod: !!date && inP(date) }
  }).sort((a, b) => (b.date || 0) - (a.date || 0))
  const divPeriod = divRows.filter((d) => d.inPeriod)
  const dividends = {
    rows: divRows, periodRows: divPeriod, periodCount: divPeriod.length, periodTotal: r2(sum(divPeriod, (d) => d.amount)),
    periodReinvested: r2(sum(divPeriod.filter((d) => d.reinvested), (d) => d.amount)), allTimeTotal: r2(sum(divRows, (d) => d.amount)),
  }

  // ── goals ──────────────────────────────────────────────────────────────────────────────────────
  const last3 = monthly.slice(-3)
  const avgMonthlyNet = r2(sum(last3, (m) => m.net) / 3)
  const goals = (raw.goals || []).map((g) => {
    const target = num(g.target_amount)
    const progressPct = target > 0 ? Math.min(Math.round((closingPool / target) * 1e4) / 100, 100) : 0
    const remaining = r2(Math.max(target - closingPool, 0))
    const achieved = target > 0 && closingPool >= target
    const monthsToTarget = achieved ? 0 : avgMonthlyNet > 0 ? Math.ceil(remaining / avgMonthlyNet) : null
    let onTrack = null
    if (g.target_date && !achieved) {
      if (monthsToTarget === null) onTrack = false
      else {
        const eta = new Date(endMonth.getFullYear(), endMonth.getMonth() + monthsToTarget + 1, 0)
        onTrack = eta <= localDate(g.target_date)
      }
    }
    return { title: g.title, target, targetDate: g.target_date, active: g.is_active !== false, progressPct, remaining, achieved, monthsToTarget, onTrack }
  })

  // ── ledger / trial balance ─────────────────────────────────────────────────────────────────────
  const acct = new Map()
  for (const e of raw.ledger || []) {
    const d = localDate(e.entry_date); if (!d || !beforeEnd(d)) continue
    const a = acct.get(e.account_name) || { name: e.account_name, type: e.account_type, debitPeriod: 0, creditPeriod: 0, debitCum: 0, creditCum: 0 }
    a.debitCum += num(e.debit); a.creditCum += num(e.credit)
    if (inP(d)) { a.debitPeriod += num(e.debit); a.creditPeriod += num(e.credit) }
    acct.set(e.account_name, a)
  }
  const ledgerRows = [...acct.values()].map((a) => {
    const bal = r2(a.debitCum - a.creditCum)
    return {
      name: a.name, type: a.type, debitPeriod: r2(a.debitPeriod), creditPeriod: r2(a.creditPeriod),
      debitTotal: r2(a.debitCum), creditTotal: r2(a.creditCum), balance: Math.abs(bal), side: bal >= 0 ? 'Dr' : 'Cr',
    }
  }).sort((a, b) => (b.debitTotal + b.creditTotal) - (a.debitTotal + a.creditTotal))
  const ledger = {
    rows: ledgerRows,
    totalDebit: r2(sum(ledgerRows, (a) => a.debitTotal)), totalCredit: r2(sum(ledgerRows, (a) => a.creditTotal)),
    periodDebit: r2(sum(ledgerRows, (a) => a.debitPeriod)), periodCredit: r2(sum(ledgerRows, (a) => a.creditPeriod)),
  }
  ledger.balanced = Math.abs(ledger.totalDebit - ledger.totalCredit) < 0.01

  // ── transaction log + per-member statements ────────────────────────────────────────────────────
  const logRow = (t) => ({
    id: t.id, date: t._date, statementNo: t.statement_no || String(t.id).slice(0, 8), member: memberById.get(t.user_id).name,
    memberId: t.user_id, type: t.type, status: t.status, amount: t.amount, depositRef: t.reference || '',
    bankRef: t.bank_verification_code || '', verifiedBy: t.verified_by_name || '', verifiedAt: t.verified_at || null,
    description: t.description || '',
  })
  const byDate = (a, b) => a._date - b._date || String(a.id).localeCompare(String(b.id))
  const transactionLog = txs.filter((t) => inP(t._date)).sort(byDate).map(logRow)
  const statements = {}
  for (const m of memberRows) {
    let running = m.openingEquity
    const rows = txs.filter((t) => t.user_id === m.id && inP(t._date)).sort(byDate).map((t) => {
      if (t.status === 'completed') running = r2(running + signed(t))
      return { ...logRow(t), signedAmount: t.status === 'completed' ? signed(t) : null, runningBalance: t.status === 'completed' ? running : null }
    })
    statements[m.id] = {
      member: m, openingBalance: m.openingEquity, closingBalance: m.closingEquity, rows,
      totals: { deposits: m.deposits, withdrawals: m.withdrawals, adjustments: m.adjustments, dividends: r2(sum(divPeriod.filter((d) => d.memberId === m.id), (d) => d.amount)) },
    }
  }

  const checks = {
    rollForwardBalanced: Math.abs(rollForward.difference) < 0.01,
    ownershipTotalsHundred: positiveTotal === 0 || Math.abs(sum(memberRows, (m) => m.ownershipPct) - 100) < 0.01,
    ledgerBalanced: ledger.rows.length ? ledger.balanced : null,
  }

  return {
    meta: { periodKey: period.key, periodKind: period.kind, periodLabel: period.label, start, end, generatedAt: now, orphanTransactions: allTx.length - txs.length, failedSources: raw._failed || [] },
    kpis, rollForward, monthly, members: memberRows, verification, reconciliation, reserve, health, liquidity,
    investments, dividends, goals, avgMonthlyNet, ledger, transactionLog, statements, checks,
  }
}
