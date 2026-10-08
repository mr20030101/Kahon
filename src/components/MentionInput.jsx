import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { decodeMentions, encodeMentions, plainMentions } from '../lib/richtext';
import { Avatar } from './ui';

// A comment textarea with @mentions: typing "@" suggests project members. The text shows
// "@Name"; getValue() returns it with mentions encoded as @[Name](user-id) for saving.
const MentionInput = forwardRef(function MentionInput({ members, initial = '', onSubmit, onTextChange, ...props }, ref) {
  const [text, setText] = useState(() => plainMentions(initial));
  const [picked, setPicked] = useState(() => decodeMentions(initial));
  const [query, setQuery] = useState(null); // { start, text } while typing after "@"
  const [cursor, setCursor] = useState(0);
  const areaRef = useRef(null);

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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit?.();
  };

  return (
    <div className="mention-input">
      <textarea ref={areaRef} value={text} onChange={onChange} onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)} {...props} />
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
    </div>
  );
});

export default MentionInput;
