// A small Google Drive client for the Vercel Function in api/files.js (no googleapis package):
// sign in, start an upload the browser finishes, read a file's details or bytes, and delete it.
// Kept free of browser and Vercel APIs so it can be tested with a fake fetch. Server only.
//
// Two ways to sign in, whichever is configured:
//   - A Google account's OAuth refresh token (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//     GOOGLE_OAUTH_REFRESH_TOKEN): files land in that account's Drive. Works with a plain Gmail account.
//   - A service account (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY): needs the
//     folder to be in a Shared Drive the service account is a member of (Google Workspace), since a
//     service account has no storage of its own.
// GOOGLE_DRIVE_FOLDER_ID is the folder the files go in.
// supabase/functions/_shared/drive.ts is the Edge Functions' copy of the sign-in and download.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';

export function driveConfigured(env) {
  const oauth = env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const serviceAccount = env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  return Boolean(env.GOOGLE_DRIVE_FOLDER_ID && (oauth || serviceAccount));
}

// Reused while a warm function instance lives, so most requests skip the token exchange.
let cachedToken = null;

/** Forgets the cached token (for tests). */
export function resetDriveTokenCache() {
  cachedToken = null;
}

function base64url(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// A service account signs its own short JWT (RS256) and trades it for an access token.
async function serviceAccountAssertion(email, privateKeyPem) {
  // Environment variables often carry the key's newlines as a literal "\n".
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

export async function driveAccessToken(env, fetchImpl = fetch) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const form = env.GOOGLE_OAUTH_REFRESH_TOKEN && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
    ? new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    })
    : new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await serviceAccountAssertion(env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '', env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? ''),
    });

  const response = await fetchImpl(TOKEN_URL, { method: 'POST', body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) throw new Error(`Google sign-in failed: ${body?.error ?? response.status}`);
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

const auth = async (env, fetchImpl) => ({ Authorization: `Bearer ${await driveAccessToken(env, fetchImpl)}` });

/**
 * Starts a resumable upload into GOOGLE_DRIVE_FOLDER_ID and returns its session URL. The browser
 * PUTs the bytes there itself (Vercel Functions only take 4.5 MB request bodies); `origin` is the
 * app's origin, which Google then allows to make that request.
 */
export async function startDriveUpload(env, { name, mimeType, size, description, appProperties }, origin, fetchImpl = fetch) {
  const response = await fetchImpl(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id',
    {
      method: 'POST',
      headers: {
        ...(await auth(env, fetchImpl)),
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(size),
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ name, mimeType, description, appProperties, parents: [env.GOOGLE_DRIVE_FOLDER_ID] }),
    },
  );
  const url = response.headers.get('location');
  if (!response.ok || !url) {
    const body = await response.json().catch(() => null);
    throw new Error(`Drive upload could not start: ${body?.error?.message ?? response.status}`);
  }
  return url;
}

/** A file's details (size, mimeType, parents, appProperties), or null if it isn't there. */
export async function driveFileInfo(env, fileId, fetchImpl = fetch) {
  const response = await fetchImpl(
    `${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,size,mimeType,parents,appProperties,trashed`,
    { headers: await auth(env, fetchImpl) },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Drive lookup failed: ${response.status}`);
  return response.json();
}

/**
 * A file's contents, or null if it isn't there (deleted, or not shared with this account).
 * `range` is an HTTP Range header value such as "bytes=0-8191".
 */
export async function downloadFromDrive(env, fileId, fetchImpl = fetch, range) {
  const response = await fetchImpl(
    `${FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { ...(await auth(env, fetchImpl)), ...(range ? { Range: range } : {}) } },
  );
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Drive download failed: ${response.status}`);
  return response;
}

/** Deletes a file for good (not to Drive's trash). A file that's already gone counts as deleted. */
export async function deleteFromDrive(env, fileId, fetchImpl = fetch) {
  const response = await fetchImpl(`${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: 'DELETE',
    headers: await auth(env, fetchImpl),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Drive delete failed: ${response.status}`);
}

/** Ids of files in the folder whose app property `key` is `value` (uploads never finished). */
export async function findDriveFiles(env, key, value, fetchImpl = fetch) {
  const q = `'${env.GOOGLE_DRIVE_FOLDER_ID}' in parents and appProperties has { key='${key}' and value='${value}' }`;
  const response = await fetchImpl(
    `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: await auth(env, fetchImpl) },
  );
  if (!response.ok) throw new Error(`Drive search failed: ${response.status}`);
  return ((await response.json()).files ?? []).map((f) => f.id);
}
