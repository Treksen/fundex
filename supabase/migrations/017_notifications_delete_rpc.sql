-- ================================================================
-- Migration 017: Notification Delete RPCs (SECURITY DEFINER)
--
-- Problem: Even with a DELETE RLS policy, Supabase sometimes
-- silently blocks deletes returning 0 rows with no error.
-- SECURITY DEFINER functions bypass RLS entirely and are the
-- reliable way to handle admin deletes.
--
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- ── 1. Delete a single notification by id ────────────────────
CREATE OR REPLACE FUNCTION admin_delete_notification(p_notification_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow the notification owner OR an admin to delete
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE id = p_notification_id
      AND (
        user_id = auth.uid()   -- owner
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  DELETE FROM notifications WHERE id = p_notification_id;

  RETURN jsonb_build_object('success', true, 'deleted', p_notification_id);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_notification(UUID) TO authenticated;

-- ── 2. Delete ALL notifications for a given user ─────────────
CREATE OR REPLACE FUNCTION admin_delete_all_notifications(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Only allow deleting your own notifications OR admin deleting any
  IF p_user_id <> auth.uid() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  DELETE FROM notifications WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_all_notifications(UUID) TO authenticated;

-- ── 3. Also fix the RLS policies cleanly ─────────────────────
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can view own notifications"   ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated insert notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated create notifications" ON notifications;

CREATE POLICY "notif_select"  ON notifications FOR SELECT  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif_insert"  ON notifications FOR INSERT  TO authenticated WITH CHECK (true);
CREATE POLICY "notif_update"  ON notifications FOR UPDATE  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif_delete"  ON notifications FOR DELETE  TO authenticated USING (user_id = auth.uid());

-- ── 4. Verify ────────────────────────────────────────────────
SELECT routine_name FROM information_schema.routines
WHERE routine_name IN ('admin_delete_notification', 'admin_delete_all_notifications');
