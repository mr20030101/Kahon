import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

// Your running timer, shared by the top bar and every task panel. It lives in the database
// (time_entries with no ended_at), so it keeps running across reloads, tabs and devices.
// See supabase/migrations/20261104_task_timer.sql.

const TimerContext = createContext({ running: null, start: async () => {}, stop: async () => {} });

const RUNNING_SELECT = 'id, task_id, user_id, started_at, ended_at, task:tasks(id, title, project_id, project:projects(name, color))';

export function TimerProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const [running, setRunning] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('time_entries').select(RUNNING_SELECT)
      .eq('user_id', user.id).is('ended_at', null).maybeSingle();
    setRunning(data ?? null);
  }, [user.id]);

  useEffect(() => {
    load();
    // Started or stopped in another tab or on another device.
    const channel = supabase
      .channel(`timer-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries', filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id, load]);

  const start = async (task) => {
    const previous = running;
    setRunning({ id: 'starting', task_id: task.id, user_id: user.id, started_at: new Date().toISOString(), ended_at: null, task });
    const { data, error } = await supabase.rpc('start_timer', { p_task: task.id });
    if (error) {
      setRunning(previous);
      return toast(`Couldn't start the timer: ${error.message}`, 'error');
    }
    setRunning({ ...data, task });
    load(); // for the task's project, which the floating timer shows
    if (previous && previous.task_id !== task.id) toast(`Stopped the timer on "${previous.task?.title ?? 'another task'}"`);
  };

  const stop = async () => {
    const previous = running;
    setRunning(null);
    const { error } = await supabase.rpc('stop_timer');
    if (error) {
      setRunning(previous);
      toast(`Couldn't stop the timer: ${error.message}`, 'error');
    }
  };

  return <TimerContext.Provider value={{ running, start, stop }}>{children}</TimerContext.Provider>;
}

export const useTimer = () => useContext(TimerContext);

/** The current time, updated every `ms` while `active`, for clocks that tick. */
export function useNow(active, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}
