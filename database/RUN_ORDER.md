# ParkWise — database run order (fresh project)

This is the exact order to paste the SQL files into a **brand-new, empty
Supabase project**. It is written for a first-time setup.

## How to run these files (read this first)

* In the Supabase dashboard open **SQL Editor → New query**.
* **One file per query.** Paste the *whole* file, click **Run** once, then open
  a **new** query for the next file. Do not paste two files into one query.
* The SQL Editor runs your paste as **one transaction**. If any statement
  fails, every later statement in that same query reports
  `25P02 current transaction is aborted` — that is **fallout, not a second
  problem**. Always fix the **first** error you see and re-run the whole file.
* "Success" in the SQL Editor = the query finishes with **no red error**, even
  if it prints a row of results (several of these files print a verification
  `SELECT` at the end — that is normal and good).
* Every file below is **safe to run twice**: re-running it does not duplicate
  or destroy data.

---

## The order

| # | Run this | Depends on |
|---|----------|-----------|
| 1 | `schema.sql` | — |
| 2 | `rls_policies.sql` | 1 |
| 3 | `business_rules.sql` | 1, 2 |
| 4 | `profile_vehicle_rates_fixes.sql` | 1, 2 |
| 5 | create the first Auth user, then run the **promote-to-admin** SQL | 4 |
| 6 | `seed.sql` | 1, 5 |
| 7 | `floor_plan_and_assignment.sql` | 1, 2, 3, 6 |

`reset_database.sql` is **not** part of this list — see the bottom of this page.

---

## Step 1 — `schema.sql`

Creates the extensions, the enum types and every table.

**Check it worked** (expect `11`):

```sql
SELECT count(*) AS tables
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('profiles','vehicles','slots','reservations','payments',
                      'penalties','notifications','rates','agent_states',
                      'verification_events','audit_log');
```

## Step 2 — `rls_policies.sql`

Creates the role-check helpers (`is_admin`, `is_attendant`, `is_staff`) and all
the row-level-security policies.

**Check it worked** (expect 3 rows: `is_admin`, `is_attendant`, `is_staff`):

```sql
SELECT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('is_admin','is_attendant','is_staff')
 ORDER BY p.proname;
```

## Step 3 — `business_rules.sql`

Creates the booking-code generator, notifications, audit logging, penalties and
the reservation triggers.

**Check it worked** (expect one code like `PW-1A2B3C4D`):

```sql
SELECT public.generate_booking_code() AS sample_code;
```

## Step 4 — `profile_vehicle_rates_fixes.sql`

Installs `handle_new_user()` + the `on_auth_user_created` trigger, `ensure_my_profile()`,
the rates data/policy and the vehicle/protection rules.

**Check it worked** (expect 1 row):

```sql
SELECT tgname FROM pg_trigger
 WHERE NOT tgisinternal AND tgname = 'on_auth_user_created';
```

> Run this **before** creating Auth users (step 5). It is what gives every new
> user a `profiles` row automatically.

## Step 5 — Create the first Auth user, then promote it to admin

1. In the dashboard go to **Authentication → Users → Add user**, create your
   account (e.g. `admin@parkwise.com`), and confirm it.
   The trigger from step 4 creates a `profiles` row for it with role
   **customer**.
2. Promote that user to **admin** by running this query. Replace the email with
   the one you just created (the `phone` column is `NOT NULL`, so a value is
   supplied here):

