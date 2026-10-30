// Server side of attachments and project files in Google Drive, run by the Vercel Function in
// api/files.js (see googleDrive.js and supabase/migrations/20261030_google_drive_files.sql).
// Server only: imported by api/files.js and the tests, never by the app.
//
//   POST {action:'start'}   the caller may add a file here: start Drive uploads (the file, and an
//                           image's thumbnail) that the browser sends the bytes to directly.
//   POST {action:'finish'}  check what arrived in Drive (size, type, first bytes), then insert the
//                           row with the caller's own access, so RLS decides as it always has.
//   POST {action:'sign'}    signed URLs for rows the caller can read, like Supabase's signed URLs.
//   POST {action:'purge'}   delete Drive files whose rows are gone (drive_trash).
//   GET  ?f=…&s=…           a signed URL: the file, streamed from Drive.
//   GET  ?job=cleanup       the daily Vercel cron job: drive_trash, and uploads never finished.
//
// Anything without a drive_file_id is still in the Supabase "attachments" bucket and is
// handled by the app as before.

import {
  deleteFromDrive, downloadFromDrive, driveConfigured, driveFileInfo, findDriveFiles, startDriveUpload,
} from './googleDrive.js';
import { matchesSignature } from './uploads.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_THUMB_BYTES = 2 * 1024 * 1024;
// Uploads one person may start in a day, so a script can't fill the Drive.
export const MAX_UPLOADS_PER_DAY = 400;
// Signed URLs last until the end of the next full hour: re-signing within the hour gives the same
// URL, so the browser's cache keeps working, and every URL is good for at least an hour.
const URL_HOURS = 2;
// An upload that was started but not finished this long ago is deleted by the cleanup job.
const ABANDONED_AFTER = 24 * 60 * 60 * 1000;

