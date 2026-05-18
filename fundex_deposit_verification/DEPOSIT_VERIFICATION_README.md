# Deposit Verification Workflow — Implementation Notes

This change introduces an admin-verification step between a member
recording a deposit and the deposit counting toward the group pool.

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/023_deposit_verification.sql` | **new** — adds columns, status value, `verify_deposit()` RPC, auto-reconciliation insert |
| `src/components/transactions/AddTransactionModal.jsx` | Deposits insert with `status='pending_verification'`. Ownership snapshot moved server-side. Admin-verifier notification added. Reference field label clarified. Info banner added. |
| `src/pages/TransactionsPage.jsx` | New `canVerifyDeposit()` / `isVerified()` / `handleVerifyDeposit()`. New status filter option. New "Verified" badge on rows. Inline verify panel (desktop + mobile). "Awaiting your verification" banner at top of page. Status label friendlier. |

## End-to-end flow

1. **Member records a deposit** (existing modal, unchanged fields):
   they type the M-Pesa / bank reference they got when sending the money
   into the existing **Bank Reference Code** field. On submit, the
   transaction is inserted with `status = 'pending_verification'`.
   *Equity is NOT yet updated*. Notifications go to the admin(s) (or to
   the other members, if the depositor is an admin) saying a deposit
   awaits verification.

2. **Admin sees the row on the Transactions page** with a "Verify"
   button. They click it, an inline panel appears showing the member's
   typed reference, and there's a field for the bank-generated
   verification code.

3. **Admin confirms in the bank account, types the bank code, hits
   Confirm Verify**. The frontend calls the `verify_deposit()` RPC,
   which:
   - Validates: must be a deposit, must be `pending_verification`,
     caller is not the depositor, role rules satisfied, bank code
     not duplicated.
   - Stamps `bank_verification_code`, `verified_at`, `verified_by`.
   - Flips `status` → `completed`. This triggers existing equity
     recalc, reserve auto-skim, ledger entries, and deposit-completed
     notifications — exactly as they did before.
   - Inserts an `ownership_snapshots` row.
   - Inserts a **matched** row into `bank_reconciliations` — the
     verified deposit appears on the reconciliation page automatically.
   - Writes an audit log entry.

4. **Member is notified** that their deposit was verified.

5. On the Transactions page the row now shows a green **✓ Verified**
   badge alongside the status badge, and hovering it shows the bank
   verification code and verifier timestamp.

## Dual control for admin's own deposits

If the depositor is an admin, the RPC refuses to let that same admin
verify their own deposit. **Any other member** (admin or non-admin) may
verify it. This satisfies the "if admin deposits, one member verifies"
requirement. The check is enforced inside the SQL RPC, since Supabase
RLS can't easily express "anyone except the depositor".

If the depositor is a regular member, only an **admin** may verify.

## Bank-code uniqueness

The RPC rejects any bank code that has already been used on another
transaction. This prevents copy-paste duplicate verifications.

## Backwards compatibility

- Existing transactions are untouched; they remain `completed` and
  continue to count as before.
- All existing views and RPCs filter by `status = 'completed'`, so
  `pending_verification` deposits simply do not appear in totals —
  no changes needed in members, ledger, equity, reports.
- The withdrawal-approval flow is unchanged.
- Adjustments (admin-only) continue to insert as `completed`.

## To apply

Run the migration in your Supabase SQL editor:

```
supabase/migrations/023_deposit_verification.sql
```

Then deploy the updated frontend (`src/components/transactions/AddTransactionModal.jsx`
and `src/pages/TransactionsPage.jsx`).
