import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

// The workspaces (companies) you're in, the one the sidebar shows, and your projects in all of
// them. Home, My tasks and Inbox span every workspace, narrowed by `scope` ('all' or an id).

const WorkspaceContext = createContext(null);

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the choice just isn't remembered.
  }
};

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]); // [{ id, name, color, role }]
  const [projects, setProjects] = useState([]);
  const [invitations, setInvitations] = useState([]); // waiting for you to join or decline
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState(() => (user ? read(`kahon.workspace.${user.id}`) : null));
  const [scope, setScopeState] = useState(() => (user ? read(`kahon.scope.${user.id}`) : null) || 'all');

  const refresh = useCallback(async () => {
    if (!user) return;
    const [ws, pr, inv] = await Promise.all([
      supabase.from('workspace_members').select('role, workspace:workspaces(id, name, color)').eq('user_id', user.id),
      supabase.from('projects').select('id, name, color, owner_id, workspace_id, created_at, archived_at').order('created_at'),
      supabase.rpc('my_workspace_invitations'),
    ]);
    if (!inv.error) setInvitations(inv.data || []);
    if (!ws.error) {
      setWorkspaces((ws.data || []).filter((m) => m.workspace)
        .map((m) => ({ ...m.workspace, role: m.role }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    }
    if (!pr.error) setProjects(pr.data);
    setLoaded(true);
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    refresh();

    const channel = supabase
      .channel(`workspace-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `user_id=eq.${user.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_members', filter: `user_id=eq.${user.id}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workspaces' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects' }, refresh)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'projects' }, refresh)
      .subscribe();

    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  // The remembered workspace while you're still in it, otherwise the first one.
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null;

  const setCurrent = useCallback((id) => {
    setCurrentId(id);
    if (user) write(`kahon.workspace.${user.id}`, id);
  }, [user]);

  // Accepting switches to the workspace you just joined. Resolves to an error or null.
  const respond = useCallback(async (invite, accept) => {
    const { error } = await supabase.rpc('respond_workspace_invitation', { p_invitation: invite.id, p_accept: accept });
    await refresh();
    if (!error && accept) setCurrent(invite.workspace_id);
    return error;
  }, [refresh, setCurrent]);

  const setScope = useCallback((value) => {
    setScopeState(value);
    if (user) write(`kahon.scope.${user.id}`, value);
  }, [user]);

  const value = useMemo(() => {
    const byId = Object.fromEntries(workspaces.map((w) => [w.id, w]));
    const projectWorkspace = Object.fromEntries(projects.map((p) => [p.id, p.workspace_id]));
    // A scope for a workspace you've since left falls back to all.
    const activeScope = scope !== 'all' && byId[scope] ? scope : 'all';
    return {
      workspaces,
      current,
      setCurrent,
      isAdmin: current?.role === 'admin',
      projects,
      currentProjects: current ? projects.filter((p) => p.workspace_id === current.id) : [],
      loaded,
      invitations,
      respond,
      refresh,
      refreshProjects: refresh,
      scope: activeScope,
      setScope,
      inScope: (projectId) => activeScope === 'all' || projectWorkspace[projectId] === activeScope,
      // The workspace a project is in, for tags; only worth showing when you're in several.
      workspaceOf: (projectId) => (workspaces.length > 1 ? byId[projectWorkspace[projectId]] ?? null : null),
    };
  }, [workspaces, current, setCurrent, projects, loaded, invitations, respond, refresh, scope, setScope]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => useContext(WorkspaceContext);
