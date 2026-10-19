-- ===========================================================================
-- ParkWise - LIVE upgrade - 00_preflight_checks.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   READ-ONLY. It changes NOTHING (no CREATE / ALTER / INSERT / DELETE / DROP).
--   It reports, one row per check, whether the LIVE database has everything
--   that upgrade files 01_fix_booking_code.sql, 02_profile_vehicle_rates_upgrade.sql
--   and 03_floor_plan_207.sql rely on.
--
-- WHAT IT NEEDS
--   Nothing. Run it first, on its own, in the Supabase SQL Editor.
--
-- HOW TO VERIFY
--   Every row must show ok = true. If ANY row is false, STOP: do NOT run
--   01-03 until the missing item is understood. The "detail" column says what
--   the row is about, and the check_name says what was looked for.
--
-- WHY THIS EXISTS
--   The live database was created quickly and is the single source of truth.
--   These checks make the upgrade refuse to run against a schema that differs
--   from what the upgrade files assume, instead of failing halfway through.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. Tell us where we are: how many slots, how many floors, which zones.
--    (Also read-only.)
-- ---------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM public.slots)                                       AS total_slots,
  (SELECT COUNT(DISTINCT floor) FROM public.slots)                          AS floors,
  (SELECT COUNT(DISTINCT floor || '/' || zone) FROM public.slots)           AS floor_zone_pairs,
  (SELECT COUNT(*) FROM public.slots WHERE is_pwd)                          AS pwd_slots,
  (SELECT COUNT(*) FROM public.agent_states)                                AS agent_states;

-- ---------------------------------------------------------------------------
-- B. The full checklist.  Expect: 0 rows with ok = false.
-- ---------------------------------------------------------------------------
WITH checks AS (
  SELECT * FROM (VALUES
    -- -- tables -------------------------------------------------------------
    ('table profiles exists',              to_regclass('public.profiles')              IS NOT NULL, 'public.profiles'),
    ('table vehicles exists',              to_regclass('public.vehicles')              IS NOT NULL, 'public.vehicles'),
    ('table slots exists',                 to_regclass('public.slots')                 IS NOT NULL, 'public.slots'),
    ('table reservations exists',          to_regclass('public.reservations')          IS NOT NULL, 'public.reservations'),
    ('table agent_states exists',          to_regclass('public.agent_states')          IS NOT NULL, 'public.agent_states'),
    ('table penalties exists',             to_regclass('public.penalties')             IS NOT NULL, 'public.penalties'),
    ('table payments exists',              to_regclass('public.payments')              IS NOT NULL, 'public.payments'),
    ('table rates exists',                 to_regclass('public.rates')                 IS NOT NULL, 'public.rates'),
    ('table notifications exists',         to_regclass('public.notifications')         IS NOT NULL, 'public.notifications'),
    ('table audit_log exists',             to_regclass('public.audit_log')             IS NOT NULL, 'public.audit_log'),

    -- -- slots columns needed by 03_floor_plan_207.sql ----------------------
    ('slots.id',                           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='id'),            'slots.id'),
    ('slots.slot_code',                    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='slot_code'),       'slots.slot_code'),
    ('slots.is_pwd',                       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='is_pwd'),          'slots.is_pwd'),
    ('slots.status',                       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='status'),          'slots.status'),
    ('slots.floor',                        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='floor'),           'slots.floor'),
    ('slots.zone',                         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='zone'),            'slots.zone'),
    ('slots.zone_row',                     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='zone_row'),        'slots.zone_row'),
    ('slots.zone_col',                     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='zone_col'),        'slots.zone_col'),
    ('slots.current_reservation_id',       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='current_reservation_id'), 'slots.current_reservation_id'),

    -- -- reservations columns needed by 03_floor_plan_207.sql ---------------
    ('reservations.id',                    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='id'),            'reservations.id'),
    ('reservations.customer_id',           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='customer_id'),     'reservations.customer_id'),
    ('reservations.vehicle_id',            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='vehicle_id'),      'reservations.vehicle_id'),
    ('reservations.slot_id',               EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='slot_id'),         'reservations.slot_id'),
    ('reservations.start_time',            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='start_time'),      'reservations.start_time'),
    ('reservations.end_time',              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='end_time'),        'reservations.end_time'),
    ('reservations.status',                EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='status'),          'reservations.status'),
    ('reservations.booking_code',          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='booking_code'),    'reservations.booking_code'),
    ('reservations.slot_code unique',      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.slots'::regclass AND contype='u'),                                                  'a UNIQUE constraint on slots (slot_code)'),
    ('reservation overlap EXCLUDE',        EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.reservations'::regclass AND contype='x'),                                            'an EXCLUDE constraint on reservations (double-booking guard)'),

    -- -- vehicles columns used by 02 ----------------------------------------
    ('vehicles.id',                        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='id'),            'vehicles.id'),
    ('vehicles.owner_id',                  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='owner_id'),        'vehicles.owner_id'),
    ('vehicles.plate_number',              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='plate_number'),    'vehicles.plate_number'),
    ('vehicles.vehicle_type',              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='vehicle_type'),    'vehicles.vehicle_type'),
    ('vehicles.is_default',                EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='is_default'),      'vehicles.is_default'),

    -- -- enum values the upgrade writes -------------------------------------
    ('enum user_role: customer',           EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='user_role' AND e.enumlabel='customer'),            'user_role.customer'),
    ('enum user_role: attendant',          EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='user_role' AND e.enumlabel='attendant'),           'user_role.attendant'),
    ('enum user_role: admin',              EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='user_role' AND e.enumlabel='admin'),               'user_role.admin'),
    ('enum user_status: active',           EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='user_status' AND e.enumlabel='active'),            'user_status.active'),
    ('enum slot_status: maintenance',      EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='slot_status' AND e.enumlabel='maintenance'),       'slot_status.maintenance'),
    ('enum reservation_status: pending',   EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='reservation_status' AND e.enumlabel='pending'),     'reservation_status.pending'),
    ('enum reservation_status: active',    EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='reservation_status' AND e.enumlabel='active'),      'reservation_status.active'),
    ('enum reservation_status: cancelled', EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='reservation_status' AND e.enumlabel='cancelled'),   'reservation_status.cancelled'),
    ('enum reservation_status: completed', EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='reservation_status' AND e.enumlabel='completed'),   'reservation_status.completed'),
    ('enum reservation_status: no_show',   EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='reservation_status' AND e.enumlabel='no_show'),     'reservation_status.no_show'),
    ('enum notification_type: reservation',EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='notification_type' AND e.enumlabel='reservation'), 'notification_type.reservation'),

    -- -- functions 01-03 call ------------------------------------------------
    ('function is_admin()',                to_regprocedure('public.is_admin()')                                  IS NOT NULL, 'public.is_admin()'),
    ('function is_staff()',                to_regprocedure('public.is_staff()')                                  IS NOT NULL, 'public.is_staff()'),
    ('function is_pwd_verified(uuid)',     to_regprocedure('public.is_pwd_verified(uuid)')                       IS NOT NULL, 'public.is_pwd_verified(uuid)'),
    ('function has_unpaid_penalties(uuid)',to_regprocedure('public.has_unpaid_penalties(uuid)')                  IS NOT NULL, 'public.has_unpaid_penalties(uuid)'),
    ('function generate_booking_code()',   to_regprocedure('public.generate_booking_code()')                     IS NOT NULL, 'public.generate_booking_code()'),
    ('function create_notification(...)',  to_regprocedure('public.create_notification(uuid,text,text,notification_type,uuid)') IS NOT NULL, 'public.create_notification(uuid,text,text,notification_type,uuid)'),
    ('function log_audit(...)',            to_regprocedure('public.log_audit(uuid,text,jsonb)')                  IS NOT NULL, 'public.log_audit(uuid,text,jsonb)'),

    -- -- extension the EXCLUDE constraint depends on ------------------------
    ('extension btree_gist',               EXISTS (SELECT 1 FROM pg_extension WHERE extname='btree_gist'),       'btree_gist (needed by the reservation EXCLUDE constraint)'),

    -- -- data sanity ---------------------------------------------------------
    ('slots has rows',                     (SELECT COUNT(*) FROM public.slots) > 0,                              'at least one slot'),
    ('slots use zone block_a',             EXISTS (SELECT 1 FROM public.slots WHERE zone='block_a'),            'zone block_a'),
    ('slots use zone side',                EXISTS (SELECT 1 FROM public.slots WHERE zone='side'),               'zone side'),
    ('every slot has a floor',             NOT EXISTS (SELECT 1 FROM public.slots WHERE floor IS NULL),         'slots.floor must not be NULL'),
    ('one agent_state per slot',           (SELECT COUNT(*) FROM public.agent_states) = (SELECT COUNT(*) FROM public.slots), 'agent_states count = slots count')
  ) AS v(check_name, ok, detail)
)
SELECT check_name, ok, detail
  FROM checks
 ORDER BY ok, check_name;

