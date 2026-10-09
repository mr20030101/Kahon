import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Icon } from './ui';
import FileViewer, { previewKindOf } from './FileViewer';
import { MAX_IMAGE_INPUT_BYTES, cleanFileName, hasValidSignature, processImage } from '../lib/uploads';

const BUCKET = 'attachments';
const MAX_BYTES = 25 * 1024 * 1024;
const URL_TTL = 60 * 60;

// Allowed files by extension. Browsers report document MIME types inconsistently
// (a .csv can arrive as application/vnd.ms-excel, a .md as ''), so the extension
// decides and the canonical type is what gets stored. Keep in sync with schema.sql.
const FILE_TYPES = {
  png: ['image', 'image/png'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  gif: ['image', 'image/gif'],
  webp: ['image', 'image/webp'],
  pdf: ['pdf', 'application/pdf'],
  doc: ['doc', 'application/msword'],
  docx: ['doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  odt: ['doc', 'application/vnd.oasis.opendocument.text'],
  rtf: ['doc', 'application/rtf'],
  txt: ['doc', 'text/plain'],
  md: ['doc', 'text/markdown'],
  xls: ['sheet', 'application/vnd.ms-excel'],
  xlsx: ['sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ods: ['sheet', 'application/vnd.oasis.opendocument.spreadsheet'],
  csv: ['sheet', 'text/csv'],
  ppt: ['slide', 'application/vnd.ms-powerpoint'],
  pptx: ['slide', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  odp: ['slide', 'application/vnd.oasis.opendocument.presentation'],
};
const ACCEPT = Object.keys(FILE_TYPES).map((e) => `.${e}`).join(',');
const MIME_EXT = Object.fromEntries(Object.entries(FILE_TYPES).map(([ext, [, mime]]) => [mime, ext]));

const extOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const kindOf = (a) => FILE_TYPES[extOf(a.name)]?.[0] || FILE_TYPES[MIME_EXT[a.mime_type]]?.[0] || 'doc';

// Resolve a dropped/pasted file to { ext, kind, mime }, or null when it isn't allowed.
function classify(file) {
  let ext = extOf(file.name);
  if (!FILE_TYPES[ext] && MIME_EXT[file.type]) ext = MIME_EXT[file.type];
  const entry = FILE_TYPES[ext];
  return entry ? { ext: ext === 'jpeg' ? 'jpg' : ext, kind: entry[0], mime: entry[1] } : null;
}

// Images (except GIFs) are re-encoded and compressed, so they may start larger than MAX_BYTES.
const inputLimit = (type) => (type.kind === 'image' && type.ext !== 'gif' ? MAX_IMAGE_INPUT_BYTES : MAX_BYTES);

// Checks a file really is what its extension says, then strips and shrinks images.
// Returns what to store: { body, ext, mime }.
async function prepareFile(file, type) {
  if (!(await hasValidSignature(file, type.ext))) throw new Error(`it doesn't look like a real .${type.ext} file`);
  const prepared = type.kind === 'image' && type.ext !== 'gif'
    ? await processImage(file, type.ext).then(({ blob, ext, mime }) => ({ body: blob, ext, mime }))
    : { body: file, ext: type.ext, mime: type.mime };
  if (prepared.body.size > MAX_BYTES) {
    throw new Error(type.kind === 'image' ? "it's still over 25 MB after compressing" : 'files must be 25 MB or smaller');
  }
  return prepared;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Remove stored files before deleting tasks, a section or a project. Attachment rows
// go with their task via cascade, but storage objects need the Storage API.
export async function removeAttachmentFiles({ taskIds, sectionId, projectId }) {
  let query = supabase.from('task_attachments').select('path, task:tasks!inner(section_id)');
  if (taskIds) query = query.in('task_id', taskIds);
  if (sectionId) query = query.eq('task.section_id', sectionId);
  if (projectId) query = query.eq('project_id', projectId);
  const { data } = await query;
  if (data?.length) await supabase.storage.from(BUCKET).remove(data.map((a) => a.path));
}

// Signed view URLs for everything, plus a download URL that keeps the original
// filename for files the browser can't show.
async function withUrls(rows) {
  if (!rows.length) return rows;
  const storage = supabase.storage.from(BUCKET);
  const { data } = await storage.createSignedUrls(rows.map((r) => r.path), URL_TTL);
  const byPath = Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl]));
  return Promise.all(rows.map(async (r) => {
    const kind = kindOf(r);
    const { data: dl } = await storage.createSignedUrl(r.path, URL_TTL, { download: r.name });
    return { ...r, kind, url: byPath[r.path], downloadUrl: dl?.signedUrl };
  }));
}

// canEdit: editors and project admins may add files and remove their own; admins (canManageAll) remove any.
const Attachments = forwardRef(function Attachments({ task, userId, canManageAll, canEdit = true }, ref) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(0);
  const [viewing, setViewing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from('task_attachments').select('*').eq('task_id', task.id).order('created_at');
      const rows = await withUrls(data || []);
      if (alive) setItems(rows);
    })();

    const channel = supabase
      .channel(`attachments-${task.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_attachments', filter: `task_id=eq.${task.id}` },
        async ({ new: row }) => {
          const [withUrl] = await withUrls([row]);
          setItems((list) => (list.some((x) => x.id === row.id) ? list : [...list, withUrl]));
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_attachments' },
        ({ old }) => setItems((list) => list.filter((x) => x.id !== old.id)))
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [task.id]);

  const upload = async (files) => {
    const allowed = files.map((file) => ({ file, type: classify(file) })).filter((f) => f.type);
    if (allowed.length < files.length) toast('Attach images, PDFs, documents, spreadsheets or presentations', 'error');
    const ok = allowed.filter((f) => f.file.size > 0 && f.file.size <= inputLimit(f.type));
    if (ok.length < allowed.length) toast('Images must be 100 MB or smaller, and other files 25 MB or smaller', 'error');
    if (!ok.length) return;

    setUploading((n) => n + ok.length);
    await Promise.all(ok.map(async ({ file, type }) => {
      try {
        const { body, ext, mime } = await prepareFile(file, type);
        const path = `${task.project_id}/${task.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: mime });
        if (upErr) throw upErr;
        const name = cleanFileName(file.name && file.name !== 'image.png' ? file.name : 'Pasted image', ext);
        if (file.size - body.size > 1024 * 1024) toast(`Compressed ${name} from ${formatBytes(file.size)} to ${formatBytes(body.size)}`);
        const { data, error } = await supabase
          .from('task_attachments')
          .insert({ task_id: task.id, project_id: task.project_id, path, name, mime_type: mime, size_bytes: body.size, created_by: userId })
          .select()
          .single();
        if (error) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw error;
        }
        const [withUrl] = await withUrls([data]);
        setItems((list) => (list.some((x) => x.id === data.id) ? list : [...list, withUrl]));
      } catch (err) {
        toast(`Could not upload ${file.name || 'file'}: ${err.message}`, 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }));
  };

  // The task panel forwards files dropped anywhere on it.
  useImperativeHandle(ref, () => ({ upload }));

  // Paste a screenshot or copied files anywhere in the panel. Text pastes are left alone.
  useEffect(() => {
    if (!canEdit) return undefined;
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      upload(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setViewing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewing]);

  const remove = async (item) => {
    setItems((list) => list.filter((x) => x.id !== item.id));
    const { error } = await supabase.from('task_attachments').delete().eq('id', item.id);
    if (error) {
      setItems((list) => [...list, item]);
      return toast(error.message, 'error');
    }
    await supabase.storage.from(BUCKET).remove([item.path]);
  };

  return (
    <>
      <h4 className="panel-h">Attachments {items.length > 0 && <span className="count">{items.length}</span>}</h4>
      <div className="attachments">
        {items.map((a) => (
          <figure key={a.id} className={`attachment${a.kind === 'image' ? '' : ' is-file'}`}>
            {a.kind === 'image' ? (
              <button className="attachment-thumb" onClick={() => setViewing(a)} aria-label={`View ${a.name}`}>
                {a.url ? <img src={a.url} alt={a.name} loading="lazy" /> : <span className="muted small">Unavailable</span>}
              </button>
            ) : (
              <a className="attachment-file" title={previewKindOf(a.name) ? `Preview ${a.name}` : `Download ${a.name}`}
                href={(previewKindOf(a.name) ? a.url : a.downloadUrl) || undefined}
                onClick={(e) => {
                  if (!previewKindOf(a.name) || !a.url) return;
                  e.preventDefault();
                  setPreviewing(a);
                }}>
                <span className={`file-badge file-${a.kind}`}>{extOf(a.name) || 'file'}</span>
                <span className="file-name">{a.name}</span>
                <span className="hint">{formatBytes(a.size_bytes)}{previewKindOf(a.name) ? '' : ' · download'}</span>
              </a>
            )}
            <div className="attachment-actions reveal">
              {a.downloadUrl && (
                <a className="icon-btn" href={a.downloadUrl} aria-label={`Download ${a.name}`} title="Download"><Icon.download /></a>
              )}
              {((canEdit && a.created_by === userId) || canManageAll) && (
                <button className="icon-btn" onClick={() => remove(a)} aria-label={`Remove ${a.name}`} title="Remove">
                  <Icon.x />
                </button>
              )}
            </div>
          </figure>
        ))}
        {Array.from({ length: uploading }, (_, i) => <div key={`up-${i}`} className="attachment attachment-pending" aria-label="Uploading" />)}
        {canEdit && (
          <button className="attachment-add" onClick={() => inputRef.current?.click()}>
            <Icon.paperclip />
            <span>Add files</span>
            <span className="hint">Images, docs, sheets, slides</span>
          </button>
        )}
        {!canEdit && items.length === 0 && <p className="muted small">No attachments.</p>}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            upload([...e.target.files]);
            e.target.value = '';
          }}
        />
      </div>

      {previewing && <FileViewer file={previewing} onClose={() => setPreviewing(null)} />}

      {viewing && (
        <div className="lightbox" onClick={() => setViewing(null)} role="dialog" aria-label={viewing.name}>
          <img src={viewing.url} alt={viewing.name} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span className="grow">{viewing.name}</span>
            <a className="btn btn-ghost" href={viewing.url} target="_blank" rel="noreferrer">Open original</a>
            {viewing.downloadUrl && <a className="icon-btn" href={viewing.downloadUrl} aria-label="Download" title="Download"><Icon.download /></a>}
            <button className="icon-btn" onClick={() => setViewing(null)} aria-label="Close"><Icon.x /></button>
          </div>
        </div>
      )}
    </>
  );
});

export default Attachments;
