import { supabase } from './supabase';

// The app's side of files in Google Drive (api/files.js, src/lib/driveFiles.js). Rows with a
// drive_file_id are in Drive; older ones are still in the Supabase "attachments" bucket.
const ENDPOINT = '/api/files';

// Once the server says Drive isn't set up (or there's no /api, as under plain `vite`), stop
// asking for this visit: uploads go to Supabase Storage as before.
let driveOff = false;

async function call(body) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('your session has expired. Refresh the page and try again');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await res.json().catch(() => null);
  if (res.status === 404 || res.status === 405 || result?.code === 'drive_off' || (res.ok && !result)) {
    driveOff = true;
    return null;
  }
  if (!res.ok) throw new Error((result?.message || 'the upload failed').replace(/\.$/, ''));
  return result;
}

// Sends the bytes to the Drive upload session the server started. Google answers with the file.
async function put(url, blob) {
  const res = await fetch(url, { method: 'PUT', body: blob });
  const file = await res.json().catch(() => null);
  if (!res.ok || !file?.id) throw new Error("the file couldn't be sent to Google Drive");
  return file.id;
}

/**
 * Uploads a prepared file to Drive and adds its row (task_attachments when `taskId` is given,
 * project_files otherwise). Returns the new row, or null when Drive isn't set up, in which case
 * the caller uploads to Supabase Storage instead.
 */
export async function uploadToDrive({ projectId, taskId = null, name, body, mime, thumb = null }) {
  if (driveOff) return null;
  const started = await call({
    action: 'start', project_id: projectId, task_id: taskId, name, mime, size: body.size,
    thumb: thumb ? { mime: thumb.mime, size: thumb.blob.size } : null,
  });
  if (!started) return null;
  const driveId = await put(started.file.url, body);
  // Best effort, like thumbnails in storage: without one the grid shows the full image.
  const thumbId = started.thumb ? await put(started.thumb.url, thumb.blob).catch(() => null) : null;
  const finished = await call({
    action: 'finish',
    name,
    file: { upload_id: started.file.id, drive_id: driveId },
    thumb: thumbId ? { upload_id: started.thumb.id, drive_id: thumbId } : null,
  });
  if (!finished) throw new Error('Google Drive is not available');
  return finished.row;
}

/** Signed { url, downloadUrl, thumbUrl } by row id for Drive rows, and when they expire (ms). */
export async function signDriveUrls(table, ids) {
  if (!ids.length) return { urls: {}, expires: 0 };
  const result = await call({ action: 'sign', table, ids }).catch(() => null);
  return result ? { urls: result.urls, expires: result.expires * 1000 } : { urls: {}, expires: 0 };
}

/** Deletes removed files from Drive now rather than at the daily cleanup. Best effort. */
export function purgeDriveTrash() {
  if (!driveOff) call({ action: 'purge' }).catch(() => {});
}
