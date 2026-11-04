import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { purgeDriveTrash } from '../lib/drive';
import { Icon } from './ui';
import { FileTile, checkFiles, deleteAttachment, extOf, storedPaths, uploadAttachment, withUrls } from './Attachments';

// Files added with a comment: task_attachments rows with a comment_id, listed under their comment
// rather than in the task's Attachments. See supabase/migrations/20261104_comment_files.sql.

/** Every comment file on a task, kept live, and what can be done with them. */
export function useCommentFiles(task, userId) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState({}); // comment id -> files on their way

  useEffect(() => {
    let alive = true;
    (async () => {
      // Errors (as before the migration adds comment_id) just mean no comment files.
      const { data } = await supabase.from('task_attachments').select('*')
        .eq('task_id', task.id).not('comment_id', 'is', null).order('created_at');
      const rows = await withUrls(data || []);
      if (alive) setFiles(rows);
    })();

    const channel = supabase
      .channel(`comment-files-${task.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_attachments', filter: `task_id=eq.${task.id}` },
        async ({ new: row }) => {
          if (!row.comment_id) return;
          const [withUrl] = await withUrls([row]);
          setFiles((list) => (list.some((x) => x.id === row.id) ? list : [...list, withUrl]));
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_attachments' },
        ({ old }) => setFiles((list) => list.filter((x) => x.id !== old.id)))
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [task.id]);

  const count = (commentId, n) => setUploading((u) => ({ ...u, [commentId]: (u[commentId] || 0) + n }));

  // `checked` comes from checkFiles.
  const upload = async (commentId, checked) => {
    if (!checked.length) return;
    count(commentId, checked.length);
    await Promise.all(checked.map(async ({ file, type }) => {
      try {
        const row = await uploadAttachment({ file, type, task, userId, commentId, toast });
        setFiles((list) => (list.some((x) => x.id === row.id) ? list : [...list, row]));
      } catch (err) {
        toast(`Could not add ${file.name || 'file'} to the comment: ${err.message}`, 'error');
      } finally {
        count(commentId, -1);
      }
    }));
  };

  const remove = async (item) => {
    setFiles((list) => list.filter((x) => x.id !== item.id));
    const error = await deleteAttachment(item);
    if (error) {
      setFiles((list) => [...list, item]);
      toast(error.message, 'error');
    }
  };

  // After a comment is deleted: its rows went with it, but files in storage need the Storage API.
  // Drive files are queued by the database (drive_trash).
  const clearDeleted = async (commentId) => {
    const gone = files.filter((f) => f.comment_id === commentId);
    setFiles((list) => list.filter((f) => f.comment_id !== commentId));
    const paths = gone.flatMap(storedPaths);
    if (paths.length) await supabase.storage.from('attachments').remove(paths);
    if (gone.some((f) => f.drive_file_id)) purgeDriveTrash();
  };

  return {
    of: (commentId) => files.filter((f) => f.comment_id === commentId),
    uploadingFor: (commentId) => uploading[commentId] || 0,
    upload,
    remove,
    clearDeleted,
  };
}

/** A comment's files, under its text. */
export function CommentFileList({ files, uploading = 0, onOpen, canRemove }) {
  if (!files.length && !uploading) return null;
  return (
    <div className="attachments comment-files">
      {files.map((a) => <FileTile key={a.id} file={a} onOpen={onOpen} onRemove={canRemove?.(a)} />)}
      {Array.from({ length: uploading }, (_, i) => <div key={`up-${i}`} className="attachment attachment-pending" aria-label="Uploading" />)}
    </div>
  );
}

/** Files picked, pasted or dropped into the comment box, waiting for the comment to be posted. */
export function usePendingFiles() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const live = useRef(items);
  live.current = items;

  // Free image previews still showing when the panel closes.
  useEffect(() => () => live.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), []);

  const add = (files) => {
    const ok = checkFiles(files, toast).map((f) => ({
      ...f, key: crypto.randomUUID(), preview: f.type.kind === 'image' ? URL.createObjectURL(f.file) : null,
    }));
    if (ok.length) setItems((list) => [...list, ...ok]);
  };
  const drop = (key) => setItems((list) => {
    const gone = list.find((p) => p.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    return list.filter((p) => p.key !== key);
  });
  // Hands the files over for posting. Call done(taken) once they've uploaded, or putBack(taken).
  const take = () => {
    const taken = live.current;
    setItems([]);
    return taken;
  };
  const putBack = (taken) => setItems((list) => [...taken, ...list]);
  const done = (taken) => taken.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));

  return { items, add, drop, take, putBack, done };
}

/** The comment box's waiting files, each with a way to take it out again. */
export function PendingFiles({ items, onDrop }) {
  if (!items.length) return null;
  return (
    <ul className="comment-pending" aria-label="Files to add with the comment">
      {items.map((p) => (
        <li key={p.key} className="pending-file" title={p.file.name || 'Pasted image'}>
          {p.preview
            ? <img src={p.preview} alt={p.file.name || 'Pasted image'} />
            : <span className={`file-badge file-${p.type.kind}`}>{extOf(p.file.name) || p.type.ext}</span>}
          <button type="button" className="icon-btn" onClick={() => onDrop(p.key)} aria-label={`Remove ${p.file.name || 'pasted image'}`} title="Remove">
            <Icon.x />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Props that make an element take pasted and dropped files (text pastes are left alone), and
 * whether files are being dragged over it. The event stops here, so the task panel doesn't also
 * add them to the task.
 */
export function useFileTarget(onFiles, enabled = true) {
  const [over, setOver] = useState(false);
  const hasFiles = (e) => enabled && [...(e.dataTransfer?.types || [])].includes('Files');
  const props = {
    onPaste: (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (!enabled || !files.length) return;
      e.preventDefault();
      e.stopPropagation();
      onFiles(files);
    },
    onDragOver: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOver(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      onFiles([...e.dataTransfer.files]);
    },
  };
  return [props, over];
}
