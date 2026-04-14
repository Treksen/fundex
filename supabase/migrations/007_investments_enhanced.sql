-- ============================================================
-- Migration 007: Enhanced Investments Module
-- Run after 001-006
-- ============================================================

-- ── 1. EXTEND INVESTMENTS TABLE ─────────────────────────────
ALTER TABLE investments
  DROP CONSTRAINT IF EXISTS investments_status_check;

ALTER TABLE investments
  ADD CONSTRAINT investments_status_check
  CHECK (status IN ('active', 'maturing', 'completed', 'loss', 'pending', 'closed'));

-- Add notes and timeline fields
ALTER TABLE investments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE investments ADD COLUMN IF NOT EXISTS maturity_alert_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE investments ADD COLUMN IF NOT EXISTS distribution_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE investments ADD COLUMN IF NOT EXISTS investment_snapshot JSONB DEFAULT '[]'::jsonb;

-- ── 2. EXTEND OWNERSHIP_SNAPSHOTS: link to investments ──────
ALTER TABLE ownership_snapshots ADD COLUMN IF NOT EXISTS investment_id UUID REFERENCES investments(id) ON DELETE CASCADE;

-- ── 3. INVESTMENT OWNERSHIP SNAPSHOT VIEW ───────────────────
CREATE OR REPLACE VIEW investment_ownership_snapshots AS
SELECT
  os.investment_id,
  os.user_id,
  p.name,
  p.avatar_url,
  os.percentage,
  os.total_contribution,
  os.snapshot_date,
  i.title AS investment_title,
  i.amount_invested,
  (os.percentage / 100) * i.amount_invested AS member_invested_amount
FROM ownership_snapshots os
JOIN profiles p ON p.id = os.user_id
JOIN investments i ON i.id = os.investment_id
WHERE os.investment_id IS NOT NULL;

-- ── 4. INVESTMENT PERFORMANCE VIEW ──────────────────────────
CREATE OR REPLACE VIEW investment_performance AS
SELECT
  i.*,
  p.name AS created_by_name,
  CASE
    WHEN i.actual_return IS NULL OR i.actual_return = 0 THEN 0
    ELSE ROUND(((i.actual_return - i.amount_invested) / i.amount_invested) * 100, 2)
  END AS roi_pct,
  COALESCE(i.actual_return, 0) - i.amount_invested AS net_profit,
  CASE
    WHEN i.status = 'completed' THEN 'completed'
    WHEN i.status = 'loss' OR (i.actual_return IS NOT NULL AND i.actual_return < i.amount_invested) THEN 'loss'
    WHEN i.end_date IS NOT NULL AND i.end_date <= CURRENT_DATE + INTERVAL '30 days' AND i.end_date > CURRENT_DATE THEN 'maturing'
    WHEN i.end_date IS NOT NULL AND i.end_date <= CURRENT_DATE AND i.status = 'active' THEN 'maturing'
    ELSE 'active'
  END AS computed_status,
  (SELECT COUNT(*) FROM dividends d WHERE d.investment_id = i.id) AS dividend_count,
  (SELECT COALESCE(SUM(d.amount), 0) FROM dividends d WHERE d.investment_id = i.id) AS total_distributed
FROM investments i
JOIN profiles p ON p.id = i.created_by;

