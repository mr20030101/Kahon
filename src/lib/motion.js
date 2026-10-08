import { animate } from 'animejs';

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Picked-up item: tilt and grow slightly, like lifting a box off the shelf.
export function lift(el, { rotate = -2 } = {}) {
  if (!el || reducedMotion()) return;
  animate(el, { scale: [1, 1.03], rotate: [0, rotate], duration: 320, ease: 'outBack(2)' });
}

// Dropped item: a short bounce where it lands. Runs after dnd-kit's drop animation,
// then removes its inline styles so it never fights the sortable transforms.
export function settle(root, key, { from = { scale: [0.95, 1] }, duration = 700 } = {}) {
  if (!root || reducedMotion()) return;
  setTimeout(() => {
    const els = root.querySelectorAll(`[data-settle="${key}"]`);
    if (!els.length) return;
    animate(els, { ...from, duration, ease: 'outElastic(1, .55)', onComplete: (a) => a.revert() });
  }, 200);
}

// Row highlight for list view, where rows can't be scaled without shifting the table.
export function flash(root, key) {
  if (!root || reducedMotion()) return;
  setTimeout(() => {
    const els = root.querySelectorAll(`[data-settle="${key}"]`);
    if (!els.length) return;
    animate(els, {
      boxShadow: ['inset 3px 0 0 0 rgba(61, 190, 107, 1)', 'inset 3px 0 0 0 rgba(61, 190, 107, 0)'],
      backgroundColor: ['rgba(61, 190, 107, 0.16)', 'rgba(61, 190, 107, 0)'],
      duration: 900,
      ease: 'outQuad',
      onComplete: (a) => a.revert(),
    });
  }, 200);
}
