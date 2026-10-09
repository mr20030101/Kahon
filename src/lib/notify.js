import { supabase } from './supabase';

// Ask the notify Edge Function to email whoever this event concerns. Fire and forget:
// the function picks the recipients itself, and a missing or failing function never
// blocks the action that triggered it.
export function notify(type, payload) {
  if (!supabase) return;
  supabase.functions
    .invoke('notify', { body: { type, ...payload } })
    .then(({ error }) => {
      if (error) console.warn(`[notify] ${type}:`, error.message);
    })
    .catch((err) => console.warn(`[notify] ${type}:`, err.message));
}

// Fields whose changes are worth telling a task's assignees about. Reordering (position)
// alone isn't. Mirrors the tasks_notify_update trigger, which fills the inbox.
const WATCHED = ['title', 'description', 'assignee_id', 'due_date', 'priority', 'completed', 'section_id', 'recurrence'];

// Email a task's assignees after a saved change. The function dedupes, so calling this on
// every edit sends one email for a run of them.
export function notifyTaskUpdate(taskId, patch) {
  if (Object.keys(patch).some((key) => WATCHED.includes(key))) notify('task_updated', { task_id: taskId });
}
