-- Round 89+: adds 'timeout_override' to the verification_result enum.
--
-- agent.py's _verify_plate() can now auto-verify a reservation once
-- auto_pass_after_seconds (5 minutes by default) has passed since the
-- attendant clicked Accept, even without a real OCR match - trusting that
-- the attendant already visually confirmed the vehicle, instead of leaving
-- the slot stuck forever on a camera that can't get a clean read (bad
-- angle/lighting, or in testing, a screen-photo target). This is logged as
-- its own verification_events.result value rather than reusing 'match', so
-- History/Reports/Reports exports can still tell a real camera match apart
-- from this fallback.
--
-- Wrapped in BEGIN/COMMIT per this project's usual Supabase SQL editor
-- workaround (it sometimes injects bogus statements after what you paste,
-- which can roll back an un-committed implicit transaction).
BEGIN;

ALTER TYPE verification_result ADD VALUE IF NOT EXISTS 'timeout_override';

COMMIT;
