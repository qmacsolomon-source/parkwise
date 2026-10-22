# ParkWise — upgrading the LIVE database (beginner's run order)

> **Read this first.** The **live Supabase database is the source of truth**.
> The upgrade files in `database/live_upgrade/` **add** what the phone needs.
> **Nothing here deletes or rewrites your data.** There is no `DELETE`, no
> `TRUNCATE`, no `DROP TABLE`, no `DROP COLUMN`. The only change to existing
> rows is filling six brand-new, empty geometry columns on `slots`.

---

## 0. Back up first (5 minutes, do not skip)

Supabase Dashboard → **Table Editor** → open each table → **⋯ → Export as CSV**.
Export these three (the small ones that matter here):

| Table      | Why |
|------------|-----|
| `slots`    | its geometry columns are what this upgrade fills |
| `rates`    | prices are never touched, but keep a copy before an upgrade |
| `profiles` | the three real accounts in your shared project |

`reservations` and `payments` are empty right now, so they are optional.

You do **not** need to back up `auth.users`; this upgrade never changes it.

---

## 1. How to run each file

1. Supabase Dashboard → **SQL Editor** → **New query**.
2. Open ONE file, copy **the whole thing**, paste it, **Run**.
3. Read the result. If it reports an error, **only the FIRST error matters** —
   everything after it is fallout (a failed statement aborts the transaction,
   so the rest say "current transaction is aborted" and mean nothing).
4. Fix that first error, or ask, before moving on.

**One new query per file.** Do not paste two files into one query.

---

## 2. Run them in this order

### `00_preflight_checks.sql` — read only, changes nothing

Paste it and run. It returns a list of `check_name / ok / detail` rows, then one
summary row.

**Expected result:** every row shows `ok = true`, and the last row shows
`failing = 0` with `verdict = OK - safe to run 01, 02, 03`.

**If a row is `false`: STOP.** The upgrade relies on something the live
database does not have. Send a screenshot of the `false` rows. Do not run 01–03
until it is understood.

### `01_fix_booking_code.sql` — fixes the booking-code crash

This replaces `generate_booking_code()` so it no longer calls
`gen_random_bytes()` (which needs the pgcrypto extension, and the live database
does not have it). Same signature, same `PW-XXXXXXXX` format, same retry, uses
the built-in `gen_random_uuid()` instead.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT generate_booking_code() AS sample_code;
```

Expected: one value that looks like `PW-1A2B3C4D`.

### `02_profile_vehicle_rates_upgrade.sql` — profiles, rates, sign-up trigger

Adds `normalize_plate()`, `ensure_my_profile()`, `submit_my_pwd_permit()`, a
rates read policy (only if one is missing), a vehicle delete policy (only if one
is missing), and the mobile-only `handle_new_user()` trigger.

**Expected result:** `Success. No rows returned`, possibly with `NOTICE` lines
about the plate backfill. Notices are fine.

**Why the trigger is safe for your group's desktop app:** it only creates a
profile when the sign-up metadata says `source = 'mobile'`. Desktop sign-ups are
left completely alone, and the role is always set to `'customer'` — it is never
read from metadata.

Quick check (paste on its own):

```sql
SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';
SELECT COUNT(*) AS profiles_after_upgrade FROM public.profiles;
```

Expected: one trigger row, and the same profile count you saw in step 0.

### `03_floor_plan_207.sql` — the floor plan and automatic assignment

Adds the six geometry columns, creates `facility_layout`, fills the geometry of
**every** slot, numbers them from the entrance, and creates the three functions
the phone calls: `get_floor_plan`, `assign_slot_for_reservation`,
`change_reservation_slot`.

**Expected result:** `Success. No rows returned`.

> The drawing is **schematic**: the bays are laid out on a clean grid computed
> from the slot data, not traced from an image, because the repo only has the
> old 34-bay drawings.

### `04_pwd_permit_photo.sql` — photo evidence for PWD permit verification

Adds a `pwd_permit_photo_path` column on `profiles`, a private `pwd-permits`
Storage bucket, policies so a customer can only upload/view their own photo
while staff can view any of them, and replaces `submit_my_pwd_permit()` to
also accept the uploaded photo's path. Also adds a SELECT policy on
`storage.buckets` itself (RLS is on there by default too) - without it,
uploads fail with "Bucket not found" even though the bucket row exists,
because the Storage API's own existence check runs under the calling user's
RLS context and can't see it either.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT id, public FROM storage.buckets WHERE id = 'pwd-permits';
SELECT polname FROM pg_policy
 WHERE polrelid = 'storage.buckets'::regclass AND polname ILIKE '%pwd-permits bucket%';
SELECT polname FROM pg_policy
 WHERE polrelid = 'storage.objects'::regclass AND polname ILIKE '%permit photo%';
```

