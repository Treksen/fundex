# Phase-4 fixes (2 of 3)

This bundle contains the immediately-actionable fixes from the latest review.
**No migrations needed** — frontend only.

## 1. Back-fill list refreshes correctly

When the last back-fillable transaction is processed while "Show only these"
is on, the filter now auto-clears and the user returns to the full
transactions list. A short toast confirms: *"All caught up — showing the full list."*

**File:** `src/pages/TransactionsPage.jsx`

## 2. Ledger + Reconciliation visible to members (read-only)

Moved Ledger and Reconciliation out of the admin-only nav section and into
the common nav for everyone. The pages themselves were already designed for
view-only mode — every edit/delete/match button is wrapped in `{isAdmin && ...}`
checks, and the underlying RLS policies on `ledger_entries` and
`bank_reconciliations` already grant SELECT to all authenticated users.
So no migration is needed — purely a nav-link change.

What members see:
- The Ledger and Reconciliation menu items appear in their sidebar.
- They can browse all entries, filter, search.
- No Add/Edit/Delete/Match buttons are visible.

Admin-only items remaining: Audit Log, Settings.

**File:** `src/components/AppShell.jsx`

## 3. NOT YET DONE — Approvals column overhaul

Awaiting decisions on copy + visuals (asked in the chat). Will follow in
the next bundle once you've picked.
