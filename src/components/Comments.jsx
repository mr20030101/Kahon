import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { timeAgo } from '../lib/dates';
import { confirmDialog } from '../lib/dialog';
import { notify } from '../lib/notify';
import { PROFILE_BRIEF } from '../lib/profiles';
import { useToast } from '../context/ToastContext';
import { checkFiles, useFileViewer } from './Attachments';
import { CommentFileList, PendingFiles, useCommentFiles, useFileTarget, usePendingFiles } from './CommentFiles';
import EmojiPicker, { Popover, QUICK_REACTIONS } from './EmojiPicker';
import MentionInput from './MentionInput';
import RichText from './RichText';
import { Avatar, Icon } from './ui';

// A task's comments: threads one reply deep, pinned comments first, reactions, files, and a
// hover bar per comment (react, reply, and a menu to pin, copy a link, follow, edit or delete).
// See supabase/migrations/20261104_comment_threads.sql.

// "*" rather than a column list, so comments still load before the thread migration has run.
// The author by name of the foreign key, so another link from comments to profiles can't make it ambiguous.
const COMMENT_SELECT = `*, author:profiles!comments_author_id_fkey(${PROFILE_BRIEF})`;
const byCreated = (a, b) => a.created_at.localeCompare(b.created_at);

/** A comment box with formatting, @mentions and files. `onPost(body, files)` resolves to whether it posted. */
function Composer({ members, onPost, placeholder, submitLabel = 'Comment', onCancel, autoFocus = false, label }) {
  const ref = useRef(null);
  const [text, setText] = useState('');
  const pending = usePendingFiles();
  const [fileProps, drag] = useFileTarget(pending.add);

  const submit = async () => {
    const body = (ref.current?.getValue() ?? '').trim().slice(0, 5000);
    // Files waiting in the box go up with it, so a comment can be just a screenshot.
    if (!body && !pending.items.length) {
      ref.current?.focus();
      return;
    }
    const files = pending.take();
    ref.current?.clear();
    setText('');
    if (await onPost(body, files)) pending.done(files);
    else pending.putBack(files);
  };

  return (
    <div className={`comment-box${drag ? ' is-drop' : ''}`} {...fileProps}>
      <MentionInput ref={ref} toolbar members={members} placeholder={placeholder} rows={2} autoFocus={autoFocus}
        onTextChange={setText} onSubmit={submit} onFiles={pending.add} aria-label={label}
        below={<PendingFiles items={pending.items} onDrop={pending.drop} />}
        footer={(
          <div className="comment-actions">
            <span className="hint">Paste or drop images · Ctrl + Enter</span>
            {onCancel && <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>}
            <button type="button" className="btn btn-primary btn-small" onClick={submit}>{submitLabel}</button>
          </div>
        )} />
    </div>
  );
}

