// Unread notifications in the browser tab, like Facebook: a red dot on the favicon, the count
// in the title, and a short chime when a new one arrives. The chime is a per-device choice
// (Settings → Notifications), like the theme, so a shared or quiet computer can stay silent.

const SOUND_KEY = 'kahon-notification-sound';
const CHIMED_KEY = 'kahon-last-chime';
const BASE_TITLE = 'Kahon';
const ICON_SRC = '/svg/mark-small.svg';
const SIZE = 64;

export function getSoundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

// ---------- Favicon badge ----------

let originals = null; // the <link rel="icon"> tags and what they pointed at
let iconImage = null;
let drawn = -1;

function iconLinks() {
  if (!originals) {
    originals = [...document.querySelectorAll('link[rel="icon"]')].map((el) => ({
      el, href: el.getAttribute('href'), type: el.getAttribute('type'),
    }));
  }
  return originals;
}

function loadIcon() {
  if (!iconImage) {
    iconImage = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = ICON_SRC;
    });
  }
  return iconImage;
}

// A red dot in the top-right corner, like Facebook's tab. The count goes in the title.
async function drawBadge() {
  const img = await loadIcon();
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  ctx.beginPath();
  ctx.arc(SIZE - 13, 13, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#F02849';
  ctx.fill();
  return canvas.toDataURL('image/png');
}

/** "(3) Kahon" and a red dot on the favicon while there's anything unread; 0 puts them back. */
export async function setTabBadge(count) {
  if (typeof document === 'undefined') return;
  const n = Math.max(0, count | 0);
  document.title = n ? `(${n > 99 ? '99+' : n}) ${BASE_TITLE}` : BASE_TITLE;
  const dot = n > 0 ? 1 : 0;
  if (dot === drawn) return;
  drawn = dot;
  const links = iconLinks();
  if (!n) {
    for (const { el, href, type } of links) {
      el.setAttribute('href', href);
      if (type) el.setAttribute('type', type);
      else el.removeAttribute('type');
    }
    return;
  }
  try {
    const url = await drawBadge();
    if (drawn !== 1) return; // everything was read while drawing
    for (const { el } of links) {
      el.setAttribute('href', url);
      el.setAttribute('type', 'image/png');
    }
  } catch {
    // The icon didn't load; the count in the title is enough.
  }
}

// ---------- Chime ----------

let audio = null;

// Browsers only allow sound after the person has interacted with the page, so the audio
// context is created (or resumed) on their first click or key press.
function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audio) audio = new Ctx();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockAudio, { capture: true });
  window.addEventListener('keydown', unlockAudio, { capture: true });
}

/** Two soft rising notes. Silent until the page has had a click or key press. */
export function playChime() {
  if (!audio || audio.state !== 'running') return;
  const start = audio.currentTime + 0.01;
  [[880, 0], [1318.5, 0.12]].forEach(([freq, offset]) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = start + offset;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.42);
  });
}

/**
 * Chimes for a notification created at `createdAt`, once across every open Kahon tab: the
 * first tab to take the lock records it, and the others see it's already been played.
 */
export function chimeOnce(createdAt) {
  if (!getSoundOn()) return;
  const run = () => {
    let last = '';
    try {
      last = localStorage.getItem(CHIMED_KEY) || '';
    } catch {
      // No storage: every tab chimes, which is better than none.
    }
    if (last && last >= createdAt) return;
    try {
      localStorage.setItem(CHIMED_KEY, createdAt);
    } catch {
      // ignore
    }
    playChime();
  };
  if (navigator.locks?.request) navigator.locks.request('kahon-chime', run).catch(() => {});
  else run();
}
