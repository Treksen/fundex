-- ============================================================
-- Migration 008: Bank Reconciliation, Document Attachments,
--                Insights, Scheduled Reports, Constraints
-- Run after 001-007
-- ============================================================

-- ── 1. BANK RECONCILIATION TABLE ────────────────────────────
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  bank_date DATE NOT NULL,
  bank_amount DECIMAL(15,2) NOT NULL,
  bank_reference TEXT,
  bank_description TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('matched', 'missing', 'mismatch', 'unmatched')),
  mismatch_reason TEXT,
  reconciled_by UUID REFERENCES profiles(id),
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view reconciliations" ON bank_reconciliations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage reconciliations" ON bank_reconciliations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ── 2. DOCUMENT ATTACHMENTS TABLE ───────────────────────────
CREATE TABLE IF NOT EXISTS document_attachments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('transaction', 'investment', 'goal', 'member')),
  entity_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE document_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view attachments" ON document_attachments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert attachments" ON document_attachments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = uploaded_by);
CREATE POLICY "Admin can delete attachments" ON document_attachments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') OR auth.uid() = uploaded_by);

-- ── 3. INSIGHTS / ALERTS TABLE ──────────────────────────────
CREATE TABLE IF NOT EXISTS system_insights (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  insight_type TEXT NOT NULL CHECK (insight_type IN (
    'concentration_risk', 'balance_drop', 'large_withdrawal',
    'goal_near', 'monthly_summary', 'quarterly_report', 'annual_report',
    'contribution_milestone', 'investment_overdue'
  )),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT FALSE,
  user_id UUID REFERENCES profiles(id),  -- NULL = broadcast to all
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE system_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own or broadcast insights" ON system_insights FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "System can insert insights" ON system_insights FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can mark read" ON system_insights FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

-- ── 4. SCHEDULED REMINDERS TABLE ────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('monthly_contribution', 'snapshot', 'report')),
  day_of_month INTEGER DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  is_active BOOLEAN DEFAULT TRUE,
  last_sent TIMESTAMPTZ,
  config JSONB DEFAULT '{}',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view reminders" ON scheduled_reminders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage reminders" ON scheduled_reminders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Insert default monthly reminders
INSERT INTO scheduled_reminders (reminder_type, day_of_month, is_active, config)
VALUES
  ('monthly_contribution', 1, TRUE, '{"message": "Monthly contribution reminder"}'),
  ('snapshot', 1, TRUE, '{"message": "Auto-snapshot ownership"}'),
  ('report', 1, TRUE, '{"message": "Monthly summary report"}')
ON CONFLICT DO NOTHING;

-- ── 5. STRONGER TRANSACTION CONSTRAINTS ─────────────────────
-- No orphan approvals: automatically delete approvals when tx is deleted
-- (already handled by CASCADE in migration 001, reinforce here)
ALTER TABLE withdrawal_approvals
  DROP CONSTRAINT IF EXISTS withdrawal_approvals_transaction_id_fkey;
ALTER TABLE withdrawal_approvals
  ADD CONSTRAINT withdrawal_approvals_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

-- No orphan transaction attachments
ALTER TABLE document_attachments
  ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

-- ── 6. CHANGE TRACKING (AUDIT DETAIL) ───────────────────────
-- Already in audit_logs — add change_type for better querying
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS change_type TEXT
  CHECK (change_type IN ('create', 'update', 'delete', 'approve', 'distribute', 'reconcile'));

-- Update existing logs with computed change_type
UPDATE audit_logs SET change_type =
  CASE
    WHEN action ILIKE '%delet%' THEN 'delete'
    WHEN action ILIKE '%creat%' OR action ILIKE '%record%' OR action ILIKE '%add%' THEN 'create'
    WHEN action ILIKE '%updat%' OR action ILIKE '%edit%' THEN 'update'
    WHEN action ILIKE '%approv%' THEN 'approve'
    WHEN action ILIKE '%distribut%' THEN 'distribute'
    WHEN action ILIKE '%reconcil%' THEN 'reconcile'
    ELSE 'update'
  END
WHERE change_type IS NULL;

-- ── 7. INSIGHTS GENERATION FUNCTION ─────────────────────────
CREATE OR REPLACE FUNCTION generate_financial_insights()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_member RECORD;
  v_total_equity DECIMAL;
  v_pool_prev DECIMAL;
  v_pool_now DECIMAL;
  v_drop_pct DECIMAL;
  v_inv RECORD;
  v_total_invested DECIMAL;
