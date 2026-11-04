import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { decodeMentions, encodeMentions, plainMentions } from '../lib/richtext';
import { Avatar, Icon } from './ui';
import EmojiPicker, { Popover } from './EmojiPicker';

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp';
const FILE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.odt,.rtf,.txt,.md,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp';

// Toolbar buttons keep the textarea's focus and selection.
const keep = (e) => e.preventDefault();
function Tool({ label, onClick, children, className = '' }) {
  return (
    <button type="button" className={`fmt-btn ${className}`.trim()} onMouseDown={keep} onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

// A comment textarea with @mentions: typing "@" suggests project members. The text shows
// "@Name"; getValue() returns it with mentions encoded as @[Name](user-id) for saving.
// With `toolbar`, it also has formatting buttons and a "+" menu that write the Markdown subset
// RichText shows (lib/richtext.js); `footer` sits at the end of its bottom row, and `onFiles`
// receives images and files picked from the menu. `below` goes between the text and the bottom row.
const MentionInput = forwardRef(function MentionInput(
  { members, initial = '', onSubmit, onTextChange, toolbar = false, footer = null, below = null, onFiles, ...props }, ref,
) {
  const [text, setText] = useState(() => plainMentions(initial));
  const [picked, setPicked] = useState(() => decodeMentions(initial));
  const [query, setQuery] = useState(null); // { start, text } while typing after "@"
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(null); // 'insert' | 'emoji'
  const areaRef = useRef(null);
  const imageRef = useRef(null);
  const fileRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getValue: () => encodeMentions(text, picked),
    clear: () => {
      setText('');
      setPicked([]);
      setQuery(null);
    },
    focus: () => areaRef.current?.focus(),
    isEmpty: () => !text.trim(),
  }));

  const matches = query
    ? members.filter((m) => (m.profile?.full_name || '').toLowerCase().includes(query.text.toLowerCase())).slice(0, 6)
    : [];

  const onChange = (e) => {
    const value = e.target.value;
    setText(value);
    onTextChange?.(value);
    const caret = e.target.selectionStart;
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at !== -1 && (at === 0 || /\s/.test(before[at - 1])) && !/[\n@]/.test(before.slice(at + 1)) && before.length - at <= 40) {
      setQuery({ start: at, text: before.slice(at + 1) });
      setCursor(0);
    } else {
      setQuery(null);
    }
  };

  const pick = (member) => {
    const name = member.profile?.full_name || member.profile?.email;
    const caret = areaRef.current.selectionStart;
    const next = `${text.slice(0, query.start)}@${name} ${text.slice(caret)}`;
    setText(next);
    onTextChange?.(next);
    setPicked((list) => [...list, { name, id: member.user_id }]);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + name.length + 2;
      areaRef.current?.setSelectionRange(pos, pos);
      areaRef.current?.focus();
    });
  };

  // ---- Formatting: each edit replaces the text and puts the selection where typing goes next.
  const apply = (next, from, to = from) => {
    setText(next);
    onTextChange?.(next);
    setQuery(null);
    requestAnimationFrame(() => {
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(from, to);
    });
  };
  const selection = () => [areaRef.current?.selectionStart ?? text.length, areaRef.current?.selectionEnd ?? text.length];

  // **bold** and the like around the selection (or a placeholder); again to take it off.
  const wrap = (mark, placeholder) => {
    const [s, e] = selection();
    const inner = text.slice(s, e);
    if (text.slice(s - mark.length, s) === mark && text.slice(e, e + mark.length) === mark) {
      return apply(text.slice(0, s - mark.length) + inner + text.slice(e + mark.length), s - mark.length, e - mark.length);
    }
    const body = inner || placeholder;
    return apply(text.slice(0, s) + mark + body + mark + text.slice(e), s + mark.length, s + mark.length + body.length);
  };

  const link = () => {
    const [s, e] = selection();
    const inner = text.slice(s, e);
    if (/^https?:\/\/\S+$/.test(inner)) {
      return apply(`${text.slice(0, s)}[link text](${inner})${text.slice(e)}`, s + 1, s + 10);
    }
    const label = inner || 'link text';
    const urlAt = s + label.length + 3;
    return apply(`${text.slice(0, s)}[${label}](https://)${text.slice(e)}`, urlAt, urlAt + 8);
  };

  // A prefix on every selected line ("- ", "1. ", "> ", "## "); again to take it off.
  const prefixLines = (make, has, strip = has) => {
    const [s, e] = selection();
    const from = text.lastIndexOf('\n', s - 1) + 1;
    let to = text.indexOf('\n', e);
    if (to === -1) to = text.length;
    const lines = text.slice(from, to).split('\n');
    const off = lines.every((l) => has.test(l));
    const out = lines.map((l, i) => (off ? l.replace(strip, '') : make(i) + l.replace(strip, ''))).join('\n');
    const next = text.slice(0, from) + out + text.slice(to);
    return lines.length === 1 ? apply(next, from + out.length) : apply(next, from, from + out.length);
  };
  const heading = (level) => prefixLines(() => `${'#'.repeat(level)} `, new RegExp(`^#{${level}}\\s+`), /^#{1,3}\s+/);
  const bullets = () => prefixLines(() => '- ', /^\s*[-*•]\s+/, /^\s*([-*•]|\d+[.)])\s+/);
  const numbers = () => prefixLines((i) => `${i + 1}. `, /^\s*\d+[.)]\s+/, /^\s*([-*•]|\d+[.)])\s+/);
  const quote = () => prefixLines(() => '> ', /^\s*>\s?/);

  // A block on lines of its own; `from`/`to` pick what's selected inside it afterwards.
  const insertBlock = (block, from = block.length, to = from) => {
    const [s, e] = selection();
    const before = text.slice(0, s);
    const after = text.slice(e);
    const pre = before && !before.endsWith('\n') ? '\n' : '';
    const post = after && !after.startsWith('\n') ? '\n' : '';
    apply(before + pre + block + post + after, s + pre.length + from, s + pre.length + to);
  };
  const codeBlock = () => {
    const [s, e] = selection();
    const inner = text.slice(s, e);
    return inner ? insertBlock(`\`\`\`\n${inner}\n\`\`\``, 4, 4 + inner.length) : insertBlock('```\n\n```', 4);
  };
  const insertText = (str) => {
    const [s, e] = selection();
    apply(text.slice(0, s) + str + text.slice(e), s + str.length);
  };
  const mention = () => {
    const [s, e] = selection();
    const lead = s > 0 && !/\s/.test(text[s - 1]) ? ' ' : '';
    const next = `${text.slice(0, s)}${lead}@${text.slice(e)}`;
    apply(next, s + lead.length + 1);
    requestAnimationFrame(() => setQuery({ start: s + lead.length, text: '' }));
  };

  const close = () => setOpen(null);
  const run = (fn) => () => {
    close();
    fn();
  };

  const onKeyDown = (e) => {
    if (matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[cursor]);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return onSubmit?.();
    if (toolbar && (e.metaKey || e.ctrlKey) && !e.altKey) {
      const shortcut = {
        b: () => wrap('**', 'bold text'), i: () => wrap('*', 'italic text'), u: () => wrap('++', 'underlined text'),
        k: link, e: () => wrap('`', 'code'),
      }[e.key.toLowerCase()];
      if (shortcut && !e.shiftKey) {
        e.preventDefault();
        shortcut();
      }
    }
  };

  const pickFiles = (input) => (e) => {
    onFiles?.([...e.target.files]);
    e.target.value = '';
    input.current?.blur();
  };

  return (
    <div className={`mention-input${toolbar ? ' has-toolbar' : ''}`}>
      {toolbar && (
        <div className="fmt-bar" role="toolbar" aria-label="Formatting">
          <Tool label="Bold (Ctrl + B)" onClick={() => wrap('**', 'bold text')}><b>B</b></Tool>
          <Tool label="Italic (Ctrl + I)" onClick={() => wrap('*', 'italic text')}><i>I</i></Tool>
          <Tool label="Underline (Ctrl + U)" onClick={() => wrap('++', 'underlined text')}><u>U</u></Tool>
          <Tool label="Strikethrough" onClick={() => wrap('~~', 'struck text')}><s>S</s></Tool>
          <span className="fmt-sep" />
          <Tool label="Link (Ctrl + K)" onClick={link}><Icon.link /></Tool>
          <Tool label="Highlight" onClick={() => wrap('==', 'highlighted text')}><Icon.highlight /></Tool>
          <Tool label="Code (Ctrl + E)" onClick={() => wrap('`', 'code')}><Icon.code /></Tool>
          <Tool label="Quote" onClick={quote}><Icon.quote /></Tool>
          <span className="fmt-sep" />
          <Tool label="Bulleted list" onClick={bullets}><Icon.list /></Tool>
          <Tool label="Numbered list" onClick={numbers}><Icon.numbered /></Tool>
        </div>
      )}
      <textarea ref={areaRef} value={text} onChange={onChange} onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)} {...props}
        // With the toolbar, the box grows with what's written (up to 14 lines) so tables and lists fit.
        rows={toolbar ? Math.min(14, Math.max(props.rows || 2, text.split('\n').length + 1)) : props.rows} />
      {matches.length > 0 && (
        <ul className="mention-menu" role="listbox">
          {matches.map((m, i) => (
            <li key={m.user_id} role="option" aria-selected={i === cursor}>
              <button type="button" className={i === cursor ? 'is-on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
                <Avatar profile={m.profile} size={22} /> {m.profile?.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {below}
      {toolbar && (
        <div className="fmt-foot">
          <div className="fmt-insert">
            <span className="menu-wrap">
              <Tool label="Insert" className={open === 'insert' ? 'is-on' : ''} onClick={() => setOpen((o) => (o === 'insert' ? null : 'insert'))}>
                <Icon.plus />
              </Tool>
              {open === 'insert' && (
                <Popover onClose={close} className="insert-menu" label="Insert">
                  <button type="button" onMouseDown={keep} onClick={run(() => heading(1))}><span className="fmt-h">H<sub>1</sub></span> Large heading</button>
                  <button type="button" onMouseDown={keep} onClick={run(() => heading(2))}><span className="fmt-h">H<sub>2</sub></span> Medium heading</button>
                  <button type="button" onMouseDown={keep} onClick={run(() => heading(3))}><span className="fmt-h">H<sub>3</sub></span> Small heading</button>
                  <hr />
                  <button type="button" onMouseDown={keep} onClick={run(bullets)}><Icon.list /> Bulleted list</button>
                  <button type="button" onMouseDown={keep} onClick={run(numbers)}><Icon.numbered /> Numbered list</button>
                  <hr />
                  <button type="button" onMouseDown={keep} onClick={run(mention)}><Icon.at /> Mention</button>
                  <button type="button" onMouseDown={keep} onClick={() => setOpen('emoji')}><Icon.smile /> Emoji</button>
                  <button type="button" onMouseDown={keep} onClick={run(() => insertBlock('https://', 0, 8))} title="A YouTube, Vimeo or Loom link on its own line shows the video">
                    <Icon.link /> Embed link
                  </button>
                  <hr />
                  <button type="button" onMouseDown={keep} onClick={run(() => insertBlock('| Column 1 | Column 2 |\n| --- | --- |\n|  |  |', 2, 10))}><Icon.table /> Table</button>
                  <button type="button" onMouseDown={keep} onClick={run(() => insertBlock('---\n', 4))}><Icon.divider /> Divider</button>
                  <button type="button" onMouseDown={keep} onClick={run(quote)}><Icon.quote /> Quote</button>
                  <button type="button" onMouseDown={keep} onClick={run(codeBlock)}><Icon.codeBlock /> Code block</button>
                  {onFiles && (
                    <>
                      <hr />
                      <button type="button" onClick={run(() => imageRef.current?.click())}><Icon.image /> Image</button>
                      <button type="button" onClick={run(() => fileRef.current?.click())}><Icon.paperclip /> Attach files</button>
                    </>
                  )}
                </Popover>
              )}
            </span>
            <span className="menu-wrap">
              <Tool label="Emoji" className={open === 'emoji' ? 'is-on' : ''} onClick={() => setOpen((o) => (o === 'emoji' ? null : 'emoji'))}>
                <Icon.smile />
              </Tool>
              {open === 'emoji' && <EmojiPicker onClose={close} onPick={(emoji) => { close(); insertText(emoji); }} />}
            </span>
            <Tool label="Mention someone" onClick={mention}><Icon.at /></Tool>
          </div>
          {footer}
        </div>
      )}
      {onFiles && (
        <>
          <input ref={imageRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={pickFiles(imageRef)} />
          <input ref={fileRef} type="file" accept={FILE_ACCEPT} multiple hidden onChange={pickFiles(fileRef)} />
        </>
      )}
    </div>
  );
});

export default MentionInput;