Expected: one bucket row with `public = false`, one bucket-policy row, and 4 object-policy rows.

### `05_pwd_intent.sql` — "do you have a PWD permit?" at sign-up

Registration no longer collects a permit number up front, just a yes/no
checkbox. Adds `profiles.pwd_intent` and updates `handle_new_user()` +
`ensure_my_profile()` to read it from sign-up metadata, so the app can send
that customer straight to Settings on their first login to finish
verification (number + photo).

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='profiles' AND column_name='pwd_intent';
```

Expected: one row.

### `06_profiles_realtime.sql` — staff-side changes reach an open mobile app immediately

Adds `profiles` to the realtime publication, so a change made on the desktop
console (PWD verification, etc.) reaches an already-open mobile session right
away instead of waiting for something else to trigger a refetch.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT COUNT(*) FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND tablename = 'profiles';
```

Expected: `1`.

### `07_vehicles_is_active.sql` — fixes "column vehicle.is_active does not exist"

Adds `vehicles.is_active` (every existing vehicle backfilled to `true`) and
changes `reservations.vehicle_id`'s foreign key from `ON DELETE CASCADE` to
`ON DELETE RESTRICT`, so a vehicle with booking history can never be
hard-deleted by anything — the app already archives those instead.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='vehicles' AND column_name='is_active';
SELECT confdeltype FROM pg_constraint WHERE conname = 'reservations_vehicle_id_fkey';
```

Expected: one column row, and `confdeltype = 'r'` (RESTRICT, not `'c'` for CASCADE).

### `08_realtime_publication.sql` — turns on live updates for slots, reservations, notifications

The mobile app has been subscribing to realtime changes on `slots`,
`reservations`, `notifications` and `agent_states` this whole time — but only
`profiles` was ever added to the live project's realtime publication, so
those subscriptions connect but silently receive nothing. This is why the new
occupancy dots and live notifications don't update until you manually
refresh/reopen a screen. This file turns them on for real.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' ORDER BY tablename;
```

Expected: `agent_states`, `notifications`, `profiles`, `reservations`, `slots` (5 rows).

### `09_profile_name_parts.sql` — splits sign-up name into First / Middle / Surname

Registration now asks for First Name / Middle Name (optional) / Surname
separately instead of one "Full Name" field. Adds `profiles.first_name`,
`profiles.middle_name`, `profiles.last_name` (all nullable — null for every
row that existed before this, and for staff accounts, which still have no
name-parts concept). `full_name` itself is untouched and still gets computed
automatically from the three parts, so every existing place that reads
`profiles.full_name` (desktop reports, payment logs, notifications, account
creation, user management) keeps working exactly as before.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='profiles'
   AND column_name IN ('first_name','middle_name','last_name');
```

Expected: 3 rows.

### `10_request_account_deletion.sql` — fixes Settings' "Request account deletion"

`request_my_account_deletion()` existed in the repo's fresh-install script but
was never carried into the live upgrade path — tapping "Send request" in
Settings currently fails on the live project. Adds the function (records an
audit-log entry for staff to action; never deletes anything itself).

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT proname FROM pg_proc WHERE proname = 'request_my_account_deletion';
```

Expected: 1 row.

### `11_protect_profile_columns.sql` — SECURITY FIX, run this one first if you only run one

