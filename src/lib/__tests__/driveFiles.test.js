import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFilesGet, handleFilesPost, signFileUrl, urlExpiry } from '../driveFiles';
import { resetDriveTokenCache } from '../googleDrive';

const ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GOOGLE_DRIVE_FOLDER_ID: 'folder',
  GOOGLE_OAUTH_CLIENT_ID: 'client',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh',
  CRON_SECRET: 'cron',
};
const NOW = new Date('2026-10-30T10:15:00Z');
const PROJECT = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const UPLOAD = '33333333-3333-4333-8333-333333333333';
const ROW = '44444444-4444-4444-8444-444444444444';
const PDF = 'application/pdf';
const pdfBytes = () => new TextEncoder().encode('%PDF-1.7 rest of the file');

const post = (body, token = 'user-token') => new Request('https://kahon.example/api/files', {
  method: 'POST',
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', Origin: 'https://kahon.example' },
  body: JSON.stringify(body),
});

// Answers Supabase auth/REST and Google's token and Drive calls; records every call.
function fakeFetch({
  canEdit = true, taskProject = PROJECT, upload = { id: UPLOAD, user_id: 'user-1', project_id: PROJECT, task_id: TASK, kind: 'file', mime_type: PDF, size_bytes: 25 },
  drive = { id: 'drive-file-123', size: '25', mimeType: PDF, parents: ['folder'], appProperties: { kahonUpload: UPLOAD } },
  bytes = pdfBytes(), insertOk = true, trash = [],
} = {}) {
  return vi.fn(async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url.endsWith('/auth/v1/user')) {
      return init.headers.Authorization === 'Bearer user-token' ? Response.json({ id: 'user-1', email: 'me@example.com' }) : new Response(null, { status: 401 });
    }
    if (url.includes('/rest/v1/tasks?')) return Response.json([{ project_id: taskProject }]);
    if (url.includes('/rest/v1/rpc/')) return Response.json(canEdit);
    if (url.includes('/rest/v1/drive_uploads') && method === 'HEAD') return new Response(null, { headers: { 'content-range': '*/0' } });
    if (url.includes('/rest/v1/drive_uploads') && method === 'POST') {
      return Response.json(JSON.parse(init.body).map((r, i) => ({ ...r, id: i ? 'thumb-upload' : UPLOAD })), { status: 201 });
    }
    if (url.includes('/rest/v1/drive_uploads') && method === 'GET') return Response.json(upload ? [upload] : []);
    if (url.includes('/rest/v1/drive_uploads')) return new Response(null, { status: 204 });
    if (url.includes('/rest/v1/task_attachments') && method === 'POST') {
      return insertOk
        ? Response.json([{ id: ROW, ...JSON.parse(init.body) }], { status: 201 })
        : Response.json({ message: 'new row violates row-level security policy' }, { status: 403 });
    }
    if (url.includes('/rest/v1/task_attachments')) {
      return Response.json([{ id: ROW, name: 'Spec.pdf', mime_type: PDF, drive_file_id: 'drive-file-123', drive_thumb_id: null }]);
    }
    if (url.includes('/rest/v1/drive_trash') && method === 'GET') return Response.json(trash.map((id) => ({ drive_file_id: id })));
    if (url.includes('/rest/v1/drive_trash')) return new Response(null, { status: 204 });
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'google-token', expires_in: 3600 });
    if (url.includes('/upload/drive/v3/files')) return new Response(null, { headers: { location: 'https://www.googleapis.com/upload/session-1' } });
    if (url.includes('/drive/v3/files/') && method === 'DELETE') return new Response(null, { status: 204 });
    if (url.includes('alt=media')) return drive ? new Response(bytes) : new Response(null, { status: 404 });
    if (url.includes('/drive/v3/files/')) return drive ? Response.json(drive) : new Response(null, { status: 404 });
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

const calls = (fetchImpl, match, method) =>
  fetchImpl.mock.calls.filter(([url, init = {}]) => String(url).includes(match) && (!method || (init.method ?? 'GET') === method));

const start = { action: 'start', project_id: PROJECT, task_id: TASK, name: 'Spec.pdf', mime: PDF, size: 25 };
const finish = { action: 'finish', name: 'Spec.pdf', file: { upload_id: UPLOAD, drive_id: 'drive-file-123' } };

beforeEach(resetDriveTokenCache);

describe('start', () => {
  it('starts a Drive upload the browser can send to', async () => {
    const fetchImpl = fakeFetch();
    const response = await handleFilesPost(post(start), ENV, fetchImpl, NOW);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ file: { kind: 'file', id: UPLOAD, url: 'https://www.googleapis.com/upload/session-1' }, thumb: null });
    const [[, init]] = calls(fetchImpl, '/upload/drive/v3/files');
    expect(init.headers.Origin).toBe('https://kahon.example');
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Spec.pdf', parents: ['folder'], appProperties: { kahonUpload: UPLOAD } });
  });

  it("refuses people who can't edit, a task from another project, and types or sizes not allowed", async () => {
    expect((await handleFilesPost(post(start, null), ENV, fakeFetch(), NOW)).status).toBe(401);
    expect((await handleFilesPost(post(start), ENV, fakeFetch({ canEdit: false }), NOW)).status).toBe(403);
    expect((await handleFilesPost(post(start), ENV, fakeFetch({ taskProject: 'other' }), NOW)).status).toBe(404);
    expect((await handleFilesPost(post({ ...start, mime: 'text/html' }), ENV, fakeFetch(), NOW)).status).toBe(400);
    expect((await handleFilesPost(post({ ...start, size: 26 * 1024 * 1024 }), ENV, fakeFetch(), NOW)).status).toBe(413);
    // Project reference files are only types Ask AI reads.
    expect((await handleFilesPost(post({ ...start, task_id: null, mime: 'image/png' }), ENV, fakeFetch(), NOW)).status).toBe(400);
  });

  it('says Drive is off when it is not set up, so the app uses Supabase Storage', async () => {
    const response = await handleFilesPost(post(start), { ...ENV, GOOGLE_DRIVE_FOLDER_ID: '' }, fakeFetch(), NOW);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('drive_off');
  });
});

