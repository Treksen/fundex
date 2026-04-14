-- ================================================================
-- Migration 015: Email Notifications + FK Fix for Investment Delete
-- Run after 001-014
-- ================================================================

-- ── 1. Profiles: add email notification preference ───────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT TRUE;

-- ── 2. Notifications: track whether email was sent ──────────────
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS email_sent     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_sent_at  TIMESTAMPTZ;

-- ── 3. FIX: dividends FK — allow investment delete ───────────────
-- The original FK had no ON DELETE action (defaults to RESTRICT),
-- which caused "violates foreign key constraint" when deleting an
-- investment that already had dividends distributed.
-- Fix: change to SET NULL so deleting an investment just nullifies
-- the investment_id on its dividends (history is preserved).

ALTER TABLE dividends
  DROP CONSTRAINT IF EXISTS dividends_investment_id_fkey;

ALTER TABLE dividends
  ADD CONSTRAINT dividends_investment_id_fkey
  FOREIGN KEY (investment_id)
  REFERENCES investments(id)
  ON DELETE SET NULL;

-- ── 4. Similarly fix ownership_snapshots investment FK ────────────
-- Already done in migration 007, but re-assert defensively
ALTER TABLE ownership_snapshots
  DROP CONSTRAINT IF EXISTS ownership_snapshots_investment_id_fkey;

ALTER TABLE ownership_snapshots
  ADD CONSTRAINT ownership_snapshots_investment_id_fkey
  FOREIGN KEY (investment_id)
  REFERENCES investments(id)
  ON DELETE CASCADE;

-- ── 5. profit_allocations investment FK ──────────────────────────
ALTER TABLE profit_allocations
  DROP CONSTRAINT IF EXISTS profit_allocations_investment_id_fkey;

ALTER TABLE profit_allocations
  ADD CONSTRAINT profit_allocations_investment_id_fkey
  FOREIGN KEY (investment_id)
  REFERENCES investments(id)
  ON DELETE SET NULL;

-- ── 6. RLS: profiles can read own email pref ─────────────────────
DROP POLICY IF EXISTS "Users update own email pref" ON profiles;
CREATE POLICY "Users update own email pref"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
