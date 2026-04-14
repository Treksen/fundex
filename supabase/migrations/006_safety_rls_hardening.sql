-- ============================================================
-- Migration 006: Financial Safety Rules + RLS Hardening
-- Run in Supabase SQL Editor after 001-005
-- ============================================================

-- ── 1. PREVENT NEGATIVE / ZERO AMOUNTS ──────────────────────
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_amount_positive;
ALTER TABLE transactions ADD CONSTRAINT chk_amount_positive
  CHECK (amount > 0);

-- ── 2. PREVENT DUPLICATE TRANSACTIONS ───────────────────────
-- Same member, same type, same amount, same reference within 60 seconds
CREATE UNIQUE INDEX IF NOT EXISTS idx_no_duplicate_tx
  ON transactions (user_id, type, amount, reference)
  WHERE reference IS NOT NULL AND status != 'rejected';

-- ── 3. PREVENT ORPHAN TRANSACTIONS ──────────────────────────
-- Already enforced by FK, but add explicit NOT NULL guard
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN created_by SET NOT NULL;

-- ── 4. OWNERSHIP INTEGRITY VIEW ─────────────────────────────
-- Always sums to 100% — used by API to validate splits
CREATE OR REPLACE VIEW ownership_integrity_check AS
SELECT
  ROUND(SUM(
    CASE WHEN gt.grand_total > 0
    THEN (GREATEST(0, es.available_equity) / gt.grand_total) * 100
    ELSE 0 END
  ), 2) AS total_pct,
  COUNT(*) AS member_count,
  gt.grand_total
FROM member_equity_summary es
CROSS JOIN (SELECT COALESCE(SUM(GREATEST(0, available_equity)), 0) AS grand_total FROM member_equity_summary) gt
GROUP BY gt.grand_total;

-- ── 5. TRANSACTION VALIDATION FUNCTION ──────────────────────
-- Called server-side before any financial insert
CREATE OR REPLACE FUNCTION validate_transaction(
  p_user_id UUID,
  p_type TEXT,
  p_amount DECIMAL,
  p_reference TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_equity DECIMAL;
  v_pending DECIMAL;
  v_profile RECORD;
BEGIN
  -- Null / invalid checks
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Member ID is required');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Amount must be greater than zero');
  END IF;
  IF p_type NOT IN ('deposit','withdrawal','adjustment') THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid transaction type');
  END IF;

  -- Member must exist and not be deleted
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Member not found');
  END IF;

  -- Withdrawal checks
  IF p_type = 'withdrawal' THEN
    SELECT available_equity, pending_withdrawals
    INTO v_equity, v_pending
    FROM member_equity_summary WHERE id = p_user_id;

    -- Hard block: cannot withdraw more than 2× their total deposits (extreme fraud guard)
    IF p_amount > (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id = p_user_id AND type = 'deposit' AND status = 'completed') * 2 THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Withdrawal amount exceeds absolute maximum (2× total deposits)');
    END IF;
  END IF;

  -- Duplicate check (same reference + same member within 5 minutes)
  IF p_reference IS NOT NULL AND p_reference != '' THEN
    IF EXISTS (
      SELECT 1 FROM transactions
      WHERE user_id = p_user_id
        AND reference = p_reference
        AND type = p_type
        AND created_at > NOW() - INTERVAL '5 minutes'
        AND status != 'rejected'
    ) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Duplicate transaction: same reference exists within the last 5 minutes');
    END IF;
  END IF;

  RETURN jsonb_build_object('valid', true, 'equity', COALESCE(v_equity, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION validate_transaction(UUID, TEXT, DECIMAL, TEXT) TO authenticated;

-- ── 6. RLS HARDENING ────────────────────────────────────────

-- Transactions: members can only INSERT for themselves; admins can do anything
DROP POLICY IF EXISTS "Authenticated users can create transactions" ON transactions;
CREATE POLICY "Members insert own transactions"
  ON transactions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      auth.uid() = user_id
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    )
  );

-- Transactions UPDATE: only admins (and the process_withdrawal_approval RPC via SECURITY DEFINER)
DROP POLICY IF EXISTS "Authenticated can update transactions" ON transactions;
CREATE POLICY "Admins can update transactions"
  ON transactions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (true);

-- Transactions DELETE: admin only
DROP POLICY IF EXISTS "Admins can delete transactions" ON transactions;
CREATE POLICY "Admins can delete transactions"
  ON transactions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Audit logs: only admin can read
DROP POLICY IF EXISTS "Admin can view audit logs" ON audit_logs;
CREATE POLICY "Admin only audit logs"
  ON audit_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Profiles DELETE: admin only (to handle user deletion)
DROP POLICY IF EXISTS "Admin can delete profiles" ON profiles;
CREATE POLICY "Admin can delete profiles"
  ON profiles FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Notifications: only insert if user_id is valid profile
DROP POLICY IF EXISTS "System can create notifications" ON notifications;
CREATE POLICY "Authenticated create notifications"
  ON notifications FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = user_id));

-- ── 7. HANDLE MISSING/DELETED USERS ─────────────────────────
-- Set created_by to NULL (not cascade-delete) when profile is removed
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_created_by_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- ── 8. PREVENT SILENT OVER-WITHDRAWALS TRIGGER ──────────────
CREATE OR REPLACE FUNCTION check_withdrawal_before_insert()
RETURNS TRIGGER AS $$
DECLARE v_equity DECIMAL;
BEGIN
  IF NEW.type = 'withdrawal' AND NEW.status = 'pending' THEN
    SELECT available_equity INTO v_equity
    FROM member_equity_summary WHERE id = NEW.user_id;
    -- Flag as potential overdraft in description if exceeds equity
    IF NEW.amount > COALESCE(v_equity, 0) AND NOT COALESCE(NEW.is_loan, FALSE) THEN
      NEW.description := COALESCE(NEW.description || ' ', '') || '[EXCEEDS EQUITY]';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_withdrawal ON transactions;
CREATE TRIGGER trg_check_withdrawal
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION check_withdrawal_before_insert();