describe('finish', () => {
  it('checks the file in Drive, then adds the row with the caller\'s own access', async () => {
    const fetchImpl = fakeFetch();
    const response = await handleFilesPost(post(finish), ENV, fetchImpl, NOW);
    expect(response.status).toBe(200);
    expect((await response.json()).row).toMatchObject({
      id: ROW, task_id: TASK, path: `${PROJECT}/${TASK}/${UPLOAD}.pdf`, drive_file_id: 'drive-file-123', drive_thumb_id: null,
    });
    const [[, insert]] = calls(fetchImpl, '/rest/v1/task_attachments', 'POST');
    expect(insert.headers.Authorization).toBe('Bearer user-token');
  });

  it('deletes a file that arrived with the wrong size or bytes', async () => {
    for (const options of [
      { drive: { id: 'drive-file-123', size: '999', mimeType: PDF, parents: ['folder'], appProperties: { kahonUpload: UPLOAD } } },
      { bytes: new TextEncoder().encode('<html>not a pdf</html>') },
    ]) {
      const fetchImpl = fakeFetch(options);
      expect((await handleFilesPost(post(finish), ENV, fetchImpl, NOW)).status).toBe(400);
      expect(calls(fetchImpl, '/drive/v3/files/drive-file-123', 'DELETE')).toHaveLength(1);
      expect(calls(fetchImpl, '/rest/v1/task_attachments', 'POST')).toHaveLength(0);
    }
  });

  it("never deletes a Drive file another upload made, whatever id the request names", async () => {
    const someoneElses = { id: 'drive-file-123', size: '25', mimeType: PDF, parents: ['folder'], appProperties: { kahonUpload: 'their-upload' } };
    const fetchImpl = fakeFetch({ drive: someoneElses });
    expect((await handleFilesPost(post(finish), ENV, fetchImpl, NOW)).status).toBe(400);
    expect(calls(fetchImpl, '/drive/v3/files/', 'DELETE')).toHaveLength(0);
  });

  it("refuses someone else's upload", async () => {
    expect((await handleFilesPost(post(finish), ENV, fakeFetch({ upload: null }), NOW)).status).toBe(404);
  });

  it('removes the Drive file when the database refuses the row', async () => {
    const fetchImpl = fakeFetch({ insertOk: false });
    expect((await handleFilesPost(post(finish), ENV, fetchImpl, NOW)).status).toBe(403);
    expect(calls(fetchImpl, '/drive/v3/files/drive-file-123', 'DELETE')).toHaveLength(1);
  });
});

describe('signed URLs', () => {
  it('signs rows the caller can read, and serves them from Drive', async () => {
    const fetchImpl = fakeFetch();
    const signed = await (await handleFilesPost(post({ action: 'sign', table: 'task_attachments', ids: [ROW] }), ENV, fetchImpl, NOW)).json();
    expect(signed.expires).toBe(urlExpiry(NOW));
    const { url, downloadUrl } = signed.urls[ROW];

    const view = await handleFilesGet(new Request(`https://kahon.example${url}`), ENV, fetchImpl, NOW);
    expect(view.status).toBe(200);
    expect(view.headers.get('content-type')).toBe(PDF);
    expect(view.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''Spec.pdf");
    expect(view.headers.get('cache-control')).toMatch(/^private, max-age=\d+, immutable$/);
    expect(await view.text()).toContain('%PDF-');

    const download = await handleFilesGet(new Request(`https://kahon.example${downloadUrl}`), ENV, fetchImpl, NOW);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('gives the same URL within the hour, so the browser cache is reused', async () => {
    const file = { driveId: 'drive-file-123', mime: PDF, name: 'Spec.pdf' };
    const a = await signFileUrl(ENV, file, urlExpiry(NOW));
    const b = await signFileUrl(ENV, file, urlExpiry(new Date('2026-10-30T10:59:00Z')));
    expect(a).toBe(b);
  });

  it('refuses a changed or expired link', async () => {
    const url = await signFileUrl(ENV, { driveId: 'drive-file-123', mime: PDF, name: 'Spec.pdf' }, urlExpiry(NOW));
    const changed = url.replace('drive-file-123', 'drive-file-999');
    expect((await handleFilesGet(new Request(`https://kahon.example${changed}`), ENV, fakeFetch(), NOW)).status).toBe(403);
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    expect((await handleFilesGet(new Request(`https://kahon.example${url}`), ENV, fakeFetch(), later)).status).toBe(403);
  });
});

describe('cleanup', () => {
  it('needs the cron secret, then deletes trashed files from Drive', async () => {
    const job = (token) => new Request('https://kahon.example/api/files?job=cleanup', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    expect((await handleFilesGet(job(null), ENV, fakeFetch(), NOW)).status).toBe(401);
    expect((await handleFilesGet(job('wrong'), ENV, fakeFetch(), NOW)).status).toBe(401);

    const fetchImpl = fakeFetch({ trash: ['gone-1', 'gone-2'], upload: null });
    const response = await handleFilesGet(job('cron'), ENV, fetchImpl, NOW);
    expect(await response.json()).toEqual({ trashed: 2, uploads: 0 });
    expect(calls(fetchImpl, '/drive/v3/files/gone-', 'DELETE')).toHaveLength(2);
  });
});
