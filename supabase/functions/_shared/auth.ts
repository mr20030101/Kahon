// Shared by the Edge Functions: who is calling, and have they passed two-factor if it's on.
// The database enforces two-factor through RLS, but functions read with the service role,
// so they have to check it themselves.

import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
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
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { response: json({ error: 'Sign in first.' }, 401) };

  const admin = adminClient();
  const { data } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (data?.factors?.some((f) => f.status === 'verified') && tokenAal(token) !== 'aal2') {
    return { response: json({ error: 'Enter your two-factor code first.' }, 403) };
  }
  return { user, admin };
}
