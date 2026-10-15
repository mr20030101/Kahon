import { useEffect, useRef } from 'react';
import { chimeOnce, setTabBadge } from '../lib/tabAlerts';

// Keeps the tab's red dot and "(3) Kahon" title in step with the inbox, and chimes when a
// notification arrives while the app is open (not for the ones already there on load).
export function useTabAlerts(items) {
  const seen = useRef(null);

  useEffect(() => {
    if (!items) return;
    const unread = items.filter((n) => !n.read_at);
    setTabBadge(unread.length);

    if (!seen.current) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    // Only recent ones: an older notification can come into the list when a newer one is cleared.
    const recent = Date.now() - 2 * 60_000;
    const fresh = unread.filter((n) => !seen.current.has(n.id) && new Date(n.created_at).getTime() > recent);
    for (const n of items) seen.current.add(n.id);
    if (fresh.length) chimeOnce(fresh.reduce((a, n) => (n.created_at > a ? n.created_at : a), ''));
  }, [items]);

  // Signed out: put the plain tab back.
  useEffect(() => () => setTabBadge(0), []);
}
