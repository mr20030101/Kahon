import { useEffect, useRef } from 'react';
import { createTimeline, stagger } from 'animejs';
import { reducedMotion } from '../lib/motion';

const PHRASES = [
  'Every task in its box.',
  'Every box where the team can see it.',
  'Plan the week. Ship the work.',
  'Drag it, drop it, done.',
  'Big projects, broken into small boxes.',
  'Fewer status meetings. More finished tasks.',
  'One board for the whole team.',
];

const TYPE_MS = 55;
const ERASE_MS = 22;
const HOLD_MS = 1800;

// Mini board geometry (px); must match .mini-board in styles.css.
const SLOT = 52;
const COL_STEP = 144;

// Static cards per column; the moving card starts at the top of "To do".
const COLUMNS = [
  { name: 'To do', cards: [{ w: 70 }, { w: 55 }] },
  { name: 'Doing', cards: [{ w: 62 }] },
  { name: 'Done', cards: [{ w: 48, done: true }, { w: 66, done: true }] },
];

function MiniCard({ w, done, className = '', style }) {
  return (
    <div className={`mini-card ${className}`.trim()} style={style}>
      <span className={`mini-check${done ? ' is-done' : ''}`} />
      <span className="mini-line" style={{ width: `${w}%` }} />
      <span className="mini-avatar" />
    </div>
  );
}

export default function AuthArt() {
  const boardRef = useRef(null);
  const textRef = useRef(null);

  // One card travels To do -> Doing -> Done while the others make room, then the loop resets.
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const q = (sel) => boardRef.current.querySelectorAll(sel);
    const mover = q('.mini-card.is-moving')[0];
    const check = mover.querySelector('.mini-check');
    const [todo, doing, done] = [q('[data-col="0"] .mini-card.is-static'), q('[data-col="1"] .mini-card.is-static'), q('[data-col="2"] .mini-card.is-static')];
    const liftUp = { scale: 1.06, rotate: -3, duration: 260, ease: 'outBack(2)' };
    const putDown = { scale: 1, rotate: 0, duration: 650, ease: 'outElastic(1, .6)' };
    const glide = { duration: 700, ease: 'inOutCubic' };
    const shift = { duration: 500, ease: 'inOutQuad' };

    const tl = createTimeline({ loop: true, loopDelay: 400 })
      .set(mover, { x: 0, y: 0, opacity: 0, scale: 0.9, rotate: 0 })
      .set(check, { backgroundColor: 'rgba(61, 190, 107, 0)', borderColor: 'rgba(244, 248, 245, 0.35)' })
      .set([...todo, ...doing, ...done], { y: 0 })
      .add(mover, { opacity: 1, scale: 1, duration: 450, ease: 'outBack(1.6)' }, 300)
      // To do -> Doing
      .add(mover, liftUp, '+=900')
      .add(mover, { x: COL_STEP, ...glide })
      .add(todo, { y: -SLOT, delay: stagger(60), ...shift }, '<<+=150')
      .add(doing, { y: SLOT, ...shift }, '<<')
      .add(mover, putDown, '<<+=550')
      // Doing -> Done
      .add(mover, liftUp, '+=500')
      .add(mover, { x: COL_STEP * 2, ...glide })
      .add(doing, { y: 0, ...shift }, '<<+=150')
      .add(done, { y: SLOT, delay: stagger(60), ...shift }, '<<')
      .add(mover, putDown, '<<+=550')
      .add(check, { backgroundColor: 'rgba(61, 190, 107, 1)', borderColor: 'rgba(61, 190, 107, 1)', duration: 300, ease: 'outQuad' }, '<<+=150')
      // Clear the board for the next round
      .add(mover, { opacity: 0, scale: 0.9, duration: 400, ease: 'inQuad' }, '+=1400')
      .add([...todo, ...done], { y: 0, ...shift }, '<<+=200');

    return () => tl.revert();
  }, []);

  // Typewriter: type a phrase, hold, erase, move to the next one.
  useEffect(() => {
    const el = textRef.current;
    if (reducedMotion()) {
      let i = 0;
      el.textContent = PHRASES[0];
      const id = setInterval(() => {
        i = (i + 1) % PHRASES.length;
        el.textContent = PHRASES[i];
      }, 3500);
      return () => clearInterval(id);
    }

    const tl = createTimeline({ loop: true });
    for (const phrase of PHRASES) {
      const cursor = { n: 0 };
      const render = () => { el.textContent = phrase.slice(0, Math.round(cursor.n)); };
      tl.add(cursor, { n: phrase.length, duration: phrase.length * TYPE_MS, ease: 'linear', onUpdate: render })
        .add(cursor, { n: 0, duration: phrase.length * ERASE_MS, delay: HOLD_MS, ease: 'linear', onUpdate: render });
    }
    return () => tl.revert();
  }, []);

  return (
    <div className="auth-art" aria-hidden="true">
      <div className="mini-board" ref={boardRef}>
        {COLUMNS.map((col, c) => (
          <div key={col.name} className="mini-col" data-col={c}>
            <span className="mini-col-name">{col.name}</span>
            <div className="mini-slots">
              {/* "To do" holds the moving card in its first slot. */}
              {col.cards.map((card, i) => (
                <MiniCard key={i} {...card} className="is-static" style={{ top: (i + (c === 0 ? 1 : 0)) * SLOT }} />
              ))}
            </div>
          </div>
        ))}
        <MiniCard w={78} className="is-moving" />
      </div>
      <p className="typed"><span ref={textRef} /><span className="caret" /></p>
    </div>
  );
}
