import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNow, useTimer } from '../context/TimerContext';
import { entrySeconds, formatClock } from '../lib/duration';
import { Icon } from './ui';

// Your running timer, floating over every page: the task (opens it), the clock, and Stop.
// Drag it by its grip to wherever it's out of the way; it remembers the spot, and whether it's
// shrunk to just the clock, in this browser.

const KEY = 'kahon:floating-timer';
const MARGIN = 12;

const saved = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
};
const save = (value) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage: it just won't remember.
  }
};

// Kept inside the window, measured from the bottom-right corner so it stays put on resize.
const clamp = (pos, el) => {
  const w = el?.offsetWidth ?? 220;
  const h = el?.offsetHeight ?? 48;
  return {
    right: Math.min(Math.max(MARGIN, pos.right), window.innerWidth - w - MARGIN),
    bottom: Math.min(Math.max(MARGIN, pos.bottom), window.innerHeight - h - MARGIN),
  };
};

export default function FloatingTimer() {
  const { running, stop } = useTimer();
  const now = useNow(!!running);
  const ref = useRef(null);
  const drag = useRef(null);
  const [pos, setPos] = useState(() => saved().pos ?? { right: 20, bottom: 20 });
  const [small, setSmall] = useState(() => !!saved().small);

  useEffect(() => save({ pos, small }), [pos, small]);

  // Back inside the window when it gets smaller, or when the timer shows up somewhere odd.
  useEffect(() => {
    if (!running) return undefined;
    const fit = () => setPos((p) => clamp(p, ref.current));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [running, small]);

  if (!running) return null;
  const elapsed = formatClock(entrySeconds(running, now));
  const task = running.task;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: pos };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const { x, y, start } = drag.current;
    setPos(clamp({ right: start.right - (e.clientX - x), bottom: start.bottom - (e.clientY - y) }, ref.current));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  // The grip also moves it with the arrow keys, for keyboards.
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 40 : 10;
    const move = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!move) return;
    e.preventDefault();
    setPos((p) => clamp({ right: p.right + move[0], bottom: p.bottom + move[1] }, ref.current));
  };

  return (
    <div ref={ref} className={`floating-timer${small ? ' is-small' : ''}`} style={{ right: pos.right, bottom: pos.bottom }}
      role="status" aria-label={`Timer running${task ? ` on ${task.title}` : ''}: ${elapsed}`}>
      <span className="floating-grip" role="button" tabIndex={0} aria-label="Move the timer (drag, or use the arrow keys)" title="Drag to move"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
        <span className="timer-dot" aria-hidden="true" />
      </span>
      {!small && (
        task
          ? <Link to={`/p/${task.project_id}?task=${task.id}`} className="floating-task" title={`Open "${task.title}"`}><span className="truncate">{task.title}</span></Link>
          : <span className="floating-task">Timer</span>
      )}
      <span className="floating-clock">{elapsed}</span>
      <button type="button" className="icon-btn floating-stop" onClick={stop} aria-label={`Stop the timer (${elapsed})`} title="Stop timer">
        <Icon.stop width="14" height="14" />
      </button>
      <button type="button" className="icon-btn floating-size" onClick={() => setSmall((v) => !v)}
        aria-label={small ? 'Show the task name' : 'Shrink to just the clock'} title={small ? 'Expand' : 'Shrink'}>
        <Icon.chevron width="14" height="14" />
      </button>
    </div>
  );
}
