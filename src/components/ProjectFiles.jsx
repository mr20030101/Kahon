import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { cleanFileName } from '../lib/uploads';
import { classify, extOf, formatBytes, prepareFile, withUrls } from './Attachments';
import FileViewer, { previewKindOf } from './FileViewer';
import { Icon } from './ui';

const BUCKET = 'attachments';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 6;

// Only formats Ask AI can read. Keep in sync with project_files in schema.sql and
// readAttachmentText in supabase/functions/ask-ai/extract.ts.
const PROJECT_FILE_TYPES = ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx', 'ods', 'pptx'];
const ACCEPT = PROJECT_FILE_TYPES.map((e) => `.${e}`).join(',');

// Specs, briefs and other reference documents for the whole project. Ask AI reads their
// text for every task here. Every member can open them; project admins add and remove them.
export default function ProjectFiles({ projectId, isOwner }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [uploading, setUploading] = useState(0);
  const [previewing, setPreviewing] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('project_files').select('*').eq('project_id', projectId).order('created_at');
      if (error) {
        if (alive) setItems([]);
        return;
      }
      const rows = await withUrls(data || []);
      if (alive) setItems(rows);
    })();
    const channel = supabase
      .channel(`project-files-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_files', filter: `project_id=eq.${projectId}` },
        async ({ new: row }) => {
          const [withUrl] = await withUrls([row]);
          setItems((list) => (list?.some((x) => x.id === row.id) ? list : [...(list || []), withUrl]));
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'project_files' },
        ({ old }) => setItems((list) => list?.filter((x) => x.id !== old.id)))
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const upload = async (files) => {
    const typed = files.map((file) => ({ file, type: classify(file) }));
    const allowed = typed.filter((f) => f.type && PROJECT_FILE_TYPES.includes(f.type.ext));
    if (allowed.length < files.length) toast('Ask AI can read PDF, Word (.docx), text, Markdown, CSV, Excel (.xlsx), .ods and PowerPoint (.pptx) files', 'error');
    const room = MAX_FILES - (items?.length ?? 0) - uploading;
    if (allowed.length > room) toast(`A project can have up to ${MAX_FILES} reference files`, 'error');
    const ok = allowed.slice(0, Math.max(room, 0)).filter((f) => f.file.size > 0 && f.file.size <= MAX_BYTES);
    if (!ok.length) return;

    setUploading((n) => n + ok.length);
    await Promise.all(ok.map(async ({ file, type }) => {
      try {
        const { body, ext, mime } = await prepareFile(file, type);
        const path = `${projectId}/project/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: mime });
        if (upErr) throw upErr;
        const name = cleanFileName(file.name, ext);
        const { data, error } = await supabase.from('project_files')
          .insert({ project_id: projectId, path, name, mime_type: mime, size_bytes: body.size })
          .select().single();
        if (error) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw error;
        }
        const [withUrl] = await withUrls([data]);
        setItems((list) => (list?.some((x) => x.id === data.id) ? list : [...(list || []), withUrl]));
      } catch (err) {
        toast(`Could not upload ${file.name}: ${err.message}`, 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }));
  };

  const remove = async (item) => {
    setItems((list) => list.filter((x) => x.id !== item.id));
    const { error } = await supabase.from('project_files').delete().eq('id', item.id);
    if (error) {
      setItems((list) => [...list, item]);
      return toast(error.message, 'error');
    }
    await supabase.storage.from(BUCKET).remove([item.path]);
  };

  const count = items?.length ?? 0;

  return (
    <div className="project-files">
      <p className="settings-label">Reference files for Ask AI</p>
      <p className="muted small project-files-hint">
        <Icon.sparkle width="14" height="14" /> Ask AI reads these on every task in this project. Add specs, briefs or style guides.
      </p>
      {items === null ? <div className="skeleton" /> : (
        <div className="attachments">
          {items.map((a) => (
            <figure key={a.id} className="attachment is-file">
              <a className="attachment-file" title={previewKindOf(a.name) ? `Preview ${a.name}` : `Download ${a.name}`}
                href={(previewKindOf(a.name) ? a.url : a.downloadUrl) || undefined}
                onClick={(e) => {
                  if (!previewKindOf(a.name) || !a.url) return;
                  e.preventDefault();
                  setPreviewing(a);
                }}>
                <span className={`file-badge file-${a.kind}`}>{extOf(a.name) || 'file'}</span>
                <span className="file-name">{a.name}</span>
                <span className="hint">{formatBytes(a.size_bytes)}</span>
              </a>
              <div className="attachment-actions reveal">
                {a.downloadUrl && <a className="icon-btn" href={a.downloadUrl} aria-label={`Download ${a.name}`} title="Download"><Icon.download /></a>}
                {isOwner && (
                  <button type="button" className="icon-btn" onClick={() => remove(a)} aria-label={`Remove ${a.name}`} title="Remove"><Icon.x /></button>
                )}
              </div>
            </figure>
          ))}
          {Array.from({ length: uploading }, (_, i) => <div key={`up-${i}`} className="attachment attachment-pending" aria-label="Uploading" />)}
          {isOwner && count + uploading < MAX_FILES && (
            <button type="button" className="attachment-add" onClick={() => inputRef.current?.click()}>
              <Icon.paperclip />
              <span>Add files</span>
              <span className="hint">PDF, Word, Excel, slides, text</span>
            </button>
          )}
          {!isOwner && count === 0 && <p className="muted small">No reference files yet. A project admin can add them.</p>}
          <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden
            onChange={(e) => {
              upload([...e.target.files]);
              e.target.value = '';
            }} />
        </div>
      )}
      {previewing && <FileViewer file={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}
