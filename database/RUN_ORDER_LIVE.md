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
- `reset_database.sql` and the two `migrate_*.sql` files are **legacy** (built
  for the old 102-slot layout). Do **not** run them against the live database.
