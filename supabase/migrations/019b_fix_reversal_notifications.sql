-- ================================================================
-- Migration 019b: Fix Reversal Notifications (replaces 019)
-- Run in: Supabase Dashboard → SQL Editor
--
-- Root cause: When reversing a deposit, the counter-entry has
-- type='withdrawal' + is_reversal=TRUE. The previous trigger
-- exited early on type='withdrawal' before checking is_reversal.
--
-- Fix: Check is_reversal FIRST before filtering by type.
-- ================================================================

CREATE OR REPLACE FUNCTION notify_members_on_deposit()
RETURNS TRIGGER AS $$
DECLARE
  v_name    TEXT;
  v_first   TEXT;
  v_stmt_no TEXT;
  v_member  RECORD;
BEGIN
  -- Skip if not newly completed
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT name INTO v_name FROM profiles WHERE id = NEW.user_id;
  v_first   := SPLIT_PART(v_name, ' ', 1);
  v_stmt_no := COALESCE(NEW.statement_no, LEFT(NEW.id::TEXT, 8));

  -- ── CASE 1: REVERSAL (any type) ──────────────────────────────
  -- Check is_reversal BEFORE filtering by type
  IF NEW.is_reversal = TRUE THEN
    FOR v_member IN SELECT id FROM profiles LOOP
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        '↩️ Transaction Reversed',
        CASE
          WHEN v_member.id = NEW.user_id THEN
            'Your transaction has been reversed (Ref: ' || v_stmt_no || '). ' ||
            'KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') || ' — ' ||
            COALESCE(NEW.reversal_reason, 'see transaction history for details') || '. ' ||
            'Your equity has been recalculated.'
          ELSE
            v_first || '''s transaction was reversed (Ref: ' || v_stmt_no || '). ' ||
            'KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') || ' — ' ||
            COALESCE(NEW.reversal_reason, 'see transaction history') || '. ' ||
            'Pool and equity recalculated.'
        END,
        'warning',
        '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'is_reversal', true)
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    RETURN NEW;
  END IF;

  -- ── CASE 2: Normal deposit ────────────────────────────────────
  IF NEW.type = 'deposit' THEN
    FOR v_member IN SELECT id FROM profiles LOOP
      IF v_member.id = NEW.user_id THEN
        INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
        VALUES (
          v_member.id,
          '✅ Deposit Confirmed',
          'Your deposit of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
          ' (Ref: ' || v_stmt_no || ') has been recorded successfully.',
          'success', '/transactions',
          jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount)
        )
        ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
        VALUES (
          v_member.id,
          '💰 ' || v_first || ' made a deposit',
          v_name || ' deposited KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
          ' into the group pool (Ref: ' || v_stmt_no || '). The pool has been updated.',
          'info', '/transactions',
          jsonb_build_object('transaction_id', NEW.id, 'depositor_id', NEW.user_id, 'amount', NEW.amount)
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  -- ── CASE 3: Adjustment ───────────────────────────────────────
  IF NEW.type = 'adjustment' THEN
    FOR v_member IN SELECT id FROM profiles LOOP
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        '⚙️ Account Adjustment Applied',
        'An adjustment of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
        ' was applied to ' || v_name || '''s account (Ref: ' || v_stmt_no || ').',
        'info', '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount)
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    RETURN NEW;
  END IF;

  -- All other types (plain withdrawal) — no notification
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach trigger
DROP TRIGGER IF EXISTS trg_deposit_notifications ON transactions;
CREATE TRIGGER trg_deposit_notifications
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_members_on_deposit();

GRANT EXECUTE ON FUNCTION notify_members_on_deposit() TO authenticated;

-- Verify
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'notify_members_on_deposit' AND routine_schema = 'public';
