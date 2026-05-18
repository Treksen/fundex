# Phase-4 fixes — complete

All three issues addressed. No DB migrations needed — frontend only.

## 1. Back-fill list refreshes correctly

When the last back-fillable transaction is processed while "Show only these"
is on, the filter auto-clears and the user returns to the full transactions
list. A short toast confirms: *"All caught up — showing the full list."*

**File:** `src/pages/TransactionsPage.jsx`

## 2. Ledger + Reconciliation visible to members (read-only)

Moved Ledger and Reconciliation out of the admin-only nav section into the
common nav. The pages were already correctly designed for view-only mode
(edit/delete buttons gated by `isAdmin`, autoMatch/matchEntry short-circuit
with `if (!isAdmin) return`). RLS policies on `ledger_entries` and
`bank_reconciliations` already grant SELECT to all authenticated users.

Admin-only nav items remaining: Audit Log, Settings.

**File:** `src/components/AppShell.jsx`

## 3. Approvals column overhaul

Single column now describes the full verification + approval state of every
row using small badges:

### Deposits
| Status                           | Badge                  | Kind  |
|----------------------------------|------------------------|-------|
| `pending_verification`           | Awaiting Verification  | amber |
| `completed` + bank code present  | Approved & Verified    | green |
| `completed`, no bank code (legacy) | Counted, Unverified  | amber |
| `rejected`                       | Rejected               | red   |

### Withdrawals
| Status      | Badge          | Kind  |
|-------------|----------------|-------|
| `pending`   | Pending Votes  | amber |
| `completed` | Approved       | green |
| `rejected`  | Rejected       | red   |

### Adjustments
| Status      | Badge    | Kind  |
|-------------|----------|-------|
| `completed` | Approved | green |

### Other notes
- For withdrawals pending votes, the small voter-avatar pile + "n/m"
  fraction is preserved BELOW the badge, since the per-voter context is
  still useful at a glance.
- The old standalone "✓ Verified" badge in the Status column has been
  **removed** as requested — the Status column now shows just the literal
  status (completed / awaiting verification / pending / rejected), and
  all verification info lives in the Approvals column.
- Tooltip on the Approved & Verified badge shows the bank reference and
  verification timestamp.
- "Counted, Unverified" makes it explicit that the legacy deposit is in
  the pool but still needs a bank code — pairs with the existing back-fill
  banner + Add Code button.
- Column widened slightly (100 → 130 px) to accommodate longer labels.

Mobile cards also use the same badge sequence in the meta strip below the
amount.

**File:** `src/pages/TransactionsPage.jsx`