BEGIN
  -- Concentration risk: any member > 50% of pool
  SELECT SUM(GREATEST(0, available_equity)) INTO v_total_equity FROM member_equity_summary;
  FOR v_member IN SELECT * FROM member_equity_summary WHERE v_total_equity > 0 LOOP
    IF v_total_equity > 0 AND (GREATEST(0, v_member.available_equity) / v_total_equity) > 0.5 THEN
      INSERT INTO system_insights (insight_type, severity, title, message, data)
      VALUES (
        'concentration_risk', 'warning',
        '⚠️ Concentration Risk Detected',
        v_member.name || ' holds over 50% of the group pool (' ||
          ROUND((GREATEST(0, v_member.available_equity) / v_total_equity) * 100, 1)::TEXT || '%). Consider diversification.',
        jsonb_build_object('member_id', v_member.id, 'pct', ROUND((GREATEST(0, v_member.available_equity) / v_total_equity) * 100, 1))
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Balance drop: compare this month vs last month
  SELECT
    COALESCE(SUM(CASE WHEN t.type = 'deposit' THEN t.amount WHEN t.type = 'withdrawal' THEN -t.amount ELSE 0 END), 0)
  INTO v_pool_now
  FROM transactions t
  WHERE t.status = 'completed'
    AND t.transaction_date >= DATE_TRUNC('month', CURRENT_DATE);

  SELECT
    COALESCE(SUM(CASE WHEN t.type = 'deposit' THEN t.amount WHEN t.type = 'withdrawal' THEN -t.amount ELSE 0 END), 0)
  INTO v_pool_prev
  FROM transactions t
  WHERE t.status = 'completed'
    AND t.transaction_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
    AND t.transaction_date < DATE_TRUNC('month', CURRENT_DATE);

  IF v_pool_prev > 0 AND v_pool_now < v_pool_prev THEN
    v_drop_pct := ROUND(((v_pool_prev - v_pool_now) / v_pool_prev) * 100, 1);
    IF v_drop_pct >= 20 THEN
      INSERT INTO system_insights (insight_type, severity, title, message, data)
      VALUES (
        'balance_drop', 'critical',
        '🔴 Significant Balance Drop This Month',
        'Group savings dropped by ' || v_drop_pct::TEXT || '% compared to last month.',
        jsonb_build_object('drop_pct', v_drop_pct, 'prev', v_pool_prev, 'now', v_pool_now)
      );
      v_count := v_count + 1;
    END IF;
  END IF;

  -- Over-concentration in one investment
  SELECT SUM(amount_invested) INTO v_total_invested FROM investments WHERE status NOT IN ('closed','loss');
  IF v_total_invested > 0 THEN
    FOR v_inv IN SELECT * FROM investments WHERE status NOT IN ('closed','loss') LOOP
      IF (v_inv.amount_invested / v_total_invested) > 0.7 THEN
        INSERT INTO system_insights (insight_type, severity, title, message, data)
        VALUES (
          'concentration_risk', 'warning',
          '⚠️ Over-Concentration in Investment',
          '"' || v_inv.title || '" represents ' || ROUND((v_inv.amount_invested / v_total_invested) * 100, 1)::TEXT ||
            '% of total investments. Consider diversifying.',
          jsonb_build_object('investment_id', v_inv.id, 'pct', ROUND((v_inv.amount_invested / v_total_invested) * 100, 1))
        );
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END IF;

  -- Large withdrawal warning: any pending withdrawal > 30% of pool
  FOR v_member IN
    SELECT t.*, p.name AS requester_name
    FROM transactions t
    JOIN profiles p ON p.id = t.user_id
    WHERE t.type = 'withdrawal' AND t.status = 'pending' AND v_total_equity > 0
      AND t.amount > v_total_equity * 0.3
  LOOP
    INSERT INTO system_insights (insight_type, severity, title, message, data)
    VALUES (
      'large_withdrawal', 'critical',
      '🚨 Large Withdrawal Pending',
      v_member.requester_name || ' has a pending withdrawal of KES ' ||
        TO_CHAR(v_member.amount, 'FM999,999,999') || ' — over 30% of group pool.',
      jsonb_build_object('transaction_id', v_member.id, 'amount', v_member.amount)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION generate_financial_insights() TO authenticated;

-- ── 8. MONTHLY SUMMARY FUNCTION ─────────────────────────────
CREATE OR REPLACE FUNCTION generate_monthly_summary(p_year INT DEFAULT NULL, p_month INT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
  v_month INT := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::INT);
  v_start DATE := DATE(v_year || '-' || LPAD(v_month::TEXT, 2, '0') || '-01');
  v_end DATE := (v_start + INTERVAL '1 month - 1 day')::DATE;
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'period', TO_CHAR(v_start, 'Month YYYY'),
    'total_deposits', COALESCE(SUM(CASE WHEN type='deposit' AND status='completed' THEN amount ELSE 0 END), 0),
    'total_withdrawals', COALESCE(SUM(CASE WHEN type='withdrawal' AND status='completed' THEN amount ELSE 0 END), 0),
    'net_change', COALESCE(SUM(CASE WHEN type='deposit' AND status='completed' THEN amount
                                    WHEN type='withdrawal' AND status='completed' THEN -amount ELSE 0 END), 0),
    'tx_count', COUNT(*),
    'pending_count', COUNT(*) FILTER (WHERE status='pending')
  )
  INTO v_result
  FROM transactions
  WHERE transaction_date BETWEEN v_start AND v_end;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION generate_monthly_summary(INT, INT) TO authenticated;

-- ── 9. DOCUMENTS STORAGE BUCKET ─────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents', 'documents', false,
  10485760,  -- 10MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','application/pdf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
) ON CONFLICT (id) DO UPDATE SET file_size_limit = 10485760;

CREATE POLICY "Authenticated can upload documents" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
CREATE POLICY "Authenticated can view documents" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'documents');
CREATE POLICY "Authenticated can delete own documents" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'documents');