The live database's "Users can update own profile" RLS policy only checks
*which row* a customer can update, not *which columns* — Postgres RLS can't
restrict that on its own. Without this trigger, any signed-in customer can
currently grant themselves `role = 'admin'`, re-enable their own disabled
account, or mark their own PWD permit verified, just by calling
`profiles.update(...)` on their own row from the app. This existed in the
fresh-install script but was never carried into live. Adds
`protect_profile_columns()` + its trigger, which pins `role`/`status`/
`pwd_verified` back to their existing value for anyone who isn't already
staff.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT tgname FROM pg_trigger WHERE tgname = 'protect_profile_columns_trg';
```

Expected: 1 row.

### `12_phone_login.sql` — fixes "log in with phone number" (it never actually worked)

Login's "Email or Phone" field accepted and validated an 11-digit phone
number, but it was passed straight through as the literal email to Supabase,
which can never match - phone login has silently never worked, always
failing with the same generic "check your credentials" message as a wrong
password. Adds `email_for_phone(phone)` (resolves a phone to its matching
email, server-side) and a partial unique index on `profiles.phone` covering
only well-formed 11-digit numbers (blank/legacy values are left alone, so
this cannot fail on existing data - unless two real customers already share
the same number, in which case it's skipped with a NOTICE instead of failing
the whole file).

**Expected result:** `Success. No rows returned`, possibly with a `NOTICE` if
two existing profiles share a phone number - that's not a failure, see above.

Quick check (paste on its own):

```sql
SELECT proname FROM pg_proc WHERE proname = 'email_for_phone';
SELECT indexname FROM pg_indexes WHERE indexname = 'profiles_phone_unique_idx';
```

Expected: 1 row each (the index may be missing with the NOTICE above explaining why).

### `13_frames_bucket.sql` — storage for the ALPR camera's frames

Creates the public `frames` Storage bucket `agent-service` uploads camera
frames to (public because `storage.py` builds its download URL by hand
rather than requesting a signed one - see the file's own comment for the
trade-off), plus the matching `storage.buckets` SELECT policy (same
"Bucket not found" issue as `04`/`07`, for anyone other than the
service-role key, which bypasses RLS and doesn't need it).

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT id, public FROM storage.buckets WHERE id = 'frames';
```

Expected: one row, `public = true`.

### `14_customer_agent_state_read.sql` — lets a customer see their own slot's camera photo

Adds a SELECT policy on `agent_states` so a customer can read the row for
their own slot (`last_frame_url`, confidence, state) while they have a
pending/active/verified reservation on it - needed for the mobile app's
"Live camera check" photo on the dashboard. Previously only staff could read
`agent_states` at all. Scoped to the customer's own reservation, so this
can never expose another customer's camera frame.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT policyname FROM pg_policies WHERE tablename = 'agent_states';
```

Expected: 3 rows (`Attendants can view agent states`, `Attendants can update
agent states`, `Customers can view their own slot's agent state`).

### `15_fix_overlap_constraint_terminal_statuses.sql` — stops a slot being permanently blocked by an old cancelled/completed reservation

The `no_overlapping_reservations` EXCLUDE constraint on this live database has
no `WHERE` clause, so once *any* reservation has ever existed for a slot and
time range, that combination is blocked forever - even after the reservation
is cancelled, completed, or marked no-show. `schema.sql` (the fresh-install
reference) already has the correct version, scoped to only
pending/active reservations; this live database was set up before that was
added and never got it. Confirmed live: reassigning onto a slot with an
earlier *completed* booking failed outright with a constraint violation.
Postgres can't alter an EXCLUDE constraint's predicate in place, so this
drops and recreates it.

**Expected result:** `Success. No rows returned`.

