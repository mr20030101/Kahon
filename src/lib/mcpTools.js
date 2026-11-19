// The tools Kahon's MCP server (src/lib/mcp.js) offers Claude. Each runs with a Supabase client
// signed in as the person who connected, so row level security decides what they can see and
// change, exactly as in the app. Read and write only: no deletes, no member or role changes.
// Server only.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID = /^#?[0-9a-z]{9}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['low', 'medium', 'high'];
const PERSON = 'id, full_name, email';

/** A mistake in the arguments or a refused change: shown to Claude as a tool error. */
export class ToolError extends Error {}

const fail = (message) => {
  throw new ToolError(message);
};

function check(error) {
  if (error) fail(error.message || 'The database refused that.');
}

function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) fail(`${name} must be an id (a UUID).`);
  return value.toLowerCase();
}

function text(value, name, { max, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') fail(`${name} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${name} can't be empty.`);
  if (max && trimmed.length > max) fail(`${name} is longer than ${max} characters.`);
  return trimmed;
}

function date(value, name) {
  if (value === null) return null;
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail(`${name} must be a date written YYYY-MM-DD, or null to clear it.`);
  }
  return value;
}

function priority(value) {
  if (value === null) return null;
  if (!PRIORITIES.includes(value)) fail('priority must be "low", "medium", "high", or null to clear it.');
  return value;
}

function person(value, user) {
  if (value === null) return null;
  if (value === 'me') return user.id;
  return uuid(value, 'assignee_id');
}

const personName = (p) => (p ? p.full_name || p.email : null);

export function taskUrl(appUrl, task) {
  return appUrl ? `${appUrl}/p/${task.project_id}?task=${task.id}` : undefined;
}

/** Finds a task by its id or the 9-character task ID shown in the app (e.g. "#a1b2c3d4e"). */
async function findTask(sb, ref, columns = '*') {
  if (typeof ref !== 'string') fail('task_id is required.');
  const value = ref.trim();
  let query = sb.from('tasks').select(columns);
  if (UUID.test(value)) query = query.eq('id', value.toLowerCase());
  else if (SHORT_ID.test(value)) query = query.eq('short_id', value.replace(/^#/, '').toLowerCase());
  else fail('task_id must be a task id (UUID) or the 9-character task ID shown in Kahon.');
  const { data, error } = await query.maybeSingle();
  check(error);
  if (!data) fail('No task with that id, or you are not a member of its project.');
  return data;
}

async function endOfSection(sb, projectId, sectionId, parentId = null) {
  let query = sb.from('tasks').select('position').eq('project_id', projectId)
    .order('position', { ascending: false }).limit(1);
  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
  query = sectionId ? query.eq('section_id', sectionId) : query.is('section_id', null);
  const { data, error } = await query;
  check(error);
  return (data?.[0]?.position ?? 0) + 1000;
}

async function sectionOf(sb, projectId, sectionId) {
  const { data, error } = await sb.from('sections').select('id').eq('id', sectionId).eq('project_id', projectId).maybeSingle();
  check(error);
  if (!data) fail('That section is not in this task\'s project. get_project lists the sections.');
  return data.id;
}

const shapeTask = (t, appUrl) => ({
  id: t.id,
  task_id: t.short_id,
  title: t.title,
  completed: t.completed,
  priority: t.priority,
  due_date: t.due_date,
  assignee: t.assignee ? { id: t.assignee.id, name: personName(t.assignee) } : null,
  section: t.section?.name ?? undefined,
  project: t.project ? { id: t.project.id, name: t.project.name } : undefined,
  url: taskUrl(appUrl, t),
});

const TASK_BRIEF = 'id, short_id, project_id, section_id, parent_id, title, completed, priority, due_date, position, '
  + `assignee:profiles!tasks_assignee_id_fkey(${PERSON})`;

export const TOOLS = [
  {
    name: 'whoami',
    description: 'Who you are signed in to Kahon as. Use the id to tell which tasks are assigned to you.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async run({ sb, user }) {
      const { data, error } = await sb.from('profiles').select(`${PERSON}, job_title, timezone`).eq('id', user.id).maybeSingle();
      check(error);
      return { id: user.id, name: personName(data) || user.email, email: data?.email || user.email, job_title: data?.job_title, timezone: data?.timezone };
    },
  },
  {
    name: 'list_workspaces',
    description: 'The Kahon workspaces you belong to. Projects live in a workspace.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async run({ sb }) {
      const { data, error } = await sb.from('workspaces').select('id, name').order('name');
      check(error);
      return { workspaces: data };
    },
  },
  {
    name: 'list_projects',
    description: 'The projects you are a member of, with their status and dates. Archived projects are left out unless asked for.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'Only projects in this workspace.' },
        include_archived: { type: 'boolean', description: 'Also list archived projects. Default false.' },
      },
    },
    annotations: { readOnlyHint: true },
    async run({ sb }, args) {
      let query = sb.from('projects')
        .select('id, name, description, status, start_date, due_date, archived_at, completed_at, workspace:workspaces(id, name)')
        .order('name');
      if (args.workspace_id !== undefined) query = query.eq('workspace_id', uuid(args.workspace_id, 'workspace_id'));
      if (!args.include_archived) query = query.is('archived_at', null);
      const { data, error } = await query;
      check(error);
      return { projects: data };
    },
  },
  {
    name: 'get_project',
    description: 'One project: its sections in board order, its members (use their ids as assignee_id) and its top-level tasks under each section. Completed tasks are left out unless asked for.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        include_completed: { type: 'boolean', description: 'Also list completed tasks. Default false.' },
      },
      required: ['project_id'],
    },
    annotations: { readOnlyHint: true },
    async run({ sb, appUrl }, args) {
      const id = uuid(args.project_id, 'project_id');
      let tasks = sb.from('tasks').select(TASK_BRIEF).eq('project_id', id).is('parent_id', null).order('position').limit(500);
      if (!args.include_completed) tasks = tasks.eq('completed', false);
      const [p, s, m, t] = await Promise.all([
        sb.from('projects').select('id, name, description, status, start_date, due_date, archived_at, completed_at').eq('id', id).maybeSingle(),
        sb.from('sections').select('id, name').eq('project_id', id).order('position'),
        sb.from('project_members').select(`role, profile:profiles(${PERSON})`).eq('project_id', id),
        tasks,
      ]);
      [p, s, m, t].forEach((r) => check(r.error));
      if (!p.data) fail('No project with that id, or you are not a member of it.');
      const brief = (task) => {
        const { section, project, ...rest } = shapeTask({ ...task, project_id: id }, appUrl);
        return rest;
      };
      return {
        project: { ...p.data, url: appUrl ? `${appUrl}/p/${id}` : undefined },
        members: m.data.map((row) => ({ id: row.profile?.id, name: personName(row.profile), email: row.profile?.email, role: row.role })),
        sections: s.data.map((sec) => ({ ...sec, tasks: t.data.filter((task) => task.section_id === sec.id).map(brief) })),
        tasks_without_section: t.data.filter((task) => !task.section_id).map(brief),
        truncated: t.data.length === 500 || undefined,
      };
    },
  },
  {
    name: 'search_tasks',
    description: 'Finds tasks whose title contains the text, or whose task ID starts with it. Searches every workspace you belong to unless one is given. Returns up to 30 per workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'At least 2 characters.' },
        workspace_id: { type: 'string' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    async run({ sb, appUrl }, args) {
      const query = text(args.query, 'query', { required: true, max: 200 });
      if (query.length < 2) fail('query needs at least 2 characters.');
      let workspaces;
      if (args.workspace_id !== undefined) workspaces = [uuid(args.workspace_id, 'workspace_id')];
      else {
        const { data, error } = await sb.from('workspaces').select('id');
        check(error);
        workspaces = data.map((w) => w.id);
      }
      const results = await Promise.all(workspaces.map((w) => sb.rpc('search_tasks', { p_query: query, p_workspace: w })));
      results.forEach((r) => check(r.error));
      return {
        tasks: results.flatMap((r) => r.data).map((t) => ({
          id: t.id, task_id: t.short_id, title: t.title, completed: t.completed, due_date: t.due_date,
          parent_title: t.parent_title ?? undefined, section: t.section_name,
          project: { id: t.project_id, name: t.project_name, archived: t.project_archived || undefined },
          url: taskUrl(appUrl, t),
        })),
      };
    },
  },
  {
    name: 'my_tasks',
    description: 'Tasks assigned to you across all your projects, soonest due first. Completed tasks are left out unless asked for.',
    inputSchema: {
      type: 'object',
      properties: { include_completed: { type: 'boolean', description: 'Also list completed tasks. Default false.' } },
    },
    annotations: { readOnlyHint: true },
    async run({ sb, user, appUrl }, args) {
      const extra = await sb.from('task_assignees').select('task_id').eq('user_id', user.id);
      check(extra.error);
      const ids = extra.data.map((r) => r.task_id);
      let query = sb.from('tasks')
        .select(`${TASK_BRIEF}, section:sections(name), project:projects!inner(id, name, archived_at)`)
        .is('project.archived_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(300);
      query = ids.length ? query.or(`assignee_id.eq.${user.id},id.in.(${ids.join(',')})`) : query.eq('assignee_id', user.id);
      if (!args.include_completed) query = query.eq('completed', false);
      const { data, error } = await query;
      check(error);
      return { tasks: data.map((t) => shapeTask(t, appUrl)) };
    },
  },
  {
    name: 'get_task',
    description: 'Everything about one task: description (Markdown), assignees, dates, its subtasks and its comments in order.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'The task\'s id (UUID) or its 9-character task ID.' } },
      required: ['task_id'],
    },
    annotations: { readOnlyHint: true },
    async run({ sb, appUrl }, args) {
      const task = await findTask(sb, args.task_id,
        `${TASK_BRIEF}, description, recurrence, completed_at, created_at, updated_at, `
        + `creator:profiles!tasks_created_by_fkey(${PERSON}), section:sections(id, name), project:projects(id, name)`);
      const [subtasks, comments, extras, parent] = await Promise.all([
        sb.from('tasks').select(TASK_BRIEF).eq('parent_id', task.id).order('position'),
        sb.from('comments').select(`id, parent_id, body, created_at, edited_at, pinned_at, author:profiles!comments_author_id_fkey(${PERSON})`)
          .eq('task_id', task.id).order('created_at'),
        sb.from('task_assignees').select(`profile:profiles(${PERSON})`).eq('task_id', task.id),
        task.parent_id
          ? sb.from('tasks').select('id, short_id, title').eq('id', task.parent_id).maybeSingle()
          : { data: null, error: null },
      ]);
      [subtasks, comments, extras, parent].forEach((r) => check(r.error));
      return {
        ...shapeTask(task, appUrl),
        section: task.section ? { id: task.section.id, name: task.section.name } : null,
        description: task.description,
        recurrence: task.recurrence ?? undefined,
        completed_at: task.completed_at ?? undefined,
        created_at: task.created_at,
        created_by: personName(task.creator),
        parent_task: parent.data ? { id: parent.data.id, task_id: parent.data.short_id, title: parent.data.title } : undefined,
        other_assignees: extras.data.map((r) => ({ id: r.profile?.id, name: personName(r.profile) })),
        subtasks: subtasks.data.map((st) => {
          const { section, project, url, ...rest } = shapeTask(st, appUrl);
          return rest;
        }),
        comments: comments.data.map((c) => ({
          id: c.id, reply_to: c.parent_id ?? undefined, author: personName(c.author), body: c.body,
          created_at: c.created_at, edited: Boolean(c.edited_at) || undefined, pinned: Boolean(c.pinned_at) || undefined,
        })),
      };
    },
  },
  {
    name: 'create_task',
    description: 'Adds a task to the end of a section (the project\'s first section if none is given), or a subtask under parent_id. Needs Editor access to the project. Descriptions use Markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        title: { type: 'string', description: 'Up to 500 characters.' },
        section_id: { type: 'string', description: 'From get_project. Defaults to the first section.' },
        parent_id: { type: 'string', description: 'Make it a subtask of this task (id or task ID).' },
        description: { type: 'string' },
        assignee_id: { type: 'string', description: 'A project member\'s id from get_project, or "me".' },
        due_date: { type: 'string', description: 'YYYY-MM-DD.' },
        priority: { type: 'string', enum: PRIORITIES },
      },
      required: ['project_id', 'title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run({ sb, user, appUrl, notify }, args) {
      let projectId = uuid(args.project_id, 'project_id');
      const row = { title: text(args.title, 'title', { required: true, max: 500 }) };
      if (args.description !== undefined) row.description = text(args.description, 'description', { max: 20000 });
      if (args.assignee_id !== undefined) row.assignee_id = person(args.assignee_id, user);
      if (args.due_date !== undefined) row.due_date = date(args.due_date, 'due_date');
      if (args.priority !== undefined) row.priority = priority(args.priority);

      if (args.parent_id !== undefined) {
        const parent = await findTask(sb, args.parent_id, 'id, project_id, section_id');
        if (parent.project_id !== projectId) fail('parent_id is a task in a different project.');
        row.parent_id = parent.id;
        row.section_id = parent.section_id;
      } else if (args.section_id !== undefined) {
        row.section_id = await sectionOf(sb, projectId, uuid(args.section_id, 'section_id'));
      } else {
        const { data, error } = await sb.from('sections').select('id').eq('project_id', projectId).order('position').limit(1);
        check(error);
        row.section_id = data[0]?.id ?? null;
      }
      row.position = await endOfSection(sb, projectId, row.section_id, row.parent_id);

      const { data, error } = await sb.from('tasks').insert({ project_id: projectId, ...row }).select(TASK_BRIEF).single();
      check(error);
      if (data.assignee?.id) await notify('task_assigned', { task_id: data.id });
      return { created: shapeTask(data, appUrl) };
    },
  },
  {
    name: 'update_task',
    description: 'Changes a task: only the fields you pass change. Pass null to clear assignee_id, due_date or priority. Setting completed to true also completes its subtasks. Needs Editor access to the project.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task\'s id (UUID) or its 9-character task ID.' },
        title: { type: 'string' },
        description: { type: 'string', description: 'Markdown. Replaces the whole description.' },
        assignee_id: { type: ['string', 'null'], description: 'A project member\'s id, "me", or null.' },
        due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null.' },
        priority: { type: ['string', 'null'], enum: [...PRIORITIES, null] },
        completed: { type: 'boolean' },
        section_id: { type: 'string', description: 'Move it to the end of this section of the same project.' },
      },
      required: ['task_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run({ sb, user, appUrl, notify }, args) {
      const task = await findTask(sb, args.task_id, 'id, project_id, section_id, parent_id, assignee_id');
      const patch = {};
      if (args.title !== undefined) patch.title = text(args.title, 'title', { required: true, max: 500 });
      if (args.description !== undefined) patch.description = text(args.description, 'description', { max: 20000 }) ?? '';
      if (args.assignee_id !== undefined) patch.assignee_id = person(args.assignee_id, user);
      if (args.due_date !== undefined) patch.due_date = date(args.due_date, 'due_date');
      if (args.priority !== undefined) patch.priority = priority(args.priority);
      if (args.completed !== undefined) {
        if (typeof args.completed !== 'boolean') fail('completed must be true or false.');
        patch.completed = args.completed;
      }
      if (args.section_id !== undefined) {
        const sectionId = await sectionOf(sb, task.project_id, uuid(args.section_id, 'section_id'));
        if (sectionId !== task.section_id) {
          patch.section_id = sectionId;
          patch.position = await endOfSection(sb, task.project_id, sectionId, task.parent_id);
        }
      }
      if (!Object.keys(patch).length) fail('Nothing to change: pass at least one field besides task_id.');

      const { data, error } = await sb.from('tasks').update(patch).eq('id', task.id).select(TASK_BRIEF).maybeSingle();
      check(error);
      if (!data) fail('That change was not saved: you may only have view or comment access to this project.');
      // Same emails the app sends (src/hooks/useProject.js, src/lib/notify.js).
      if (patch.assignee_id && patch.assignee_id !== task.assignee_id) await notify('task_assigned', { task_id: task.id });
      await notify('task_updated', { task_id: task.id });
      return { updated: shapeTask(data, appUrl), changed: Object.keys(patch).filter((k) => k !== 'position') };
    },
  },
  {
    name: 'add_comment',
    description: 'Posts a comment on a task as you, or a reply to one of its comments. Markdown works; mention someone with @[Their Name](their-user-id). Needs Commenter access or higher.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task\'s id (UUID) or its 9-character task ID.' },
        body: { type: 'string', description: 'Up to 5000 characters.' },
        reply_to: { type: 'string', description: 'The id of a comment on this task to reply to (from get_task).' },
      },
      required: ['task_id', 'body'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run({ sb, user, appUrl, notify }, args) {
      const task = await findTask(sb, args.task_id, 'id, project_id');
      const row = { task_id: task.id, author_id: user.id, body: text(args.body, 'body', { required: true, max: 5000 }) };
      if (args.reply_to !== undefined) row.parent_id = uuid(args.reply_to, 'reply_to');
      const { data, error } = await sb.from('comments').insert(row).select('id, created_at').single();
      check(error);
      await notify('comment_added', { comment_id: data.id });
      return { comment_id: data.id, created_at: data.created_at, url: appUrl ? `${taskUrl(appUrl, task)}&comment=${data.id}` : undefined };
    },
  },
];
