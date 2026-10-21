-- ===========================================================================
-- 07_frames_bucket.sql
-- Creates the Storage bucket that agent-service uploads camera frames to.
--
-- Safe to re-run: the insert is ON CONFLICT DO NOTHING and the policy is
-- dropped before being recreated.
--
-- WHY THIS BUCKET IS PUBLIC
--   agent-service/storage.py builds its URL by hand as
--       <project>/storage/v1/object/public/<bucket>/<path>
--   so a private bucket would make every stored `frame_url` (in
--   verification_events) return 404 even though the upload itself succeeded.
--   The trade-off: anyone who has the URL can view that frame, and frames show
--   number plates. If that is not acceptable, make the bucket private AND
--   change Storage.upload_frame() to return a signed URL instead.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('frames', 'frames', true)
on conflict (id) do update
  set public = excluded.public;

-- Belt-and-braces. The Storage API runs its own bucket-existence check under
-- the calling user's RLS context, so a *client-key* upload reports
-- "Bucket not found" even when the row above exists. This is the same fix
-- applied in 04_pwd_permit_photo.sql.
--
-- The agent-service itself connects with the service role and bypasses RLS, so
-- it does not depend on this policy - it only matters if the desktop or mobile
-- app ever reads or writes this bucket directly.
drop policy if exists "frames bucket visible" on storage.buckets;
create policy "frames bucket visible"
  on storage.buckets for select
  using (id = 'frames');

-- ---------------------------------------------------------------------------
-- Check
-- ---------------------------------------------------------------------------
-- SELECT id, public FROM storage.buckets WHERE id = 'frames';
-- Expected: one row, public = true.
