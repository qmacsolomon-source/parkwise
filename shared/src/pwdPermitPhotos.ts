import { supabase, isConfigured } from './supabase';

/** Private Storage bucket holding PWD permit photos, one folder per user id. */
export const PWD_PERMIT_BUCKET = 'pwd-permits';

/**
 * Staff-side (desktop): a short-lived URL to view a customer's uploaded
 * permit photo, since the bucket is private. Returns null (and logs) if the
 * path doesn't exist or the caller isn't allowed to see it.
 */
export async function getPwdPermitPhotoUrl(
  path: string,
  expiresInSeconds = 120
): Promise<string | null> {
  if (!supabase || !isConfigured) return null;
  const { data, error } = await supabase.storage
    .from(PWD_PERMIT_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    console.error('Could not create a signed URL for the permit photo:', error.message);
    return null;
  }
  return data.signedUrl;
}
