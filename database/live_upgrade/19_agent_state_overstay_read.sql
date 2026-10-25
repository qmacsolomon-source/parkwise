-- ===========================================================================
-- 19_agent_state_overstay_read.sql
-- 14_customer_agent_state_read.sql's policy only covers
-- 'pending'/'active'/'verified' - missing 'overstay', a real, reachable
-- reservation_status that update_slot_status() and agent-service's overstay
-- monitor both already handle. The moment a reservation goes overstay, the
-- customer's RLS grant to read their own agent_states row (the "live camera
-- check" photo on the dashboard) silently disappears - exactly while they
-- most need visibility into their own car.
--
-- Same status-list-gap pattern already found and fixed elsewhere this
-- session (useFloorPlan.ts, checkTimeOverlap(), several others) - this one
-- was in the database layer rather than a client file.
--
-- Safe to re-run: policy is dropped before being recreated.
-- ===========================================================================

DROP POLICY IF EXISTS "Customers can view their own slot's agent state" ON agent_states;
CREATE POLICY "Customers can view their own slot's agent state" ON agent_states
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.slot_id = agent_states.slot_id
        AND r.customer_id = auth.uid()
        AND r.status IN ('pending', 'active', 'verified', 'overstay')
    )
  );

-- ---------------------------------------------------------------------------
-- Check
-- ---------------------------------------------------------------------------
-- SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
--  WHERE polname = 'Customers can view their own slot''s agent state';
-- Expected: the condition's status list includes 'overstay'.
