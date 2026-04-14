-- ================================================================
-- Migration 019: Fix Duplicate + Reversal Notifications
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

CREATE OR REPLACE FUNCTION notify_members_on_deposit()
RETURNS TRIGGER AS $$
DECLARE
  v_name      TEXT;
  v_first     TEXT;
  v_stmt_no   TEXT;
  v_member    RECORD;
BEGIN
  -- Only fire for completed deposits or adjustments
  IF NEW.type NOT IN ('deposit', 'adjustment') THEN RETURN NEW; END IF;
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;

  SELECT name INTO v_name FROM profiles WHERE id = NEW.user_id;
  v_first   := SPLIT_PART(v_name, ' ', 1);
  v_stmt_no := COALESCE(NEW.statement_no, LEFT(NEW.id::TEXT, 8));

  -- Reversal counter-entry → send reversal notification
  IF NEW.is_reversal = TRUE THEN
    FOR v_member IN SELECT id FROM profiles LOOP
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        '↩️ Transaction Reversed',
        CASE
          WHEN v_member.id = NEW.user_id THEN
            'Your transaction has been reversed (Ref: ' || v_stmt_no ||
            '). KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' has been credited back. Your equity has been recalculated.'
          ELSE
            v_first || '''s transaction was reversed (Ref: ' || v_stmt_no ||
            '). KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' credited back. Pool and equity recalculated.'
        END,
        'warning', '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'is_reversal', true)
      );
    END LOOP;
    RETURN NEW;
  END IF;

  -- Normal deposit / adjustment
  FOR v_member IN SELECT id FROM profiles LOOP
    IF v_member.id = NEW.user_id THEN
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        CASE NEW.type WHEN 'adjustment' THEN '⚙️ Adjustment Applied' ELSE '✅ Deposit Confirmed' END,
        CASE NEW.type
          WHEN 'adjustment' THEN
            'An adjustment of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' (Ref: ' || v_stmt_no || ') has been applied to your account.'
          ELSE
            'Your deposit of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' (Ref: ' || v_stmt_no || ') has been recorded successfully.'
        END,
        'success', '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount)
      );
    ELSE
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        CASE NEW.type WHEN 'adjustment' THEN '⚙️ Adjustment — ' || v_first ELSE '💰 ' || v_first || ' made a deposit' END,
        CASE NEW.type
          WHEN 'adjustment' THEN
            v_name || ' had an adjustment of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' applied (Ref: ' || v_stmt_no || ').'
          ELSE
            v_name || ' deposited KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
            ' into the group pool (Ref: ' || v_stmt_no || '). The pool has been updated.'
        END,
        'info', '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'depositor_id', NEW.user_id, 'amount', NEW.amount)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── KEY FIX: AFTER INSERT only — not AFTER INSERT OR UPDATE ──────
-- The duplicate was caused by subsequent UPDATEs on the same
-- completed row (from other triggers). INSERT-only means the
-- function fires exactly ONCE per new transaction row, never again.
-- Reversals are new INSERTs so they still fire correctly.
DROP TRIGGER IF EXISTS trg_deposit_notifications   ON transactions;
DROP TRIGGER IF EXISTS trg_adjustment_notifications ON transactions;

CREATE TRIGGER trg_deposit_notifications
  AFTER INSERT ON transactions          -- INSERT only, not UPDATE
  FOR EACH ROW
  EXECUTE FUNCTION notify_members_on_deposit();

GRANT EXECUTE ON FUNCTION notify_members_on_deposit() TO authenticated;

-- Verify: should fire on INSERT only
SELECT tgname, tgenabled,
  CASE tgtype & 4 WHEN 4 THEN 'INSERT' ELSE '' END ||
  CASE tgtype & 8 WHEN 8 THEN '+DELETE' ELSE '' END ||
  CASE tgtype & 16 WHEN 16 THEN '+UPDATE' ELSE '' END AS fires_on
FROM pg_trigger
WHERE tgrelid = 'transactions'::regclass
  AND tgname LIKE '%notif%';
