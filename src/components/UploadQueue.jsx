import { useEffect, useRef, useState } from 'react';

// Files on their way up. Each one has its own progress and its own retry, so one failure never
// holds up the rest, and a failed file stays loaded: Retry sends it again without picking it anew.

const SECOND = 1000;

/** Rough time left from how fast the bytes have gone so far, or null while that's still unknown. */
export function timeLeft(loaded, total, elapsedMs) {
  if (!loaded || !total || elapsedMs < SECOND || loaded >= total) return null;
  const seconds = Math.ceil(((total - loaded) / loaded) * (elapsedMs / SECOND));
  if (seconds < 60) return `about ${Math.max(1, seconds)} s left`;
  return `about ${Math.ceil(seconds / 60)} min left`;
}

/**
 * add(checked, run, group) queues files ({ file, type } from checkFiles); run({ file, type },
 * onProgress) uploads one and returns its row, and onDone(row) gets each finished row.
 * items(group) lists the files of one group (a comment id, or null for the task itself).
 */
export function useUploadQueue(onDone) {
  const [list, setList] = useState([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const live = useRef(list);
  live.current = list;

  useEffect(() => () => live.current.forEach((u) => u.preview && URL.revokeObjectURL(u.preview)), []);

  const patch = (key, changes) => setList((l) => l.map((u) => (u.key === key ? { ...u, ...changes } : u)));
  const forget = (key) => setList((l) => {
    const gone = l.find((u) => u.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    return l.filter((u) => u.key !== key);
  });

  const send = async (item) => {
    patch(item.key, { status: 'preparing', loaded: 0, total: 0, startedAt: 0, error: '' });
    const onProgress = (loaded, total) => setList((l) => l.map((u) => (u.key !== item.key ? u : {
      ...u, status: 'uploading', loaded, total, startedAt: u.startedAt || Date.now(),
    })));
    try {
      const row = await item.run({ file: item.file, type: item.type }, onProgress);
      forget(item.key);
      doneRef.current?.(row, item.group);
    } catch (err) {
      patch(item.key, { status: 'failed', error: err.message || 'the upload failed' });
    }
  };

  const add = (checked, run, group = null) => {
    const items = checked.map(({ file, type }) => ({
      key: crypto.randomUUID(), file, type, group, run, status: 'preparing', loaded: 0, total: 0, startedAt: 0, error: '',
      preview: type.kind === 'image' ? URL.createObjectURL(file) : null,
    }));
    setList((l) => [...l, ...items]);
    items.forEach(send);
  };

  return {
    add,
    items: (group = null) => list.filter((u) => u.group === group),
    retry: (key) => {
      const item = live.current.find((u) => u.key === key);
      if (item) send(item);
    },
    dismiss: forget,
  };
}

/** One queued file: what it is (thumbnail, type, size), how far along it is, and Retry if it failed. */
export function UploadTile({ item, onRetry, onDismiss }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (item.status !== 'uploading') return undefined;
    const id = setInterval(() => tick((n) => n + 1), SECOND);
    return () => clearInterval(id);
  }, [item.status]);

  const name = item.file.name || 'Pasted image';
  const size = item.file.size;
  const percent = item.total ? Math.min(100, Math.round((item.loaded / item.total) * 100)) : null;
  const left = timeLeft(item.loaded, item.total, item.startedAt ? Date.now() - item.startedAt : 0);
  const failed = item.status === 'failed';

  let status;
  if (failed) status = `Failed: ${item.error}`;
  else if (item.status === 'preparing') status = 'Preparing…';
  else if (percent === null) status = 'Uploading…';
  else status = `${percent}%${left ? ` · ${left}` : ''}`;

  return (
    <figure className={`attachment upload-tile${failed ? ' is-failed' : ''}`} aria-busy={!failed}>
      <div className="upload-preview">
        {item.preview ? <img src={item.preview} alt="" /> : <span className={`file-badge file-${item.type.kind}`}>{item.type.ext}</span>}
      </div>
      <figcaption className="upload-info">
        <span className="file-name" title={name}>{name}</span>
        <span className="hint">{formatSize(size)} · {item.type.ext.toUpperCase()}</span>
        <span className={`upload-status${failed ? ' is-error' : ''}`} role={failed ? 'alert' : 'status'}>{status}</span>
        {!failed && (
          <span className="upload-bar" aria-hidden="true">
            <span className={percent === null ? 'is-indeterminate' : ''} style={percent === null ? undefined : { width: `${percent}%` }} />
          </span>
        )}
        {failed && (
          <span className="upload-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => onRetry(item.key)}>Retry</button>
            <button type="button" className="link-btn" onClick={() => onDismiss(item.key)}>Remove</button>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
