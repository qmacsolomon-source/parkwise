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

### 4.1 Run Schema
1. In Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Copy contents of `database/schema.sql`
4. Paste and click "Run"

### 4.2 Run RLS Policies
1. Create new query in SQL Editor
2. Copy contents of `database/rls_policies.sql`
3. Paste and click "Run"

### 4.3 Run Business Rules
1. Create new query in SQL Editor
2. Copy contents of `database/business_rules.sql`
3. Paste and click "Run"

### 4.4 Create Auth Users
1. Go to **Authentication > Users** in Supabase dashboard
2. Create these users with temporary passwords:

   **Admin:**
   - Email: `admin@parkwise.com`
   - Password: (choose one)
   - Copy the User ID (UUID)

   **Attendant:**
   - Email: `attendant@parkwise.com`
   - Password: (choose one)
   - Copy the User ID (UUID)

   **Customer 1:**
   - Email: `john@example.com`
   - Password: (choose one)
   - Copy the User ID (UUID)

   **Customer 2:**
   - Email: `jane@example.com`
   - Password: (choose one)
   - Copy the User ID (UUID)

### 4.5 Run Seed Script
1. Open `database/seed.sql`
2. Replace the placeholder UUIDs with the actual User IDs from step 4.4:
   ```sql
   admin_user_id UUID := '00000000-0000-0000-0000-000000000001'; -- REPLACE WITH ACTUAL ADMIN UUID
   attendant_user_id UUID := '00000000-0000-0000-0000-000000000002'; -- REPLACE WITH ACTUAL ATTENDANT UUID
   customer1_user_id UUID := '00000000-0000-0000-0000-000000000003'; -- REPLACE WITH ACTUAL CUSTOMER1 UUID
   customer2_user_id UUID := '00000000-0000-0000-0000-000000000004'; -- REPLACE WITH ACTUAL CUSTOMER2 UUID
   ```
3. Copy the modified seed.sql
4. Paste in SQL Editor and click "Run"

### 4.6 Enable Realtime
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
- Password: (what you set in step 4.4)

**Test with attendant account:**
- Email: `attendant@parkwise.com`
- Password: (what you set in step 4.4)

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
- Password: (what you set in step 4.4)

## Step 8: Test the System

### Test Desktop Console
1. Login as attendant
2. View all 20 slots (A1-A20)
3. Check that A1 and A2 show PWD badges
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

### Slots (20 total)
- A1-A20: Regular slots
- A1, A2: PWD slots (blue badge)

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
