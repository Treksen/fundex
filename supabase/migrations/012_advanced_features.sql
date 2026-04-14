-- ============================================================
-- Migration 012: Advanced Features
--   - Universal Approval Workflows (2-of-3 governance)
--   - Virtual Account System
--   - Capital Accounts & Profit Allocation
--   - Cash Flow & Liquidity Projections
--   - Member Reliability Scores
--   - Decision Support Engine
-- Run after 001-011
-- ============================================================

-- ── 1. UNIVERSAL APPROVAL WORKFLOWS ─────────────────────────
-- Extends approval governance beyond withdrawals to investments,
-- dividend distributions, large deposits, and adjustments.

CREATE TABLE IF NOT EXISTS action_approvals (
  id             UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  action_type    TEXT NOT NULL CHECK (action_type IN (
                   'investment_create','investment_distribute',
                   'large_deposit','adjustment','dividend_distribute'
                 )),
  reference_id   UUID NOT NULL,          -- investments.id / transactions.id
  reference_type TEXT NOT NULL,          -- 'investment','transaction'
  title          TEXT NOT NULL,          -- human-readable summary
  amount         DECIMAL(15,2),
  requested_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','cancelled')),
  min_approvals  INTEGER NOT NULL DEFAULT 2, -- 2-of-3 rule
  approved_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  resolved_at    TIMESTAMPTZ,
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_approval_votes (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  approval_id UUID REFERENCES action_approvals(id) ON DELETE CASCADE,
  voter_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  vote        TEXT NOT NULL CHECK (vote IN ('approve','reject')),
  reason      TEXT,
  voted_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (approval_id, voter_id)
);

ALTER TABLE action_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_approval_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view approvals"
  ON action_approvals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Members can create approvals"
  ON action_approvals FOR INSERT TO authenticated WITH CHECK (auth.uid() = requested_by);
CREATE POLICY "Admin can update approvals"
  ON action_approvals FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Members can vote"
  ON action_approval_votes FOR ALL TO authenticated
  USING (auth.uid() = voter_id) WITH CHECK (auth.uid() = voter_id);
CREATE POLICY "All can view votes"
  ON action_approval_votes FOR SELECT TO authenticated USING (true);

-- Function: cast vote and check if threshold is met
CREATE OR REPLACE FUNCTION cast_action_vote(
  p_approval_id UUID,
  p_voter_id    UUID,
  p_vote        TEXT,  -- 'approve' or 'reject'
  p_reason      TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_appr   RECORD;
  v_approved INT;
  v_rejected INT;
  v_total    INT;
BEGIN
  SELECT * INTO v_appr FROM action_approvals WHERE id = p_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Approval not found'); END IF;
  IF v_appr.status != 'pending' THEN RETURN jsonb_build_object('error','Already resolved'); END IF;
  IF v_appr.requested_by = p_voter_id THEN RETURN jsonb_build_object('error','Cannot vote on own request'); END IF;

  INSERT INTO action_approval_votes (approval_id, voter_id, vote, reason)
  VALUES (p_approval_id, p_voter_id, p_vote, p_reason)
  ON CONFLICT (approval_id, voter_id) DO UPDATE SET vote = p_vote, reason = p_reason, voted_at = NOW();

  SELECT
    COUNT(*) FILTER (WHERE vote='approve'),
    COUNT(*) FILTER (WHERE vote='reject'),
    COUNT(*)
  INTO v_approved, v_rejected, v_total
  FROM action_approval_votes WHERE approval_id = p_approval_id;

  UPDATE action_approvals
  SET approved_count = v_approved, rejected_count = v_rejected, updated_at = NOW()
  WHERE id = p_approval_id;

  -- Check threshold (2-of-3: 2 approvals = pass, any 2 rejections = fail)
  IF v_approved >= v_appr.min_approvals THEN
    UPDATE action_approvals SET status='approved', resolved_at=NOW() WHERE id=p_approval_id;
    RETURN jsonb_build_object('status','approved','approved',v_approved,'total',v_total);
  ELSIF v_rejected >= v_appr.min_approvals THEN
    UPDATE action_approvals SET status='rejected', resolved_at=NOW() WHERE id=p_approval_id;
    RETURN jsonb_build_object('status','rejected','rejected',v_rejected,'total',v_total);
  ELSE
    RETURN jsonb_build_object('status','pending','approved',v_approved,'rejected',v_rejected,'total',v_total,'needed',v_appr.min_approvals);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION cast_action_vote(UUID,UUID,TEXT,TEXT) TO authenticated;

-- ── 2. VIRTUAL ACCOUNT SYSTEM ────────────────────────────────
CREATE TABLE IF NOT EXISTS virtual_accounts (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  account_code TEXT NOT NULL UNIQUE,       -- 'GROUP_WALLET','INV_WALLET','MEMBER_{id}'
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('group','investment','member','reserve')),
  member_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  balance      DECIMAL(15,2) NOT NULL DEFAULT 0,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS virtual_transfers (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  from_account UUID REFERENCES virtual_accounts(id),
  to_account   UUID REFERENCES virtual_accounts(id),
  amount       DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  description  TEXT,
  reference_tx UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE virtual_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view virtual accounts" ON virtual_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated view transfers" ON virtual_transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage virtual accounts" ON virtual_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin'));
CREATE POLICY "System can insert transfers" ON virtual_transfers FOR INSERT TO authenticated WITH CHECK (true);

-- Seed default virtual accounts
INSERT INTO virtual_accounts (account_code, account_name, account_type)
VALUES
  ('GROUP_WALLET',  'Group Main Wallet',        'group'),
  ('INV_WALLET',    'Investment Wallet',         'investment'),
  ('RESERVE_FUND',  'Emergency Reserve Fund',    'reserve')
ON CONFLICT (account_code) DO NOTHING;

-- Member virtual accounts: created via function
CREATE OR REPLACE FUNCTION ensure_member_virtual_account(p_member_id UUID)
RETURNS UUID AS $$
DECLARE v_id UUID; v_name TEXT;
BEGIN
  SELECT name INTO v_name FROM profiles WHERE id = p_member_id;
  INSERT INTO virtual_accounts (account_code, account_name, account_type, member_id)
  VALUES ('MEMBER_'||p_member_id::TEXT, v_name||' Account', 'member', p_member_id)
  ON CONFLICT (account_code) DO NOTHING;
  SELECT id INTO v_id FROM virtual_accounts WHERE account_code = 'MEMBER_'||p_member_id::TEXT;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION ensure_member_virtual_account(UUID) TO authenticated;

-- Sync virtual account balances from transactions
CREATE OR REPLACE FUNCTION sync_virtual_account_balances()
RETURNS VOID AS $$
DECLARE v_member RECORD;
BEGIN
  -- Group wallet = total completed deposits - total completed withdrawals
  UPDATE virtual_accounts
  SET balance = (
    SELECT COALESCE(SUM(
      CASE WHEN type='deposit' THEN amount
           WHEN type='withdrawal' THEN -amount
           ELSE 0 END
    ),0)
    FROM transactions WHERE status='completed'
  ), updated_at = NOW()
  WHERE account_code = 'GROUP_WALLET';

  -- Member accounts
  FOR v_member IN SELECT id FROM profiles LOOP
    PERFORM ensure_member_virtual_account(v_member.id);
    UPDATE virtual_accounts
    SET balance = (
      SELECT COALESCE(SUM(
        CASE WHEN t.type='deposit' THEN t.amount
             WHEN t.type='withdrawal' THEN -t.amount
             ELSE t.amount END
      ),0)
      FROM transactions t WHERE t.user_id=v_member.id AND t.status='completed'
    ), updated_at = NOW()
    WHERE account_code = 'MEMBER_'||v_member.id::TEXT;
  END LOOP;

  -- Investment wallet = total invested - distributed
  UPDATE virtual_accounts
  SET balance = (
    SELECT COALESCE(SUM(amount_invested),0) FROM investments WHERE status NOT IN ('completed','loss','closed')
  ), updated_at = NOW()
  WHERE account_code = 'INV_WALLET';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION sync_virtual_account_balances() TO authenticated;

-- Auto-sync on every completed transaction
CREATE OR REPLACE FUNCTION trg_sync_virtual_on_tx()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status='completed' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM sync_virtual_account_balances();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_virtual_sync ON transactions;
CREATE TRIGGER trg_virtual_sync
  AFTER INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION trg_sync_virtual_on_tx();

-- ── 3. CAPITAL ACCOUNTS & PROFIT ALLOCATION ──────────────────
CREATE TABLE IF NOT EXISTS capital_accounts (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  member_id        UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  -- Cumulative capital contributions
  paid_in_capital  DECIMAL(15,2) NOT NULL DEFAULT 0,
  -- Retained earnings: accumulated profit allocations
  retained_earnings DECIMAL(15,2) NOT NULL DEFAULT 0,
  -- Current year profit share
  current_year_profit DECIMAL(15,2) NOT NULL DEFAULT 0,
  -- Carry-forward from prior years
  carry_forward    DECIMAL(15,2) NOT NULL DEFAULT 0,
  -- Total capital = paid_in + retained + carry_forward
  total_capital    DECIMAL(15,2) GENERATED ALWAYS AS
                     (paid_in_capital + retained_earnings + carry_forward) STORED,
  last_updated     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE capital_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view own capital" ON capital_accounts FOR SELECT TO authenticated
  USING (member_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin'));
CREATE POLICY "System update capital" ON capital_accounts FOR ALL TO authenticated WITH CHECK (true);

-- Profit allocation log
CREATE TABLE IF NOT EXISTS profit_allocations (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  investment_id   UUID REFERENCES investments(id) ON DELETE SET NULL,
  member_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  period_label    TEXT NOT NULL,           -- e.g. 'Q1 2026'
  gross_profit    DECIMAL(15,2) NOT NULL,
  ownership_pct   DECIMAL(8,4) NOT NULL,
  allocated_amount DECIMAL(15,2) NOT NULL,
  allocation_type TEXT NOT NULL DEFAULT 'dividend'
                    CHECK (allocation_type IN ('dividend','adjustment','carry_forward')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profit_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view allocations" ON profit_allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "System insert allocations" ON profit_allocations FOR INSERT TO authenticated WITH CHECK (true);

-- Function: sync capital accounts from transactions + dividends
CREATE OR REPLACE FUNCTION sync_capital_accounts()
RETURNS VOID AS $$
DECLARE v_member RECORD;
BEGIN
  FOR v_member IN SELECT id FROM profiles LOOP
    INSERT INTO capital_accounts (member_id, paid_in_capital, retained_earnings, current_year_profit)
    SELECT
      v_member.id,
      COALESCE(SUM(CASE WHEN t.type='deposit' AND t.status='completed' THEN t.amount ELSE 0 END),0),
      COALESCE((SELECT SUM(d.amount) FROM dividends d WHERE d.user_id=v_member.id),0),
      COALESCE((SELECT SUM(d.amount) FROM dividends d WHERE d.user_id=v_member.id
                AND EXTRACT(YEAR FROM d.distribution_date)=EXTRACT(YEAR FROM NOW())),0)
    FROM transactions t WHERE t.user_id=v_member.id
    ON CONFLICT (member_id) DO UPDATE SET
      paid_in_capital     = EXCLUDED.paid_in_capital,
      retained_earnings   = EXCLUDED.retained_earnings,
      current_year_profit = EXCLUDED.current_year_profit,
      last_updated        = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION sync_capital_accounts() TO authenticated;

-- ── 4. CASH FLOW PROJECTIONS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_flow_projections (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  projection_date DATE NOT NULL,
  projected_inflow  DECIMAL(15,2) DEFAULT 0,
  projected_outflow DECIMAL(15,2) DEFAULT 0,
  projected_balance DECIMAL(15,2) DEFAULT 0,
  actual_balance    DECIMAL(15,2),
  notes           TEXT,
  generated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cash_flow_projections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view projections" ON cash_flow_projections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage projections" ON cash_flow_projections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin'));

-- Generate 90-day cash flow forecast based on historical patterns
CREATE OR REPLACE FUNCTION generate_cash_flow_forecast(p_days INT DEFAULT 90)
RETURNS JSONB AS $$
DECLARE
  v_current_balance  DECIMAL;
  v_avg_monthly_in   DECIMAL;
  v_avg_monthly_out  DECIMAL;
  v_avg_daily_in     DECIMAL;
  v_avg_daily_out    DECIMAL;
  v_days_count       INT;
  v_projected        DECIMAL;
  v_result           JSONB;
  v_30day            DECIMAL;
  v_60day            DECIMAL;
  v_90day            DECIMAL;
  v_safe_invest_cap  DECIMAL;
  v_liquidity_ratio  DECIMAL;
BEGIN
  -- Current pool balance
  SELECT COALESCE(SUM(GREATEST(0, available_equity)),0)
  INTO v_current_balance FROM member_equity_summary;

  -- Historical monthly average (last 6 months)
  SELECT
    COALESCE(AVG(mo_in),0),
    COALESCE(AVG(mo_out),0)
  INTO v_avg_monthly_in, v_avg_monthly_out
  FROM (
    SELECT
      DATE_TRUNC('month', transaction_date) AS mo,
      SUM(CASE WHEN type='deposit'    AND status='completed' THEN amount ELSE 0 END) AS mo_in,
      SUM(CASE WHEN type='withdrawal' AND status='completed' THEN amount ELSE 0 END) AS mo_out
    FROM transactions
    WHERE transaction_date >= NOW() - INTERVAL '6 months'
    GROUP BY 1
  ) t;

  v_avg_daily_in  := v_avg_monthly_in  / 30.0;
  v_avg_daily_out := v_avg_monthly_out / 30.0;

  -- Project forward
  v_30day := v_current_balance + (v_avg_daily_in - v_avg_daily_out) * 30;
  v_60day := v_current_balance + (v_avg_daily_in - v_avg_daily_out) * 60;
  v_90day := v_current_balance + (v_avg_daily_in - v_avg_daily_out) * 90;

  -- Safe investment capacity (keep 30% as liquid reserve)
  v_safe_invest_cap := GREATEST(0, v_current_balance * 0.70);

  -- Liquidity ratio: current balance / avg monthly outflow
  v_liquidity_ratio := CASE WHEN v_avg_monthly_out > 0
    THEN ROUND(v_current_balance / v_avg_monthly_out, 2) ELSE 99 END;

  -- Upsert 30/60/90 day projections
  DELETE FROM cash_flow_projections
  WHERE projection_date IN (
    CURRENT_DATE + 30, CURRENT_DATE + 60, CURRENT_DATE + 90
  );
  INSERT INTO cash_flow_projections
    (projection_date, projected_inflow, projected_outflow, projected_balance)
  VALUES
    (CURRENT_DATE+30, v_avg_daily_in*30, v_avg_daily_out*30, v_30day),
    (CURRENT_DATE+60, v_avg_daily_in*60, v_avg_daily_out*60, v_60day),
    (CURRENT_DATE+90, v_avg_daily_in*90, v_avg_daily_out*90, v_90day);

  v_result := jsonb_build_object(
    'current_balance',     v_current_balance,
    'avg_monthly_inflow',  v_avg_monthly_in,
    'avg_monthly_outflow', v_avg_monthly_out,
    'projected_30d',       v_30day,
    'projected_60d',       v_60day,
    'projected_90d',       v_90day,
    'safe_invest_cap',     v_safe_invest_cap,
    'liquidity_ratio',     v_liquidity_ratio,
    'liquidity_months',    v_liquidity_ratio,
    'risk_flag',           CASE
      WHEN v_30day < 0 THEN 'critical'
      WHEN v_30day < v_current_balance * 0.3 THEN 'warning'
      ELSE 'safe' END
  );
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION generate_cash_flow_forecast(INT) TO authenticated;

-- ── 5. MEMBER RELIABILITY / BEHAVIOR SCORE ───────────────────
CREATE OR REPLACE VIEW member_reliability_scores AS
WITH
base AS (
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    -- Total completed deposits count
    COUNT(t.id) FILTER (WHERE t.type='deposit' AND t.status='completed') AS deposit_count,
    -- Total completed withdrawals count
    COUNT(t.id) FILTER (WHERE t.type='withdrawal' AND t.status='completed') AS withdrawal_count,
    -- Active months in last 12
    COUNT(DISTINCT DATE_TRUNC('month', t.transaction_date))
      FILTER (WHERE t.type='deposit' AND t.status='completed'
              AND t.transaction_date >= NOW()-INTERVAL '12 months') AS active_months_12,
    -- On-time: deposits in first 7 days of month
    COUNT(t.id) FILTER (
      WHERE t.type='deposit' AND t.status='completed'
        AND EXTRACT(DAY FROM t.transaction_date) <= 7
    ) AS early_deposits,
    -- Late: deposits after day 20
    COUNT(t.id) FILTER (
      WHERE t.type='deposit' AND t.status='completed'
        AND EXTRACT(DAY FROM t.transaction_date) > 20
    ) AS late_deposits,
    -- Large withdrawals (>50% of their equity at time)
    COUNT(t.id) FILTER (WHERE t.type='withdrawal' AND t.status='completed') AS total_withdrawals,
    -- Total deposited
    COALESCE(SUM(t.amount) FILTER (WHERE t.type='deposit' AND t.status='completed'),0) AS total_deposited,
    -- Total withdrawn
    COALESCE(SUM(t.amount) FILTER (WHERE t.type='withdrawal' AND t.status='completed'),0) AS total_withdrawn
  FROM profiles p
  LEFT JOIN transactions t ON t.user_id = p.id
  GROUP BY p.id, p.name, p.avatar_url
),
scored AS (
  SELECT *,
    -- Consistency score: 0-40 pts (active_months_12 / 12 * 40)
    LEAST(40, ROUND((active_months_12::DECIMAL / 12) * 40)) AS consistency_pts,
    -- Punctuality score: 0-30 pts
    CASE WHEN (early_deposits + late_deposits) = 0 THEN 15
         ELSE LEAST(30, ROUND((early_deposits::DECIMAL / NULLIF(early_deposits+late_deposits,0)) * 30))
    END AS punctuality_pts,
    -- Retention score: 0-30 pts (net retention of funds)
    CASE WHEN total_deposited = 0 THEN 30
         ELSE LEAST(30, ROUND((1 - LEAST(1, total_withdrawn::DECIMAL / NULLIF(total_deposited,0))) * 30))
    END AS retention_pts
  FROM base
)
SELECT
  id,
  name,
  avatar_url,
  deposit_count,
  withdrawal_count,
  active_months_12,
  early_deposits,
  late_deposits,
  total_deposited,
  total_withdrawn,
  consistency_pts,
  punctuality_pts,
  retention_pts,
  (consistency_pts + punctuality_pts + retention_pts) AS reliability_score,
  CASE
    WHEN (consistency_pts + punctuality_pts + retention_pts) >= 80 THEN 'Excellent'
    WHEN (consistency_pts + punctuality_pts + retention_pts) >= 60 THEN 'Good'
    WHEN (consistency_pts + punctuality_pts + retention_pts) >= 40 THEN 'Fair'
    ELSE 'Needs Improvement'
  END AS reliability_label,
  CASE
    WHEN (consistency_pts + punctuality_pts + retention_pts) >= 80 THEN '🌟'
    WHEN (consistency_pts + punctuality_pts + retention_pts) >= 60 THEN '✅'
    WHEN (consistency_pts + punctuality_pts + retention_pts) >= 40 THEN '🟡'
    ELSE '⚠️'
  END AS reliability_icon
FROM scored;

-- ── 6. DECISION SUPPORT ENGINE ───────────────────────────────
CREATE OR REPLACE FUNCTION get_decision_advice(p_amount DECIMAL, p_action TEXT)
RETURNS JSONB AS $$
DECLARE
  v_pool          DECIMAL;
  v_invested      DECIMAL;
  v_avg_roi       DECIMAL;
  v_safe_cap      DECIMAL;
  v_liq_ratio     DECIMAL;
  v_30d           DECIMAL;
  v_pending_out   DECIMAL;
  v_advice        JSONB;
  v_warnings      TEXT[] := '{}';
  v_tips          TEXT[] := '{}';
  v_recommendation TEXT;
BEGIN
  SELECT COALESCE(SUM(GREATEST(0,available_equity)),0) INTO v_pool FROM member_equity_summary;
  SELECT COALESCE(SUM(amount_invested),0) INTO v_invested FROM investments WHERE status NOT IN ('closed','loss','completed');
  SELECT COALESCE(AVG(((actual_return-amount_invested)/NULLIF(amount_invested,0))*100),0)
    INTO v_avg_roi FROM investments WHERE actual_return > 0;
  SELECT COALESCE(SUM(amount),0) INTO v_pending_out
    FROM transactions WHERE type='withdrawal' AND status='pending';

  v_safe_cap := GREATEST(0, v_pool * 0.70);
  v_liq_ratio := CASE WHEN v_pool > 0 THEN
    ROUND((v_pool - v_invested) / v_pool * 100, 1) ELSE 0 END;

  -- 30-day projection
  SELECT projected_balance INTO v_30d
  FROM cash_flow_projections
  WHERE projection_date = CURRENT_DATE + 30
  LIMIT 1;
  IF v_30d IS NULL THEN v_30d := v_pool; END IF;

  IF p_action = 'invest' THEN
    v_safe_cap := GREATEST(0, (v_pool - v_pending_out) * 0.70);

    IF p_amount > v_safe_cap THEN
      v_warnings := array_append(v_warnings,
        'This investment exceeds the safe capacity of ' || formatcurrency_kes(v_safe_cap) ||
        '. Liquidity will drop dangerously low.');
      v_recommendation := 'not_recommended';
    ELSIF (v_pool - p_amount) < v_pool * 0.30 THEN
      v_warnings := array_append(v_warnings,
        'Liquidity will drop below the 30% reserve threshold after this investment.');
      v_recommendation := 'caution';
    ELSE
      v_recommendation := 'safe';
    END IF;

    v_tips := array_append(v_tips, 'Safe investment capacity: ' || formatcurrency_kes(v_safe_cap));
    v_tips := array_append(v_tips, 'Remaining liquid after investment: ' || formatcurrency_kes(v_pool - p_amount));
    IF v_avg_roi > 0 THEN
      v_tips := array_append(v_tips, 'Your group average ROI is ' || ROUND(v_avg_roi,1)::TEXT || '%. Aim above this.');
    END IF;

  ELSIF p_action = 'withdraw' THEN
    IF p_amount > v_pool * 0.40 THEN
      v_warnings := array_append(v_warnings,
        'This withdrawal is over 40% of the group pool — it will impact other members significantly.');
    END IF;
    IF v_30d - p_amount < v_pool * 0.20 THEN
      v_warnings := array_append(v_warnings,
        '30-day projected balance after withdrawal: ' || formatcurrency_kes(v_30d - p_amount) ||
        '. Liquidity risk is elevated.');
      v_recommendation := 'caution';
    ELSE
      v_recommendation := 'safe';
    END IF;
    v_tips := array_append(v_tips, '30-day projected pool balance: ' || formatcurrency_kes(v_30d));

  ELSIF p_action = 'deposit' THEN
    v_recommendation := 'safe';
    v_tips := array_append(v_tips, 'Great! This deposit will increase the pool to ' || formatcurrency_kes(v_pool + p_amount));
  END IF;

  v_advice := jsonb_build_object(
    'action',          p_action,
    'amount',          p_amount,
    'pool_balance',    v_pool,
    'safe_capacity',   v_safe_cap,
    'liquidity_pct',   v_liq_ratio,
    'projected_30d',   v_30d,
    'avg_group_roi',   ROUND(v_avg_roi,2),
    'recommendation',  COALESCE(v_recommendation,'safe'),
    'warnings',        to_jsonb(v_warnings),
    'tips',            to_jsonb(v_tips)
  );
  RETURN v_advice;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION get_decision_advice(DECIMAL, TEXT) TO authenticated;

-- Helper to format currency in plpgsql
CREATE OR REPLACE FUNCTION formatcurrency_kes(v DECIMAL)
RETURNS TEXT AS $$
BEGIN RETURN 'KES ' || TO_CHAR(v, 'FM999,999,999.00'); END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 7. BACKFILL ───────────────────────────────────────────────
-- Create member virtual accounts for existing members
DO $$
DECLARE v_m RECORD;
BEGIN
  FOR v_m IN SELECT id FROM profiles LOOP
    PERFORM ensure_member_virtual_account(v_m.id);
  END LOOP;
END;
$$;

-- Sync virtual account balances from existing transactions
SELECT sync_virtual_account_balances();

-- Sync capital accounts
SELECT sync_capital_accounts();

-- Generate initial cash flow forecast
SELECT generate_cash_flow_forecast(90);
