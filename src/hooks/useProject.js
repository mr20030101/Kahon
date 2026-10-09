import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { byPosition } from '../lib/position';
import { useToast } from '../context/ToastContext';
import { removeAttachmentFiles } from '../components/Attachments';
import { notify, notifyTaskUpdate } from '../lib/notify';
import { PROFILE_BRIEF } from '../lib/profiles';

const EMPTY = {
  loading: true, error: null, project: null, sections: [], tasks: [], members: [],
  labels: [], taskLabels: [], extraAssignees: [],
};

const MEMBER_SELECT = `role, user_id, profile:profiles(${PROFILE_BRIEF})`;

export function useProject(projectId) {
  const toast = useToast();
  const [state, setState] = useState(EMPTY);
  const ref = useRef(state);
  ref.current = state;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState(EMPTY);
    const [p, s, t, m] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('sections').select('*').eq('project_id', projectId).order('position'),
      supabase.from('tasks').select('*').eq('project_id', projectId).order('position'),
      supabase.from('project_members').select(MEMBER_SELECT).eq('project_id', projectId),
    ]);
    const err = p.error || s.error || t.error || m.error;
    if (err) {
      setState((st) => ({ ...st, loading: false, error: err.message }));
      return;
    }
    if (!p.data) {
      setState({ ...EMPTY, loading: false, error: 'not-found' });
      return;
    }
    setState((st) => ({ ...st, loading: false, error: null, project: p.data, sections: s.data, tasks: t.data, members: m.data }));
    loadLinks();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Labels, which tasks carry them, and extra assignees. Loaded and refreshed separately
  // because their change events can't be filtered by project.
  const loadLinks = useCallback(async () => {
    const [l, tl, ta] = await Promise.all([
      supabase.from('project_labels').select('*').eq('project_id', projectId).order('name'),
      supabase.from('task_labels').select('task_id, label_id, label:project_labels!inner(project_id)').eq('label.project_id', projectId),
      supabase.from('task_assignees').select('task_id, user_id, task:tasks!inner(project_id)').eq('task.project_id', projectId),
    ]);
    setState((st) => ({
      ...st,
      labels: l.data || [],
      taskLabels: (tl.data || []).map(({ task_id, label_id }) => ({ task_id, label_id })),
      extraAssignees: (ta.data || []).map(({ task_id, user_id }) => ({ task_id, user_id })),
    }));
  }, [projectId]);

  const upsert = useCallback((key, row) => {
    setState((st) => {
      const list = st[key];
      const exists = list.some((x) => x.id === row.id);
      const next = exists ? list.map((x) => (x.id === row.id ? { ...x, ...row } : x)) : [...list, row];
      return { ...st, [key]: next.sort(byPosition) };
    });
  }, []);

  const remove = useCallback((key, id) => {
    setState((st) => ({ ...st, [key]: st[key].filter((x) => x.id !== id) }));
  }, []);

  useEffect(() => {
    load();
    const onRow = (key) => ({ eventType, new: row, old }) => {
      if (eventType === 'DELETE') remove(key, old.id);
      else upsert(key, row);
    };
    const reloadQuiet = () => load(true);
    let linksTimer;
    const reloadLinks = () => {
      clearTimeout(linksTimer);
      linksTimer = setTimeout(loadLinks, 150);
    };

    const channel = supabase
      .channel(`project-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` }, onRow('tasks'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` }, onRow('tasks'))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, onRow('tasks'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sections', filter: `project_id=eq.${projectId}` }, onRow('sections'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sections', filter: `project_id=eq.${projectId}` }, onRow('sections'))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sections' }, onRow('sections'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${projectId}` }, reloadQuiet)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_labels', filter: `project_id=eq.${projectId}` }, reloadLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_labels' }, reloadLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, reloadLinks)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, ({ new: row }) =>
        setState((st) => ({ ...st, project: { ...st.project, ...row } })))
      .subscribe();

    return () => {
      clearTimeout(linksTimer);
      supabase.removeChannel(channel);
    };
  }, [projectId, load, loadLinks, upsert, remove]);

  const fail = useCallback((error) => {
    toast(error?.message || 'That change did not save. Showing the latest data.', 'error');
    load(true);
  }, [toast, load]);

  // ---------- Tasks ----------
  const createTask = useCallback(async ({ section_id, title }) => {
    const siblings = ref.current.tasks.filter((t) => t.section_id === section_id && !t.parent_id);
    const last = siblings.reduce((max, t) => Math.max(max, t.position), 0);
    const { data, error } = await supabase
      .from('tasks')
      .insert({ project_id: projectId, section_id, title, position: last + 1000 })
      .select()
      .single();
    if (error) return fail(error);
    upsert('tasks', data);
    return data;
  }, [projectId, fail, upsert]);

  const updateTask = useCallback(async (id, patch) => {
    upsert('tasks', { id, ...patch });
    // The database completes subtasks along with their parent; show it right away.
    if (patch.completed === true) {
      ref.current.tasks.filter((t) => t.parent_id === id && !t.completed)
        .forEach((t) => upsert('tasks', { id: t.id, completed: true }));
    }
    const { error } = await supabase.from('tasks').update(patch).eq('id', id);
    if (error) return fail(error);
    if (patch.assignee_id) notify('task_assigned', { task_id: id });
    notifyTaskUpdate(id, patch);
  }, [fail, upsert]);

  const patchLocal = useCallback((id, patch) => {
    if (ref.current.tasks.some((t) => t.id === id)) upsert('tasks', { id, ...patch });
  }, [upsert]);

  const removeLocal = useCallback((id) => remove('tasks', id), [remove]);

  // ---------- Sections ----------
  const createSection = useCallback(async (name) => {
    const last = ref.current.sections.reduce((max, s) => Math.max(max, s.position), 0);
    const { data, error } = await supabase
      .from('sections')
      .insert({ project_id: projectId, name, position: last + 1000 })
      .select()
      .single();
    if (error) return fail(error);
    upsert('sections', data);
  }, [projectId, fail, upsert]);

  const renameSection = useCallback(async (id, name) => {
    upsert('sections', { id, name });
    const { error } = await supabase.from('sections').update({ name }).eq('id', id);
    if (error) fail(error);
  }, [fail, upsert]);

  const moveSection = useCallback(async (id, position) => {
    upsert('sections', { id, position });
    const { error } = await supabase.from('sections').update({ position }).eq('id', id);
    if (error) fail(error);
  }, [fail, upsert]);

  const deleteSection = useCallback(async (id) => {
    remove('sections', id);
    setState((st) => ({ ...st, tasks: st.tasks.filter((t) => t.section_id !== id) }));
    await removeAttachmentFiles({ sectionId: id });
    const { error } = await supabase.from('sections').delete().eq('id', id);
    if (error) fail(error);
  }, [fail, remove]);

  // ---------- Project ----------
  const updateProject = useCallback(async (patch) => {
    setState((st) => ({ ...st, project: { ...st.project, ...patch } }));
    const { error } = await supabase.from('projects').update(patch).eq('id', projectId);
    if (error) fail(error);
    return !error;
  }, [projectId, fail]);

  const deleteProject = useCallback(async () => {
    await removeAttachmentFiles({ projectId });
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    if (error) {
      fail(error);
      return false;
    }
    return true;
  }, [projectId, fail]);

  // ---------- Bulk ----------
  const bulkUpdate = useCallback(async (ids, patch) => {
    ids.forEach((id) => upsert('tasks', { id, ...patch }));
    const { error } = await supabase.from('tasks').update(patch).in('id', ids);
    if (error) return fail(error);
    ids.forEach((id) => {
      if (patch.assignee_id) notify('task_assigned', { task_id: id });
      notifyTaskUpdate(id, patch);
    });
  }, [fail, upsert]);

  const bulkDelete = useCallback(async (ids) => {
    const all = ref.current.tasks.filter((t) => ids.includes(t.id) || ids.includes(t.parent_id)).map((t) => t.id);
    all.forEach((id) => remove('tasks', id));
    await removeAttachmentFiles({ taskIds: all });
    const { error } = await supabase.from('tasks').delete().in('id', ids);
    if (error) fail(error);
  }, [fail, remove]);

  // ---------- Labels ----------
  const createLabel = useCallback(async (name, color) => {
    const { data, error } = await supabase.from('project_labels')
      .insert({ project_id: projectId, name: name.trim(), color }).select().single();
    if (error) {
      toast(error.code === '23505' ? 'There is already a label with that name' : error.message, 'error');
      return null;
    }
    setState((st) => ({ ...st, labels: [...st.labels, data].sort((a, b) => a.name.localeCompare(b.name)) }));
    return data;
  }, [projectId, toast]);

  const updateLabel = useCallback(async (id, patch) => {
    setState((st) => ({ ...st, labels: st.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
    const { error } = await supabase.from('project_labels').update(patch).eq('id', id);
    if (error) fail(error);
  }, [fail]);

  const deleteLabel = useCallback(async (id) => {
    setState((st) => ({
      ...st,
      labels: st.labels.filter((l) => l.id !== id),
      taskLabels: st.taskLabels.filter((tl) => tl.label_id !== id),
    }));
    const { error } = await supabase.from('project_labels').delete().eq('id', id);
    if (error) fail(error);
  }, [fail]);

  // ---------- Project lifecycle ----------
  const setArchived = useCallback(async (archived) => {
    const archived_at = archived ? new Date().toISOString() : null;
    setState((st) => ({ ...st, project: { ...st.project, archived_at } }));
    const { error } = await supabase.from('projects').update({ archived_at }).eq('id', projectId);
    if (error) fail(error);
    return !error;
  }, [projectId, fail]);

  const duplicateProject = useCallback(async (name) => {
    const { data, error } = await supabase.rpc('duplicate_project', { p_project: projectId, p_name: name });
    if (error) {
      toast(error.message, 'error');
      return null;
    }
    return data;
  }, [projectId, toast]);

  return {
    ...state,
    reload: () => load(true),
    actions: {
      createTask, updateTask, patchLocal, removeLocal,
      createSection, renameSection, moveSection, deleteSection,
      updateProject, deleteProject, setArchived, duplicateProject,
      bulkUpdate, bulkDelete,
      createLabel, updateLabel, deleteLabel,
    },
  };
}
