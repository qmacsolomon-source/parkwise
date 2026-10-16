# Alex's Changes

Notes on everything changed in this pass, so the team knows what moved and why. Nothing here touches the mobile app or agent-service.

## ⚠️ Action required on the live Supabase project

Code changes alone don't update the live database. To pick these up, run (in this order, in the Supabase SQL Editor):
1. `database/schema.sql` — safe to re-run, adds the missing `annotation` column without touching existing data
2. `database/rls_policies.sql` — adds the new attendant insert policies described below

## Fixed: Manual Entry wasn't working at all

Root cause was in `database/rls_policies.sql`, not the frontend. Creating a walk-in entry requires inserting a `profiles` row, a `vehicles` row, and a `reservations` row for the customer — but the existing policies only allowed:
- `profiles` inserts by **admins only** (attendants were blocked)
- `vehicles` inserts only where `owner_id = auth.uid()` (never true — the attendant is inserting on someone else's behalf)
- `reservations` inserts only where `customer_id = auth.uid()` (same problem)

So every Manual Entry submission was being silently rejected by the database, regardless of what the form looked like. Added three new `is_staff()`-gated INSERT policies to cover all three tables.

## Fixed: `schema.sql` was wiping all data on every re-run

It started with `DROP TABLE ... CASCADE` on every table. Re-running it after any schema tweak (which the setup docs tell you to do) deleted every profile, reservation, and payment that existed. This is almost certainly why the dataset kept "disappearing."

- `schema.sql` is now idempotent (`CREATE TABLE IF NOT EXISTS`, guarded `CREATE TYPE`, etc.) — re-running it to pick up someone else's schema change no longer destroys data.
- The old destructive version is preserved as `database/reset_database.sql`, for when a genuine full wipe is actually wanted (it has a warning header).
- `SETUP.md` updated to point at the right script for each case.

## Manual Entry (`desktop/src/pages/ManualEntry.tsx`)

- Motorcycle option removed from Vehicle Type — then Vehicle Type was removed from the form entirely (it's always four-wheeled, no reason to make the attendant pick it)
- Customer Name and Mobile Number are now required (were optional)
- Mobile Number must be exactly 11 digits
- Time In is now automatic (current time at submission) instead of a manual field
- Expected Duration is now hours **and** minutes, not hours only
- Reason field removed entirely (wasn't needed)

## Other bug fixes found while reviewing every page

- **Live Occupancy**: the Logout button called an undefined function — would have crashed on click
- **Slot Assignment**: the customer notification sent on reassignment used a nonexistent `message` column (actual column is `body`) and an invalid `type: 'info'` (enum only allows `reservation/verification/payment/penalty/system`). This made the insert throw, which the outer try/catch caught and reported as **"Failed to reassign slot" even though the reassignment itself had already succeeded** — very confusing for the attendant. Fixed to use `body` and `type: 'system'`.
- **Time & Payment Log**:
  - `reservation.annotation` was referenced in code but the column never existed in the database — saving an annotation always failed. Added the column.
  - The "Attendant" column logic was inverted (blank when a payment existed, "N/A" when it didn't)
  - Pagination showed a hardcoded fake total of 100 records instead of the real count
- **Account Creation**:
  - Removed the "Username" field — the `profiles` table has no username column, and the duplicate-check was comparing it against `full_name`, which was just wrong. Login is by email only.
  - Creating a staff account via `supabase.auth.signUp()` was silently logging the admin out and logging them in as the brand-new account (there's no backend service-role key available to create users without this side effect). Fixed by saving and restoring the admin's session around the signup call.
- **User Management**: "Last Login" always showed "Never" — it queried audit action `'login'`, but logins are actually logged as `'login_success'`. Fixed the filter.
- **Reports**:
  - "Occupancy Rate by Hour" chart was `Math.random()` on every render (the code even said so in a comment: "Placeholder - would need actual slot status history"). Removed it rather than ship a chart that's pure noise.
  - "Daily Revenue" labeled bars "Day 1, Day 2..." without actually sorting chronologically. Now sorted by real date and labeled with the actual date.

## Removed dead code

`desktop/src/pages/Dashboard.tsx` was never routed anywhere (`LiveOccupancyDashboard.tsx` replaced it), but was still imported in `App.tsx`. Deleted it along with its two only-used-there helper components, `SlotCard.tsx` and `ReservationCard.tsx`.

## Known limitation — not fixed, needs a backend

In **User Management**, "Reset Password" and "Hard Delete" both call `supabase.auth.admin.*`, which requires a service-role key. Called from the browser with only the anon key, these will always fail. There's no safe way to fix this from the client — it needs a small backend component (e.g. a Supabase Edge Function) that holds the service-role key server-side. Worth knowing before demoing either button.