```sql
INSERT INTO public.profiles (id, full_name, email, phone, role)
SELECT u.id,
       COALESCE(NULLIF(u.raw_user_meta_data->>'full_name', ''), 'ParkWise Admin'),
       COALESCE(u.email, 'admin@parkwise.local'),
       COALESCE(NULLIF(u.raw_user_meta_data->>'phone', ''), '09171234567'),
       'admin'
  FROM auth.users u
 WHERE u.email = 'admin@parkwise.com'
ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

**Check it worked** (expect one row with `role = admin`):

```sql
SELECT email, role FROM public.profiles WHERE email = 'admin@parkwise.com';
```

## Step 6 — `seed.sql`

Creates the parking map: **3 floors × 34 slots = 102 slots**, one rates row and
one agent state per slot, and enables Realtime.

**Check it worked** (expect `102`):

```sql
SELECT count(*) FROM public.slots;
```

> This file only creates the **map**, not demo users. It does not need any UUID
> edited.

## Step 7 — `floor_plan_and_assignment.sql`

Adds the floor-plan geometry columns to `slots` and backfills the coordinates,
then creates `facility_layout`, `get_floor_plan()`, `assign_slot_for_reservation()`
and `change_reservation_slot()`.

**Check it worked** (expect `102`):

```sql
SELECT count(*) FROM public.slots WHERE floor_x IS NOT NULL;
```

> This file must come **after** `seed.sql` (it backfills the rows `seed.sql`
> created). It wraps everything in one `BEGIN; … COMMIT;`, so if it fails,
> **only the first error is real** — the rest are the `25P02` fallout described
> at the top of this page.

---

## Everything is installed — one final check

Run this once. Every row should say **`true`**.

```sql
SELECT label, ok, actual FROM (VALUES
  ('102 slots (34 on each of 3 floors)',
   (SELECT count(*)::int FROM public.slots) = 102
     AND (SELECT count(*)::int FROM public.slots WHERE floor = 1) = 34
     AND (SELECT count(*)::int FROM public.slots WHERE floor = 2) = 34
     AND (SELECT count(*)::int FROM public.slots WHERE floor = 3) = 34,
   (SELECT count(*)::text FROM public.slots)),
  ('PWD slots = 1A11,1A12,2A11,2A12,3A11,3A12',
   (SELECT string_agg(slot_code, ',' ORDER BY slot_code) FROM public.slots WHERE is_pwd)
     = '1A11,1A12,2A11,2A12,3A11,3A12',
   (SELECT string_agg(slot_code, ',' ORDER BY slot_code) FROM public.slots WHERE is_pwd)),
  ('1 rates row',
   (SELECT count(*)::int FROM public.rates) = 1,
   (SELECT count(*)::text FROM public.rates)),
  ('1 facility_layout row',
   (SELECT count(*)::int FROM public.facility_layout) = 1,
   (SELECT count(*)::text FROM public.facility_layout)),
  ('102 agent_states',
   (SELECT count(*)::int FROM public.agent_states) = 102,
   (SELECT count(*)::text FROM public.agent_states)),
  ('geometry backfilled on all 102 slots',
   (SELECT count(*)::int FROM public.slots WHERE floor_x IS NOT NULL) = 102
     AND (SELECT count(*)::int FROM public.slots WHERE entry_rank IS NOT NULL) = 102,
   (SELECT count(*)::text FROM public.slots WHERE floor_x IS NOT NULL)),
  ('functions installed (is_admin, is_staff, get_floor_plan, ...)',
   (SELECT count(DISTINCT p.proname)::int FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('is_admin','is_attendant','is_staff',
       'handle_new_user','ensure_my_profile','get_floor_plan',
       'assign_slot_for_reservation','change_reservation_slot','normalize_plate')) = 9,
   (SELECT count(DISTINCT p.proname)::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('is_admin','is_attendant','is_staff',
       'handle_new_user','ensure_my_profile','get_floor_plan',
       'assign_slot_for_reservation','change_reservation_slot','normalize_plate'))),
  ('triggers installed (on_auth_user_created, reservation triggers, ...)',
   (SELECT count(DISTINCT tgname)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
     ('on_auth_user_created','protect_profile_columns_trg','trg_reservation_check_penalties',
      'trg_reservation_check_pwd','trg_reservation_set_booking_code','trg_reservation_update_slot',
      'trg_reservation_notify_created','trg_reservation_notify_status','trg_reservation_create_penalty',
      'trg_reservation_audit','trg_payment_audit')) = 11,
   (SELECT count(DISTINCT tgname)::text FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
     ('on_auth_user_created','protect_profile_columns_trg','trg_reservation_check_penalties',
      'trg_reservation_check_pwd','trg_reservation_set_booking_code','trg_reservation_update_slot',
      'trg_reservation_notify_created','trg_reservation_notify_status','trg_reservation_create_penalty',
      'trg_reservation_audit','trg_payment_audit'))),
  ('Realtime on slots, reservations, agent_states, notifications',
   (SELECT count(*)::int FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND tablename IN ('slots','reservations','agent_states','notifications')) = 4,
   (SELECT count(*)::text FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND tablename IN ('slots','reservations','agent_states','notifications'))),
  ('booking-code generator works (PW- + 8 hex)',
   (SELECT public.generate_booking_code() ~ '^PW-[0-9A-F]{8}$'),
   (SELECT public.generate_booking_code())),
  ('first Auth user is admin',
   (SELECT count(*)::int FROM public.profiles WHERE role = 'admin') >= 1,
   (SELECT count(*)::text FROM public.profiles WHERE role = 'admin'))
) AS t(label, ok, actual);
```

---

## `reset_database.sql` — deletes data, and when NOT to use it

> **WARNING: `reset_database.sql` DELETES ALL DATA.** It drops every ParkWise
> table (profiles, vehicles, slots, reservations, payments, penalties,
> notifications, audit_log …) and recreates them empty. Any reservations,
> customers and history are gone permanently. It does **not** delete Supabase
> Auth users, but it deletes their `profiles` rows — which is why logins then
> fail with "Profile not found".

* **Do NOT run it** on a project you are simply setting up for the first time —
  steps 1–7 above already create everything.
* **Do NOT run it** on a project that has reservations or customers you want to
  keep.
* Only use it when you genuinely want to wipe a demo/dev project and start over.
  After a reset you must re-run steps 1–7 (its own header repeats this order).

---

## Advanced — upgrade path for an OLD 20-slot database (NOT for a fresh project)

A fresh project does **not** need any of this: `seed.sql` already creates the
final 3-floor / 102-slot layout. The two files below exist **only** to convert a
database that still holds the very old single-floor layout (`A1`…`A20`). They are
**not** part of the setup order.

* `migrate_multi_floor_layout.sql` — expands the old single-floor layout into the
  multi-floor one.
* `migrate_shrink_to_reference_layout.sql` — reshapes each floor to the current
  reference layout. **This one DELETES slots**, and the delete cascades into any
  reservations and payments that reference them.

Rules for using them:

1. Take a backup first.
2. Run them **only** on an old database that still has the `A1`…`A20` naming.
3. Run them **only** when there are **no reservations or payments you need to
   keep** — otherwise the shrink file can delete them.
4. Never run them on a fresh project, and never run them twice.
