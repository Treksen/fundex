-- ================================================================
-- FUNDEX — CLEAN DATABASE RESET
-- Wipes all financial/transactional data.
-- Keeps: profiles, auth users, storage objects (avatars).
-- Project: GT Capital  (vhjhgodlltvurmzeynpt)
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste → Run
--
-- ⚠️  IRREVERSIBLE. No undo. Screenshot your data first if needed.
-- ================================================================

-- Step 1: Disable FK checks so we can truncate in any order
SET session_replication_role = 'replica';

-- ── Financial tables (order doesn't matter with replica role) ──
TRUNCATE TABLE action_approval_votes     RESTART IDENTITY CASCADE;
TRUNCATE TABLE action_approvals          RESTART IDENTITY CASCADE;
TRUNCATE TABLE audit_logs                RESTART IDENTITY CASCADE;
TRUNCATE TABLE bank_reconciliations      RESTART IDENTITY CASCADE;
TRUNCATE TABLE capital_accounts          RESTART IDENTITY CASCADE;
TRUNCATE TABLE cash_flow_projections     RESTART IDENTITY CASCADE;
TRUNCATE TABLE dividends                 RESTART IDENTITY CASCADE;
TRUNCATE TABLE document_attachments      RESTART IDENTITY CASCADE;
TRUNCATE TABLE investments               RESTART IDENTITY CASCADE;
TRUNCATE TABLE ledger_entries            RESTART IDENTITY CASCADE;
TRUNCATE TABLE member_invitations        RESTART IDENTITY CASCADE;
TRUNCATE TABLE notifications             RESTART IDENTITY CASCADE;
TRUNCATE TABLE ownership_snapshots       RESTART IDENTITY CASCADE;
TRUNCATE TABLE profit_allocations        RESTART IDENTITY CASCADE;
TRUNCATE TABLE reserve_contributions     RESTART IDENTITY CASCADE;
TRUNCATE TABLE savings_goals             RESTART IDENTITY CASCADE;
TRUNCATE TABLE scheduled_reminders       RESTART IDENTITY CASCADE;
TRUNCATE TABLE system_insights           RESTART IDENTITY CASCADE;
TRUNCATE TABLE transactions              RESTART IDENTITY CASCADE;
TRUNCATE TABLE virtual_transfers         RESTART IDENTITY CASCADE;
TRUNCATE TABLE withdrawal_approvals      RESTART IDENTITY CASCADE;

-- ── Reset statement number sequence ────────────────────────────
ALTER SEQUENCE IF EXISTS tx_statement_seq RESTART WITH 1;

-- ── Re-enable FK checks ─────────────────────────────────────────
SET session_replication_role = 'origin';

-- ── Reset virtual account balances to zero ──────────────────────
-- (they'll auto-recalculate from transactions, but since transactions
--  are empty now, zero them out explicitly)
UPDATE virtual_accounts
SET balance = 0, updated_at = NOW();

-- ── Reset equity status on all profiles ─────────────────────────
UPDATE profiles
SET
  equity_status = 'safe',
  loan_balance  = 0,
  updated_at    = NOW();

-- ── Re-seed default scheduled reminders ─────────────────────────
-- (were wiped above — restore defaults)
INSERT INTO scheduled_reminders (reminder_type, day_of_month, is_active, config)
VALUES
  ('monthly_contribution', 1, TRUE, '{"message": "Monthly contribution reminder"}'),
  ('snapshot',             1, TRUE, '{"message": "Auto-snapshot ownership"}'),
  ('report',               1, TRUE, '{"message": "Monthly summary report"}')
ON CONFLICT DO NOTHING;

-- ── Re-seed default reserve policy ──────────────────────────────
INSERT INTO reserve_policy (target_pct_of_pool, auto_allocate_on_deposit, auto_allocate_pct)
VALUES (10, FALSE, 2)
ON CONFLICT DO NOTHING;

-- ── Re-create member virtual accounts ───────────────────────────
DO $$
DECLARE v_m RECORD;
BEGIN
  FOR v_m IN SELECT id FROM profiles LOOP
    PERFORM ensure_member_virtual_account(v_m.id);
  END LOOP;
END;
$$;

-- ── Sync capital accounts (fresh, zero balances) ────────────────
SELECT sync_capital_accounts();

-- ── Verify ──────────────────────────────────────────────────────
SELECT
  'profiles'     AS tbl, COUNT(*) AS rows FROM profiles
UNION ALL SELECT 'transactions',     COUNT(*) FROM transactions
UNION ALL SELECT 'investments',      COUNT(*) FROM investments
UNION ALL SELECT 'notifications',    COUNT(*) FROM notifications
UNION ALL SELECT 'audit_logs',       COUNT(*) FROM audit_logs
ORDER BY tbl;
