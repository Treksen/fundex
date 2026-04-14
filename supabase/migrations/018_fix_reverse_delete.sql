-- ================================================================
-- Migration 018: Fix Reversal + Delete — Full Recalculation
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- ── 1. FIX admin_delete_transaction ──────────────────────────
-- Frontend calls:  admin_delete_transaction({ p_transaction_id: id })
-- Old function had: p_tx_id + p_admin_user_id (wrong param names, extra required param)
-- New function:     single param p_transaction_id, reads admin from auth.uid()

CREATE OR REPLACE FUNCTION admin_delete_transaction(
  p_transaction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx       RECORD;
  v_admin_id UUID := auth.uid();
  v_member   RECORD;
BEGIN
  -- Admin check
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can delete transactions');
  END IF;

  -- Fetch transaction
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  -- Audit before delete
  INSERT INTO audit_logs (user_id, action, table_name, record_id, change_type, old_values)
  VALUES (v_admin_id,
    'Admin deleted transaction: ' || COALESCE(v_tx.statement_no, v_tx.id::TEXT),
    'transactions', p_transaction_id, 'delete', to_jsonb(v_tx));

  -- Remove auto-skim reserve contributions that reference this transaction
  DELETE FROM reserve_contributions
  WHERE reference_id = p_transaction_id;

  -- If this was a reversal, un-mark the original transaction
  IF v_tx.is_reversal THEN
    UPDATE transactions
    SET reversed_by = NULL, updated_at = NOW()
    WHERE reversed_by = p_transaction_id;
  END IF;

  -- If the original was reversed by this tx, clear that link too
  UPDATE transactions
  SET reversed_by = NULL, updated_at = NOW()
  WHERE reversed_by = p_transaction_id;

  -- Delete ledger entries for this transaction
  DELETE FROM ledger_entries WHERE transaction_id = p_transaction_id;

  -- Delete ownership snapshots
  DELETE FROM ownership_snapshots WHERE transaction_id = p_transaction_id;

  -- Delete withdrawal approvals
  DELETE FROM withdrawal_approvals WHERE transaction_id = p_transaction_id;

  -- Delete the transaction itself
  DELETE FROM transactions WHERE id = p_transaction_id;

  -- Recalculate equity for ALL members
  FOR v_member IN SELECT id FROM profiles LOOP
    PERFORM recalculate_equity_status(v_member.id);
  END LOOP;

  -- Sync virtual account balances (pool + reserve)
  PERFORM sync_virtual_account_balances();

  RETURN jsonb_build_object('success', true,
    'message', 'Transaction deleted and all balances recalculated');
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_transaction(UUID) TO authenticated;

-- ── 2. FIX reverse_transaction ───────────────────────────────
-- Add: equity recalculation + virtual account sync + reserve cleanup

CREATE OR REPLACE FUNCTION reverse_transaction(
  p_tx_id            UUID,
  p_reason           TEXT,
  p_reversed_by_user UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx       RECORD;
  v_new_id   UUID;
  v_member   RECORD;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF v_tx.is_reversal THEN
    RAISE EXCEPTION 'Cannot reverse a reversal transaction';
  END IF;
  IF v_tx.reversed_by IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction has already been reversed';
  END IF;

  -- Create counter-transaction
  INSERT INTO transactions (
    user_id, amount, type, reference, description,
    status, created_by, transaction_date,
    is_reversal, reversal_reason
  ) VALUES (
    v_tx.user_id,
    v_tx.amount,
    CASE v_tx.type
      WHEN 'deposit'    THEN 'withdrawal'
      WHEN 'withdrawal' THEN 'deposit'
      ELSE 'adjustment'
    END,
    'REV-' || COALESCE(v_tx.statement_no, LEFT(v_tx.id::TEXT, 8)),
    'REVERSAL: ' || p_reason,
    'completed',
    p_reversed_by_user,
    NOW(),
    TRUE,
    p_reason
  )
  RETURNING id INTO v_new_id;

  -- Mark original as reversed
  UPDATE transactions
  SET reversed_by = v_new_id, updated_at = NOW()
  WHERE id = p_tx_id;

  -- Create ledger entries for the reversal transaction
  PERFORM create_ledger_entries(v_new_id);

  -- Remove the auto-skim reserve contribution for the original deposit
  -- (reversing a deposit means the skim should also be reversed)
  IF v_tx.type = 'deposit' THEN
    DELETE FROM reserve_contributions
    WHERE reference_id = p_tx_id
      AND source = 'group_pool';

    -- Also remove any skim for the NEW reversal transaction (if trigger fires)
    -- The reversal is a withdrawal so it shouldn't skim, but safety:
    DELETE FROM reserve_contributions
    WHERE reference_id = v_new_id
      AND source = 'group_pool'
      AND notes LIKE 'Auto-skim%';
  END IF;

  -- Recalculate equity for ALL members
  FOR v_member IN SELECT id FROM profiles LOOP
    PERFORM recalculate_equity_status(v_member.id);
  END LOOP;

  -- Sync virtual account balances (GROUP_WALLET + RESERVE_FUND)
  PERFORM sync_virtual_account_balances();

  -- Audit log
  INSERT INTO audit_logs (user_id, action, table_name, record_id, change_type)
  VALUES (
    p_reversed_by_user,
    'Reversed transaction ' || COALESCE(v_tx.statement_no, v_tx.id::TEXT)
      || ': ' || p_reason,
    'transactions', v_new_id, 'update'
  );

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reverse_transaction(UUID, TEXT, UUID) TO authenticated;

-- ── 3. Verify both functions exist ───────────────────────────
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name IN ('admin_delete_transaction', 'reverse_transaction')
  AND routine_schema = 'public';