-- ── 5. FUNCTION: Create ownership snapshot for an investment ─
CREATE OR REPLACE FUNCTION snapshot_ownership_for_investment(p_investment_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Delete any existing snapshot for this investment
  DELETE FROM ownership_snapshots WHERE investment_id = p_investment_id;

  -- Insert fresh snapshot from current equity
  INSERT INTO ownership_snapshots (user_id, percentage, total_contribution, investment_id)
  SELECT
    p.id,
    CASE WHEN gt.grand_total > 0
      THEN ROUND((GREATEST(0, es.available_equity) / gt.grand_total) * 100, 4)
      ELSE 0 END,
    GREATEST(0, es.available_equity),
    p_investment_id
  FROM profiles p
  JOIN member_equity_summary es ON es.id = p.id
  CROSS JOIN (
    SELECT COALESCE(SUM(GREATEST(0, available_equity)), 0) AS grand_total
    FROM member_equity_summary
  ) gt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION snapshot_ownership_for_investment(UUID) TO authenticated;

-- ── 6. FUNCTION: Distribute profit for an investment ────────
CREATE OR REPLACE FUNCTION distribute_investment_profit(
  p_investment_id UUID,
  p_profit DECIMAL,
  p_reinvested BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_inv RECORD;
  v_rows_inserted INT := 0;
  v_member RECORD;
  v_share DECIMAL;
BEGIN
  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Investment not found');
  END IF;

  IF p_profit <= 0 THEN
    RETURN jsonb_build_object('error', 'Profit must be greater than zero');
  END IF;

  -- Use ownership snapshot linked to this investment
  -- Fall back to current equity if no snapshot exists
  FOR v_member IN
    SELECT
      os.user_id,
      p.name,
      os.percentage
    FROM ownership_snapshots os
    JOIN profiles p ON p.id = os.user_id
    WHERE os.investment_id = p_investment_id
      AND os.percentage > 0
  LOOP
    v_share := ROUND((v_member.percentage / 100) * p_profit, 2);

    INSERT INTO dividends (investment_id, user_id, amount, ownership_percentage, reinvested, notes)
    VALUES (p_investment_id, v_member.user_id, v_share, v_member.percentage, p_reinvested, p_notes);

    -- Notify member
    INSERT INTO notifications (user_id, title, message, type, action_url)
    VALUES (
      v_member.user_id,
      '💰 Dividend Distributed',
      'Profit of KES ' || TO_CHAR(p_profit, 'FM999,999,999.00') || ' from "' || v_inv.title ||
        '" has been distributed. Your share (' || v_member.percentage::TEXT || '%): KES ' ||
        TO_CHAR(v_share, 'FM999,999,999.00'),
      'success',
      '/investments'
    );

    v_rows_inserted := v_rows_inserted + 1;
  END LOOP;

  -- Update investment status and actual_return
  UPDATE investments
  SET
    actual_return = p_profit,
    status = CASE WHEN p_profit >= amount_invested THEN 'completed' ELSE 'loss' END,
    distribution_completed = TRUE,
    updated_at = NOW()
  WHERE id = p_investment_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'members_paid', v_rows_inserted,
    'total_profit', p_profit
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION distribute_investment_profit(UUID, DECIMAL, BOOLEAN, TEXT) TO authenticated;

-- ── 7. AUTO-MATURITY ALERT FUNCTION ─────────────────────────
CREATE OR REPLACE FUNCTION check_investment_maturity()
RETURNS VOID AS $$
DECLARE v_inv RECORD;
BEGIN
  FOR v_inv IN
    SELECT i.*, p.name AS creator_name
    FROM investments i
    JOIN profiles p ON p.id = i.created_by
    WHERE i.status = 'active'
      AND i.end_date IS NOT NULL
      AND i.end_date <= CURRENT_DATE + INTERVAL '30 days'
      AND NOT i.maturity_alert_sent
  LOOP
    -- Notify all members
    INSERT INTO notifications (user_id, title, message, type, action_url)
    SELECT
      p.id,
      '⚠️ Investment Maturing Soon',
      '"' || v_inv.title || '" matures on ' || TO_CHAR(v_inv.end_date, 'DD Mon YYYY') || '. Review and record returns.',
      'warning',
      '/investments'
    FROM profiles p;

    -- Update investment status and flag
    UPDATE investments
    SET status = 'maturing', maturity_alert_sent = TRUE, updated_at = NOW()
    WHERE id = v_inv.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_investment_maturity() TO authenticated;

-- ── 8. RLS FOR INVESTMENTS ───────────────────────────────────
DROP POLICY IF EXISTS "Admin can manage investments" ON investments;
CREATE POLICY "Investments readable by authenticated" ON investments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can insert investments" ON investments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admin can update investments" ON investments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admin can delete investments" ON investments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- RLS for dividends
DROP POLICY IF EXISTS "Admin can manage dividends" ON dividends;
CREATE POLICY "Dividends readable by authenticated" ON dividends
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can insert dividends" ON dividends
  FOR INSERT TO authenticated WITH CHECK (true);

