// Reading files from Google Drive, for Ask AI. The Edge Functions' copy of the sign-in and
// download in src/lib/googleDrive.js (the Vercel Function's Drive client); keep the two in step.
// Needs the same GOOGLE_* settings as the Vercel project, set as Supabase secrets.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const env = (key: string) => Deno.env.get(key) ?? '';

let cachedToken: { token: string; expiresAt: number } | null = null;

export const driveConfigured = () =>
  Boolean(env('GOOGLE_OAUTH_REFRESH_TOKEN') && env('GOOGLE_OAUTH_CLIENT_ID') && env('GOOGLE_OAUTH_CLIENT_SECRET'))
  || Boolean(env('GOOGLE_SERVICE_ACCOUNT_EMAIL') && env('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'));

function base64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function serviceAccountAssertion(email: string, privateKeyPem: string): Promise<string> {
  const pem = privateKeyPem.replace(/\\n/g, '\n');
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  )}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(signature)}`;
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const form = env('GOOGLE_OAUTH_REFRESH_TOKEN')
    ? new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env('GOOGLE_OAUTH_REFRESH_TOKEN'),
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
    })
    : new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await serviceAccountAssertion(env('GOOGLE_SERVICE_ACCOUNT_EMAIL'), env('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY')),
    });
  const response = await fetch(TOKEN_URL, { method: 'POST', body: form });
  const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: string } | null;
  if (!response.ok || !body?.access_token) throw new Error(`Google sign-in failed: ${body?.error ?? response.status}`);
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

/** A Drive file's bytes, or null if it isn't there. */
export async function downloadFromDrive(fileId: string): Promise<Uint8Array | null> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${await accessToken()}` } },
  );
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Drive download failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
