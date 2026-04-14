-- ================================================================
-- Migration 017b: Allow Admin to Delete Any Notification
-- Run in Supabase Dashboard → SQL Editor
--
-- The existing DELETE policy only allows users to delete their
-- OWN notifications (user_id = auth.uid()).
-- This adds a policy allowing admins to delete ANY notification.
-- ================================================================

-- Add admin delete policy (admins can delete any notification)
DROP POLICY IF EXISTS "Admin can delete any notification" ON notifications;

CREATE POLICY "Admin can delete any notification"
  ON notifications FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  );

-- Verify
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'notifications'
ORDER BY cmd, policyname;
