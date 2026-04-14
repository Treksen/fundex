-- ============================================================
-- Migration 009: Double-Entry Ledger, Group Health Score,
--                Running Balance, Reversal Transactions,
--                Statement Numbers, User Registration
-- Run after 001-008
-- ============================================================

-- ── 1. STATEMENT/TRANSACTION NUMBER ─────────────────────────
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS statement_no TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_reversal BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES transactions(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS running_balance DECIMAL(15,2);

-- Auto-generate statement number: FX-YYYY-NNNNNN
CREATE SEQUENCE IF NOT EXISTS tx_statement_seq START 1;

CREATE OR REPLACE FUNCTION assign_statement_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.statement_no IS NULL THEN
    NEW.statement_no := 'FX-' || TO_CHAR(NOW(), 'YYYY') || '-'
                     || LPAD(nextval('tx_statement_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_statement_number ON transactions;
CREATE TRIGGER trg_statement_number
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION assign_statement_number();

-- ── 2. DOUBLE-ENTRY LEDGER TABLE ────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  entry_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_name  TEXT NOT NULL,
  account_type  TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  debit         DECIMAL(15,2) DEFAULT 0,
  credit        DECIMAL(15,2) DEFAULT 0,
  description   TEXT,
  member_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ledger"
  ON ledger_entries FOR SELECT TO authenticated USING (true);

CREATE POLICY "System can insert ledger entries"
  ON ledger_entries FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account     ON ledger_entries(account_name);
CREATE INDEX IF NOT EXISTS idx_ledger_date        ON ledger_entries(entry_date);

-- ── 3. CREATE DOUBLE-ENTRY FOR A TRANSACTION ────────────────
CREATE OR REPLACE FUNCTION create_ledger_entries(p_tx_id UUID)
RETURNS VOID AS $$
DECLARE
  v_tx         RECORD;
  v_member_name TEXT;
BEGIN
  SELECT t.*, p.name AS member_name
  INTO v_tx
  FROM transactions t
  JOIN profiles p ON p.id = t.user_id
  WHERE t.id = p_tx_id;

  IF NOT FOUND THEN RETURN; END IF;

  v_member_name := v_tx.member_name;

  -- Idempotent: delete existing entries first
  DELETE FROM ledger_entries WHERE transaction_id = p_tx_id;

  IF v_tx.type = 'deposit' THEN
    -- DR Group Cash (asset ↑)
    INSERT INTO ledger_entries
      (transaction_id, entry_date, account_name, account_type, debit, credit, description, member_id)
    VALUES
      (p_tx_id, v_tx.transaction_date, 'Group Cash', 'asset',
       v_tx.amount, 0,
       'Cash deposit by ' || v_member_name, v_tx.user_id);
    -- CR Member Contribution (equity ↑)
    INSERT INTO ledger_entries
      (transaction_id, entry_date, account_name, account_type, debit, credit, description, member_id)
    VALUES
      (p_tx_id, v_tx.transaction_date, v_member_name || ' Contribution', 'equity',
       0, v_tx.amount,
       'Contribution from ' || v_member_name, v_tx.user_id);

  ELSIF v_tx.type = 'withdrawal' AND v_tx.status = 'completed' THEN
    -- DR Member Equity (equity ↓)
    INSERT INTO ledger_entries
      (transaction_id, entry_date, account_name, account_type, debit, credit, description, member_id)
    VALUES
      (p_tx_id, v_tx.transaction_date, v_member_name || ' Equity', 'equity',
       v_tx.amount, 0,
       'Withdrawal by ' || v_member_name, v_tx.user_id);
    -- CR Group Cash (asset ↓)
    INSERT INTO ledger_entries
      (transaction_id, entry_date, account_name, account_type, debit, credit, description, member_id)
    VALUES
      (p_tx_id, v_tx.transaction_date, 'Group Cash', 'asset',
       0, v_tx.amount,
       'Cash paid out to ' || v_member_name, v_tx.user_id);

  ELSIF v_tx.type = 'adjustment' THEN
    INSERT INTO ledger_entries
      (transaction_id, entry_date, account_name, account_type, debit, credit, description, member_id)
    VALUES
      (p_tx_id, v_tx.transaction_date, 'Adjustment Account', 'equity',
       v_tx.amount, 0,
       'Adjustment: ' || COALESCE(v_tx.description, ''), v_tx.user_id);
    INSERT INTO ledger_entries
      (transaction_id, entry_date, account_name, account_type, debit, credit, description, member_id)
    VALUES
      (p_tx_id, v_tx.transaction_date, v_member_name || ' Equity', 'equity',
       0, v_tx.amount,
       'Equity adjustment for ' || v_member_name, v_tx.user_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_ledger_entries(UUID) TO authenticated;

-- ── 4. REVERSAL TRANSACTION ──────────────────────────────────
CREATE OR REPLACE FUNCTION reverse_transaction(
  p_tx_id           UUID,
  p_reason          TEXT,
  p_reversed_by_user UUID
)
RETURNS UUID AS $$
DECLARE
  v_tx     RECORD;
  v_new_id UUID;
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

  -- Counter-transaction
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

  -- Ledger entries for the reversal
  PERFORM create_ledger_entries(v_new_id);

  -- Audit log
  INSERT INTO audit_logs (user_id, action, table_name, record_id, change_type)
  VALUES (
    p_reversed_by_user,
    'Reversed transaction: ' || p_reason,
    'transactions',
    v_new_id,
    'update'
  );

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reverse_transaction(UUID, TEXT, UUID) TO authenticated;

-- ── 5. TRANSACTION STATEMENT VIEW (with running balance) ─────
CREATE OR REPLACE VIEW transaction_statement AS
SELECT
  t.id,
  t.statement_no,
  t.user_id,
  p.name        AS member_name,
  p.avatar_url,
  t.type,
  t.amount,
  t.status,
  t.reference,
  t.description,
  t.transaction_date,
  t.is_reversal,
  t.reversed_by,
  t.reversal_reason,
  t.created_at,
  SUM(
    CASE WHEN t.status = 'completed' THEN
      CASE t.type
        WHEN 'deposit'    THEN  t.amount
        WHEN 'withdrawal' THEN -t.amount
        ELSE t.amount
      END
    ELSE 0 END
  ) OVER (
    ORDER BY t.transaction_date ASC, t.created_at ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM transactions t
JOIN profiles p ON p.id = t.user_id;

-- ── 6. GROUP HEALTH SCORE VIEW ───────────────────────────────
CREATE OR REPLACE VIEW group_health_score AS
WITH equity AS (
  SELECT
    COALESCE(SUM(GREATEST(0, available_equity)), 0)          AS total_equity,
    COALESCE(SUM(total_deposits), 0)                         AS total_deposits,
    COALESCE(SUM(total_withdrawals), 0)                      AS total_withdrawals,
    COUNT(*)                                                 AS member_count,
    COUNT(*) FILTER (WHERE equity_status = 'overdrawn')      AS overdrawn_count,
    COUNT(*) FILTER (WHERE equity_status = 'near_limit')     AS near_limit_count
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
    COUNT(*) FILTER (WHERE status NOT IN ('closed','loss','completed'))
      AS active_investments,
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
  -- Savings strength 0–100
  LEAST(100, GREATEST(0,
    CASE WHEN e.total_deposits = 0 THEN 0 ELSE
      (50 * (1 - (e.total_withdrawals::DECIMAL / NULLIF(e.total_deposits, 0))))
      + (30 * LEAST(1, t.deposits_this_month::DECIMAL / NULLIF(e.member_count, 0) / 2))
      + (20 * (1 - LEAST(1, e.overdrawn_count::DECIMAL / NULLIF(e.member_count, 0))))
    END
  ))::INTEGER AS savings_strength,
  -- Risk level
  CASE
    WHEN e.overdrawn_count > 0 OR t.pending_count > 2 THEN 'High'
    WHEN e.near_limit_count > 0 OR t.pending_count > 0 THEN 'Medium'
    ELSE 'Low'
  END AS risk_level,
  -- Growth rate
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

-- ── 7. MEMBER CONTRIBUTION CONSISTENCY VIEW ──────────────────
CREATE OR REPLACE VIEW member_contribution_consistency AS
SELECT
  p.id,
  p.name,
  (
    SELECT COUNT(DISTINCT DATE_TRUNC('month', t2.transaction_date))
    FROM transactions t2
    WHERE t2.user_id = p.id
      AND t2.type = 'deposit'
      AND t2.status = 'completed'
      AND t2.transaction_date >= NOW() - INTERVAL '6 months'
  ) AS active_months_6,
  COALESCE((
    SELECT SUM(t3.amount) / 6.0
    FROM transactions t3
    WHERE t3.user_id = p.id
      AND t3.type = 'deposit'
      AND t3.status = 'completed'
      AND t3.transaction_date >= NOW() - INTERVAL '6 months'
  ), 0) AS avg_monthly_deposit,
  (
    SELECT MAX(t4.transaction_date)
    FROM transactions t4
    WHERE t4.user_id = p.id
      AND t4.type = 'deposit'
      AND t4.status = 'completed'
  ) AS last_deposit_date,
  (
    SELECT COUNT(DISTINCT DATE_TRUNC('month', t5.transaction_date))
    FROM transactions t5
    WHERE t5.user_id = p.id
      AND t5.type = 'deposit'
      AND t5.status = 'completed'
      AND t5.transaction_date >= NOW() - INTERVAL '3 months'
  ) AS streak_3months
FROM profiles p;

-- ── 8. MEMBER INVITATIONS TABLE ──────────────────────────────
CREATE TABLE IF NOT EXISTS member_invitations (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  invite_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  accepted_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE member_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage invitations"
  ON member_invitations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ── 9. AUTO-CREATE LEDGER ENTRIES ON COMPLETION ──────────────
CREATE OR REPLACE FUNCTION auto_create_ledger_entries()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed'
     AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM create_ledger_entries(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_ledger ON transactions;
CREATE TRIGGER trg_auto_ledger
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION auto_create_ledger_entries();

-- ── 10. BACKFILL: Ledger entries for existing completed tx ───
-- Safe to re-run — entries are deleted + recreated per tx
DO $$
DECLARE
  v_tx RECORD;
BEGIN
  FOR v_tx IN
    SELECT id FROM transactions WHERE status = 'completed'
  LOOP
    PERFORM create_ledger_entries(v_tx.id);
  END LOOP;
END;
$$;

-- ── 11. BACKFILL: Statement numbers for existing transactions ─
-- Use a CTE to get IDs in chronological order, then UPDATE
UPDATE transactions t
SET statement_no = sub.new_no
FROM (
  SELECT
    id,
    'FX-' || TO_CHAR(created_at, 'YYYY') || '-'
           || LPAD(ROW_NUMBER() OVER (ORDER BY created_at, id)::TEXT, 6, '0')
           AS new_no
  FROM transactions
  WHERE statement_no IS NULL
) sub
WHERE t.id = sub.id;