const Comments = forwardRef(function Comments({ task, members, userId, commentable, editable, isOwner }, ref) {
  const toast = useToast();
  const [comments, setComments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [following, setFollowing] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [open, setOpen] = useState(null); // { id, what: 'menu' | 'emoji' }
  const [highlight, setHighlight] = useState(null);
  const editRef = useRef(null);
  const files = useCommentFiles(task, userId);
  const viewer = useFileViewer();
  const [editFileProps, editDrag] = useFileTarget(
    (list) => editing && files.upload(editing, checkFiles(list, toast)), commentable,
  );

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    (async () => {
      const [c, r, f] = await Promise.all([
        supabase.from('comments').select(COMMENT_SELECT).eq('task_id', task.id).order('created_at'),
        supabase.from('comment_reactions').select('comment_id, user_id, emoji, created_at').eq('task_id', task.id).order('created_at'),
        supabase.from('comment_followers').select('comment_id, comment:comments!inner(task_id)').eq('user_id', userId).eq('comment.task_id', task.id),
      ]);
      if (!alive) return;
      // Never show "No comments" when they just couldn't be loaded.
      if (c.error) {
        toast(`Couldn't load the comments: ${c.error.message}`, 'error');
        return;
      }
      setComments(c.data || []);
      setReactions(r.data || []);
      setFollowing(new Set((f.data || []).map((x) => x.comment_id)));
      setLoaded(true);
    })();

    const sameReaction = (a, b) => a.comment_id === b.comment_id && a.user_id === b.user_id && a.emoji === b.emoji;
    const channel = supabase
      .channel(`comments-${task.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `task_id=eq.${task.id}` },
        async ({ new: row }) => {
          const { data } = await supabase.from('comments').select(COMMENT_SELECT).eq('id', row.id).maybeSingle();
          if (data) setComments((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]));
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comments', filter: `task_id=eq.${task.id}` },
        ({ new: row }) => setComments((list) => list.map((x) => (x.id === row.id ? { ...x, ...row, author: x.author } : x))))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'comments' },
        ({ old }) => setComments((list) => list.filter((x) => x.id !== old.id && x.parent_id !== old.id)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comment_reactions', filter: `task_id=eq.${task.id}` },
        ({ new: row }) => setReactions((list) => (list.some((x) => sameReaction(x, row)) ? list : [...list, row])))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'comment_reactions' },
        ({ old }) => setReactions((list) => list.filter((x) => !sameReaction(x, old))))
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [task.id, userId]);

  // A comment link (?comment=…) scrolls to the comment and highlights it for a moment.
  useEffect(() => {
    if (!loaded) return undefined;
    const id = new URLSearchParams(window.location.search).get('comment');
    const el = id && document.getElementById(`comment-${id}`);
    if (!el) return undefined;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlight(id);
    const t = setTimeout(() => setHighlight(null), 2600);
    return () => clearTimeout(t);
  }, [loaded]);

  const post = async ({ body, files: list = [], parentId = null }) => {
    const { data, error } = await supabase
      .from('comments')
      .insert({ task_id: task.id, author_id: userId, body, ...(parentId ? { parent_id: parentId } : {}) })
      .select(COMMENT_SELECT)
      .single();
    if (error) {
      toast(error.message, 'error');
      return false;
    }
    setComments((all) => (all.some((x) => x.id === data.id) ? all : [...all, data]));
    notify('comment_added', { comment_id: data.id });
    await files.upload(data.id, list);
    return true;
  };

  // Ask AI's "Post as comment".
  useImperativeHandle(ref, () => ({ post: (text) => post({ body: text.trim().slice(0, 5000) }) }));

  const saveEdit = async (c) => {
    const body = (editRef.current?.getValue() ?? '').trim().slice(0, 5000);
    if (!body && !files.of(c.id).length) return;
    setEditing(null);
    if (body === c.body) return;
    const edited_at = new Date().toISOString();
    setComments((list) => list.map((x) => (x.id === c.id ? { ...x, body, edited_at } : x)));
    const { error } = await supabase.from('comments').update({ body, edited_at }).eq('id', c.id);
    if (error) toast(error.message, 'error');
  };

  const remove = async (c) => {
    setOpen(null);
    const replies = comments.filter((x) => x.parent_id === c.id);
    const fileCount = [c, ...replies].reduce((n, x) => n + files.of(x.id).length, 0);
    const also = [
      replies.length && `${replies.length === 1 ? 'its reply' : `its ${replies.length} replies`}`,
      fileCount && `${fileCount === 1 ? 'a file' : `${fileCount} files`}`,
    ].filter(Boolean);
    const ok = await confirmDialog({
      title: c.parent_id ? 'Delete this reply?' : 'Delete this comment?',
      text: `${also.length ? `This also deletes ${also.join(' and ')}. ` : ''}This can't be undone.`,
      confirmText: c.parent_id ? 'Delete reply' : 'Delete comment',
      danger: true,
    });
    if (!ok) return;
    setComments((list) => list.filter((x) => x.id !== c.id && x.parent_id !== c.id));
    const { error } = await supabase.from('comments').delete().eq('id', c.id);
    if (error) return toast(error.message, 'error');
    for (const x of [c, ...replies]) await files.clearDeleted(x.id);
  };

  const toggleReaction = async (c, emoji) => {
    setOpen(null);
    const row = { comment_id: c.id, user_id: userId, emoji, task_id: task.id };
    const mine = reactions.some((r) => r.comment_id === c.id && r.user_id === userId && r.emoji === emoji);
    const same = (r) => r.comment_id === c.id && r.user_id === userId && r.emoji === emoji;
    setReactions((list) => (mine ? list.filter((r) => !same(r)) : [...list, { ...row, created_at: new Date().toISOString() }]));
    const { error } = mine
      ? await supabase.from('comment_reactions').delete().match({ comment_id: c.id, user_id: userId, emoji })
      : await supabase.from('comment_reactions').insert(row);
    if (error) {
      setReactions((list) => (mine ? [...list, row] : list.filter((r) => !same(r))));
      toast(error.message, 'error');
    }
  };

  const togglePin = async (c) => {
    setOpen(null);
    const pinned_at = c.pinned_at ? null : new Date().toISOString();
    setComments((list) => list.map((x) => (x.id === c.id ? { ...x, pinned_at } : x)));
    const { error } = await supabase.rpc('pin_comment', { p_comment: c.id, p_pinned: !!pinned_at });
    if (error) {
      setComments((list) => list.map((x) => (x.id === c.id ? { ...x, pinned_at: c.pinned_at } : x)));
      return toast(error.message, 'error');
    }
    toast(pinned_at ? 'Pinned to the top of the comments' : 'Unpinned');
  };

  const copyLink = async (c) => {
    setOpen(null);
    const url = `${window.location.origin}/p/${task.project_id}?task=${task.id}&comment=${c.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Comment link copied');
    } catch {
      toast(url);
    }
  };

  // Following is per thread: a reply's menu follows the comment it answers.
  const toggleFollow = async (c) => {
    setOpen(null);
    const id = c.parent_id || c.id;
    const on = !following.has(id);
    const set = (value) => setFollowing((s) => {
      const next = new Set(s);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
    set(on);
    const { error } = on
      ? await supabase.from('comment_followers').insert({ comment_id: id, user_id: userId })
      : await supabase.from('comment_followers').delete().match({ comment_id: id, user_id: userId });
    if (error) {
      set(!on);
      return toast(error.message, 'error');
    }
    toast(on ? "You'll be notified about replies to this comment" : "You won't be notified about replies to this comment");
  };

  const nameOf = (id) => (id === userId ? 'You' : members.find((m) => m.user_id === id)?.profile?.full_name || 'Someone');
  const canRemoveFile = (f) => (isOwner || (commentable && f.created_by === userId) ? files.remove : undefined);
  const toggleOpen = (id, what) => setOpen((o) => (o?.id === id && o.what === what ? null : { id, what }));

  const renderReactions = (c) => {
    const groups = [];
    for (const r of reactions.filter((x) => x.comment_id === c.id)) {
      const g = groups.find((x) => x.emoji === r.emoji);
      if (g) g.users.push(r.user_id);
      else groups.push({ emoji: r.emoji, users: [r.user_id] });
    }
    if (!groups.length) return null;
    return (
      <div className="reactions">
        {groups.map((g) => (
          <button key={g.emoji} type="button" className={`reaction${g.users.includes(userId) ? ' is-mine' : ''}`}
            disabled={!commentable} onClick={() => toggleReaction(c, g.emoji)}
            title={`${g.users.map(nameOf).join(', ')} reacted with ${g.emoji}`}
            aria-label={`${g.emoji} ${g.users.length}${g.users.includes(userId) ? ', including you' : ''}`}>
            <span>{g.emoji}</span> {g.users.length}
          </button>
        ))}
      </div>
    );
  };

  const renderComment = (c) => {
    const isReply = !!c.parent_id;
    const own = c.author_id === userId;
    const mine = (emoji) => reactions.some((r) => r.comment_id === c.id && r.user_id === userId && r.emoji === emoji);
    const isOpen = open?.id === c.id;
    return (
      <div id={`comment-${c.id}`} className={`comment${isReply ? ' is-reply' : ''}${highlight === c.id ? ' is-highlight' : ''}`}>
        <Avatar profile={c.author} size={isReply ? 24 : 28} />
        <div className="comment-body">
          <div className="comment-head">
            <strong>{c.author?.full_name || 'Someone'}</strong>
            <span className="muted small">{timeAgo(c.created_at)}{c.edited_at ? ' · edited' : ''}</span>
            {c.pinned_at && !isReply && <span className="pin-tag"><Icon.pin width="13" height="13" /> Pinned</span>}
          </div>
          {editing === c.id ? (
            <div className={`comment-box is-editing${editDrag ? ' is-drop' : ''}`} {...editFileProps}>
              <MentionInput ref={editRef} toolbar members={members} initial={c.body} rows={3} autoFocus
                onSubmit={() => saveEdit(c)} onFiles={(list) => files.upload(c.id, checkFiles(list, toast))} aria-label="Edit comment"
                footer={(
                  <div className="comment-actions">
                    <span className="hint">Ctrl + Enter to save</span>
                    <button type="button" className="link-btn" onClick={() => setEditing(null)}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-small" onClick={() => saveEdit(c)}>Save</button>
                  </div>
                )} />
            </div>
          ) : (
            c.body && <RichText text={c.body} className="comment-text" />
          )}
          <CommentFileList files={files.of(c.id)} uploads={files.uploadsFor(c.id)} onRetry={files.retryUpload} onDismiss={files.dismissUpload}
            onOpen={viewer.open} canRemove={canRemoveFile} />
          {renderReactions(c)}
        </div>

        {editing !== c.id && (
          <div className={`comment-bar${isOpen ? ' is-open' : ''}`}>
            {commentable && QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" className={`bar-btn bar-emoji${mine(emoji) ? ' is-on' : ''}`}
                onClick={() => toggleReaction(c, emoji)} aria-label={`React with ${emoji}`} title={`React with ${emoji}`}>{emoji}</button>
            ))}
            {commentable && (
              <span className="menu-wrap">
                <button type="button" className="bar-btn" onClick={() => toggleOpen(c.id, 'emoji')} aria-label="Add a reaction" title="Add a reaction">
                  <Icon.smilePlus />
                </button>
                {isOpen && open.what === 'emoji' && <EmojiPicker onClose={() => setOpen(null)} onPick={(emoji) => toggleReaction(c, emoji)} />}
              </span>
            )}
            {commentable && (
              <button type="button" className="bar-btn bar-reply" onClick={() => setReplyingTo(c.parent_id || c.id)}>
                <Icon.comment width="16" height="16" /> Reply
              </button>
            )}
            <span className="menu-wrap">
              <button type="button" className="bar-btn" onClick={() => toggleOpen(c.id, 'menu')} aria-label="More" title="More" aria-expanded={isOpen && open.what === 'menu'}>
                <Icon.more />
              </button>
              {isOpen && open.what === 'menu' && (
                <Popover onClose={() => setOpen(null)} className="comment-menu" label="Comment options">
                  {editable && !isReply && <button type="button" onClick={() => togglePin(c)}><Icon.pin /> {c.pinned_at ? 'Unpin' : 'Pin to top'}</button>}
                  <button type="button" onClick={() => copyLink(c)}><Icon.link /> Copy comment link</button>
                  <button type="button" onClick={() => toggleFollow(c)}>
                    <Icon.bell /> {following.has(c.parent_id || c.id) ? 'Stop notifications' : 'Get notifications'}
                  </button>
                  {own && commentable && (
                    <>
                      <hr />
                      <button type="button" onClick={() => { setOpen(null); setEditing(c.id); }}><Icon.edit /> Edit</button>
                      <button type="button" className="danger" onClick={() => remove(c)}><Icon.trash /> Delete</button>
                    </>
                  )}
                </Popover>
              )}
            </span>
          </div>
        )}
      </div>
    );
  };

  const tops = comments.filter((c) => !c.parent_id);
  const ordered = [
    ...tops.filter((c) => c.pinned_at).sort((a, b) => b.pinned_at.localeCompare(a.pinned_at)),
    ...tops.filter((c) => !c.pinned_at).sort(byCreated),
  ];

  return (
    <>
      <h4 className="panel-h">Comments</h4>
      <ul className="comments">
        {ordered.map((c) => {
          const replies = comments.filter((x) => x.parent_id === c.id).sort(byCreated);
          return (
            <li key={c.id} className={`thread${c.pinned_at ? ' is-pinned' : ''}`}>
              {renderComment(c)}
              {(replies.length > 0 || replyingTo === c.id) && (
                <ul className="replies">
                  {replies.map((r) => <li key={r.id}>{renderComment(r)}</li>)}
                  {replyingTo === c.id && (
                    <li>
                      <Composer members={members} autoFocus placeholder="Write a reply. Type @ to mention someone." submitLabel="Reply"
                        label="Reply" onCancel={() => setReplyingTo(null)}
                        onPost={async (body, list) => {
                          const ok = await post({ body, files: list, parentId: c.id });
                          if (ok) setReplyingTo(null);
                          return ok;
                        }} />
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
        {comments.length === 0 && <li className="muted small">{commentable ? 'No comments yet. Ask a question or leave an update.' : 'No comments yet.'}</li>}
      </ul>
      {!commentable && <p className="muted small">You're a viewer in this project, so you can read comments but not add them.</p>}
      {commentable && (
        <Composer members={members} label="Comment" placeholder="Write a comment. Type @ to mention someone."
          onPost={(body, list) => post({ body, files: list })} />
      )}
      {viewer.element}
    </>
  );
});

export default Comments;
