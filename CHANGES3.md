# Reconciliation page — proper table layout

## Root cause of the "stacked in one column" look

The Reconciliation page had a desktop table already built, but its container was hard-coded `display: 'none'`. Every screen size was getting the mobile card view — which is why everything looked stacked. The fix is to turn the desktop table on and toggle it against the mobile card view at the same 768px breakpoint the rest of the app uses.

## What changed

### `src/pages/BankReconciliationPage.jsx`
- Removed the hard-coded `display: 'none'` on the desktop table container, gave it the new class `recon-table-view`.
- Renamed the mobile card wrapper to `mobile-recon-list` / `mobile-recon-card` so it follows the established responsive pattern (matching `tx-table-view` / `mobile-tx-card` and `audit-table-view` / `mobile-audit-card`).
- Re-ordered and re-spaced the columns: **Bank Date · Amount · Deposit Ref · Bank Ref · Status · Matched To · Description · Actions**. Description moved to the end since it's the least-scanned field; Deposit Ref + Bank Ref sit side by side as their own columns; Status badge gets its own narrow column; Matched To shows the amount on top and member name beneath (two short lines, not a comma-joined run-on); inline Match dropdown gets a Cancel button.
- All "—" placeholders use muted text consistently.

### `src/styles/main.css`
- New rules for `.recon-table-view` (header styling, hover stripe, sticky header, consistent cell padding) and `.mobile-recon-card`.
- Added the 768px media query rule so the table shows on desktop and the cards show on mobile.

## Result

Desktop users now see a clean, scannable table with one piece of data per column. Mobile users still get the existing card layout. No data was changed — purely presentation.

## Apply

Drop both files into your tree and redeploy. No DB migration. No other files affected.
