-- ===========================================================================
-- 14_customer_agent_state_read.sql
-- Lets a customer read the agent_states row (including last_frame_url) for
-- their own slot, while they have a live reservation on it, so the mobile
-- app can show them the camera's latest photo of their own car.
--
-- Previously agent_states had no customer-facing SELECT policy at all - only
-- "Attendants can view agent states" (is_staff()). Scoped narrowly (only the
-- slot tied to one of THEIR OWN pending/active/verified reservations) rather
-- than opening the whole table, so a customer can never see another
-- customer's camera frame.
--
-- Safe to re-run: policy is dropped before being recreated.
-- ===========================================================================

drop policy if exists "Customers can view their own slot's agent state" on agent_states;
create policy "Customers can view their own slot's agent state"
  on agent_states for select
  using (
    exists (
      select 1 from reservations r
      where r.slot_id = agent_states.slot_id
        and r.customer_id = auth.uid()
        and r.status in ('pending', 'active', 'verified')
    )
  );

-- ---------------------------------------------------------------------------
-- Check (run as the project owner, bypasses RLS, just confirms the policy exists)
-- ---------------------------------------------------------------------------
-- SELECT polname FROM pg_policies WHERE tablename = 'agent_states';
-- Expected: both "Attendants can view agent states" and this new policy.
