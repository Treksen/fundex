# Deposit Verification — Full Implementation Notes

This bundle delivers the complete admin-verification workflow for FundEx deposits, including back-fill of historical data, side-by-side reference display, and notifications/emails through the existing Resend pipeline.

## Files in this delivery

| File | Status | Change |
|------|--------|--------|
| `supabase/migrations/023_deposit_verification.sql` | new | Columns, `pending_verification` status, `verify_deposit()` RPC, auto-reconciliation insert |
| `supabase/migrations/024_backfill_deposit_verification.sql` | new | `backfill_deposit_verification()` RPC for legacy deposits |
| `supabase/migrations/025_verification_notifications.sql` | new | DB triggers for verifier-fan-out + verifier-aware deposit-completed messages |
| `supabase/migrations/026_backfill_notifications.sql` | new | DB trigger for back-fill notifications (fires on `bank_verification_code` NULL→non-null on completed deposits) |
| `supabase/migrations/027_members_can_backfill_admin.sql` | new | Relaxes `backfill_deposit_verification` so members can back-fill admin deposits (mirrors verify_deposit rule). Seeds a rollup notification for every member with un-back-filled admin deposits pending. |
| `src/components/transactions/AddTransactionModal.jsx` | updated | Deposits start as `pending_verification`. Verifier notifications moved to DB trigger. |
| `src/pages/TransactionsPage.jsx` | updated | Verify/back-fill UI. Side-by-side **Deposit Ref** + **Bank Ref** columns. Banners. Verified badge. |
| `src/pages/BankReconciliationPage.jsx` | updated | New **Deposit Ref** column shown next to **Bank Ref** on desktop and mobile. |

## What you'll see in the app

### Transactions page

The "Reference" column is now **"Refs"** and stacks two values in each row:

- **Dep: SLK5XB9PQ2** — the M-Pesa/bank code the depositor typed in. Neutral styling.
- **Bank: ✓ BNK-2026-04-871234** — the bank-side verification code added by the admin. Green ✓ accent if present, dash if missing.

The same pair is shown on mobile cards.

### Bank Reconciliation page

The "Reference" column is now split into two columns:

- **Deposit Ref** — pulled from the matched transaction's `reference`.
- **Bank Ref** — the `bank_reference` on the reconciliation entry, styled with the green ✓ when present.

Mobile cards now show both refs in a compact strip under the date.

## Notifications & emails — who gets what

The app already has an Edge Function (`send-email-notification`) that fires on every `notifications` INSERT and pushes an email via Resend, respecting `profiles.email_notifications_enabled`. We piggyback on this — every notification we insert into the table is automatically emailed.

| Event | In-app notification | Email | Recipients |
|-------|--------|--------|------------|
| Member records a new deposit | ✓ | ✓ | The verifier(s) — admins (or other members, if depositor is an admin) |
| Deposit gets verified | ✓ | ✓ | Depositor gets "✅ Your Deposit Verified" with verifier name + bank ref; everyone else gets "💰 X's deposit verified" with bank ref |
| Admin back-fills bank code on old deposit | ✓ | ✓ | Depositor gets "🧾 Bank Reference Added to Your Deposit"; everyone else gets "🧾 Bank Reference Back-filled". Messages explicitly say "no change to balances — record-keeping only" so people don't think the pool changed. |

Implemented entirely by DB triggers in migration 025 so it can't be skipped by frontend bugs:

- `trg_pending_verification_notifications` (AFTER INSERT) — fires when a deposit is inserted with status `pending_verification`. Inserts one notification per verifier; the email pipeline picks them up.
- `notify_members_on_deposit()` (the existing mig-014 trigger, now enhanced) — fires when status transitions to `completed`. Detects whether the completion came from a verification (presence of `bank_verification_code` + `verified_by`, with old status `pending_verification`) and uses different messaging accordingly. Falls back to original wording for any legacy/non-verified completion.

## Flow summary

### A. New deposits

1. Member fills the modal, sees a notice that the deposit will await verification. Row is inserted with `status='pending_verification'`. **Equity not yet updated.**
2. DB trigger fires "🕓 Deposit Awaiting Verification" to each verifier. Edge Function emails them.
3. Verifier sees the row on the Transactions page (highlighted amber, "Verify" button visible) — also visible in a top banner. Opens inline panel, types bank code, clicks Confirm.
4. `verify_deposit()` RPC stamps the row, flips status to `completed`, snapshots ownership, inserts matched bank_reconciliations row, audit-logs.
5. DB trigger fires "✅ Your Deposit Verified" to depositor and "💰 X's deposit verified" to every other member. Emails go out via Resend.

### B. Existing deposits (back-fill)

1. Admin sees a blue banner: "N historical deposits need a bank verification code."
2. Toggles "Show only these" or clicks the **Add Code** button on a specific row.
3. Types the bank code → `backfill_deposit_verification()` RPC stamps the row, inserts a matched reconciliation row (if none exists), and audit-logs.
4. The `trg_backfill_notifications` trigger fans out "🧾 Bank Reference Back-filled" / "🧾 Bank Reference Added to Your Deposit" notifications to everyone, with explicit copy clarifying that balances haven't changed. Emails go via Resend.
5. Row immediately gets the green ✓ Verified badge.

## Apply in order

1. `023_deposit_verification.sql`
2. `024_backfill_deposit_verification.sql`
3. `025_verification_notifications.sql`
4. `026_backfill_notifications.sql`
5. `027_members_can_backfill_admin.sql`  ← seeds rollup notifications on run
6. Deploy the updated frontend files.

No Edge Function changes required — the existing webhook handles emails.

## Defaults the user didn't pick

For the recent set of clarifying questions on who gets notifications, sensible defaults were chosen — flag any you'd like changed:

- **New deposit recorded** → verifiers only (the depositor doesn't need to be emailed about their own action).
- **Deposit verified** → everyone in the group (matches the existing pre-verification deposit-confirmation behavior so emails feel consistent across old and new deposits).
- **Back-fill** → everyone in the group, with copy that makes clear it's record-keeping (no balance change).
