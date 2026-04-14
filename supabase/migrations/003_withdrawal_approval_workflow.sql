-- ============================================================
-- Migration 003: Enhanced Withdrawal Approval Workflow
-- Run in Supabase SQL Editor after 001 and 002
-- ============================================================

-- Add action_url to notifications if not already present
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add approved_at to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_count INT DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS required_approvals INT DEFAULT 2;

-- Add notes/reason to withdrawal_approvals
ALTER TABLE withdrawal_approvals ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ============================================================
-- FUNCTION: Process withdrawal when enough approvals received
-- Called after each approval vote
-- ============================================================
CREATE OR REPLACE FUNCTION process_withdrawal_approval(p_transaction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_tx RECORD;
  v_approved_count INT;
  v_rejected_count INT;
  v_total_approvers INT;
  v_result JSONB;
  v_requester RECORD;
  v_approver RECORD;
BEGIN
  -- Get transaction details
  SELECT t.*, p.name AS requester_name
  INTO v_tx
  FROM transactions t
  JOIN profiles p ON p.id = t.user_id
  WHERE t.id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found');
  END IF;

  -- Count votes
  SELECT
    COUNT(*) FILTER (WHERE status = 'approved') AS approved,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
    COUNT(*) AS total
  INTO v_approved_count, v_rejected_count, v_total_approvers
  FROM withdrawal_approvals
  WHERE transaction_id = p_transaction_id;

  -- Update approved_count on transaction
  UPDATE transactions
  SET approved_count = v_approved_count
  WHERE id = p_transaction_id;

  -- CASE 1: All approvers have approved → mark completed, deduct amount
  IF v_approved_count >= v_total_approvers AND v_total_approvers > 0 THEN
    UPDATE transactions
    SET
      status = 'completed',
      approved_at = NOW()
    WHERE id = p_transaction_id;

    -- Notify the requester
    INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
    VALUES (
      v_tx.user_id,
      'Withdrawal Approved ✅',
      'Your withdrawal of KES ' || TO_CHAR(v_tx.amount, 'FM999,999,999.00') || ' has been fully approved and processed.',
      'success',
      '/transactions',
      jsonb_build_object('transaction_id', p_transaction_id, 'amount', v_tx.amount)
    );

    -- Snapshot ownership after withdrawal
    INSERT INTO ownership_snapshots (user_id, percentage, total_contribution, transaction_id)
    SELECT
      id,
      CASE WHEN grand_total > 0 THEN ROUND((net_dep / grand_total) * 100, 4) ELSE 0 END,
      net_dep,
      p_transaction_id
    FROM (
      SELECT
        p.id,
        COALESCE(SUM(CASE WHEN t.type IN ('deposit','adjustment') AND t.status = 'completed' THEN t.amount
                          WHEN t.type = 'withdrawal' AND t.status = 'completed' THEN -t.amount
                          ELSE 0 END), 0) AS net_dep
      FROM profiles p
      LEFT JOIN transactions t ON t.user_id = p.id
      GROUP BY p.id
    ) AS contrib
    CROSS JOIN (
      SELECT COALESCE(SUM(CASE WHEN t.type IN ('deposit','adjustment') AND t.status = 'completed' THEN t.amount
                               WHEN t.type = 'withdrawal' AND t.status = 'completed' THEN -t.amount
                               ELSE 0 END), 0) AS grand_total
      FROM transactions t
    ) AS totals;

    v_result := jsonb_build_object('status', 'completed', 'message', 'All approved, withdrawal processed');

  -- CASE 2: Any rejection → mark rejected, notify requester
  ELSIF v_rejected_count > 0 AND (v_rejected_count + v_approved_count) = v_total_approvers THEN
    UPDATE transactions
    SET status = 'rejected'
    WHERE id = p_transaction_id;

    INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
    VALUES (
      v_tx.user_id,
      'Withdrawal Rejected ❌',
      'Your withdrawal request of KES ' || TO_CHAR(v_tx.amount, 'FM999,999,999.00') || ' was rejected.',
      'error',
      '/transactions',
      jsonb_build_object('transaction_id', p_transaction_id, 'amount', v_tx.amount)
    );

    v_result := jsonb_build_object('status', 'rejected', 'message', 'Withdrawal rejected');

  -- CASE 3: Partial approval (some voted, some pending)
  ELSE
    v_result := jsonb_build_object(
      'status', 'pending',
      'approved_count', v_approved_count,
      'rejected_count', v_rejected_count,
      'total', v_total_approvers,
      'message', 'Awaiting more approvals'
    );
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION process_withdrawal_approval(UUID) TO authenticated;

-- ============================================================
-- RLS: Allow authenticated to update transactions status
-- (needed for approval completion via RPC)
-- ============================================================
DROP POLICY IF EXISTS "Members can update pending withdrawals" ON transactions;
CREATE POLICY "Members can update pending withdrawals"
  ON transactions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow members to insert ownership snapshots via RPC
DROP POLICY IF EXISTS "Members can insert snapshots" ON ownership_snapshots;
CREATE POLICY "Members can insert snapshots"
  ON ownership_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (true);
