# Monthly reports (PDF + Excel) — rebuilt

App version NOT changed (package.json and vite.config.js are not in this bundle).

## Files
New:      src/lib/reportPeriod.js, reportModel.js, reportPdf.js, reportExcel.js, reportLoader.js, fetchAll.js, public/logo-mark.png
Replaced: src/pages/ReportsPage.jsx   (whole file. If you edited it since v6, keep your copy aside first)
Tests:    tests/reports/  ->  run with:  node tests/reports/run.mjs

## The four fixes
1. Withdrawals now count COMPLETED withdrawals only (before, pending ones were included, so totals did not reconcile).
2. Every figure is for the chosen month, or "as at" the month end. Before, the date filter only changed the transaction list.
3. Deposits awaiting verification are shown (count, amount, oldest) instead of invisible.
4. Ownership % now uses the same formula as the rest of the app (positive equity / total positive equity).
   The old Reports page used net contribution / net pool, which could disagree with the Members page.

## What you asked for (items)
1  Header with logo, period, generated time          3  Balance roll-forward (opening + deposits - withdrawals +/- adjustments = closing, with a self-check)
5  Monthly activity table + chart (12 months)         7  Reserve fund: balance, target, % of target, movement in the month
8  Group health indicators                            9  Liquidity: invested vs not invested
10 Richer member table (ownership, equity, deposits, withdrawals, count, average, last deposit, loan, pending)
12 Member statements (one member, or all members in one PDF) with running balance, bank refs, ownership, dividends received
16 Transaction log with Deposit Ref, Bank Ref, verified by, status incl. awaiting verification / rejected
17 Verification summary (verified / awaiting / rejected, median hours to verify, oldest pending, deposits missing a bank ref)
20 Bank reconciliation (matched / unmatched, amount differences, deposits with no bank entry)
23 Portfolio summary   24 Investment performance table   27 Savings goals progress and pace-based ETA
29 Ledger summary and trial balance (Dr/Cr, balanced check)
30 Charts inside the PDF (drawn as vector shapes)   31 Better Excel (totals as real formulas, filters, column widths, flat data sheets)
33 Monthly email: NOT in this bundle (see below)

Also restored: the old Excel "Dividends" sheet (same columns), plus dividends in the PDF and on statements.

## Behaviour you should know
- Page: pick a month (defaults to the last completed month) or "All time". The custom from/to date range is gone, replaced by months.
- Everyone who can open Reports sees all of this, as today. Nothing is hidden by role.
- Reserve fund and group-health figures are "as at the day you generate the report", not the month end (the database only keeps current values). The PDF says so.
- "Currently invested / not invested" is an ESTIMATE: member equity pool minus capital in active/maturing investments. It is not a bank balance. The PDF says so.
- If an optional data source fails to load, the exports say "Not loaded: ..." and the page warns. If transactions or members fail, exports are switched off.
- All data is read in pages of 1,000 rows, so large groups do not get silently truncated totals.
- Excel limits (free SheetJS): no cell colours and no frozen header rows. Filters, widths, number formats and formulas work.

## Verified
49 automated checks pass: balances hand-calculated, month-boundary time zones (Nairobi), pending/rejected money excluded, an independent
re-implementation of your equity/ownership SQL, every month balancing and chaining, every Excel formula recomputed against its cells,
table column counts, page numbers, chart bounds, paging past 1,000 rows, partial failures, empty groups.
NOT verified: how the PDF LOOKS (jsPDF could not be installed here, so layout was tested with a recording stand-in), and anything in a real browser.
Please export one PDF and one Excel from real data and send them back so the layout can be tuned.
