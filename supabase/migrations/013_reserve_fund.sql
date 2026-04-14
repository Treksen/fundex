-- ============================================================
-- Migration 013: Emergency Reserve Fund — Full Implementation
-- Run after 001-012
-- ============================================================

-- ── 1. RESERVE CONTRIBUTIONS HISTORY TABLE ───────────────────
-- Tracks every allocation into and withdrawal from the reserve.
CREATE TABLE IF NOT EXISTS reserve_contributions (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  direction       TEXT NOT NULL CHECK (direction IN ('allocate','withdraw')),
  amount          DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  source          TEXT NOT NULL CHECK (source IN (
                    'group_pool',     -- taken from the main group wallet
                    'investment_return', -- funded from an investment profit
                    'manual'          -- admin manually recorded contribution
                  )),
  reference_id    UUID,               -- optional: links to a transaction or investment
  notes           TEXT,
  approved_by     UUID REFERENCES profiles(id),
  created_by      UUID REFERENCES profiles(id) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reserve_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view reserve history"
  ON reserve_contributions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin manage reserve contributions"
  ON reserve_contributions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_reserve_created ON reserve_contributions(created_at);

-- ── 2. RESERVE TARGET / POLICY TABLE ─────────────────────────
-- Admin configures: target amount, % of pool, auto-contribute rules.
CREATE TABLE IF NOT EXISTS reserve_policy (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  target_amount        DECIMAL(15,2),           -- fixed KES target (optional)
  target_pct_of_pool   DECIMAL(5,2) DEFAULT 10, -- % of pool to maintain in reserve
  auto_allocate_on_deposit BOOLEAN DEFAULT FALSE, -- auto-skim each deposit
  auto_allocate_pct    DECIMAL(5,2) DEFAULT 2,   -- % to skim per deposit
  min_balance          DECIMAL(15,2) DEFAULT 0,  -- alert threshold
  is_active            BOOLEAN DEFAULT TRUE,
  updated_by           UUID REFERENCES profiles(id),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reserve_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view reserve policy"
  ON reserve_policy FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage reserve policy"
  ON reserve_policy FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Insert default policy
INSERT INTO reserve_policy (target_pct_of_pool, auto_allocate_on_deposit, auto_allocate_pct)
VALUES (10, FALSE, 2)
ON CONFLICT DO NOTHING;

-- ── 3. FIX: sync_virtual_account_balances INCLUDES RESERVE ───
-- The reserve balance = SUM of all 'allocate' - SUM of all 'withdraw' in reserve_contributions
CREATE OR REPLACE FUNCTION sync_virtual_account_balances()
RETURNS VOID AS $$
DECLARE v_member RECORD;
BEGIN
  -- Group wallet = total completed deposits - withdrawals - reserve allocations
  UPDATE virtual_accounts
  SET balance = (
    SELECT COALESCE(SUM(
      CASE WHEN type='deposit'    THEN  amount
           WHEN type='withdrawal' THEN -amount
           ELSE 0 END
    ), 0)
    FROM transactions WHERE status='completed'
  ) - (
    -- Subtract what has been moved to reserve
    SELECT COALESCE(SUM(
      CASE WHEN direction='allocate' THEN  amount
           WHEN direction='withdraw' THEN -amount
           ELSE 0 END
    ), 0)
    FROM reserve_contributions WHERE source = 'group_pool'
  ),
  updated_at = NOW()
  WHERE account_code = 'GROUP_WALLET';

  -- Member virtual accounts (unchanged)
  FOR v_member IN SELECT id FROM profiles LOOP
    PERFORM ensure_member_virtual_account(v_member.id);
    UPDATE virtual_accounts
    SET balance = (
      SELECT COALESCE(SUM(
        CASE WHEN t.type='deposit'    THEN  t.amount
             WHEN t.type='withdrawal' THEN -t.amount
             ELSE  t.amount END
      ), 0)
      FROM transactions t
      WHERE t.user_id = v_member.id AND t.status = 'completed'
    ), updated_at = NOW()
    WHERE account_code = 'MEMBER_' || v_member.id::TEXT;
  END LOOP;

  -- Investment wallet = total active investment capital
  UPDATE virtual_accounts
  SET balance = (
    SELECT COALESCE(SUM(amount_invested), 0)
    FROM investments
    WHERE status NOT IN ('completed','loss','closed')
  ), updated_at = NOW()
  WHERE account_code = 'INV_WALLET';

  -- *** RESERVE FUND = cumulative net contributions ***
  UPDATE virtual_accounts
  SET balance = (
    SELECT COALESCE(SUM(
      CASE WHEN direction='allocate' THEN  amount
           WHEN direction='withdraw' THEN -amount
           ELSE 0 END
    ), 0)
    FROM reserve_contributions
  ), updated_at = NOW()
  WHERE account_code = 'RESERVE_FUND';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION sync_virtual_account_balances() TO authenticated;

-- ── 4. FUNCTION: Allocate funds to reserve ───────────────────
CREATE OR REPLACE FUNCTION fund_emergency_reserve(
  p_amount      DECIMAL,
  p_source      TEXT,       -- 'group_pool' | 'investment_return' | 'manual'
  p_notes       TEXT,
  p_admin_id    UUID,
  p_reference   UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_group_balance  DECIMAL;
  v_reserve_balance DECIMAL;
  v_policy         RECORD;
BEGIN
  -- Admin check
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can fund the reserve');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  -- For group_pool source: check there are sufficient funds
  IF p_source = 'group_pool' THEN
    SELECT balance INTO v_group_balance
    FROM virtual_accounts WHERE account_code = 'GROUP_WALLET';

    IF v_group_balance < p_amount THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Insufficient group pool balance. Available: KES ' ||
                 TO_CHAR(v_group_balance, 'FM999,999,999.00')
      );
    END IF;
  END IF;

  -- Record the contribution
  INSERT INTO reserve_contributions
    (direction, amount, source, reference_id, notes, created_by, approved_by)
  VALUES
    ('allocate', p_amount, p_source, p_reference, p_notes, p_admin_id, p_admin_id);

  -- Sync all virtual account balances
  PERFORM sync_virtual_account_balances();

  -- Audit log
  INSERT INTO audit_logs (user_id, action, table_name, change_type)
  VALUES (
    p_admin_id,
    'Allocated KES ' || TO_CHAR(p_amount, 'FM999,999,999.00') ||
    ' to Emergency Reserve Fund from ' || p_source ||
    CASE WHEN p_notes IS NOT NULL THEN ' — ' || p_notes ELSE '' END,
    'virtual_accounts',
    'update'
  );

  -- Get updated reserve balance
  SELECT balance INTO v_reserve_balance
  FROM virtual_accounts WHERE account_code = 'RESERVE_FUND';

  -- Notify all members
  INSERT INTO notifications (user_id, title, message, type, action_url)
  SELECT
    id,
    '🛡️ Emergency Reserve Updated',
    'KES ' || TO_CHAR(p_amount, 'FM999,999,999.00') ||
    ' has been allocated to the Emergency Reserve Fund. New balance: KES ' ||
    TO_CHAR(v_reserve_balance, 'FM999,999,999.00'),
    'info',
    '/cashflow'
  FROM profiles;

  RETURN jsonb_build_object(
    'success', true,
    'amount_allocated', p_amount,
    'new_reserve_balance', v_reserve_balance,
    'source', p_source
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION fund_emergency_reserve(DECIMAL, TEXT, TEXT, UUID, UUID) TO authenticated;

-- ── 5. FUNCTION: Withdraw from reserve ───────────────────────
CREATE OR REPLACE FUNCTION withdraw_from_reserve(
  p_amount   DECIMAL,
  p_reason   TEXT,
  p_admin_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_reserve_balance DECIMAL;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can withdraw from reserve');
  END IF;

  SELECT balance INTO v_reserve_balance
  FROM virtual_accounts WHERE account_code = 'RESERVE_FUND';

  IF v_reserve_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reserve balance insufficient. Available: KES ' ||
               TO_CHAR(v_reserve_balance, 'FM999,999,999.00')
    );
  END IF;

  INSERT INTO reserve_contributions
    (direction, amount, source, notes, created_by, approved_by)
  VALUES
    ('withdraw', p_amount, 'manual', p_reason, p_admin_id, p_admin_id);

  PERFORM sync_virtual_account_balances();

  INSERT INTO audit_logs (user_id, action, table_name, change_type)
  VALUES (
    p_admin_id,
    'Withdrew KES ' || TO_CHAR(p_amount, 'FM999,999,999.00') ||
    ' from Emergency Reserve Fund — ' || p_reason,
    'virtual_accounts',
    'update'
  );

  -- Notify members
  INSERT INTO notifications (user_id, title, message, type, action_url)
  SELECT id,
    '⚠️ Emergency Reserve Withdrawal',
    'KES ' || TO_CHAR(p_amount, 'FM999,999,999.00') ||
    ' withdrawn from Emergency Reserve. Reason: ' || p_reason,
    'warning', '/cashflow'
  FROM profiles;

  RETURN jsonb_build_object(
    'success', true,
    'amount_withdrawn', p_amount,
    'new_balance', v_reserve_balance - p_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION withdraw_from_reserve(DECIMAL, TEXT, UUID) TO authenticated;

-- ── 6. VIEW: Reserve Fund Status ─────────────────────────────
CREATE OR REPLACE VIEW reserve_fund_status AS
SELECT
  va.balance                                          AS current_balance,
  rp.target_pct_of_pool,
  rp.auto_allocate_on_deposit,
  rp.auto_allocate_pct,
  rp.min_balance,
  -- Pool balance for reference
  (SELECT balance FROM virtual_accounts WHERE account_code = 'GROUP_WALLET')
    AS group_pool_balance,
  -- Target amount based on % of pool
  ROUND(
    (SELECT balance FROM virtual_accounts WHERE account_code = 'GROUP_WALLET')
    * rp.target_pct_of_pool / 100, 2
  )                                                   AS target_balance,
  -- How far from target (positive = surplus, negative = deficit)
  va.balance - ROUND(
    (SELECT balance FROM virtual_accounts WHERE account_code = 'GROUP_WALLET')
    * rp.target_pct_of_pool / 100, 2
  )                                                   AS vs_target,
  -- Percentage of target achieved
  CASE WHEN rp.target_pct_of_pool > 0 AND
            (SELECT balance FROM virtual_accounts WHERE account_code = 'GROUP_WALLET') > 0
    THEN ROUND(
      va.balance /
      NULLIF(
        (SELECT balance FROM virtual_accounts WHERE account_code = 'GROUP_WALLET')
        * rp.target_pct_of_pool / 100, 0
      ) * 100, 1)
    ELSE 0
  END                                                 AS pct_of_target,
  -- Is it healthy?
  CASE
    WHEN va.balance <= 0 THEN 'unfunded'
    WHEN va.balance < rp.min_balance THEN 'below_minimum'
    WHEN va.balance < ROUND(
      (SELECT balance FROM virtual_accounts WHERE account_code = 'GROUP_WALLET')
      * rp.target_pct_of_pool / 100, 2
    ) * 0.5 THEN 'low'
    WHEN va.balance < ROUND(
      (SELECT balance FROM virtual_accounts WHERE account_code = 'GROUP_WALLET')
      * rp.target_pct_of_pool / 100, 2
    ) THEN 'building'
    ELSE 'healthy'
  END                                                 AS health_status
FROM virtual_accounts va
CROSS JOIN (SELECT * FROM reserve_policy ORDER BY updated_at DESC LIMIT 1) rp
WHERE va.account_code = 'RESERVE_FUND';

-- ── 7. AUTO-SKIM ON DEPOSIT (optional, respects policy) ──────
-- When auto_allocate_on_deposit = TRUE, each completed deposit
-- automatically skims the configured % into the reserve.
CREATE OR REPLACE FUNCTION trg_auto_reserve_skim()
RETURNS TRIGGER AS $$
DECLARE
  v_policy  RECORD;
  v_skim    DECIMAL;
BEGIN
  -- Only fire on newly completed deposits
  IF NEW.type = 'deposit'
     AND NEW.status = 'completed'
     AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'completed')
  THEN
    SELECT * INTO v_policy
    FROM reserve_policy
    WHERE is_active = TRUE
    ORDER BY updated_at DESC
    LIMIT 1;

    IF v_policy.auto_allocate_on_deposit AND v_policy.auto_allocate_pct > 0 THEN
      v_skim := ROUND(NEW.amount * v_policy.auto_allocate_pct / 100, 2);

      IF v_skim > 0 THEN
        INSERT INTO reserve_contributions
          (direction, amount, source, reference_id, notes, created_by, approved_by)
        VALUES (
          'allocate', v_skim, 'group_pool', NEW.id,
          'Auto-skim ' || v_policy.auto_allocate_pct::TEXT ||
          '% of deposit ' || COALESCE(NEW.statement_no, LEFT(NEW.id::TEXT, 8)),
          NEW.user_id, NEW.created_by
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_reserve_skim ON transactions;
CREATE TRIGGER trg_reserve_skim
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION trg_auto_reserve_skim();

-- ── 8. Re-sync now ────────────────────────────────────────────
SELECT sync_virtual_account_balances();
