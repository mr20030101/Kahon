import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Files in a completed project or task are deleted this long after it's completed, when a super
// admin has turned auto delete on. Keep in sync with app_settings.auto_delete_after.
export const FILE_CLEANUP_DAYS = 2;

// Whether auto delete is on: one Kahon-wide yes/no, asked once per page load.
let enabledOnce;
export function useFileCleanup() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    enabledOnce ??= supabase.rpc('file_cleanup_enabled').then(({ data }) => !!data);
    enabledOnce.then((on) => live && setEnabled(on));
    return () => { live = false; };
  }, []);
  return enabled;
}

export const cleanupDate = (completedAt) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  .format(new Date(new Date(completedAt || Date.now()).getTime() + FILE_CLEANUP_DAYS * 86_400_000));
