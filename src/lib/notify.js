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
