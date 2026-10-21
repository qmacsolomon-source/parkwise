# ParkWise Setup Guide

This guide will help you set up and run the ParkWise parking management system.

## Prerequisites

- Node.js 18+ and npm
- A Supabase account (free tier works)
- Git (optional)

## Step 1: Create Supabase Project

1. Go to https://supabase.com and sign up/login
2. Click "New Project"
3. Enter project name: `parkwise`
4. Choose a database password (save it securely)
5. Select a region closest to you
6. Wait for the project to be created (2-3 minutes)

## Step 2: Get Supabase Credentials

1. Go to your Supabase project dashboard
2. Navigate to **Settings > API**
3. Copy the following values:
   - **Project URL** (starts with https://)
   - **anon/public** key (starts with eyJhbGci...)

## Step 3: Configure Environment Variables

### Desktop Console
Create `desktop/.env`:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Mobile App
Create `mobile/.env`:
```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Step 4: Set Up Database

> For a brand-new, empty project, the canonical copy-paste order — with a
> per-file CHECK query and a final "everything is installed" query — is in
> `database/RUN_ORDER.md`. Run one file per query.

### 4.1 Run Schema
1. In Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Copy contents of `database/schema.sql`
4. Paste and click "Run"

`schema.sql` is safe to re-run later (e.g. after pulling someone else's schema
change) — it only adds what's missing and will NOT delete existing data. If
you genuinely need to wipe everything and start over, use
`database/reset_database.sql` instead (it drops every table first — read its
warning header before running it).

### 4.2 Run RLS Policies
1. Create new query in SQL Editor
2. Copy contents of `database/rls_policies.sql`
3. Paste and click "Run"

### 4.3 Run Business Rules
1. Create new query in SQL Editor
2. Copy contents of `database/business_rules.sql`
3. Paste and click "Run"

### 4.4 Run Profile, Vehicle and Rates Fixes
1. Create new query in SQL Editor
2. Copy contents of `database/profile_vehicle_rates_fixes.sql`
3. Paste and click "Run"

Run this BEFORE the Auth users below: it installs the
`on_auth_user_created` trigger, so every new user gets a `profiles` row
(and their first vehicle) automatically. It needs only `schema.sql` and
`rls_policies.sql` to have been applied.

### 4.5 Create Auth Users
1. Go to **Authentication > Users** in Supabase dashboard
2. Create your first user — this will be the admin:
   - Email: `admin@parkwise.com`
   - Password: (choose one)
   - Copy the User ID (UUID)
3. Optionally create more users now (e.g. `attendant@parkwise.com`,
   `john@example.com`, `jane@example.com`) the same way.

Every new user automatically gets a `profiles` row from the trigger installed
in step 4.4 — no UUID editing is required anywhere.

### 4.6 Promote your first user to admin
The trigger from 4.4 gives every new user the role `customer`, so promote your
first user explicitly. `profiles.phone` is `NOT NULL`, so a phone value is
supplied. Replace the email with the one you created in 4.5:

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

### 4.7 Run Seed Script
1. Open `database/seed.sql`
2. Copy it as-is — it needs no edits and creates no users
3. Paste in SQL Editor and click "Run"

This creates the parking map: 3 floors x 69 slots (207 total), one rates row,
and one agent state per slot.

### 4.8 Run Floor Plan and Assignment
1. Create new query in SQL Editor
2. Copy contents of `database/floor_plan_and_assignment.sql`
3. Paste and click "Run"

This must come AFTER `seed.sql`. It adds the floor-plan geometry columns to
`slots`, then backfills `floor_x` / `floor_y` / `floor_w` / `floor_h` /
`facing` / `entry_rank` on the slots `seed.sql` created — so running it on an
empty `slots` table leaves the map blank. It also depends on `rls_policies.sql`
(`is_admin()`) and `business_rules.sql` (`is_pwd_verified()`,
`has_unpaid_penalties()`, `create_notification()`, `log_audit()`).

The file wraps everything in one `BEGIN; ... COMMIT;`, so if you run it out of
order the first `relation "slots" does not exist` kicks off a long run of
"current transaction is aborted" messages. Only the first error is real — fix
that and re-run the file.

### 4.9 Enable Realtime
1. Go to **Database > Replication** in Supabase dashboard
2. Ensure "Realtime" is enabled
3. The following tables should already be enabled (from seed.sql):
   - slots
   - reservations
   - agent_states
   - notifications

## Step 5: Install Dependencies

Dependencies are already installed. If you need to reinstall:

```bash
# Root (already done)
npm install

# Shared (already done)
cd shared
npm install

# Desktop (already done)
cd ../desktop
npm install

# Mobile (already done)
cd ../mobile
npm install
```

## Step 6: Run Desktop Console

```bash
cd desktop
npm run dev
```

The console will open at `http://localhost:5173`

**Test with admin account:**
- Email: `admin@parkwise.com`
- Password: (what you set in step 4.5)

**Test with attendant account:**
- Email: `attendant@parkwise.com`
- Password: (what you set in step 4.5)

## Step 7: Run Mobile App

```bash
cd mobile
npm start
```

This will start the Expo development server. You can:

- **Web:** Press `w` to open in browser at `http://localhost:19006`
- **iOS:** Scan QR code with Expo Go app
- **Android:** Scan QR code with Expo Go app

**Test with customer account:**
- Email: `john@example.com` or `jane@example.com`
- Password: (what you set in step 4.5)

## Step 8: Test the System

### Test Desktop Console
1. Login as attendant
2. View all 207 slots (69 per floor, across 3 floors)
3. Check the PWD badges: `block_a` columns 8-12 of every 12-column row, plus `side` 1-5 (30 per floor)
4. View reservations tab (empty initially)

### Test Mobile App
1. Login as customer (john@example.com)
2. View available slots
3. Tap a slot to create reservation
4. Select vehicle (ABC1234 or XYZ5678)
5. Set start and end time
6. Create reservation
7. Note the booking code (e.g., PW-A1B2C3D4)

### Test Real-time Updates
1. Keep both desktop and mobile open
2. Create a reservation on mobile
3. Watch it appear on desktop reservations tab
4. See slot status change from "available" to "reserved" on both

## Default Data

### Slots (207 total)
- 3 floors x 69 slots: `{floor}A1`..`{floor}A60` (block_a) and `{floor}S1`..`{floor}S9` (side)
- PWD slots (blue badge): block_a columns 8-12 of every 12-column row, plus side 1-5 (90 total, 30 per floor)

### Rates
- Hourly rate: ₱50
- Overstay per hour: ₱100
- No-show penalty: ₱100
- Late cancel penalty: ₱50
- Late cancel window: 30 minutes
- Grace period: 15 minutes

### Test Accounts
- **Admin:** admin@parkwise.com (role: admin)
- **Attendant:** attendant@parkwise.com (role: attendant)
- **Customer 1:** john@example.com (role: customer, 2 vehicles)
- **Customer 2:** jane@example.com (role: customer, PWD verified, 1 vehicle)

## Troubleshooting

### "Missing Supabase environment variables"
- Ensure `.env` files are created in both `desktop/` and `mobile/`
- Check that URL and key are copied correctly from Supabase

### "Profile not found" after login
- Ensure you ran the seed script with correct User IDs
- Check that profiles exist in Supabase: Database > profiles table
- If profiles/reservations/etc. that used to exist are now empty, someone
  likely ran `reset_database.sql` (or the old destructive `schema.sql`)
  instead of the current idempotent `schema.sql` — re-create the Auth users'
  profile rows and re-run `seed.sql`

### Realtime not working
- Go to Database > Replication in Supabase
- Ensure Realtime is enabled
- Check that tables are added to publication

### Mobile app won't start
- Ensure Expo CLI is installed: `npm install -g expo-cli`
- Try clearing cache: `expo start -c`

### Desktop build fails
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again

## Security Notes

- Change default passwords before production
- Enable email confirmation in Supabase Auth settings
- Set up custom domain for production
- Review RLS policies before production deployment
- Enable Supabase Auth rate limiting
- Use Supabase Edge Functions for sensitive operations

## Production Deployment

### Desktop Console
1. Build: `cd desktop && npm run build`
2. Deploy `dist/` folder to any static hosting (Vercel, Netlify, etc.)
3. Set environment variables in hosting platform

### Mobile App
1. Build for iOS: `eas build --platform ios`
2. Build for Android: `eas build --platform android`
3. Submit to App Store / Google Play
4. Requires EAS CLI setup: https://docs.expo.dev/eas/

## Support

For issues:
1. Check Supabase logs: Database > Logs
2. Check browser console for errors
3. Verify environment variables
4. Ensure all SQL scripts ran successfully
