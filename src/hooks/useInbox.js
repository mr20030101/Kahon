import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PROFILE_BRIEF } from '../lib/profiles';

const SELECT = `id, kind, read_at, created_at, project_id, task_id,
  actor:profiles!notifications_actor_id_fkey(${PROFILE_BRIEF}),
  task:tasks(id, title, project_id), project:projects(id, name, color), comment:comments(body)`;

// The signed-in person's notifications, kept live.
export function useInbox(userId, { limit = 100 } = {}) {
  const [items, setItems] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('notifications').select(SELECT)
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    setItems(data || []);
  }, [userId, limit]);

  useEffect(() => {
    if (!userId) return undefined;
    load();
    const channel = supabase
      .channel(`inbox-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const markRead = useCallback(async (ids) => {
    if (!ids.length) return;
    const read_at = new Date().toISOString();
    setItems((list) => list?.map((n) => (ids.includes(n.id) ? { ...n, read_at } : n)));
    await supabase.from('notifications').update({ read_at }).in('id', ids);
  }, []);

  const clearRead = useCallback(async () => {
    setItems((list) => list?.filter((n) => !n.read_at));
    await supabase.from('notifications').delete().eq('user_id', userId).not('read_at', 'is', null);
  }, [userId]);

  const unread = items?.filter((n) => !n.read_at).length ?? 0;
  return { items, unread, markRead, clearRead };
}
