# ParkWise - Parking Management System

A two-part parking management system with a shared Supabase backend:
- **Desktop Console**: For parking attendants and admins
- **Mobile App**: For customers to make reservations

## Tech Stack

- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Storage)
- **Desktop Console**: React + Vite + TailwindCSS + shadcn/ui
- **Mobile App**: React Native + Expo
- **Shared**: TypeScript utilities and Supabase client

## Setup

1. Create a Supabase project at https://supabase.com
2. Copy your Supabase credentials to `.env` files
3. Run the database schema SQL in Supabase SQL Editor
4. Run the seeding script to populate initial data
5. Install dependencies: `npm install`
6. Run desktop: `npm run dev:desktop`
7. Run mobile: `npm run dev:mobile`

## Database Schema

See `database/schema.sql` for the complete database structure with:
- 11 tables with proper relationships
- Row-Level Security (RLS) policies
- Business rule enforcement via functions/triggers
- Realtime enabled on key tables

## Design System

- Primary: Navy #0F2A4A
- Accent: Teal #14B8A6
- Background: Soft Gray #F5F7FA
- Font: Inter
- Rounded cards (12px desktop, 16px mobile)
- WCAG AA compliant