Quick check (paste on its own):

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'no_overlapping_reservations';
```

Expected: the definition ends with a `WHERE` clause excluding `cancelled`,
`completed`, and `no_show`.

### `16_occupied_means_verified.sql` — a slot only shows 'occupied' once the camera actually verified it

`update_slot_status()` previously treated `reservations.status = 'active'`
(an attendant administratively checking a car in on Slot Assignment) the
same as `'verified'` (the camera actually confirmed the plate on Plate
Verification) - both turned the slot `occupied` immediately. Now only
`'verified'` does; `'active'` leaves the slot at `'reserved'`, matching what
a freshly-created reservation already gets. Redefines the trigger function
in place (`CREATE OR REPLACE`, no DROP needed, unlike `15`'s constraint).

**Expected result:** `Success. No rows returned`.

Quick check (manual, not a query): accept a vehicle on Slot Assignment and
confirm the slot shows `reserved`, not `occupied`, until Plate Verification's
Accept Vehicle actually verifies the plate.

---

## 3. Final check — "is everything installed?"

Paste this whole block as one query. Every row should say `ok`.

```sql
WITH r AS (
  SELECT 'slots'                      AS item, COUNT(*)::text AS value, (COUNT(*) > 0)        AS ok FROM public.slots
  UNION ALL SELECT 'agent_states',      COUNT(*)::text, (COUNT(*) = (SELECT COUNT(*) FROM public.slots)) FROM public.agent_states
  UNION ALL SELECT 'slots with position',  COUNT(*)::text, (COUNT(*) = (SELECT COUNT(*) FROM public.slots)) FROM public.slots WHERE floor_x IS NOT NULL
  UNION ALL SELECT 'slots with entry_rank',COUNT(*)::text, (COUNT(*) = (SELECT COUNT(*) FROM public.slots)) FROM public.slots WHERE entry_rank IS NOT NULL
  UNION ALL SELECT 'geometry columns',  COUNT(*)::text, (COUNT(*) = 6) FROM information_schema.columns
              WHERE table_schema='public' AND table_name='slots'
                AND column_name IN ('floor_x','floor_y','floor_w','floor_h','facing','entry_rank')
  UNION ALL SELECT 'facility_layout row', COUNT(*)::text, (COUNT(*) = 1) FROM public.facility_layout
  UNION ALL SELECT 'floor-plan functions', COUNT(*)::text, (COUNT(*) = 3) FROM pg_proc
              WHERE proname IN ('get_floor_plan','assign_slot_for_reservation','change_reservation_slot')
  UNION ALL SELECT 'mobile sign-up trigger', COUNT(*)::text, (COUNT(*) = 1) FROM pg_trigger
              WHERE tgname='on_auth_user_created'
  UNION ALL SELECT 'booking_code fixed', 'gen_random_uuid', (pg_get_functiondef('public.generate_booking_code()'::regprocedure) NOT LIKE '%gen_random_bytes%')
  UNION ALL SELECT 'pwd-permits bucket', COUNT(*)::text, (COUNT(*) = 1) FROM storage.buckets WHERE id = 'pwd-permits'
  UNION ALL SELECT 'pwd permit photo policies', COUNT(*)::text, (COUNT(*) = 4) FROM pg_policy
              WHERE polrelid = 'storage.objects'::regclass AND polname ILIKE '%permit photo%'
  UNION ALL SELECT 'pwd-permits bucket policy', COUNT(*)::text, (COUNT(*) = 1) FROM pg_policy
              WHERE polrelid = 'storage.buckets'::regclass AND polname ILIKE '%pwd-permits bucket%'
  UNION ALL SELECT 'pwd_intent column', COUNT(*)::text, (COUNT(*) = 1) FROM information_schema.columns
              WHERE table_schema='public' AND table_name='profiles' AND column_name='pwd_intent'
  UNION ALL SELECT 'profiles realtime', COUNT(*)::text, (COUNT(*) = 1) FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  UNION ALL SELECT 'vehicles.is_active column', COUNT(*)::text, (COUNT(*) = 1) FROM information_schema.columns
              WHERE table_schema='public' AND table_name='vehicles' AND column_name='is_active'
  UNION ALL SELECT 'vehicle FK is RESTRICT', confdeltype::text, (confdeltype = 'r') FROM pg_constraint
              WHERE conname = 'reservations_vehicle_id_fkey'
  UNION ALL SELECT 'realtime: slots/reservations/notifications/agent_states', COUNT(*)::text, (COUNT(*) = 4) FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND tablename IN ('slots','reservations','notifications','agent_states')
  UNION ALL SELECT 'profile name-parts columns', COUNT(*)::text, (COUNT(*) = 3) FROM information_schema.columns
              WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('first_name','middle_name','last_name')
  UNION ALL SELECT 'request_my_account_deletion()', COUNT(*)::text, (COUNT(*) = 1) FROM pg_proc
              WHERE proname = 'request_my_account_deletion'
  UNION ALL SELECT 'protect_profile_columns trigger (SECURITY)', COUNT(*)::text, (COUNT(*) = 1) FROM pg_trigger
              WHERE tgname = 'protect_profile_columns_trg'
  UNION ALL SELECT 'email_for_phone()', COUNT(*)::text, (COUNT(*) = 1) FROM pg_proc
              WHERE proname = 'email_for_phone'
  UNION ALL SELECT 'frames bucket', COUNT(*)::text, (COUNT(*) = 1) FROM storage.buckets
              WHERE id = 'frames'
  UNION ALL SELECT 'agent_states customer read policy', COUNT(*)::text, (COUNT(*) = 1) FROM pg_policy
              WHERE polrelid = 'public.agent_states'::regclass AND polname = 'Customers can view their own slot''s agent state'
  UNION ALL SELECT 'overlap constraint excludes terminal statuses', 'has WHERE', (pg_get_constraintdef(oid) LIKE '%WHERE%') FROM pg_constraint
              WHERE conname = 'no_overlapping_reservations'
)
SELECT item, value, ok FROM r ORDER BY ok, item;
```

**Expected:**
- `slots` = **207**
- `agent_states` = **207**
- `slots with position` = **207**
- `slots with entry_rank` = **207**
- `geometry columns` = **6**
- `facility_layout row` = **1**
- `floor-plan functions` = **3**
- `mobile sign-up trigger` = **1**
- `booking_code fixed` → `ok = true`
- `pwd-permits bucket` = **1**
- `pwd permit photo policies` = **4**
- `pwd-permits bucket policy` = **1**
- `pwd_intent column` = **1**
- `profiles realtime` = **1**
- `vehicles.is_active column` = **1**
- `vehicle FK is RESTRICT` → `ok = true`
- `realtime: slots/reservations/notifications/agent_states` = **4**
- `profile name-parts columns` = **3**
- `request_my_account_deletion()` = **1**
- `protect_profile_columns trigger (SECURITY)` = **1**
- `email_for_phone()` = **1**
- `frames bucket` = **1**
- `agent_states customer read policy` = **1**
- `overlap constraint excludes terminal statuses` → `ok = true`

If any `ok` is `false`, note which row and stop — do not re-run random files.

---

## 4. After the upgrade (manual, on a phone)

- [ ] Register a new customer **in the app** → a profile appears in `profiles`
      with `role = 'customer'`.
- [ ] Book a slot → the phone returns a booking code (no more 42883 error) and
      the floor plan marks one bay as yours.
- [ ] A non-PWD customer never gets a PWD bay (`PWD_ONLY` if they force one).
- [ ] Two overlapping bookings get two different bays.

## 5. Things this upgrade does NOT fix (your group's call)

- The **desktop** staff account flow (`desktop/src/pages/AccountCreation.tsx`)
  creates an auth user and then updates `profiles`, expecting a trigger to have
  created the row. This upgrade's trigger is mobile-only, so it does not create
  staff rows. See the final report for the full list of desktop assumptions.
- `reset_database.sql` **does** work against the live database, but only as a
  full wipe (it drops and recreates every table, so all reservations/customers
  are lost). Use it only when you deliberately want to rebuild live as the
  207-slot layout, then re-run the fresh-project order in `RUN_ORDER.md`
  (steps 2–7) — `reset_database.sql` already contains `schema.sql`.
- The two `migrate_*.sql` files are **legacy** (built for the old 102-slot
  layout). Do **not** run them against the live database.
