// Supabase Edge Function: performs the two admin actions the desktop app
// can't safely do itself from the browser (resetting someone's password,
// permanently deleting their login) because both need the service-role key,
// which must never be shipped to a client.
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided automatically in every Edge Function's environment by Supabase
// -- nothing to configure manually for those.
//
// The caller's own session is used ONLY to verify they're actually an
// admin (via the same `profiles` table/RLS the rest of the app already
// trusts). The service-role key is used ONLY after that check passes, and
// only for the one specific action requested.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Missing Authorization header' }, 200);
  }

  // Scoped to the caller's own session -- used only to find out who they
  // are and whether profiles.role = 'admin'. Never used for the action
  // itself.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // auth.getUser() ignores the global Authorization header for its own
  // auth.* calls -- it only inspects client-side session storage, which
  // doesn't exist in this stateless server context. The token has to be
  // passed explicitly to validate it.
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: userError } = await callerClient.auth.getUser(jwt);
  if (userError || !user) {
    return json({ error: 'Not authenticated' }, 200);
  }

  const { data: callerProfile } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Admin access required' }, 200);
  }

  let body: { action?: string; targetUserId?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 200);
  }

  const { action, targetUserId, newPassword } = body;

  if (!targetUserId || (action !== 'reset_password' && action !== 'hard_delete')) {
    return json({ error: 'Invalid request: expected action + targetUserId' }, 200);
  }

  // Only this client -- built with the service-role key -- can actually
  // perform the privileged action. It's never sent to, or usable by, the
  // browser.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (action === 'reset_password') {
      if (!newPassword || newPassword.length < 8) {
        return json({ error: 'Password must be at least 8 characters' }, 200);
      }
      const { error } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password: newPassword,
      });
      if (error) throw error;
    } else {
      const { error } = await adminClient.auth.admin.deleteUser(targetUserId);
      if (error) throw error;
    }

    return json({ success: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 200);
  }
});
