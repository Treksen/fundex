-- ================================================================
-- Migration 019: Fix Notifications for Reversed Transactions
-- Run in: Supabase Dashboard → SQL Editor
--
-- Problem: When a transaction is reversed, the reversal counter-
-- entry (which has is_reversal = TRUE) was triggering the same
-- "made a deposit" notification as a real deposit. This is wrong
-- because:
--   - Reversals of withdrawals create a deposit-type counter-entry
--     which triggered "X made a deposit" — should say "reversal"
--   - Reversals of deposits create a withdrawal-type counter-entry
--     which already didn't notify — correct
--
-- Fix: Check is_reversal flag in both deposit and adjustment
-- notification triggers. If is_reversal = TRUE, send a reversal
-- notification instead.
-- ================================================================

CREATE OR REPLACE FUNCTION notify_members_on_deposit()
RETURNS TRIGGER AS $$
DECLARE
  v_name       TEXT;
  v_first      TEXT;
  v_stmt_no    TEXT;
  v_member     RECORD;
  v_orig_stmt  TEXT;
BEGIN
  -- Only fire for newly-completed deposits/adjustment
  IF NEW.type NOT IN ('deposit', 'adjustment') THEN RETURN NEW; END IF;
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT name INTO v_name FROM profiles WHERE id = NEW.user_id;
  v_first   := SPLIT_PART(v_name, ' ', 1);
  v_stmt_no := COALESCE(NEW.statement_no, LEFT(NEW.id::TEXT, 8));

  -- ── REVERSAL: send a specific reversal notification ─────────
  IF NEW.is_reversal = TRUE THEN
    -- Try to get the original transaction's statement number
    v_orig_stmt := COALESCE(
      NEW.reversal_reason,
      REPLACE(NEW.reference, 'REV-', ''),
      'original transaction'
    );

    FOR v_member IN SELECT id FROM profiles LOOP
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        '↩️ Transaction Reversed',
        CASE
          WHEN v_member.id = NEW.user_id THEN
            'A transaction on your account has been reversed (Ref: ' || v_stmt_no || '). ' ||
            'KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') || ' has been credited back. ' ||
            'Your equity has been recalculated.'
          ELSE
            v_first || '''s transaction has been reversed (Ref: ' || v_stmt_no || '). ' ||
            'KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') || ' credited back. ' ||
            'Pool and equity have been recalculated.'
        END,
        'warning',
        '/transactions',
        jsonb_build_object(
          'transaction_id', NEW.id,
          'amount', NEW.amount,
          'is_reversal', true
        )
      )
      ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN NEW;
  END IF;

  -- ── NORMAL DEPOSIT / ADJUSTMENT: existing logic ─────────────
  FOR v_member IN SELECT id FROM profiles LOOP
    IF v_member.id = NEW.user_id THEN
      -- Confirmation to the depositor
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        CASE NEW.type
          WHEN 'adjustment' THEN '⚙️ Adjustment Applied'
          ELSE '✅ Deposit Confirmed'
        END,
        CASE NEW.type
          WHEN 'adjustment' THEN
            'An adjustment of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' (Ref: ' || v_stmt_no || ') has been applied to your account.'
          ELSE
            'Your deposit of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' (Ref: ' || v_stmt_no || ') has been recorded successfully.'
        END,
        'success',
        '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount)
      )
      ON CONFLICT DO NOTHING;

    ELSE
      -- Group update to every other member
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        CASE NEW.type
          WHEN 'adjustment' THEN '⚙️ Account Adjustment — ' || v_first
          ELSE '💰 ' || v_first || ' made a deposit'
        END,
        CASE NEW.type
          WHEN 'adjustment' THEN
            v_name || ' had an adjustment of KES ' ||
            TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' applied (Ref: ' || v_stmt_no || ').'
          ELSE
            v_name || ' deposited KES ' ||
            TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' into the group pool (Ref: ' || v_stmt_no || '). ' ||
            'The pool has been updated.'
        END,
        'info',
        '/transactions',
        jsonb_build_object(
          'transaction_id', NEW.id,
          'depositor_id', NEW.user_id,
          'amount', NEW.amount
        )
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach trigger (function name unchanged, trigger stays)
DROP TRIGGER IF EXISTS trg_deposit_notifications ON transactions;
CREATE TRIGGER trg_deposit_notifications
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_members_on_deposit();

GRANT EXECUTE ON FUNCTION notify_members_on_deposit() TO authenticated;
