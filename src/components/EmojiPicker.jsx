import { useEffect, useRef } from 'react';

/**
 * A small floating panel next to its button. Closes on a click outside it or Escape (without
 * Escape also closing the task panel). Put it inside a `position: relative` wrapper.
 */
export function Popover({ onClose, className = '', children, label }) {
  const ref = useRef(null);
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
  return <div ref={ref} className={`popover ${className}`.trim()} role="dialog" aria-label={label}>{children}</div>;
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
