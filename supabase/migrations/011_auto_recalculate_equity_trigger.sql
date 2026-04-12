-- ============================================================
-- Migration 011: Auto-recalculate equity on every transaction
-- ============================================================
-- ROOT CAUSE OF BUG:
--   recalculate_equity_status() was only called inside
--   process_withdrawal_approval(). Deposits had NO trigger to
--   update profiles.equity_status / profiles.loan_balance.
--   So after Amos deposited 10,000, the stale overdraft value
--   stayed on his profile row — the view computed it correctly
--   but the MembersPage reads profiles.equity_status to show
--   the "overdrawn" banner, which never cleared.
--
-- FIX:
--   Add an AFTER INSERT OR UPDATE trigger on transactions that
--   calls recalculate_equity_status() for the affected member
--   every time a transaction reaches 'completed' status.
--   This covers deposits, manual adjustments, and approved
--   withdrawals regardless of which code path created them.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_recalculate_equity_on_tx()
RETURNS TRIGGER AS $$
BEGIN
  -- Fire on any completed transaction (insert or status change to completed)
  IF NEW.status = 'completed' THEN
    PERFORM recalculate_equity_status(NEW.user_id);
  END IF;

  -- Also fire if a pending/rejected tx is being deleted (status won't be
  -- 'completed' but the member's balance context may have changed)
  -- Handled separately by admin_delete_transaction() RPC which calls
  -- recalculate_equity_status() explicitly after DELETE.

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace any old version of this trigger
DROP TRIGGER IF EXISTS trg_auto_equity_recalc ON transactions;

CREATE TRIGGER trg_auto_equity_recalc
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION trg_recalculate_equity_on_tx();

-- ============================================================
-- IMMEDIATE BACKFILL:
--   Run recalculate_equity_status() for every member right now
--   so that anyone currently showing a stale overdraft gets
--   corrected immediately without waiting for the next tx.
-- ============================================================

DO $$
DECLARE v_member RECORD;
BEGIN
  FOR v_member IN SELECT id FROM profiles LOOP
    PERFORM recalculate_equity_status(v_member.id);
  END LOOP;
END;
$$;

-- ============================================================
-- VERIFICATION QUERY  (run this after applying to confirm)
-- ============================================================
-- SELECT id, name, equity_status, loan_balance
-- FROM profiles
-- ORDER BY name;
--
-- Expected for Amos after his 10,000 deposit:
--   equity_status = 'safe'   (or 'near_limit' if still close)
--   loan_balance  = 0.00
-- ============================================================
