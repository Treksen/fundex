-- ================================================================
-- Migration 022: Fix Audit Log Delete
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- ── 1. Add DELETE policy on audit_logs ───────────────────────
DROP POLICY IF EXISTS "Admin can delete audit logs" ON audit_logs;
CREATE POLICY "Admin can delete audit logs"
  ON audit_logs FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  ));

-- ── 2. SECURITY DEFINER RPC — delete one log ─────────────────
CREATE OR REPLACE FUNCTION admin_delete_audit_log(p_log_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admins only');
  END IF;
  DELETE FROM audit_logs WHERE id = p_log_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_audit_log(UUID) TO authenticated;

-- ── 3. SECURITY DEFINER RPC — clear all logs ─────────────────
CREATE OR REPLACE FUNCTION admin_clear_audit_logs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admins only');
  END IF;
  DELETE FROM audit_logs;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'deleted', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_clear_audit_logs() TO authenticated;

-- ── Verify ────────────────────────────────────────────────────
SELECT routine_name FROM information_schema.routines
WHERE routine_name IN ('admin_delete_audit_log', 'admin_clear_audit_logs')
  AND routine_schema = 'public';
