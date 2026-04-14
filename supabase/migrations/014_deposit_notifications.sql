-- ============================================================
-- Migration 014: Deposit Notifications
-- Ensures ALL members are notified whenever a deposit is
-- completed — covers frontend, admin edits, and any future
-- API/trigger paths.
-- Run after 001-013
-- ============================================================

-- ── 1. DB-LEVEL TRIGGER FUNCTION ─────────────────────────────
-- Fires whenever a transaction reaches status = 'completed'
-- AND type = 'deposit'.  Safe to re-run (ON CONFLICT DO NOTHING
-- prevents duplicate notifications if triggered twice).

CREATE OR REPLACE FUNCTION notify_members_on_deposit()
RETURNS TRIGGER AS $$
DECLARE
  v_depositor_name TEXT;
  v_depositor_first TEXT;
  v_member         RECORD;
  v_stmt_no        TEXT;
BEGIN
  -- Only fire for newly-completed deposits
  IF NEW.type <> 'deposit' THEN RETURN NEW; END IF;
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  -- Skip if it was already 'completed' before this update
  IF OLD IS NOT NULL AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  -- Fetch depositor name
  SELECT name INTO v_depositor_name FROM profiles WHERE id = NEW.user_id;
  v_depositor_first := SPLIT_PART(v_depositor_name, ' ', 1);
  v_stmt_no := COALESCE(NEW.statement_no, LEFT(NEW.id::TEXT, 8));

  FOR v_member IN SELECT id FROM profiles LOOP
    IF v_member.id = NEW.user_id THEN
      -- ── Confirmation to the depositor ──────────────────────
      INSERT INTO notifications
        (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        '✅ Deposit Confirmed',
        'Your deposit of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
          ' (Ref: ' || v_stmt_no || ') has been recorded successfully.',
        'success',
        '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount)
      )
      ON CONFLICT DO NOTHING;

    ELSE
      -- ── Group update to every other member ─────────────────
      INSERT INTO notifications
        (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        '💰 ' || v_depositor_first || ' made a deposit',
        v_depositor_name || ' deposited KES ' ||
          TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
          ' into the group pool (Ref: ' || v_stmt_no || '). ' ||
          'The pool has been updated.',
        'info',
        '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'depositor_id', NEW.user_id, 'amount', NEW.amount)
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. ATTACH TRIGGER ────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_deposit_notifications ON transactions;

CREATE TRIGGER trg_deposit_notifications
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_members_on_deposit();

-- ── 3. ALSO NOTIFY ON ADJUSTMENTS ────────────────────────────
-- Adjustments are admin-only and also affect the pool balance,
-- so all members should know about them.

CREATE OR REPLACE FUNCTION notify_members_on_adjustment()
RETURNS TRIGGER AS $$
DECLARE
  v_adjuster_name TEXT;
  v_subject_name  TEXT;
  v_member        RECORD;
BEGIN
  IF NEW.type <> 'adjustment' THEN RETURN NEW; END IF;
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT name INTO v_adjuster_name FROM profiles WHERE id = NEW.created_by;
  SELECT name INTO v_subject_name  FROM profiles WHERE id = NEW.user_id;

  FOR v_member IN SELECT id FROM profiles LOOP
    INSERT INTO notifications
      (user_id, title, message, type, action_url, metadata)
    VALUES (
      v_member.id,
      '⚙️ Account Adjustment Applied',
      'An adjustment of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00') ||
        ' was applied to ' || v_subject_name || '''s account' ||
        CASE WHEN NEW.description IS NOT NULL
             THEN ': ' || NEW.description
             ELSE '.'
        END ||
        ' Applied by: ' || COALESCE(v_adjuster_name, 'Admin'),
      'info',
      '/transactions',
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'subject_id', NEW.user_id)
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_adjustment_notifications ON transactions;

CREATE TRIGGER trg_adjustment_notifications
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_members_on_adjustment();

-- ── 4. NOTE ──────────────────────────────────────────────────
-- Withdrawal notifications already handled by:
--   process_withdrawal_approval() in migration 010 (approved/rejected)
--   AddTransactionModal.jsx (pending — notifies approvers)
-- No changes needed for withdrawals.

-- ── 5. GRANT ─────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION notify_members_on_deposit()    TO authenticated;
GRANT EXECUTE ON FUNCTION notify_members_on_adjustment() TO authenticated;
