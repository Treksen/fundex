-- ================================================================
-- Migration 016: Fix Virtual Account Sync (run in Supabase SQL Editor)
--
-- Problem: GROUP_WALLET and RESERVE_FUND show Ksh 0.00 because
-- sync_virtual_account_balances() was never called after deposits
-- were made. The auto-skim trigger inserts reserve_contributions
-- but nothing re-syncs virtual_accounts afterwards.
--
-- Fixes:
--   1. Trigger on reserve_contributions → auto-sync after every change
--   2. Trigger on reserve_policy → sync when policy changes
--   3. Force sync RIGHT NOW to fix existing stale balances
-- ================================================================

-- ── 1. Trigger: sync after any reserve contribution insert/update ─
CREATE OR REPLACE FUNCTION trg_sync_on_reserve_contribution()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM sync_virtual_account_balances();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_reserve_contribution_sync ON reserve_contributions;
CREATE TRIGGER trg_reserve_contribution_sync
  AFTER INSERT OR UPDATE OR DELETE ON reserve_contributions
  FOR EACH ROW EXECUTE FUNCTION trg_sync_on_reserve_contribution();

-- ── 2. Trigger: sync when reserve policy changes ──────────────────
CREATE OR REPLACE FUNCTION trg_sync_on_policy_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM sync_virtual_account_balances();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_policy_sync ON reserve_policy;
CREATE TRIGGER trg_policy_sync
  AFTER INSERT OR UPDATE ON reserve_policy
  FOR EACH ROW EXECUTE FUNCTION trg_sync_on_policy_change();

-- ── 3. Force sync NOW to fix all existing stale balances ─────────
SELECT sync_virtual_account_balances();

-- ── 4. Verify — should show real balances now ─────────────────────
SELECT account_code, account_name, balance, updated_at
FROM virtual_accounts
ORDER BY account_type, account_name;
