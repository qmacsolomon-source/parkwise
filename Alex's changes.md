# Alex's Changes

Notes on everything changed in this pass, so the team knows what moved and why. Nothing here touches the mobile app (left alone throughout, including this round, since that's actively being worked on separately).

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

## ~~Known limitation — not fixed, needs a backend~~ — fixed in Round 5

~~In **User Management**, "Reset Password" and "Hard Delete" both call `supabase.auth.admin.*`, which requires a service-role key. Called from the browser with only the anon key, these will always fail.~~ Fixed properly via a Supabase Edge Function — see Round 5 below.

## Round 2: Manual Entry was still failing even with the RLS fix applied

After the `is_staff()` policies above were added, Manual Entry submissions still came back as "Failed to create manual entry" — but the data was actually being written (confirmed slot A12 correctly flipped to `occupied` with a real reservation attached, checked directly via the API). Two separate problems were layered on top of each other:

### `profiles.id` had a hard foreign key to `auth.users(id)`

Walk-in customers registered via Manual Entry never log in, so they have no `auth.users` row — but `profiles.id` required one via `REFERENCES auth.users(id) ON DELETE CASCADE`. Every walk-in profile insert was rejected outright by the database.

- Dropped the FK and gave `id` a `DEFAULT uuid_generate_v4()` instead, in both `database/schema.sql` and `database/reset_database.sql`.
- Real accounts (customers who sign up, staff created via Account Creation) are unaffected — the app still sets `id` explicitly to match their `auth.users` id when one exists.
- **Action required on the live Supabase project**: run the schema changes in `database/schema.sql` (it includes a guarded upgrade path that drops the old constraint and sets the new default — safe to re-run).

### Agent-service calls were turning successful operations into false failures

Manual Entry (and Cash Payment) each call out to the Python agent-service (`localhost:8000`) as a side effect — informing it a slot is now occupied, or resetting it on void/payment. With the agent-service not running, those `fetch()` calls threw, and the *unrelated* database write that had already succeeded got reported as a failure anyway.

- Wrapped these calls in their own try/catch (`console.warn` on failure instead of throwing) in `ManualEntry.tsx` (submit + void) and `CashPayment.tsx` (confirm payment) — the core database operation's success is no longer tied to whether the agent-service happens to be running.
- `PlateVerification.tsx` was left untouched since talking to the agent-service is that page's actual job, not a side effect.

### Manual Entry form, round 2

- Vehicle Type removed from the form entirely (previously just had motorcycle removed) — always four-wheeled, set automatically
- Time In is now automatic (current time at submission), no manual field
- Mobile Number must be exactly 11 digits (was: at least 10)

Confirmed working end-to-end in the browser after these fixes.

## Round 3: full codebase deep-dive (database, agent-service, shared, remaining desktop pages)

Not reacting to a specific complaint this time — went looking for whatever else was broken. Found and fixed 10 issues across every part of the stack except mobile. Each was fixed and verified independently (typecheck/compile at minimum; several were confirmed live via the browser or a disposable test account — noted per item).

### ⚠️ Action required on the live Supabase project

Three SQL files changed. **Re-run all three, in this order**, in the Supabase SQL Editor (all three are idempotent / safe to re-run — nothing gets dropped or wiped):
1. `database/schema.sql`
2. `database/business_rules.sql` — note: this file's `CREATE TRIGGER` statements never had `DROP TRIGGER IF EXISTS` guards before this round (every other object in the file was already idempotent, triggers were the one gap) — re-running it previously would have errored out immediately on the first pre-existing trigger. Fixed as part of this round, so it's now actually safe to paste the whole file again.
3. `database/rls_policies.sql`

### 1. Agent-service (Python) never actually touched the database

Every Supabase call in `database.py` and `agent_manager.py` built a query but never called `.execute()` on it — in supabase-py 2.x, nothing happens and `.data` doesn't exist until you call that. The service's startup routine has no error handling around this, so it likely crashed on launch; even where it didn't, no agent state, slot status, or verification event was ever actually saved. Added `.execute()` everywhere it was missing (10 call sites). Also fixed a related bug in the same file: `agent_manager.py` was storing the slot_id string instead of the restored `SlotAgent` object, silently discarding an agent's recovered state on every restart.
Verified via `python -m py_compile` (clean) and by re-checking the supabase-py 2.x API shape; could not run the service live since no service-role key / `.env` exists for it yet.

### 2. Mobile customer signup silently failed

`shared/src/auth.ts`'s `signup()` inserted `pwd_verified: null` (violates `NOT NULL`) for the common case, or `status: 'pending'` (not a valid enum value) when a PWD permit was supplied — the insert always failed, but the error was only `console.error`'d, never surfaced, so the user ended up logged in with no profile at all. Fixed to always insert valid values (`pwd_verified: false`, `status: 'active'`) and rethrow the error instead of swallowing it. Verified clean on `shared`'s and `desktop`'s typecheck.
Side note: `mobile/src/screens/RegistrationScreen.tsx` has leftover hint text claiming the account "will be pending until verified by staff" — nothing ever actually implemented that, so the wording is a little inaccurate now. Not fixed (mobile is out of scope right now), just flagged.

### 3. Rebooking a slot after a cancellation failed at the database level

The "no double-booking" constraint on `reservations` didn't exclude cancelled/completed/no-show reservations, so once any reservation existed for a slot+time window, that exact window could never be booked again — even though the UI's own "is this slot available" logic already correctly ignored dead reservations. Added a `WHERE` predicate to the exclusion constraint so it agrees with that logic. Fixed in both `schema.sql` and `reset_database.sql`.

### 4. Penalties were never actually charged

No-show, overstay, and late-cancel penalties existed as enum values and rate columns, but nothing ever inserted a `penalties` row — a notification told the customer "a penalty has been applied" when none ever was. Added a trigger that creates the right penalty row (amount pulled from the `rates` table) the first time a reservation transitions into `no_show`, `overstay`, or a late `cancelled`. One open question flagged in the trigger's own comment: `overstay` penalties are a flat charge separate from the existing metered per-hour overstay surcharge, which may double-charge a single overstay event — worth a second look if that matters.

### 5–7. RLS policy gaps that silently blocked real app actions

Three tables were missing policies the app actually needs, so the matching UI action always failed with no visible error:
- `penalties` had no UPDATE policy — Cash Payment couldn't mark a penalty paid, admin couldn't adjust/waive one.
- `audit_log` had no UPDATE policy — voiding a Manual Entry never actually marked its audit record voided.
- `profiles` had no DELETE policy — admin "Delete User" silently did nothing.

Also fixed: the self-cancel reservation policy was written so the cancel itself always got rejected (Postgres defaults an UPDATE policy's `WITH CHECK` to match its `USING` clause, which required the *post*-cancel row to still be `pending`/`active` — impossible). Added an explicit `WITH CHECK` allowing that specific transition.

Bonus found while fixing the above: `audit_log`'s INSERT policy was `WITH CHECK (true)` — any logged-in user, including customers, could write an audit entry claiming to be anyone. Checked every real audit-log insert in the codebase; all of them always use the caller's own id, so tightened it to `WITH CHECK (actor_id = auth.uid())` with no legitimate use broken.

### 8. Rates & Pricing: grace period setting did nothing, and the preview math was wrong

The admin-editable "grace period" field wasn't used anywhere — overstay billing started counting immediately at `end_time` with no grace at all. Added the gate to the real billing function (`calculate_payment()` in `business_rules.sql`): overstay only applies once `NOW() > end_time + grace_period_minutes`. Also fixed the on-screen price preview, which computed overstay as a fractional amount instead of matching the real `CEIL(hours) * rate` rounding — it was under-reporting the real charge.
(Separately confirmed: `PlateVerification.tsx`'s hardcoded 60-second value is an unrelated agent-service "verification retry window" setting, not the same grace period — left untouched.)

### 9. Login lockout was shared by the whole machine, and a dead route

Five failed attempts locked out every account on that machine for 15 minutes, not just the one being attempted — one person fumbling their password could lock out the whole attendant kiosk. Fixed to key the lockout per email. Verified live in the browser: locking out one email left a different email fully usable. Also fixed `Sidebar.tsx`'s logout not waiting for sign-out to finish before navigating away, and `Login.tsx` redirecting to a route (`/dashboard`) that doesn't exist (harmless today only because of a catch-all redirect).

### 10. A "maintenance" slot looked identical to an "available" one

`StatusBadge.tsx` mapped both to the exact same color, differing only in text — a real risk of misreading the live occupancy board at a glance. Maintenance now gets its own distinct color.

### Bonus: ProtectedRoute let profile-less users into the desktop console

Found while reviewing the rest: a logged-in user with no `profiles` row at all (e.g. the exact scenario bug #2 above used to cause) wasn't blocked by the route guard, which only explicitly excluded `role === 'customer'`. Changed it to an allowlist (`attendant`/`admin` only, everyone else — including no profile — denied). Verified live: created a disposable, profile-less test account and confirmed it now gets "Access Denied" instead of full attendant access. That test account (`paranoid-test-1792200188@mailinator.com`) is still sitting in Supabase Auth with no profile and no way to delete it without a service-role key — harmless, but worth removing from the dashboard's Authentication tab eventually.

## Round 4: full click-through audit of every page, plus a critical Manual Entry regression

Asked for directly: "check all buttons, make sure they're doing their intended use." Ran one agent per page against the actual running app (already logged in), clicking every control for real rather than just reading code. Found real, previously-undetected bugs on 6 of the 10 pages. Also hit, diagnosed, and fixed a serious regression that briefly broke Manual Entry again after Round 3 shipped.

### ⚠️ Action required on the live Supabase project

Two more targeted SQL fixes this round (small, standalone — no need to re-run the full files). Both are included in the next full `database/business_rules.sql` / `database/rls_policies.sql` paste, but if you're applying them as standalone patches instead, run these two:

```sql
-- in rls_policies.sql: audit_log's INSERT policy was briefly too strict
DROP POLICY IF EXISTS "System can insert audit entries" ON audit_log;
CREATE POLICY "System can insert audit entries" ON audit_log
  FOR INSERT WITH CHECK (actor_id = auth.uid() OR is_staff());
```

```sql
-- in business_rules.sql: create_notification() and log_audit() both need
-- SECURITY DEFINER -- see "The real Manual Entry regression" below for why.
CREATE OR REPLACE FUNCTION create_notification(
  user_uuid UUID,
  notif_title TEXT,
  notif_body TEXT,
  notif_type notification_type,
  related_reservation UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_id UUID;
BEGIN
  INSERT INTO notifications (user_id, title, body, type, related_reservation_id)
  VALUES (user_uuid, notif_title, notif_body, notif_type, related_reservation)
  RETURNING id INTO notification_id;
  RETURN notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION log_audit(
  actor_uuid UUID,
  action_text TEXT,
  audit_details JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  audit_id UUID;
BEGIN
  INSERT INTO audit_log (actor_id, action, details)
  VALUES (actor_uuid, action_text, audit_details)
  RETURNING id INTO audit_id;
  RETURN audit_id;
END;
$$;
```

(Both snippets above were already run live and verified working during this session — re-running `business_rules.sql`/`rls_policies.sql` in full is only needed for a fresh environment; this project's live database already has all of it.)

### The duplicate "Bell" icon, explained and fixed

Every page showed what looked like two notification bells. They were two unrelated things sharing the same icon: `Layout.tsx`'s top-bar bell was a real "Notifications" button with **no `onClick` handler at all** (completely dead), while every individual page *also* had its own bell that was actually a sound-on/off toggle, just drawn with the wrong icon.

- **`Layout.tsx`**: wired up a real, working notification dropdown — fetches the logged-in user's own `notifications` rows, shows an unread-count badge, marks read on click, clean empty/loading states. Verified live with real inserted/read data. Known limitation: every notification-creating trigger in the database only ever targets `customer_id` (never staff), so an attendant/admin account will normally see "No notifications yet" until the system also generates staff-facing notifications — that's a pre-existing gap, not something this fix invented or tried to paper over.
- **Every page** (`LiveOccupancyDashboard`, `PlateVerification`, `CashPayment`, `TimeAndPaymentLog`, `ManualEntry`, `Reports`, `AccountCreation`, `SlotAssignment`, `UserManagement`, `RatesAndPricing`): swapped the mislabeled sound-toggle icon from `Bell` to `Volume2`/`VolumeX`, with a hover tooltip ("Sound alerts on/off"). Purely cosmetic, but it's exactly what was confusing — the two bells are now visually distinct.

### Bugs found and fixed, page by page

- **Live Occupancy**: the search box matched plates/customers **globally** instead of per-slot — searching any real plate or customer name highlighted every slot in the system, not just the right one. Fixed to look up each slot's own reservation chain. Also found (not fixed — needs real feature work, not a quick patch): **"Reassign Slot" and "Release Vehicle" on the slot detail drawer have no click handler at all.** They're decorative buttons that do nothing.
- **Cash Payment**: confirming a payment auto-triggered `window.print()`, which opens a blocking native OS dialog with no way to dismiss it programmatically — froze the page for real users too, not just automation. Now the automatic post-payment action only downloads the receipt; printing is an explicit separate action. Also fixed "Print Receipt Again" being permanently dead code (the state it depended on was always cleared right before the button could render) and a related bug where the receipt would print "Amount Received: $NaN" after that state got cleared.
- **Reports**: the Verification Results pie chart rendered completely blank with no message when there's no data (rather than a clean empty state like the other charts), and "Verification Success Rate" showed "NaN%" in that same case. Both fixed.
- **Slot Assignment**: a slot in Maintenance was still hardcoded gray on the slot map, inconsistent with this session's earlier StatusBadge color fix — now orange, matching. Also fixed: the "Manage Slots" header button did nothing (it opened the modal but never set which slot to edit, so the modal's render condition was never satisfied).
- **User Management**: "Reset Password" silently showed a false **"Operation successful!"** banner even when the underlying call failed (expected, since there's no service-role key) — it just never checked the error. Now shows the real failure instead of lying to the admin. "Last Login" and "Delete User" (both fixed in Round 3) were re-verified working.
- **Manual Entry**: the Void Entry flow was wiping the original entry's plate/customer/slot/time data from its own audit log record every time it voided something, because of a stale `(entry as any).details` reference that never actually matched the real data shape. Fixed.
- **Account Creation, Plate Verification, Time & Payment Log, Rates & Pricing**: no bugs found beyond the icon swap — each confirmed working as intended, including specific regression checks (Account Creation's admin-session-restore, Time & Payment Log's annotation save-and-persist, Rates & Pricing's grace-period/CEIL math from Round 3).

### The real Manual Entry regression (found and fixed live, not by code review)

Partway through this round, three independent agents hit the exact same wall: creating any new reservation failed with a 403, even though it had been confirmed fully working right after Round 3. Root-caused by direct testing against the live database (not guesswork):

1. **First layer**: Round 3's `audit_log` INSERT policy fix (`WITH CHECK (actor_id = auth.uid())`, meant to stop customers forging audit entries) was *too* strict — it also blocked the database's own `audit_reservation_changes()` trigger, which legitimately logs `actor_id = NEW.customer_id` (the walk-in customer) when an attendant creates their reservation. Loosened to `actor_id = auth.uid() OR is_staff()`.
2. **Second, deeper layer, found right after**: even with that fixed, reservations *still* failed — this time while inserting the "your reservation was created" notification. Postgres enforces the table's SELECT policy on an INSERT's `RETURNING` clause too, not just the INSERT policy itself, and `create_notification()`/`log_audit()` (both called from triggers, both doing `INSERT ... RETURNING id INTO ...`) were plain functions, not `SECURITY DEFINER` — so when an attendant creates something *for* a customer, the RETURNING clause gets blocked by "you can only view your own notifications/audit entries," and the whole transaction rolls back. This is a genuinely pre-existing bug (not introduced this session), just never triggered before because every prior end-to-end test happened to be run as an admin account whose broader view permissions masked it on the audit_log side — the notifications side has no such admin-wide policy at all, so it surfaced immediately. Fixed by marking both functions `SECURITY DEFINER` (same pattern already used for `is_admin()`/`is_attendant()`/`is_staff()` in this codebase).

Verified with a real submission through the actual Manual Entry form ("Manual entry created successfully"), not just an API test. All test data (reservations, slot states) was cleaned up afterward.

### Known issues, not fixed this round (flagged for later)

- ~~Live Occupancy's "Reassign Slot" and "Release Vehicle" buttons do nothing~~ — fixed in Round 5.
- ~~Several pages use native `alert()`/`confirm()` dialogs~~ — fixed in Round 5.
- **Account Creation hit Supabase's built-in email rate limit** during this round's testing (too many test signups in one session) — not a bug, just infrastructure; be aware if testing signup again soon.

## Round 5: native popups, the two dead Live Occupancy buttons, and a real fix for Reset Password / Hard Delete

Picked up the three items flagged at the end of Round 4.

### ⚠️ Action required — but only once, and not through the SQL editor this time

This round added a **Supabase Edge Function**, which can't be pasted into the SQL editor like everything else so far. If you're setting this project up somewhere new, deploy it with the Supabase CLI from the repo root:

```
npx supabase init      # press Enter through any prompts
npx supabase login     # opens your browser to authorize
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy admin-user-actions
```

No key to copy anywhere — Supabase gives every Edge Function access to the project's service-role key automatically, server-side only. Already deployed and verified working on the live project as of this round.

### Native browser popups replaced everywhere

Every `window.alert()` and `window.confirm()` in the app (11 call sites across `LiveOccupancyDashboard.tsx`, `ManualEntry.tsx`, `PlateVerification.tsx`, `TimeAndPaymentLog.tsx`) replaced with a proper in-app dialog that matches the rest of the UI (same style as the Logout confirmation). New shared piece: `desktop/src/contexts/DialogContext.tsx` — a `DialogProvider` (wrapped around the whole app in `App.tsx`) exposing a `useDialog()` hook with promise-based `alert(message)` / `confirm(message)`, so call sites read almost identically to the native versions (`await dialog.confirm('...')` instead of `confirm('...')`) but render as a styled modal instead of a jarring plain browser box. Also fixes the native-dialog-freezing-automated-testing problem noted in earlier rounds.

### Live Occupancy's "Reassign Slot" and "Release Vehicle" — now gated correctly and actually do something

These two buttons used to render unconditionally and do nothing at all. Two problems, both fixed:

1. **They didn't make sense for every slot status.** Reassigning only makes sense before the car has actually arrived (`slot.status === 'reserved'`) — reassigning an occupied slot would mean moving a parked car, which isn't what this button is for. Releasing a vehicle only makes sense once a car is actually there (`occupied`/`overstay`/`unverified`). Both buttons are now hidden outside their correct status, instead of always showing regardless of whether the action makes sense.
2. **They didn't do anything.** Rather than duplicate Slot Assignment's reassignment logic and Cash Payment's payment logic inside this drawer too, both buttons now navigate to the page that already does that job correctly (tested and fixed earlier this session) — **and carry the specific reservation along with them**, so the destination page opens straight into the right flow (Slot Assignment's reassign modal already open on the right reservation; Cash Payment with that reservation already selected and the charge calculated) instead of making the attendant re-find it from scratch.

### Reset Password / Hard Delete — properly fixed, not just failing honestly anymore

The real fix flagged as a limitation since Round 1: a new Supabase Edge Function, `supabase/functions/admin-user-actions/index.ts`, does the privileged work instead of the browser trying to. It checks the caller's own session is actually an admin (via the same `profiles` table/RLS the rest of the app trusts), and only then uses the service-role key — which lives purely as a Supabase-managed secret on the function's server, deployed via the Supabase CLI, never pasted into any file or seen by the browser — to actually reset the password or delete the auth user. `UserManagement.tsx` now calls this function (`supabase.functions.invoke('admin-user-actions', ...)`) instead of `supabase.auth.admin.*` directly.

One bug found and fixed during testing: the function's own auth check initially failed every request with "Not authenticated" — `auth.getUser()` ignores the request's Authorization header for its own calls unless the token is passed to it explicitly (it otherwise only looks at client-side session storage, which doesn't exist in a stateless server function). Fixed by extracting the bearer token and passing it directly: `callerClient.auth.getUser(jwt)`.

Verified live end-to-end: called the deployed function directly with a real admin session and confirmed the full chain works (authenticated → confirmed admin → service-role action actually reaches Supabase's Auth system) — used it to clean up the disposable `paranoid-test-...@mailinator.com` account left over from Round 4's testing, rather than touch any real account.

## Round 6: small UX fixes, then a full end-to-end shift simulation that found two real bugs

### Small fixes requested directly

- **Live Occupancy's time-remaining badge is now actually live.** It only ever recomputed when something else happened to trigger a re-render — between refreshes it just sat there looking frozen, and it only ever showed hours/minutes anyway. Added a 1-second ticking clock and extended the format to include seconds.
- **Cash Payment now warns before releasing a slot early.** Confirming payment before the reservation's reserved time was actually up used to go through silently with no indication anything was off. Now shows a confirmation naming exactly how many minutes remain before letting the attendant proceed. Early payment is still allowed (a customer leaving ahead of schedule is legitimate), it just can't happen by accident.
- **Voiding an active Manual Entry now requires a much stronger warning.** Void exists to undo an immediate mistake, not to end an active, occupied session with no payment collected - but both got the same generic "are you sure?" before this. Entries older than 5 minutes (very likely a real parked car, not a typo being corrected) now get an explicit warning naming the consequence, with a red "Void Anyway" button instead of a generic one.
- **Disabled buttons now explain why, throughout the app.** A button that's just disabled with no explanation looks broken to someone who doesn't know the system internals - e.g. Cash Payment's Confirm button gave zero feedback when clicked with no amount entered. Added a visible hint wherever a button could be silently disabled by missing input: Cash Payment (amount), Plate Verification (no reservation selected), Slot Assignment (no new slot chosen), User Management (Reset Password / Waive Penalty's required fields).

### Full shift simulation (login → Live Occupancy → Manual Entry → Plate Verification → Cash Payment → Time & Payment Log), which found two more real bugs live

- **Manual Entry's "Recent Entries" showed stale status forever.** The status badge was only ever written once (at creation, or by Void) and never updated again - so an entry that had long since been paid off and completed would still show "active" indefinitely, and the Void button was offered on already-completed transactions. Now fetches each entry's real, current reservation status instead of relying on a snapshot from creation time.
- **Plate Verification never confirmed success on anything.** Accept Vehicle, Manual Override, and Flag Unverified only ever said something when they failed - a successful action just closed its modal in silence. Verified live: ran a real Manual Override, confirmed via direct query it had worked, with nothing in the UI saying so. Added a clear success confirmation to all three.
- **Time & Payment Log showed $0.00 and a blank Attendant for every single transaction, real or historical.** Found by actually paying a real $50 test reservation and watching the log report it as $0.00. The underlying payment record was completely correct - the bug was that `payments.reservation_id` has no UNIQUE constraint, so PostgREST embeds `reservations -> payments` as an array even though there's only ever one payment per reservation in practice. The code cast that array straight to a single object, so every `.base_charge`/`.total`/`.attendant` access was silently `undefined` and fell through to a zero/blank default. This has almost certainly been wrong since this page was first built, not something introduced this session. Fixed by taking the first element of the array; verified every row (new and historical) now shows its real figures.

### Cleanup note

The simulation's disposable walk-in customer ("Shift Simulation") couldn't be fully hard-deleted once it had a completed reservation attached - attempting it surfaced a real constraint (the reservation-delete cascade tries to log an audit entry attributed to the very customer being deleted). This isn't a bug: it's the same reason `UserManagement.tsx`'s own Delete action already soft-deletes (disables) any account with reservation history instead of hard-deleting it. Did the same here - the test profile is disabled and clearly renamed `[TEST - Shift Simulation, disabled]` rather than force-deleted.

## Round 7: a real 3-floor parking map for Live Occupancy and Slot Assignment

Replaced the plain uniform grid of slot cards with an actual visual parking map matching a real garage floor plan you provided: a small "compact" row near the entrance, an elevator/stairs landmark, two big double-loaded-aisle blocks (a top row and a bottom row of 10 spots each, split by a divider), and a single-file column along the far wall - repeated across 3 floors, with a floor switcher (and a brief rise/descend animation when changing floors) above the map. This is genuinely what the system should look like for something billed as "the digital representation of their parking lot."

### ⚠️ Action required on the live Supabase project - two files, in order, once

This is a bigger database change than usual: the slot layout went from 20 slots (A1-A20) to 168 (56 per floor x 3 floors). Run these two files, in this exact order:

1. `database/schema.sql` - adds the new `floor`/`zone`/`zone_row`/`zone_col` columns to `slots` (safe to re-run, as always).
2. `database/migrate_multi_floor_layout.sql` - **new, one-time file.** This is NOT part of schema.sql/seed.sql on purpose: it `UPDATE`s your 20 existing slots by their old code (A1 -> 1C1, A2 -> 1C2, etc.) to relocate them into floor 1's new layout rather than deleting and recreating them, specifically so every reservation and payment already tied to those slots stays intact - nothing gets wiped. It then adds the rest of floor 1 plus all of floors 2 and 3. Verified live: ran both, confirmed all 168 slots landed with the right floor/zone breakdown (56/floor, 6 PWD total), and confirmed the original A1-A20 history (the real `SIM001` test payment, the historical entries) was still there afterward under its new slot codes.

A brand-new install never needs the migration file - `seed.sql` now seeds the full 168-slot, 3-floor layout directly.

### What's new

- **`ParkingFloorMap.tsx`** (new shared component) - renders one floor's worth of slots in the layout described above, reusing the same status color convention as `StatusBadge.tsx` (just a shade more saturated, since a 36px map cell needs more contrast than a full-width badge to still read at a glance). Clicking a slot does exactly what clicking a card used to: opens the slot detail drawer on Live Occupancy, opens the Manage Slot modal on Slot Assignment.
- **`FloorSwitcher.tsx`** (new shared component) - floor tabs (built from however many distinct floor numbers actually exist in the data, not hardcoded to 3) plus up/down arrows, used identically on both pages.
- **The floor-change animation** is a plain CSS keyframe (`index.css`) - the incoming floor's map rises into view when going up, descends when going down. No new dependency needed for it.
- **Live Occupancy** keeps the old card grid too, as a "List" view next to the new "Map" view (a toggle, defaulting to Map) - searching by plate/customer/slot code now auto-switches floor if the only match is on a different one than currently showing, instead of leaving the map looking empty.
- **Slot codes changed format**: `A1`-`A20` is now `{floor}{zone letter}{number}`, e.g. `1A7`, `2B14`, `3S3`. The map itself hides the leading floor digit on each cell (floor is already obvious from the page around it) but the full code is still what's stored and what shows everywhere else (dropdowns, logs, receipts).

### A real usability bug found immediately after the migration, and fixed

Manual Entry's, Plate Verification's, and Slot Assignment's plain `<select>` slot dropdowns went from a clean 20-item list to a 168-item one with **no sort order at all** (Postgres returns unordered rows without an explicit `.order()`, and the one that existed, `slot_code` string-sorted, puts "1A10" before "1A2") - scrolling through it to find a specific slot was genuinely painful. Added a shared sort/group utility, `groupSlotsByFloor()` (new, `shared/src/slotLayout.ts`), that orders slots the way someone looking at the actual map would expect - by floor, then by walking through the map itself (compact row, block A top-to-bottom, block B top-to-bottom, side column) - and wired all three dropdowns to use it with `<optgroup>` sections per floor. Verified live: each dropdown now shows three clearly-labeled "Floor 1/2/3" groups, each in correct walking order.

## Round 8: map restyled to match a real garage schematic

Round 7's map worked but looked like a grid of form fields (labeled bordered boxes: "Compact" / "Block A" / "Block B" / "Side"), not an actual parking lot. Rebuilt `ParkingFloorMap.tsx`'s visuals to match a reference top-down schematic directly: a dark frame around the whole floor, the floor number painted in the top-left and bottom-left corners like a real garage level marker, small yellow curb-reflector accents, an elevator/stairs block (teal accent strip) in the top-right corner, a gray asphalt-colored floor, the two main rows run as one continuous strip with a thin aisle line between them and a thicker divider bar only at each end (instead of two separately-boxed "Block A"/"Block B" sections), yellow directional flow arrows (straight + corner arrows) showing the drive path through each row, and the side column rendered as a plain ladder of stalls with no box or label.

Data model, zone grouping, and slot counts are all unchanged from Round 7 - this was purely the paint job. Slot clicking, status colors (available/reserved/occupied/overstay/unverified/maintenance), the PWD ring, and the selection ring all work exactly as before; that part couldn't be dropped since it's how the attendant actually uses the map, even though the reference image itself was a static (non-interactive) mockup. Verified live on both Live Occupancy and Slot Assignment, including floor switching (corner badges update correctly) and the narrower "Slot Map" card layout on Slot Assignment.

### Round 8 follow-up: rebuilt again as a direct 1:1 copy, not a reinterpretation

The first pass above still used labeled, bordered, boxed buttons with visible slot codes - a reasonable-looking map, but not an actual copy of the reference image, which has thin unlabeled tick-mark stalls, no boxes, and a specific pixel layout (exact corner placement, a staircase icon with diagonal hatching, specific arrow positions). Rebuilt `ParkingFloorMap.tsx` a second time on a fixed-size pixel canvas positioned to match the reference directly: compact + block A + block B now render as one continuous tick row (no separate labeled sections), bottom-row stalls align under the matching top-row columns the way a real garage's support columns would, the elevator icon got actual diagonal stair hatching instead of a plain box, and slot codes are no longer shown as permanent text (they still show on hover via the tooltip, and the full code is always visible in the drawer/modal opened by clicking) to match the reference's clean, label-free look.

Found and fixed one bug during this rebuild: the frame's outer wrapper had no explicit width, so it silently stretched to fill the full card instead of hugging the fixed-size canvas, leaving a blank gap to the right of the map inside the border. Fixed by making the frame an `inline-block` that sizes to its content, with a separate scroll wrapper around it for narrow layouts (like the "Slot Map" card on Slot Assignment). Verified live on both pages, including scrolling the narrower Slot Assignment card to see the far-right side column, and clicking a stall to confirm it still opens the correct slot ("Manage Slot 1A13") with a visible selection ring.

## Round 9: the map now uses your actual reference images, not a redraw of them

Round 8's rebuild was still a from-scratch recreation of the reference drawing using CSS shapes - closer than the first pass, but still not literally *your* image. This round switches to the real thing: `desktop/src/assets/floor-maps/floor-1.png` / `floor-2.png` / `floor-3.png` (the three separated, higher-resolution floor images you provided) are now the actual background of `ParkingFloorMap.tsx` - nothing about the frame, floor number, elevator icon, dividers, or arrows is drawn by the app anymore, it's all your artwork, shown as-is. On top of each image sit small, mostly-transparent click targets (a translucent dot per stall, more opaque when a slot isn't `available`) positioned at pixel coordinates measured directly off each image - divider positions, tick-line centers, side-column spacing - so they line up with your actual drawing rather than an approximation of it.

### ⚠️ Action required on the live Supabase project - one file, once

Along the way, counting the stalls actually drawn in the reference images (12 per row x 2 rows + 10 side = **34 per floor**, verified by measuring tick spacing in Python, not eyeballed) turned up a real mismatch: the live database still had 56 slots/floor from Round 7's original layout. Rather than keep the data ahead of what's actually drawn, `database/migrate_shrink_to_reference_layout.sql` (new, one-time) shrinks each floor to the 34 slots that match the image: drops the unused "compact" (6/floor) and "block_b" (20/floor) zones entirely, and extends "block_a" from 10+10 to 12+12 (codes `{floor}A1`-`{floor}A24`, top row columns 11/12 - nearest the elevator in the drawing - marked PWD). The side column is untouched (already matched at 10/floor).

This is a clean delete + recreate, not a history-preserving remap like Round 7's migration - confirmed safe by querying the live project first: **zero reservations and zero payments reference any slot** right now, so nothing's at risk. Run `database/migrate_shrink_to_reference_layout.sql` once in the Supabase SQL Editor; `seed.sql` is also updated so a fresh install seeds the 34/floor layout directly.

Verified live both before and after checking the data: the map correctly shows markers only for slots that actually exist (10+10 main-row dots pre-migration, since Round 7's data only went up to column 10), clicking a dot opens the right slot ("Manage Slot 1A1"), and the dot-to-tick alignment holds up under zoom.
