-- ================================================================
-- Migration 017: Fix Notifications RLS — Allow Delete
-- Run in Supabase Dashboard → SQL Editor
--
-- Problem: Supabase RLS was silently blocking DELETE on notifications
-- even for the notification owner. The original policy only covered
-- SELECT and INSERT, not DELETE.
-- ================================================================

-- ── Drop any existing notification policies ───────────────────
DROP POLICY IF EXISTS "Users can view own notifications"      ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications"    ON notifications;
DROP POLICY IF EXISTS "Users can delete own notifications"    ON notifications;
DROP POLICY IF EXISTS "Service role manages notifications"    ON notifications;
DROP POLICY IF EXISTS "Authenticated insert notifications"    ON notifications;
DROP POLICY IF EXISTS "Users manage own notifications"        ON notifications;

-- ── Re-create clean policies ─────────────────────────────────

-- SELECT: each user sees only their own notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT: any authenticated user can create notifications
-- (needed for deposit/withdrawal triggers firing via frontend)
CREATE POLICY "Authenticated insert notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE: users can mark their own notifications as read
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ── Verify policies are in place ─────────────────────────────
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'notifications'
ORDER BY cmd, policyname;
