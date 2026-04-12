-- ============================================================
-- Migration 004: Overdraft Protection & Fix Approval RLS
-- Run in Supabase SQL Editor after 001, 002, 003
-- ============================================================

-- Add equity status tracking to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS equity_status TEXT DEFAULT 'safe'
  CHECK (equity_status IN ('safe', 'near_limit', 'overdrawn'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS loan_balance DECIMAL(15,2) DEFAULT 0;

-- Add loan/overdraft metadata to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_loan BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS loan_amount DECIMAL(15,2) DEFAULT 0;

-- Fix withdrawal_approvals RLS: allow ANY authenticated user to insert
-- approvals for others (needed when admin/modal creates approval records)
DROP POLICY IF EXISTS "Authenticated can create approvals" ON withdrawal_approvals;
CREATE POLICY "Authenticated can create approvals"
  ON withdrawal_approvals FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Fix transactions UPDATE policy (allow any auth user to update status fields)
DROP POLICY IF EXISTS "Admin can update transactions" ON transactions;
DROP POLICY IF EXISTS "Members can update pending withdrawals" ON transactions;
CREATE POLICY "Authenticated can update transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Fix ownership_snapshots INSERT policy
DROP POLICY IF EXISTS "System can insert snapshots" ON ownership_snapshots;
DROP POLICY IF EXISTS "Members can insert snapshots" ON ownership_snapshots;
CREATE POLICY "Authenticated can insert snapshots"
  ON ownership_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow profiles to be updated by any authenticated (for equity_status)
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Authenticated can update profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- VIEW: member equity status (available balance + overdraft flag)
-- ============================================================
CREATE OR REPLACE VIEW member_equity_summary AS
SELECT
  p.id,
  p.name,
  p.role,
  p.email,
  p.equity_status,
  COALESCE(p.loan_balance, 0) AS loan_balance,
  COALESCE(SUM(CASE WHEN t.type = 'deposit'     AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_deposits,
  COALESCE(SUM(CASE WHEN t.type = 'withdrawal'  AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_withdrawals,
  COALESCE(SUM(CASE WHEN t.type = 'adjustment'  AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_adjustments,
  -- Available equity = deposits + adjustments - completed withdrawals
  COALESCE(SUM(CASE WHEN t.type = 'deposit'     AND t.status = 'completed' THEN t.amount ELSE 0 END), 0)
  + COALESCE(SUM(CASE WHEN t.type = 'adjustment' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0)
  AS available_equity,
  -- Pending withdrawals (not yet approved)
  COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.status = 'pending' THEN t.amount ELSE 0 END), 0) AS pending_withdrawals
FROM profiles p
LEFT JOIN transactions t ON t.user_id = p.id
GROUP BY p.id, p.name, p.role, p.email, p.equity_status, p.loan_balance;

-- ============================================================
-- FUNCTION: recalculate equity status for a member after tx
-- ============================================================
CREATE OR REPLACE FUNCTION recalculate_equity_status(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_equity DECIMAL(15,2);
  v_deposits DECIMAL(15,2);
  v_status TEXT;
  v_threshold_near DECIMAL := 0.15; -- warn when < 15% equity remains
BEGIN
  SELECT available_equity, total_deposits
  INTO v_equity, v_deposits
  FROM member_equity_summary
  WHERE id = p_user_id;

  IF v_equity < 0 THEN
    v_status := 'overdrawn';
  ELSIF v_deposits > 0 AND v_equity < (v_deposits * v_threshold_near) THEN
    v_status := 'near_limit';
  ELSE
    v_status := 'safe';
  END IF;

  UPDATE profiles SET equity_status = v_status WHERE id = p_user_id;
  RETURN v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION recalculate_equity_status(UUID) TO authenticated;

-- ============================================================
-- Update process_withdrawal_approval to recalculate equity
-- ============================================================
CREATE OR REPLACE FUNCTION process_withdrawal_approval(p_transaction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_tx RECORD;
  v_approved_count INT;
  v_rejected_count INT;
  v_total_approvers INT;
  v_result JSONB;
BEGIN
  SELECT t.*, p.name AS requester_name
  INTO v_tx
  FROM transactions t
  JOIN profiles p ON p.id = t.user_id
  WHERE t.id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found');
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'approved') AS approved,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
    COUNT(*) AS total
  INTO v_approved_count, v_rejected_count, v_total_approvers
  FROM withdrawal_approvals
  WHERE transaction_id = p_transaction_id;

  UPDATE transactions SET approved_count = v_approved_count WHERE id = p_transaction_id;

  IF v_approved_count >= v_total_approvers AND v_total_approvers > 0 THEN
    UPDATE transactions SET status = 'completed', approved_at = NOW() WHERE id = p_transaction_id;

    -- Recalculate equity after completion
    PERFORM recalculate_equity_status(v_tx.user_id);

    INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
    VALUES (
      v_tx.user_id,
      'Withdrawal Approved ✅',
      'Your withdrawal of KES ' || TO_CHAR(v_tx.amount, 'FM999,999,999.00') || ' has been fully approved and processed.',
      'success', '/transactions',
      jsonb_build_object('transaction_id', p_transaction_id, 'amount', v_tx.amount)
    );

    -- Snapshot ownership
    INSERT INTO ownership_snapshots (user_id, percentage, total_contribution, transaction_id)
    SELECT
      p.id,
      CASE WHEN gt.grand_total > 0 THEN ROUND((es.available_equity / gt.grand_total) * 100, 4) ELSE 0 END,
      es.available_equity,
      p_transaction_id
    FROM profiles p
    JOIN member_equity_summary es ON es.id = p.id
    CROSS JOIN (SELECT SUM(available_equity) AS grand_total FROM member_equity_summary) gt;

    v_result := jsonb_build_object('status', 'completed', 'message', 'All approved, withdrawal processed');

  ELSIF v_rejected_count > 0 AND (v_rejected_count + v_approved_count) = v_total_approvers THEN
    UPDATE transactions SET status = 'rejected' WHERE id = p_transaction_id;

    INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
    VALUES (
      v_tx.user_id,
      'Withdrawal Rejected ❌',
      'Your withdrawal request of KES ' || TO_CHAR(v_tx.amount, 'FM999,999,999.00') || ' was rejected.',
      'error', '/transactions',
      jsonb_build_object('transaction_id', p_transaction_id, 'amount', v_tx.amount)
    );

    v_result := jsonb_build_object('status', 'rejected', 'message', 'Withdrawal rejected');

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

GRANT EXECUTE ON FUNCTION process_withdrawal_approval(UUID) TO authenticated;