// Allowed types and the extension each is checked and stored as. Keep in sync with FILE_TYPES in
// src/components/Attachments.jsx and the mime_type checks in schema.sql.
const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf', 'text/plain': 'txt', 'text/markdown': 'md',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'text/csv': 'csv',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.presentation': 'odp',
};
// Project files are only types Ask AI reads; see PROJECT_FILE_TYPES in src/components/ProjectFiles.jsx.
const PROJECT_EXTS = ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx', 'ods', 'pptx'];
const THUMB_TYPES = ['image/webp', 'image/jpeg'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const refuse = (status, message, extra = {}) => json(status, { message, ...extra });

export function serverConfig(env) {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

// Supabase's REST API, either as the caller (their RLS applies) or with the service role.
function restClient(env, fetchImpl) {
  const { url, anonKey, serviceKey } = serverConfig(env);
  return async (path, { token, method = 'GET', body, prefer } = {}) => {
    const key = token ?? serviceKey;
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: token ? anonKey : serviceKey,
        Authorization: `Bearer ${key}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 || method === 'HEAD' ? null : await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data, headers: response.headers };
  };
}

// The signed-in user behind the request's Supabase access token, if it's valid.
async function signedInCaller(request, env, fetchImpl) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const { url, anonKey } = serverConfig(env);
  const response = await fetchImpl(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? { id: user.id, email: user.email ?? '', token } : null;
}

// ---------------------------------------------------------------------------------------------
// Signed URLs
// ---------------------------------------------------------------------------------------------

const toBase64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromBase64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const signingKey = (env) => crypto.subtle.importKey(
  'raw', new TextEncoder().encode(`kahon-file-urls:${env.SUPABASE_SERVICE_ROLE_KEY}`),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
);
const payload = (p) => new TextEncoder().encode(JSON.stringify([p.f, p.m, p.n, p.d, p.e]));

/** The end of the next full hour, in seconds: when URLs signed now expire. */
export const urlExpiry = (now) => (Math.floor(now.getTime() / 3_600_000) + URL_HOURS) * 3600;

export async function signFileUrl(env, { driveId, mime, name, download = false }, expires) {
  const p = { f: driveId, m: mime, n: name, d: download ? '1' : '0', e: String(expires) };
  const s = toBase64url(await crypto.subtle.sign('HMAC', await signingKey(env), payload(p)));
  return `/api/files?${new URLSearchParams({ ...p, s })}`;
}

async function verifySigned(env, params, now) {
  const p = Object.fromEntries(['f', 'm', 'n', 'd', 'e', 's'].map((k) => [k, params.get(k) ?? '']));
  if (!DRIVE_ID.test(p.f) || !EXT[p.m] || !/^\d+$/.test(p.e) || Number(p.e) * 1000 < now.getTime()) return null;
  let signature;
  try {
    signature = fromBase64url(p.s);
  } catch {
    return null;
  }
  return (await crypto.subtle.verify('HMAC', await signingKey(env), signature, payload(p))) ? p : null;
}

// ---------------------------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------------------------

export async function handleFilesPost(request, env, fetchImpl = fetch, now = new Date()) {
  if (!serverConfig(env).serviceKey || !driveConfigured(env)) {
    // The app then uploads to Supabase Storage as it did before Drive.
    return refuse(503, 'Google Drive is not set up.', { code: 'drive_off' });
  }
  const caller = await signedInCaller(request, env, fetchImpl);
  if (!caller) return refuse(401, 'Your session has expired. Refresh the page and try again.');
  const body = await request.json().catch(() => null);
  const rest = restClient(env, fetchImpl);
  const ctx = { request, env, fetchImpl, now, caller, rest };

  switch (body?.action) {
    case 'start': return startUpload(ctx, body);
    case 'finish': return finishUpload(ctx, body);
    case 'sign': return signRows(ctx, body);
    case 'purge': return json(200, { deleted: await purgeTrash(ctx) });
    default: return refuse(400, 'Unknown request.');
  }
}

async function startUpload({ request, env, fetchImpl, now, caller, rest }, body) {
  const { project_id: projectId, task_id: taskId = null, name, mime, size, thumb = null } = body;
  if (!UUID.test(projectId ?? '') || (taskId !== null && !UUID.test(taskId))) return refuse(400, 'Unknown project or task.');
  if (typeof name !== 'string' || !name.trim() || name.length > 255) return refuse(400, 'That file name is not allowed.');
  const ext = EXT[mime];
  if (!ext || (!taskId && !PROJECT_EXTS.includes(ext))) return refuse(400, "That type of file can't be added here.");
  if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES) return refuse(413, 'Files must be 25 MB or smaller.');
  const wantsThumb = thumb !== null && taskId !== null && mime.startsWith('image/') && mime !== 'image/gif';
  if (wantsThumb && (!THUMB_TYPES.includes(thumb.mime) || !Number.isInteger(thumb.size) || thumb.size < 1 || thumb.size > MAX_THUMB_BYTES)) {
    return refuse(400, 'That thumbnail is not allowed.');
  }

  // With the caller's own access, the same checks the insert policies make on finish.
  if (taskId) {
    const task = await rest(`tasks?id=eq.${taskId}&select=project_id`, { token: caller.token });
    if (task.data?.[0]?.project_id !== projectId) return refuse(404, 'Task not found.');
  }
  const allowed = await rest(`rpc/${taskId ? 'can_edit' : 'is_owner'}`, { token: caller.token, method: 'POST', body: { p_project: projectId } });
  if (allowed.data !== true) {
    return refuse(403, taskId ? 'Only editors can add files to this project.' : 'Only project admins can add reference files.');
  }

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const count = await rest(`drive_uploads?user_id=eq.${caller.id}&created_at=gte.${encodeURIComponent(since)}&select=id`,
    { method: 'HEAD', prefer: 'count=exact' });
  if (Number(count.headers.get('content-range')?.split('/')[1] ?? 0) >= MAX_UPLOADS_PER_DAY) {
    return refuse(429, "You've uploaded a lot of files today. Try again tomorrow.");
  }

  const rows = [{ kind: 'file', mime_type: mime, size_bytes: size }];
  if (wantsThumb) rows.push({ kind: 'thumb', mime_type: thumb.mime, size_bytes: thumb.size });
  const created = await rest('drive_uploads', {
    method: 'POST',
    prefer: 'return=representation',
    body: rows.map((r) => ({ ...r, user_id: caller.id, project_id: projectId, task_id: taskId })),
  });
  if (!created.ok) {
    console.error('api/files: recording the upload failed:', created.status, created.data);
    return refuse(500, "The file couldn't be uploaded just now. Please try again.");
  }

  const origin = request.headers.get('origin') || new URL(request.url).origin;
  const where = taskId ? `project ${projectId}, task ${taskId}` : `project ${projectId} (reference file)`;
  try {
    const sessions = await Promise.all(created.data.map(async (u) => ({
      kind: u.kind,
      id: u.id,
      url: await startDriveUpload(env, {
        name: u.kind === 'thumb' ? `${name} (thumbnail).${EXT[u.mime_type]}` : name,
        mimeType: u.mime_type,
        size: u.size_bytes,
        description: `Kahon: ${where}, uploaded by ${caller.email || caller.id}`,
        appProperties: { kahonUpload: u.id },
      }, origin, fetchImpl),
    })));
    return json(200, {
      file: sessions.find((s) => s.kind === 'file'),
      thumb: sessions.find((s) => s.kind === 'thumb') ?? null,
    });
  } catch (error) {
    console.error('api/files: starting the Drive upload failed:', error);
    await rest(`drive_uploads?id=in.(${created.data.map((u) => u.id).join(',')})`, { method: 'DELETE' });
    return refuse(502, "The file couldn't be uploaded just now. Please try again.");
  }
}

// Is Drive file `driveId` really upload `upload`: ours, in the folder, the size and type that
// were started, and bytes that match the type?
async function arrivedIntact(env, fetchImpl, upload, driveId) {
  const info = await driveFileInfo(env, driveId, fetchImpl);
  if (!info || info.trashed || info.appProperties?.kahonUpload !== upload.id) return false;
  if (!info.parents?.includes(env.GOOGLE_DRIVE_FOLDER_ID)) return false;
  if (Number(info.size) !== upload.size_bytes || info.mimeType !== upload.mime_type) return false;
  const head = await downloadFromDrive(env, driveId, fetchImpl, 'bytes=0-8191');
  if (!head) return false;
  return matchesSignature(new Uint8Array(await head.arrayBuffer()), EXT[upload.mime_type]);
}

async function finishUpload({ env, fetchImpl, caller, rest }, body) {
  const parts = [body.file, body.thumb].filter(Boolean);
  if (!parts.length || parts.some((p) => !UUID.test(p.upload_id ?? '') || !DRIVE_ID.test(p.drive_id ?? ''))) {
    return refuse(400, 'Unknown upload.');
  }
  const found = await rest(
    `drive_uploads?id=in.(${parts.map((p) => p.upload_id).join(',')})&user_id=eq.${caller.id}&verified_at=is.null&select=*`,
  );
  const uploads = new Map((found.data ?? []).map((u) => [u.id, u]));
  const file = uploads.get(body.file?.upload_id);
  if (!file || file.kind !== 'file') return refuse(404, 'Unknown upload.');
  const thumbUpload = body.thumb ? uploads.get(body.thumb.upload_id) : null;
  const thumb = thumbUpload?.kind === 'thumb' && thumbUpload.task_id === file.task_id ? thumbUpload : null;

  // Only a Drive file that one of the caller's own uploads made: the ids come from the request.
  const discard = async (upload, driveId) => {
    try {
      const info = await driveFileInfo(env, driveId, fetchImpl);
      if (info?.appProperties?.kahonUpload === upload.id) await deleteFromDrive(env, driveId, fetchImpl);
    } catch (e) {
      console.error('api/files: delete failed:', e);
    }
    await rest(`drive_uploads?id=eq.${upload.id}`, { method: 'DELETE' });
  };

  try {
    if (!(await arrivedIntact(env, fetchImpl, file, body.file.drive_id))) {
      await discard(file, body.file.drive_id);
      if (thumb) await discard(thumb, body.thumb.drive_id);
      return refuse(400, "The file didn't arrive intact. Please try again.");
    }
    // A thumbnail is optional: the grid shows the full image without one.
    const thumbOk = thumb && (await arrivedIntact(env, fetchImpl, thumb, body.thumb.drive_id));
    if (thumb && !thumbOk) await discard(thumb, body.thumb.drive_id);

    for (const [upload, driveId] of [[file, body.file.drive_id], ...(thumbOk ? [[thumb, body.thumb.drive_id]] : [])]) {
      const marked = await rest(`drive_uploads?id=eq.${upload.id}`, {
        method: 'PATCH', body: { drive_file_id: driveId, verified_at: new Date().toISOString() },
      });
      if (!marked.ok) throw new Error(`marking the upload failed: ${marked.status}`);
    }

    const ext = EXT[file.mime_type];
    const name = String(body.name ?? '').slice(0, 255);
    const row = file.task_id
      ? {
        table: 'task_attachments',
        values: {
          task_id: file.task_id, project_id: file.project_id, path: `${file.project_id}/${file.task_id}/${file.id}.${ext}`,
          name, mime_type: file.mime_type, size_bytes: file.size_bytes,
          drive_file_id: body.file.drive_id, drive_thumb_id: thumbOk ? body.thumb.drive_id : null,
        },
      }
      : {
        table: 'project_files',
        values: {
          project_id: file.project_id, path: `${file.project_id}/project/${file.id}.${ext}`,
          name, mime_type: file.mime_type, size_bytes: file.size_bytes, drive_file_id: body.file.drive_id,
        },
      };
    // As the caller: the insert policies and the check_drive_ids trigger decide.
    const inserted = await rest(row.table, { token: caller.token, method: 'POST', prefer: 'return=representation', body: row.values });
    if (!inserted.ok) {
      await discard(file, body.file.drive_id);
      if (thumbOk) await discard(thumb, body.thumb.drive_id);
      return refuse(inserted.status === 403 ? 403 : 400, inserted.data?.message || "The file couldn't be added.");
    }
    return json(200, { row: inserted.data[0] });
  } catch (error) {
    console.error('api/files: finishing the upload failed:', error);
    return refuse(502, "The file couldn't be uploaded just now. Please try again.");
  }
}

async function signRows({ env, now, caller, rest }, body) {
  const table = body.table === 'project_files' ? 'project_files' : 'task_attachments';
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => UUID.test(id)).slice(0, 200) : [];
  if (!ids.length) return json(200, { expires: urlExpiry(now), urls: {} });
  const columns = table === 'task_attachments' ? 'id,name,mime_type,drive_file_id,drive_thumb_id' : 'id,name,mime_type,drive_file_id';
  // As the caller: only rows they can read come back.
  const rows = await rest(`${table}?id=in.(${ids.join(',')})&drive_file_id=not.is.null&select=${columns}`, { token: caller.token });
  const expires = urlExpiry(now);
  const urls = {};
  for (const r of rows.data ?? []) {
    const file = { driveId: r.drive_file_id, mime: r.mime_type, name: r.name };
    urls[r.id] = {
      url: await signFileUrl(env, file, expires),
      downloadUrl: await signFileUrl(env, { ...file, download: true }, expires),
      // Thumbnails are WebP, or JPEG from Safari; browsers go by an image's bytes, not its type.
      thumbUrl: r.drive_thumb_id
        ? await signFileUrl(env, { driveId: r.drive_thumb_id, mime: 'image/webp', name: r.name }, expires)
        : null,
    };
  }
  return json(200, { expires, urls });
}

// Deletes up to `limit` files in drive_trash from Drive. Returns how many went.
async function purgeTrash({ env, fetchImpl, rest }, limit = 50) {
  const trash = await rest(`drive_trash?select=drive_file_id&order=created_at&limit=${limit}`);
  let deleted = 0;
  for (const { drive_file_id: id } of trash.data ?? []) {
    try {
      await deleteFromDrive(env, id, fetchImpl);
      await rest(`drive_trash?drive_file_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      deleted += 1;
    } catch (error) {
      console.error('api/files: purge failed for', id, error);
    }
  }
  return deleted;
}

// Uploads started a day ago and never added to a task or project: their Drive files (found by
// the upload id when the browser never said which file it was), then the record. Records of
// finished uploads only count toward the daily limit, so they go too.
async function cleanUpUploads({ env, fetchImpl, now, rest }) {
  const before = encodeURIComponent(new Date(now.getTime() - ABANDONED_AFTER).toISOString());
  const stale = await rest(`drive_uploads?created_at=lt.${before}&select=id,drive_file_id,claimed_at&limit=200`);
  let removed = 0;
  for (const u of stale.data ?? []) {
    try {
      if (!u.claimed_at) {
        const ids = u.drive_file_id ? [u.drive_file_id] : await findDriveFiles(env, 'kahonUpload', u.id, fetchImpl);
        for (const id of ids) await deleteFromDrive(env, id, fetchImpl);
      }
      await rest(`drive_uploads?id=eq.${u.id}`, { method: 'DELETE' });
      removed += 1;
    } catch (error) {
      console.error('api/files: cleanup failed for upload', u.id, error);
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------------------------

export async function handleFilesGet(request, env, fetchImpl = fetch, now = new Date()) {
  if (!serverConfig(env).serviceKey || !driveConfigured(env)) return refuse(503, 'Google Drive is not set up.');
  const params = new URL(request.url).searchParams;

  if (params.get('job') === 'cleanup') {
    // Vercel's cron jobs send "Authorization: Bearer <CRON_SECRET>".
    if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return refuse(401, 'Unauthorized');
    const ctx = { env, fetchImpl, now, rest: restClient(env, fetchImpl) };
    let trashed = 0;
    for (let round = 0; round < 20; round += 1) {
      const n = await purgeTrash(ctx, 100);
      trashed += n;
      if (n < 100) break;
    }
    return json(200, { trashed, uploads: await cleanUpUploads(ctx) });
  }

  const p = await verifySigned(env, params, now);
  if (!p) return refuse(403, 'This link has expired. Refresh the page to get a new one.');

  let file;
  try {
    file = await downloadFromDrive(env, p.f, fetchImpl);
  } catch (error) {
    console.error('api/files: download failed:', error);
    return refuse(502, "This file couldn't be loaded just now.");
  }
  if (!file) return refuse(404, 'This file is no longer in Google Drive.');

  const disposition = `${p.d === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(p.n)}`;
  const headers = {
    'Content-Type': p.m.startsWith('text/') ? `${p.m}; charset=utf-8` : p.m,
    'Content-Disposition': disposition,
    // Private: only this signed-in viewer's browser keeps it. A stored file never changes.
    'Cache-Control': `private, max-age=${Math.max(0, Number(p.e) - Math.floor(now.getTime() / 1000))}, immutable`,
    'X-Content-Type-Options': 'nosniff',
  };
  const length = file.headers.get('content-length');
  if (length) headers['Content-Length'] = length;
  // Opened in a tab, a file can't run anything. PDFs are left out: the browser's viewer needs scripts.
  if (p.m !== 'application/pdf') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
  return new Response(file.body, { status: 200, headers });
}
