-- ============================================================
-- Migration 010: Fix Transaction Delete, Overdraft Logic,
--                Equity Calculation, and Member Loan Tracking
-- Run in Supabase SQL Editor after 001-009
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- FIX 1: ownership_snapshots FK missing ON DELETE action.
--   Postgres defaulted to RESTRICT, blocking transaction deletes.
--   Change to SET NULL so deleting a tx just nullifies the link.
-- ════════════════════════════════════════════════════════════

ALTER TABLE ownership_snapshots
  DROP CONSTRAINT IF EXISTS ownership_snapshots_transaction_id_fkey;

ALTER TABLE ownership_snapshots
  ADD CONSTRAINT ownership_snapshots_transaction_id_fkey
  FOREIGN KEY (transaction_id)
  REFERENCES transactions(id)
  ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════
-- FIX 2: member_equity_summary needs new columns (avatar_url,
--   computed loan_balance). CREATE OR REPLACE VIEW fails when
--   column positions change ("cannot change name of view column").
--
--   Solution: DROP the view CASCADE first. This also drops:
--     • ownership_integrity_check  (migration 006)
--     • group_health_score         (migration 009)
--   Both are recreated below immediately after.
-- ════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS ownership_integrity_check CASCADE;
DROP VIEW IF EXISTS group_health_score        CASCADE;
DROP VIEW IF EXISTS member_equity_summary     CASCADE;

-- ── member_equity_summary (rebuilt) ──────────────────────────
CREATE VIEW member_equity_summary AS
SELECT
  p.id,
  p.name,
  p.role,
  p.email,
  p.avatar_url,
  p.equity_status,
  -- Gross figures
  COALESCE(SUM(CASE WHEN t.type = 'deposit'    AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_deposits,
  COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_withdrawals,
  COALESCE(SUM(CASE WHEN t.type = 'adjustment' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_adjustments,
  -- Net equity: positive = has funds; negative = overdrawn / owes pool
  COALESCE(SUM(CASE
    WHEN t.type = 'deposit'    AND t.status = 'completed' THEN  t.amount
    WHEN t.type = 'withdrawal' AND t.status = 'completed' THEN -t.amount
    WHEN t.type = 'adjustment' AND t.status = 'completed' THEN  t.amount
    ELSE 0
  END), 0) AS available_equity,
  -- Loan balance = MAX(0, -(net equity)).
  -- Exactly 0 when available_equity >= 0 — never stale.
  GREATEST(0,
    -COALESCE(SUM(CASE
      WHEN t.type = 'deposit'    AND t.status = 'completed' THEN  t.amount
      WHEN t.type = 'withdrawal' AND t.status = 'completed' THEN -t.amount
      WHEN t.type = 'adjustment' AND t.status = 'completed' THEN  t.amount
      ELSE 0
    END), 0)
  ) AS loan_balance,
  -- Pending withdrawals (not yet approved)
  COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.status = 'pending' THEN t.amount ELSE 0 END), 0) AS pending_withdrawals
FROM profiles p
LEFT JOIN transactions t ON t.user_id = p.id
GROUP BY p.id, p.name, p.role, p.email, p.avatar_url, p.equity_status, p.loan_balance;

-- ── ownership_integrity_check (recreated from migration 006) ──
CREATE VIEW ownership_integrity_check AS
SELECT
  ROUND(SUM(
    CASE WHEN gt.grand_total > 0
    THEN (GREATEST(0, es.available_equity) / gt.grand_total) * 100
    ELSE 0 END
  ), 2) AS total_pct,
  COUNT(*) AS member_count,
  gt.grand_total
FROM member_equity_summary es
CROSS JOIN (
  SELECT COALESCE(SUM(GREATEST(0, available_equity)), 0) AS grand_total
  FROM member_equity_summary
) gt
GROUP BY gt.grand_total;

-- ── group_health_score (recreated from migration 009) ─────────
CREATE VIEW group_health_score AS
WITH equity AS (
  SELECT
    COALESCE(SUM(GREATEST(0, available_equity)), 0)      AS total_equity,
    COALESCE(SUM(total_deposits), 0)                     AS total_deposits,
    COALESCE(SUM(total_withdrawals), 0)                  AS total_withdrawals,
    COUNT(*)                                             AS member_count,
    COUNT(*) FILTER (WHERE equity_status = 'overdrawn')  AS overdrawn_count,
    COUNT(*) FILTER (WHERE equity_status = 'near_limit') AS near_limit_count
  FROM member_equity_summary
),
tx_stats AS (
  SELECT
    COUNT(*) FILTER (
      WHERE type = 'deposit' AND status = 'completed'
        AND transaction_date >= NOW() - INTERVAL '30 days'
    ) AS deposits_this_month,
    COUNT(*) FILTER (
      WHERE type = 'deposit' AND status = 'completed'
        AND transaction_date >= NOW() - INTERVAL '60 days'
        AND transaction_date <  NOW() - INTERVAL '30 days'
    ) AS deposits_last_month,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count
  FROM transactions
),
inv_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('closed','loss','completed')) AS active_investments,
    COALESCE(
      SUM(
        CASE WHEN actual_return > 0
        THEN ((actual_return - amount_invested) / NULLIF(amount_invested, 0)) * 100
        ELSE 0 END
      ) / NULLIF(COUNT(*) FILTER (WHERE actual_return > 0), 0),
    0) AS avg_roi
  FROM investments
)
SELECT
  e.total_equity,
  e.total_deposits,
  e.total_withdrawals,
  e.member_count,
  e.overdrawn_count,
  e.near_limit_count,
  t.deposits_this_month,
  t.deposits_last_month,
  t.pending_count,
  i.active_investments,
  COALESCE(i.avg_roi, 0) AS avg_investment_roi,
  LEAST(100, GREATEST(0,
    CASE WHEN e.total_deposits = 0 THEN 0 ELSE
      (50 * (1 - (e.total_withdrawals::DECIMAL / NULLIF(e.total_deposits, 0))))
      + (30 * LEAST(1, t.deposits_this_month::DECIMAL / NULLIF(e.member_count, 0) / 2))
      + (20 * (1 - LEAST(1, e.overdrawn_count::DECIMAL / NULLIF(e.member_count, 0))))
    END
  ))::INTEGER AS savings_strength,
  CASE
    WHEN e.overdrawn_count > 0 OR t.pending_count > 2 THEN 'High'
    WHEN e.near_limit_count > 0 OR t.pending_count > 0 THEN 'Medium'
    ELSE 'Low'
  END AS risk_level,
  CASE
    WHEN t.deposits_last_month = 0 AND t.deposits_this_month > 0 THEN 'High'
    WHEN t.deposits_last_month > 0
      AND t.deposits_this_month >= t.deposits_last_month THEN 'High'
    WHEN t.deposits_last_month > 0
      AND t.deposits_this_month >= t.deposits_last_month * 0.7 THEN 'Moderate'
    WHEN t.deposits_last_month > 0 AND t.deposits_this_month > 0 THEN 'Low'
    ELSE 'No Activity'
  END AS growth_rate
