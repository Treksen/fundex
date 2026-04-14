-- ============================================================
-- Fundex SAVINGS & INVESTMENT - SUPABASE DATABASE SCHEMA
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS / PROFILES TABLE
-- ============================================================
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  email TEXT NOT NULL,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TRANSACTIONS TABLE
-- ============================================================
CREATE TABLE transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'adjustment')),
  reference TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  created_by UUID REFERENCES profiles(id) NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WITHDRAWAL APPROVALS TABLE
-- ============================================================
CREATE TABLE withdrawal_approvals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE NOT NULL,
  approver_id UUID REFERENCES profiles(id) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes TEXT,
  voted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OWNERSHIP SNAPSHOTS TABLE
-- ============================================================
CREATE TABLE ownership_snapshots (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  percentage DECIMAL(8, 4) NOT NULL,
  total_contribution DECIMAL(15, 2) NOT NULL,
  snapshot_date TIMESTAMPTZ DEFAULT NOW(),
  transaction_id UUID REFERENCES transactions(id)
);

-- ============================================================
-- SAVINGS GOALS TABLE
-- ============================================================
CREATE TABLE savings_goals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  target_amount DECIMAL(15, 2) NOT NULL,
  target_date DATE,
  month_year TEXT, -- Format: YYYY-MM for monthly goals
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INVESTMENTS TABLE
-- ============================================================
CREATE TABLE investments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  investment_type TEXT NOT NULL,
  description TEXT,
  amount_invested DECIMAL(15, 2) NOT NULL,
  expected_return DECIMAL(15, 2),
  actual_return DECIMAL(15, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'pending')),
  start_date DATE NOT NULL,
  end_date DATE,
  created_by UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DIVIDENDS TABLE
-- ============================================================
CREATE TABLE dividends (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  investment_id UUID REFERENCES investments(id) NOT NULL,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  ownership_percentage DECIMAL(8, 4) NOT NULL,
  distribution_date TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  reinvested BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'error', 'approval')),
  is_read BOOLEAN DEFAULT FALSE,
  action_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS TABLE
-- ============================================================
CREATE TABLE audit_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles: All authenticated users can read all profiles
CREATE POLICY "Profiles are viewable by authenticated users"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Transactions: All members can view, authenticated can insert
CREATE POLICY "Transactions viewable by authenticated"
  ON transactions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admin can update transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Withdrawal approvals
CREATE POLICY "Approvals viewable by authenticated"
  ON withdrawal_approvals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can create approvals"
  ON withdrawal_approvals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = approver_id);

CREATE POLICY "Approver can update own approval"
  ON withdrawal_approvals FOR UPDATE
  TO authenticated
  USING (auth.uid() = approver_id);

-- Ownership snapshots: viewable by all
CREATE POLICY "Snapshots viewable by authenticated"
  ON ownership_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert snapshots"
  ON ownership_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Savings goals
CREATE POLICY "Goals viewable by authenticated"
  ON savings_goals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can create goals"
  ON savings_goals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admin can update goals"
  ON savings_goals FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Investments
CREATE POLICY "Investments viewable by authenticated"
  ON investments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can manage investments"
  ON investments FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Dividends
CREATE POLICY "Dividends viewable by authenticated"
  ON dividends FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can manage dividends"
  ON dividends FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Audit logs
CREATE POLICY "Admin can view audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'member')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_investments_updated_at BEFORE UPDATE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- USEFUL DATABASE VIEWS
-- ============================================================

-- Member contribution summary
CREATE OR REPLACE VIEW member_contribution_summary AS
SELECT 
  p.id,
  p.name,
  p.role,
  p.email,
  COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_deposits,
  COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_withdrawals,
  COALESCE(SUM(CASE WHEN t.status = 'completed' THEN
    CASE t.type
      WHEN 'deposit' THEN t.amount
      WHEN 'withdrawal' THEN -t.amount
      WHEN 'adjustment' THEN t.amount
    END
  ELSE 0 END), 0) AS net_contribution
FROM profiles p
LEFT JOIN transactions t ON t.user_id = p.id
GROUP BY p.id, p.name, p.role, p.email;

-- Ownership percentage view (live)
CREATE OR REPLACE VIEW ownership_percentages AS
WITH totals AS (
  SELECT 
    user_id,
    COALESCE(SUM(CASE WHEN type = 'deposit' AND status = 'completed' THEN amount ELSE 0 END), 0) AS total_deposits
  FROM transactions
  GROUP BY user_id
),
group_total AS (
  SELECT SUM(total_deposits) AS grand_total FROM totals
)
SELECT 
  p.id,
  p.name,
  t.total_deposits,
  gt.grand_total,
  CASE WHEN gt.grand_total > 0 THEN ROUND((t.total_deposits / gt.grand_total) * 100, 4) ELSE 0 END AS ownership_pct
FROM profiles p
LEFT JOIN totals t ON t.user_id = p.id
CROSS JOIN group_total gt;

-- ============================================================
-- INITIAL SEED DATA - THE THREE MEMBERS
-- NOTE: Run this AFTER creating auth users via the app
-- Replace UUIDs with actual auth user IDs after signup
-- ============================================================

-- The members will be created automatically via the trigger
-- when they sign up. Use these emails for initial setup:
-- collins.towett@Fundex.app  (Admin)
-- gilbert.langat@Fundex.app  (Member)
-- amos.korir@Fundex.app      (Member)

COMMENT ON TABLE profiles IS 'User profiles for Fundex Savings members';
COMMENT ON TABLE transactions IS 'All financial transactions mirroring bank activity';
COMMENT ON TABLE investments IS 'Investment tracking for pooled funds';
COMMENT ON TABLE dividends IS 'Profit distribution records per member';
