-- ===========================================================================
-- 20_tighten_notifications_insert.sql
-- "System can insert notifications" was WITH CHECK (true) - wide open to
-- any authenticated client, not just staff. create_notification()
-- (business_rules.sql) is SECURITY DEFINER and bypasses RLS entirely as the
-- function owner, so it never actually needed this policy open at all; its
-- only live effect was that any signed-in customer could insert a
-- notification with an arbitrary user_id, impersonating the system in
-- another customer's inbox. Checked every direct client-side insert into
-- notifications in this codebase (desktop's SlotAssignment Reassign and
-- UserManagement) - both are staff-authenticated, so is_staff() covers
-- every real use without breaking anything.
--
-- Safe to re-run: policy is dropped before being recreated.
-- ===========================================================================

DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
CREATE POLICY "System can insert notifications" ON notifications
  FOR INSERT WITH CHECK (is_staff());

-- ---------------------------------------------------------------------------
-- Check
-- ---------------------------------------------------------------------------
-- SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
--  WHERE polname = 'System can insert notifications';
-- Expected: calls is_staff(), not just "true".