FROM equity e
CROSS JOIN tx_stats t
CROSS JOIN inv_stats i;

-- ════════════════════════════════════════════════════════════
-- FIX 3: recalculate_equity_status() — now syncs loan_balance
--   from live transaction data instead of a stale stored value.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION recalculate_equity_status(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_equity    DECIMAL(15,2);
  v_deposits  DECIMAL(15,2);
  v_loan      DECIMAL(15,2);
  v_status    TEXT;
  v_threshold DECIMAL := 0.15;
BEGIN
  SELECT available_equity, total_deposits, loan_balance
  INTO   v_equity, v_deposits, v_loan
  FROM   member_equity_summary
  WHERE  id = p_user_id;

  IF v_equity < 0 THEN
    v_status := 'overdrawn';
  ELSIF v_deposits > 0 AND v_equity < (v_deposits * v_threshold) THEN
    v_status := 'near_limit';
  ELSE
    v_status := 'safe';
  END IF;

  UPDATE profiles
  SET  equity_status = v_status,
       loan_balance  = v_loan
  WHERE id = p_user_id;

  RETURN v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION recalculate_equity_status(UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- FIX 4: process_withdrawal_approval() — recalculate ALL
--   members' equity after a withdrawal completes, and use
--   GREATEST(0, equity) in ownership snapshots so overdrawn
--   members never show negative ownership percentages.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_withdrawal_approval(p_transaction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_tx              RECORD;
  v_approved_count  INT;
  v_rejected_count  INT;
  v_total_approvers INT;
  v_result          JSONB;
  v_member          RECORD;
BEGIN
  SELECT t.*, p.name AS requester_name
  INTO   v_tx
  FROM   transactions t
  JOIN   profiles p ON p.id = t.user_id
  WHERE  t.id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found');
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'approved') AS approved,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
    COUNT(*)                                    AS total
  INTO v_approved_count, v_rejected_count, v_total_approvers
  FROM withdrawal_approvals
  WHERE transaction_id = p_transaction_id;

  UPDATE transactions SET approved_count = v_approved_count WHERE id = p_transaction_id;

  IF v_approved_count >= v_total_approvers AND v_total_approvers > 0 THEN

    UPDATE transactions SET status = 'completed', approved_at = NOW() WHERE id = p_transaction_id;

    FOR v_member IN SELECT id FROM profiles LOOP
      PERFORM recalculate_equity_status(v_member.id);
    END LOOP;

    INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
    VALUES (
      v_tx.user_id,
      'Withdrawal Approved ✅',
      'Your withdrawal of KES ' || TO_CHAR(v_tx.amount, 'FM999,999,999.00') || ' has been fully approved and processed.',
      'success', '/transactions',
      jsonb_build_object('transaction_id', p_transaction_id, 'amount', v_tx.amount)
    );

    INSERT INTO ownership_snapshots (user_id, percentage, total_contribution, transaction_id)
    SELECT
      p.id,
      CASE WHEN gt.grand_total > 0
        THEN ROUND((GREATEST(0, es.available_equity) / gt.grand_total) * 100, 4)
        ELSE 0
      END,
      GREATEST(0, es.available_equity),
      p_transaction_id
    FROM   profiles p
    JOIN   member_equity_summary es ON es.id = p.id
    CROSS JOIN (
      SELECT COALESCE(SUM(GREATEST(0, available_equity)), 0) AS grand_total
      FROM   member_equity_summary
    ) gt;

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

-- ════════════════════════════════════════════════════════════
-- FIX 5: Reinforce FK cascades so no table blocks tx deletes.
-- ════════════════════════════════════════════════════════════

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_transaction_id_fkey;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

ALTER TABLE bank_reconciliations
  DROP CONSTRAINT IF EXISTS bank_reconciliations_transaction_id_fkey;
ALTER TABLE bank_reconciliations
  ADD CONSTRAINT bank_reconciliations_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════
-- FIX 6: admin_delete_transaction() RPC — safe atomic delete
--   with audit log + full equity recalculation for all members.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_delete_transaction(
  p_tx_id         UUID,
  p_admin_user_id UUID,
  p_reason        TEXT DEFAULT 'Admin deleted'
)
RETURNS JSONB AS $$
DECLARE
  v_tx     RECORD;
  v_member RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_user_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can delete transactions');
  END IF;

  SELECT * INTO v_tx FROM transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  INSERT INTO audit_logs (user_id, action, table_name, record_id, change_type, old_values)
  VALUES (p_admin_user_id, 'Deleted transaction: ' || p_reason, 'transactions', p_tx_id, 'delete', to_jsonb(v_tx));

  DELETE FROM transactions WHERE id = p_tx_id;

  FOR v_member IN SELECT id FROM profiles LOOP
    PERFORM recalculate_equity_status(v_member.id);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'message', 'Transaction deleted and equity recalculated');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_delete_transaction(UUID, UUID, TEXT) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- FIX 7: ownership_percentages view — use net equity not gross.
-- ════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS ownership_percentages CASCADE;
CREATE VIEW ownership_percentages AS
WITH net AS (
  SELECT
    p.id,
    p.name,
    COALESCE(SUM(CASE
      WHEN t.type = 'deposit'    AND t.status = 'completed' THEN  t.amount
      WHEN t.type = 'withdrawal' AND t.status = 'completed' THEN -t.amount
      WHEN t.type = 'adjustment' AND t.status = 'completed' THEN  t.amount
      ELSE 0
    END), 0) AS net_equity,
    COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_deposits
  FROM profiles p
  LEFT JOIN transactions t ON t.user_id = p.id
  GROUP BY p.id, p.name
),
pool AS (
  SELECT COALESCE(SUM(GREATEST(0, net_equity)), 0) AS grand_total FROM net
)
SELECT
  n.id,
  n.name,
  n.net_equity,
  n.total_deposits,
  p.grand_total,
  CASE WHEN p.grand_total > 0
    THEN ROUND((GREATEST(0, n.net_equity) / p.grand_total) * 100, 4)
    ELSE 0
  END AS ownership_pct
FROM net n
CROSS JOIN pool p;

-- ════════════════════════════════════════════════════════════
-- BACKFILL: Fix stale equity_status and loan_balance on all
-- profiles using the corrected function.
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE v_member RECORD;
BEGIN
  FOR v_member IN SELECT id FROM profiles LOOP
    PERFORM recalculate_equity_status(v_member.id);
  END LOOP;
END;
$$;
