import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDue } from '../lib/dates';
import { useWorkspace } from '../context/WorkspaceContext';
import { Icon } from './ui';

// Opens the search from anywhere (the sidebar's Search item) without passing props around.
export const openSearch = () => window.dispatchEvent(new Event('kahon:search'));

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const SEARCH_SHORTCUT = isMac ? '⌘K' : 'Ctrl K';

// Search every task in the current workspace by title or ID. Ctrl/⌘ K or the sidebar opens it;
// arrows move, Enter opens the task, Escape closes. The search_tasks RPC only returns tasks
// in projects the person is a member of.
export default function SearchPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('kahon:search', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('kahon:search', onOpen);
    };
  }, []);

  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}

function Palette({ onClose }) {
  const navigate = useNavigate();
  const { current } = useWorkspace();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [active, setActive] = useState(0);
  const latest = useRef(0);
  const listRef = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !current) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }
    setStatus('loading');
    const run = ++latest.current;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('search_tasks', { p_query: q, p_workspace: current.id });
      if (run !== latest.current) return; // a newer search has started
      setResults(data || []);
      setActive(0);
      setStatus(error ? 'error' : 'done');
    }, 200);
    return () => clearTimeout(timer);
  }, [query, current]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (r) => {
    onClose();
    navigate(`/p/${r.project_id}?task=${r.id}`);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  };

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-palette" role="dialog" aria-modal="true" aria-label="Search tasks">
        <div className="search-input">
          <Icon.search />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder={`Search tasks in ${current?.name || 'this workspace'} by title or ID, e.g. 866b1c2jx`}
            role="combobox" aria-expanded={results.length > 0} aria-controls="search-results"
            aria-activedescendant={results[active] ? `search-${results[active].id}` : undefined} />
          <kbd>Esc</kbd>
        </div>

        <ul className="search-results" id="search-results" role="listbox" ref={listRef}>
          {results.map((r, i) => (
            <li key={r.id} id={`search-${r.id}`} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }}>
              <span className={`search-check${r.completed ? ' is-done' : ''}`} aria-label={r.completed ? 'Completed' : 'Open'}>
                {r.completed && <Icon.check />}
              </span>
              <span className="search-copy">
                <span className={`search-title${r.completed ? ' is-done' : ''}`}>
                  {r.parent_title && <span className="muted">{r.parent_title} › </span>}
                  {r.title}
                </span>
                <span className="search-meta">
                  <span className="dot" style={{ background: r.project_color }} />
                  {r.project_name}
                  {r.section_name && <> · {r.section_name}</>}
                  {r.project_archived && <> · Archived</>}
                  {r.due_date && <> · Due {formatDue(r.due_date)}</>}
                  <span className="search-id">{r.short_id}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>

        {status === 'idle' && <p className="search-note muted small">Type at least 2 letters, or a task ID like 866b1c2jx (Copy task ID in a task's ⋯ menu).</p>}
        {status === 'loading' && results.length === 0 && <p className="search-note muted small">Searching…</p>}
        {status === 'done' && results.length === 0 && <p className="search-note muted small">No tasks match “{query.trim()}”.</p>}
        {status === 'error' && <p className="search-note muted small">Search didn't work. Try again in a moment.</p>}
        {status === 'done' && results.length === 30 && <p className="search-note muted small">Showing the first 30. Type more to narrow it down.</p>}
      </div>
    </div>
  );
}
