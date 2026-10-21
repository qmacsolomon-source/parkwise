-- ===========================================================================
-- ParkWise - LIVE upgrade - 08_realtime_publication.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   06_profiles_realtime.sql added ONLY public.profiles to the
--   supabase_realtime publication. But the mobile app subscribes to realtime
--   changes on three more tables that were never added on the live project:
--     - slots         (useFloorPlan.ts)   -> drives the live occupancy dots
--     - reservations  (useFloorPlan.ts, DashboardScreen.tsx, TimerScreen.tsx)
--     - notifications (NotificationsScreen.tsx)
--   Those subscriptions have been running this whole time, connecting fine,
--   but silently receiving NOTHING - a change to any of those tables
--   (a new reservation, a cancelled booking, a new notification) never
--   reaches an already-open app. The screens only update when something
--   else happens to re-trigger a fetch (navigating away and back, pulling
--   to refresh). This file is what actually turns those subscriptions on.
--
--   agent_states is included too: the desktop console's live slot map and
--   the mobile floor plan both read agent/slot state, and it's the same kind
--   of gap (present in the legacy database/seed.sql's publication list, never
--   run against the live project).
--
-- WHAT IT NEEDS
--   Nothing beyond the base schema - slots, reservations, notifications and
--   agent_states already exist. Existing RLS is untouched; realtime only
--   ever sends a subscriber rows they could already SELECT.
--
-- HOW TO VERIFY (read-only)
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime'
--    ORDER BY tablename;
--   -- expect: agent_states, notifications, profiles, reservations, slots
--
-- SAFE TO RUN TWICE: guarded by duplicate_object, same pattern as 06.
-- ===========================================================================

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.slots;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_states;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