-- ---------------------------------------------------------------------------
-- C. One-line verdict.  Expect failing = 0.  If failing > 0, do NOT run 01-03.
-- ---------------------------------------------------------------------------
WITH checks AS (
  SELECT * FROM (VALUES
    (to_regclass('public.profiles')     IS NOT NULL),
    (to_regclass('public.slots')        IS NOT NULL),
    (to_regclass('public.reservations') IS NOT NULL),
    (to_regclass('public.rates')        IS NOT NULL),
    (to_regclass('public.agent_states') IS NOT NULL),
    (to_regclass('public.notifications')IS NOT NULL),
    (to_regclass('public.audit_log')    IS NOT NULL),
    (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='slots' AND column_name='zone_col')),
    (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='booking_code')),
    (EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.reservations'::regclass AND contype='x')),
    (to_regprocedure('public.is_admin()') IS NOT NULL),
    (to_regprocedure('public.is_staff()') IS NOT NULL),
    (to_regprocedure('public.is_pwd_verified(uuid)') IS NOT NULL),
    (to_regprocedure('public.has_unpaid_penalties(uuid)') IS NOT NULL),
    (to_regprocedure('public.generate_booking_code()') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_extension WHERE extname='btree_gist')),
    ((SELECT COUNT(*) FROM public.slots) > 0),
    ((SELECT COUNT(*) FROM public.agent_states) = (SELECT COUNT(*) FROM public.slots))
  ) AS v(ok)
)
SELECT
  COUNT(*)                                        AS checks_run,
  COUNT(*) FILTER (WHERE ok)                      AS passing,
  COUNT(*) FILTER (WHERE NOT ok)                  AS failing,
  CASE WHEN COUNT(*) FILTER (WHERE NOT ok) = 0
       THEN 'OK - safe to run 01, 02, 03'
       ELSE 'STOP - fix the false rows above before running 01-03'
  END                                             AS verdict
FROM checks;
