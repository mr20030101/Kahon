import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A small floating panel next to its button. Closes on a click outside it or Escape (without
 * Escape also closing the task panel). Put it inside a `position: relative` wrapper.
 */
export function Popover({ onClose, className = '', children, label }) {
  const ref = useRef(null);
  const [flip, setFlip] = useState('');
  const [maxHeight, setMaxHeight] = useState(null);
  // Opens up or down (as its class says) unless that runs out of the scrolling area or window,
  // in which case it opens the other way, whichever side has more room.
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;
    let box = { top: 0, bottom: window.innerHeight };
    for (let p = anchor.parentElement; p; p = p.parentElement) {
      if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) {
        const r = p.getBoundingClientRect();
        box = { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) };
        break;
      }
    }
    const a = anchor.getBoundingClientRect();
    const h = el.getBoundingClientRect().height;
    const above = a.top - box.top;
    const below = box.bottom - a.bottom;
    const opensUp = getComputedStyle(el).bottom !== 'auto';
    let up = opensUp;
    if (opensUp && above < h + 8 && below > above) up = false;
    else if (!opensUp && below < h + 8 && above > below) up = true;
    if (up !== opensUp) setFlip(up ? 'open-up' : 'open-down');
    // Still too tall for the side it opens on: it scrolls inside instead of running off.
    const room = (up ? above : below) - 12;
    if (h > room) setMaxHeight(Math.max(140, room));
  }, []);
  useEffect(() => {
    const onDown = (e) => {
      // The button that opened it toggles it itself.
      if (!ref.current?.parentElement?.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`popover ${className} ${flip}`.trim()} role="dialog" aria-label={label}
      style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      {children}
    </div>
  );
}

// The reactions offered in the comment hover bar, and the emoji picker's set.
export const QUICK_REACTIONS = ['👍', '👀', '🙌'];
export const EMOJI = [
  ['Smileys', '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😍 🥰 😘 😎 🤩 🥳 🤔 🤨 😐 😑 😶 🙄 😏 😬 😮 😯 😲 😳 🥺 😢 😭 😤 😠 😡 🤯 😱 😴 🤒 🤗 🤭 🫡 🫠'],
  ['Hands', '👍 👎 👏 🙌 👐 🙏 🤝 👌 🤌 ✌️ 🤞 🤟 🤘 👋 ✋ 🖐️ 👊 ✊ 💪 👈 👉 👆 👇 ☝️ ✍️ 🫶'],
  ['Things', '🎉 🎊 ✨ 🔥 💯 ✅ ❌ ⚠️ ❗ ❓ 💡 📌 📎 📝 📅 ⏰ ⏳ 🚀 🎯 🏁 🐛 🔧 🛠️ 📦 💬 👀 💰 📈 📉 🔒 🔑 ⭐ 🌟 ❤️ 💔 💚 💙 💜 🧡 💛 🖤'],
].map(([name, list]) => [name, list.split(' ')]);

export default function EmojiPicker({ onPick, onClose }) {
  return (
    <Popover onClose={onClose} className="emoji-picker" label="Pick an emoji">
      {EMOJI.map(([name, list]) => (
        <section key={name}>
          <h5>{name}</h5>
          <div className="emoji-grid">
            {list.map((e) => (
              <button key={e} type="button" onClick={() => onPick(e)} aria-label={e}>{e}</button>
            ))}
          </div>
        </section>
      ))}
    </Popover>
  );
}
