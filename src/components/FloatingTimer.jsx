import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNow, useTimer } from '../context/TimerContext';
import { entrySeconds, formatClock } from '../lib/duration';
import { Icon } from './ui';

// Your running timer, floating over every page: the task (opens it), the clock, and Stop.
// Drag it by any part to wherever it's out of the way (a click still opens the task or presses
// a button; it only moves once dragged a few pixels). It remembers the spot, and whether it's
// shrunk to just the clock, in this browser.

const KEY = 'kahon:floating-timer';
const MARGIN = 12;
// How far the pointer moves before a press becomes a drag rather than a click.
const THRESHOLD = 4;

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
  const project = Array.isArray(task?.project) ? task.project[0] : task?.project;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, start: pos, id: e.pointerId, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < THRESHOLD) return;
      d.moved = true;
      ref.current?.setPointerCapture(d.id);
    }
    setPos(clamp({ right: d.start.right - dx, bottom: d.start.bottom - dy }, ref.current));
  };
  const onPointerUp = () => {
    // A drag that ends over the task link or a button shouldn't also click it.
    if (drag.current?.moved) {
      const swallow = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
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
      role="status" aria-label={`Timer running${task ? ` on ${task.title}` : ''}: ${elapsed}`} title="Drag to move"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDragStart={(e) => e.preventDefault()}>
      {/* The stopwatch, with a light that pulses while it runs. Also the keyboard handle for moving. */}
      <span className="floating-icon" role="button" tabIndex={0} aria-label="Move the timer (drag it, or use the arrow keys)"
        onKeyDown={onKeyDown}>
        <Icon.stopwatch width="20" height="20" />
        <span className="floating-pulse" aria-hidden="true" />
      </span>
      {!small && (
        <span className="floating-what">
          <span className="floating-project">
            {project && <span className="floating-swatch" style={{ background: project.color }} aria-hidden="true" />}
            <span className="truncate">{project?.name ?? 'Tracking time'}</span>
          </span>
          {task
            ? (
              <Link to={`/p/${task.project_id}?task=${task.id}`} className="floating-task" title={`Open "${task.title}"`} draggable={false}>
                <span className="truncate">{task.title}</span>
              </Link>
            )
            : <span className="floating-task">Timer</span>}
        </span>
      )}
      <span className="floating-clock">{elapsed}</span>
      <button type="button" className="floating-stop" onClick={stop} aria-label={`Stop the timer (${elapsed})`} title="Stop timer">
        <Icon.stop width="13" height="13" />
      </button>
      {/* On the opposite corner from Stop, so shrinking it can't stop the timer by a near miss. */}
      <button type="button" className="floating-size" onClick={() => setSmall((v) => !v)}
        aria-label={small ? 'Show the task name' : 'Shrink to just the clock'} title={small ? 'Expand' : 'Shrink'}>
        {small ? <Icon.plus width="12" height="12" /> : <span className="floating-minus" aria-hidden="true" />}
      </button>
    </div>
  );
}
