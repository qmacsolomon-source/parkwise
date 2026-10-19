import { decode } from 'base64-arraybuffer';
import { supabase, isConfigured, PWD_PERMIT_BUCKET } from '@parkwise/shared';

function extensionFromUri(uri: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(uri.split('?')[0]);
  return match ? match[1].toLowerCase() : 'jpg';
}

function contentTypeFor(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Uploads a PWD permit photo picked on-device (ImagePicker result, with
 * base64 requested) to the signed-in user's own folder in the private
 * 'pwd-permits' bucket, and returns the storage path to pass to
 * authService.submitPwdPermit(). Storage policies only allow writing inside
 * "<own-user-id>/...", so this throws if there is no signed-in user.
 */
export async function uploadMyPwdPermitPhoto(uri: string, base64: string): Promise<string> {
  if (!supabase || !isConfigured) throw new Error('Supabase is not configured.');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You need to be signed in to upload a permit photo.');

  const ext = extensionFromUri(uri);
  const path = `${user.id}/permit-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(PWD_PERMIT_BUCKET)
    .upload(path, decode(base64), { contentType: contentTypeFor(ext), upsert: true });

  if (error) throw error;
  return path;
}
