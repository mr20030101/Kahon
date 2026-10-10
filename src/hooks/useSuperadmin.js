import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Loads a super admin report from an RPC. Checks is_superadmin() first so people without
// access get a clear "denied" instead of an error; the RPC refuses them on its own anyway.
// status: 'loading' | 'ready' | 'denied' | 'error'
export function useSuperadmin(fn, args) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const key = JSON.stringify(args ?? {});

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    const { data: allowed, error: accessError } = await supabase.rpc('is_superadmin');
    if (accessError) {
      setError(accessError.message);
      setStatus('error');
      return;
    }
    if (!allowed) {
      setStatus('denied');
      return;
    }
    const { data: rows, error: loadError } = await supabase.rpc(fn, JSON.parse(key));
    if (loadError) {
      setError(loadError.message);
      setStatus('error');
      return;
    }
    setData(rows);
    setStatus('ready');
  }, [fn, key]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, status, error, load };
}
