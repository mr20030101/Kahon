// Shared by the Edge Functions: who is calling, and have they passed two-factor if it's on.
// The database enforces two-factor through RLS, but functions read with the service role,
// so they have to check it themselves.

import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const adminClient = (): SupabaseClient =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function tokenAal(token: string): string | undefined {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)).aal;
  } catch {
    return undefined;
  }
}

/** The signed-in caller and a service-role client, or a Response to return when they can't proceed. */
export async function requireUser(req: Request): Promise<{ user: User; admin: SupabaseClient } | { response: Response }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token === 'undefined') return { response: json({ error: 'Sign in first.' }, 401) };

  // Checked with the service role client, so it works whether or not the legacy anon key is enabled.
  const admin = adminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (!user) {
    console.error('requireUser: token rejected', error?.message);
    return { response: json({ error: 'Your session has expired. Refresh the page and try again.' }, 401) };
  }

  const { data } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (data?.factors?.some((f) => f.status === 'verified') && tokenAal(token) !== 'aal2') {
    return { response: json({ error: 'Enter your two-factor code first.' }, 403) };
  }
  return { user, admin };
}
