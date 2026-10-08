import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const refreshProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, color, owner_id, created_at, archived_at')
      .order('created_at');
    if (!error) setProjects(data);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    refreshProjects();

    const channel = supabase
      .channel(`workspace-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `user_id=eq.${user.id}` }, refreshProjects)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects' }, refreshProjects)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'projects' }, refreshProjects)
      .subscribe();

    window.addEventListener('focus', refreshProjects);
    return () => {
      window.removeEventListener('focus', refreshProjects);
      supabase.removeChannel(channel);
    };
  }, [user, refreshProjects]);

  return (
    <WorkspaceContext.Provider value={{ projects, loaded, refreshProjects }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);
