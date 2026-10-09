import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Icon } from './ui';

// "Ask AI" in the task panel. The ask-ai Edge Function loads the task itself, asks a model on
// Groq and streams the answer back as plain text, which is shown as it arrives.
const ACTIONS = [
  { kind: 'summarize', label: 'Summarize' },
  { kind: 'next_steps', label: 'Next steps' },
  { kind: 'subtasks', label: 'Suggest subtasks' },
];

// Keep in sync with ERROR_MARK in supabase/functions/ask-ai/index.ts.
const ERROR_MARK = '\u0000';
const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-ai`;

// "- item" lines from a subtask suggestion.
const listItems = (text) => text.split('\n')
  .map((line) => line.match(/^\s*[-*•]\s+(.+)$/)?.[1]?.trim())
  .filter(Boolean)
  .map((item) => item.slice(0, 500));

export default function AskAI({ taskId, canAddSubtasks, onAddSubtasks, onPostComment }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null); // { kind, text, done, error }
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = async (kind, text = '') => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAnswer({ kind, text: '', done: false, error: null });

    try {
      const send = (session) => fetch(FUNCTION_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ task_id: taskId, kind, question: text }),
      });
      const { data: { session } } = await supabase.auth.getSession();
      let res = await send(session);
      // A token that went stale while the tab was idle: refresh it once and retry.
      if (res.status === 401) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed?.session) res = await send(refreshed.session);
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || (res.status === 404 ? 'Ask AI is not deployed yet.' : `Request failed (${res.status})`));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setAnswer((cur) => (cur ? { ...cur, text: cur.text + chunk } : cur));
      }
      // The function marks a failure partway through with ERROR_MARK; what follows is the error.
      setAnswer((cur) => {
        if (!cur) return cur;
        const at = cur.text.indexOf(ERROR_MARK);
        return at === -1 ? { ...cur, done: true }
          : { ...cur, text: cur.text.slice(0, at).trim(), error: cur.text.slice(at + 1).trim(), done: true };
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setAnswer((cur) => ({ ...(cur || { kind }), text: cur?.text || '', done: true, error: err.message }));
    }
  };

  const submit = (e) => {
    e.preventDefault();
    const text = question.trim();
    if (!text) return;
    ask('question', text);
  };

  const suggestions = answer?.kind === 'subtasks' && answer.done ? listItems(answer.text) : [];
  const busy = answer && !answer.done;

  return (
    <section className="ask-ai">
      <h4 className="panel-h"><Icon.sparkle /> Ask AI</h4>
      <div className="ask-actions">
        {ACTIONS.filter((a) => a.kind !== 'subtasks' || canAddSubtasks).map((a) => (
          <button key={a.kind} type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => ask(a.kind)}>
            {a.label}
          </button>
        ))}
      </div>
      <form className="ask-form" onSubmit={submit}>
        <input className="input" value={question} maxLength={2000} placeholder="Ask anything about this task"
          onChange={(e) => setQuestion(e.target.value)} aria-label="Question for the AI" />
        <button className="btn btn-primary" disabled={busy || !question.trim()}>Ask</button>
      </form>

      {answer && (
        <div className="ask-answer" aria-live="polite">
          {answer.text
            ? <p className="ask-text">{answer.text.split(ERROR_MARK)[0]}{busy && <span className="caret" />}</p>
            : busy && <p className="muted small">Reading the task…</p>}
          {answer.error && (
            <>
              <p className="form-error">{answer.error}</p>
              <button type="button" className="link-btn" onClick={() => setAnswer(null)}>Dismiss</button>
            </>
          )}
          {answer.done && !answer.error && answer.text && (
            <div className="ask-answer-actions">
              {suggestions.length > 0 && (
                <button type="button" className="btn btn-primary btn-small" onClick={() => { onAddSubtasks(suggestions); setAnswer(null); }}>
                  Add {suggestions.length} subtask{suggestions.length === 1 ? '' : 's'}
                </button>
              )}
              {onPostComment && (
                <button type="button" className="btn btn-ghost btn-small" onClick={() => { onPostComment(`AI:\n${answer.text.trim()}`); setAnswer(null); }}>
                  Post as comment
                </button>
              )}
              <button type="button" className="link-btn" onClick={() => setAnswer(null)}>Dismiss</button>
            </div>
          )}
          {busy && (
            <button type="button" className="link-btn" onClick={() => { abortRef.current?.abort(); setAnswer((cur) => cur && { ...cur, done: true }); }}>
              Stop
            </button>
          )}
        </div>
      )}
      <p className="hint">The AI reads this task's details, subtasks, comments and attachments (not images), plus the project's description and reference files from About. Answers can be wrong; check before acting on them.</p>
    </section>
  );
}
