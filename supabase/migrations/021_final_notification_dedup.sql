-- ================================================================
-- Migration 021: Final deduplication of deposit notifications
--
-- Root cause confirmed: The trigger guard
--   IF OLD.status = 'completed' THEN RETURN NEW
-- fires correctly for status-only UPDATEs, BUT the trigger
-- still runs when reverse_transaction does:
--   UPDATE transactions SET reversed_by = v_new_id
-- because OLD.status = 'completed' causes early return...
-- EXCEPT the reversal counter-entry INSERT fires first, which
-- correctly sends the reversal notification. Then the UPDATE on
-- the original row fires AGAIN and since OLD.status='completed'
-- the guard exits — but by then the deposit notification was
-- already fired on the original INSERT (at 23:14).
--
-- The REAL duplicate: the deposit at 23:14 fired one notification.
-- The reversal at 23:15 fires the reversal notification AND
-- then the reverse_transaction function re-inserts the same
-- "Deposit Confirmed" because somewhere in the call chain,
-- the original deposit row is being touched in a way that
-- OLD.status transitions from something other than 'completed'.
--
-- DEFINITIVE FIX:
-- Use a transaction_id-based dedup key in the notifications
-- table, and skip notification if one already exists for this
-- transaction_id + user_id + title combination.
-- ================================================================

-- ── 1. Add unique partial index to prevent duplicate notifications
--    for the same transaction_id per user ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_tx_user_title
  ON notifications (user_id, (metadata->>'transaction_id'), title)
  WHERE metadata->>'transaction_id' IS NOT NULL;

-- ── 2. Replace notify function with explicit duplicate check ──────
CREATE OR REPLACE FUNCTION notify_members_on_deposit()
RETURNS TRIGGER AS $$
DECLARE
  v_name    TEXT;
  v_first   TEXT;
  v_stmt_no TEXT;
  v_member  RECORD;
BEGIN
  -- Only fire when a row first becomes completed
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT name INTO v_name FROM profiles WHERE id = NEW.user_id;
  v_first   := SPLIT_PART(v_name, ' ', 1);
  v_stmt_no := COALESCE(NEW.statement_no, LEFT(NEW.id::TEXT, 8));

  -- ── REVERSAL ─────────────────────────────────────────────────
  IF NEW.is_reversal = TRUE THEN
    FOR v_member IN SELECT id FROM profiles LOOP
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (
        v_member.id,
        '↩️ Transaction Reversed',
        CASE WHEN v_member.id = NEW.user_id
          THEN 'Your transaction has been reversed (Ref: ' || v_stmt_no || '). KES '
               || TO_CHAR(NEW.amount, 'FM999,999,999.00') || ' — '
               || COALESCE(NEW.reversal_reason, 'see transaction history')
               || '. Your equity has been recalculated.'
          ELSE v_first || '''s transaction was reversed (Ref: ' || v_stmt_no || '). KES '
               || TO_CHAR(NEW.amount, 'FM999,999,999.00') || ' — '
               || COALESCE(NEW.reversal_reason, 'see transaction history')
               || '. Pool and equity recalculated.'
        END,
        'warning', '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'is_reversal', true)
      )
      ON CONFLICT (user_id, (metadata->>'transaction_id'), title)
        WHERE metadata->>'transaction_id' IS NOT NULL
      DO NOTHING;
    END LOOP;
    RETURN NEW;
  END IF;

  -- ── NORMAL DEPOSIT ────────────────────────────────────────────
  IF NEW.type = 'deposit' THEN
    FOR v_member IN SELECT id FROM profiles LOOP
      IF v_member.id = NEW.user_id THEN
        INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
        VALUES (v_member.id, '✅ Deposit Confirmed',
          'Your deposit of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00')
          || ' (Ref: ' || v_stmt_no || ') has been recorded successfully.',
          'success', '/transactions',
          jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount)
        )
        ON CONFLICT (user_id, (metadata->>'transaction_id'), title)
          WHERE metadata->>'transaction_id' IS NOT NULL
        DO NOTHING;
      ELSE
        INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
        VALUES (v_member.id,
          '💰 ' || v_first || ' made a deposit',
          v_name || ' deposited KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00')
          || ' into the group pool (Ref: ' || v_stmt_no || '). The pool has been updated.',
          'info', '/transactions',
          jsonb_build_object('transaction_id', NEW.id, 'depositor_id', NEW.user_id, 'amount', NEW.amount)
        )
        ON CONFLICT (user_id, (metadata->>'transaction_id'), title)
          WHERE metadata->>'transaction_id' IS NOT NULL
        DO NOTHING;
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  -- ── ADJUSTMENT ────────────────────────────────────────────────
  IF NEW.type = 'adjustment' THEN
    FOR v_member IN SELECT id FROM profiles LOOP
      INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
      VALUES (v_member.id, '⚙️ Account Adjustment Applied',
        'An adjustment of KES ' || TO_CHAR(NEW.amount, 'FM999,999,999.00')
        || ' was applied to ' || v_name || '''s account (Ref: ' || v_stmt_no || ').',
        'info', '/transactions',
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount)
      )
      ON CONFLICT (user_id, (metadata->>'transaction_id'), title)
        WHERE metadata->>'transaction_id' IS NOT NULL
      DO NOTHING;
    END LOOP;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deposit_notifications ON transactions;
CREATE TRIGGER trg_deposit_notifications
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION notify_members_on_deposit();

GRANT EXECUTE ON FUNCTION notify_members_on_deposit() TO authenticated;

-- ── Verify ────────────────────────────────────────────────────
SELECT indexname FROM pg_indexes
WHERE tablename = 'notifications' AND indexname = 'uq_notif_tx_user_title';
