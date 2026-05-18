# Phase 6 — Five fixes from your shortlist + the actor-vs-recipient wording

## Files

| File | What changed |
|------|--------------|
| `supabase/migrations/028_actor_aware_notifications.sql` | All notification text now branches on whether the recipient is the actor. "You verified X's deposit" / "X verified your deposit" / "X verified Y's deposit" instead of one generic message. |
| `supabase/migrations/029_reject_verification.sql` | New `reject_deposit_verification(p_tx_id, p_reason)` RPC. Same dual-control rules as `verify_deposit`. Reason required (≥5 chars), saved into description and audit log. Notifies depositor + everyone with actor-aware wording. |
| `supabase/migrations/030_relax_uniqueness_window.sql` | Bank-code uniqueness check is now a rolling 90-day window instead of all-history. Both `verify_deposit` and `backfill_deposit_verification` updated. |
| `supabase/functions/send-scheduled-reminders/index.ts` | Extended to also run **daily staleness nudges**: pending_verification >3 days old → reminds verifiers; completed-but-no-bank-code >14 days old → reminds back-fillers. Per-user, per-tx, per-kind dedupe with a 24h window. |
| `src/components/transactions/AddTransactionModal.jsx` | Deposit `reference` field is now required with red asterisk + form-level validation. |
| `src/pages/TransactionsPage.jsx` | Reject button + inline reason panel (desktop + mobile). |
| `src/pages/DashboardPage.jsx` | New **Verification Queue** widget — shows pending count, oldest-days, and back-fill count for the current user, clickable to jump to Transactions. Only renders when there's something to act on. |

## Apply order

1. `028_actor_aware_notifications.sql`
2. `029_reject_verification.sql`
3. `030_relax_uniqueness_window.sql`
4. Deploy the updated Edge Function `send-scheduled-reminders`
5. Deploy the updated frontend files

## Important to know

### Actor-vs-recipient wording
The change is purely in DB functions that write to `notifications`. The Resend Edge Function still reads `title` + `message` verbatim, so it picks up the new wording automatically — no changes there. Every recipient sees a message tailored to whether they're the depositor, verifier, or bystander.

### Reject behavior
When a verifier rejects a deposit:
- Status flips to `'rejected'`. Row stays visible.
- `verified_by` / `verified_at` get stamped with the rejecter (these columns now mean "decided by/at" regardless of outcome).
- The reason is prepended to the description (`REJECTED: <reason>`) and stored in the audit log.
- Everyone is notified. Depositor sees: *"X rejected your deposit. Reason: …"*; rejecter sees: *"You rejected X's deposit"*; everyone else sees: *"X rejected Y's deposit"*.
- If money does arrive later, the admin can re-open via the standard edit modal (flip status back to `pending_verification`).

### Staleness nudge defaults
- **>3 days** for `pending_verification` (you can't audit a deposit you saw last week).
- **>14 days** for un-back-filled completed deposits (lower priority — these are already counted in the pool).
- **24h dedupe** so each verifier gets at most one nudge per tx per day.
- The cron schedule isn't included; if you don't already have one, add a daily Supabase Cron entry pointing at this function (any time of day).

### 90-day uniqueness
Genuine same-day duplicate paste is still blocked (within the window). M-Pesa reference reuse after several months is now allowed.

### Dashboard widget visibility
Shown only when the user is eligible to act. A member with no admin deposits to verify and no admin deposits to back-fill sees nothing. Numbers are real-time via the existing dashboard realtime channel.

## Defaults chosen on your behalf (you didn't pick)

- **Reject behavior**: status='rejected', row stays visible, admin can re-open via edit. (You can flip this by changing the RPC to delete the row, but I'd advise against it for audit reasons.)
- **Staleness cadence**: only nudge stale items (>3 days), not a daily digest. Less email noise, same coverage.

Both flagged inline so you can change later.
