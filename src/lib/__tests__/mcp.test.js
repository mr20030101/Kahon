import { describe, expect, it, vi } from 'vitest';
import { handleMcpRequest, protectedResourceMetadata, PROTOCOL_VERSIONS } from '../mcp.js';

const ENV = { VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon', APP_URL: 'https://kahon.test' };
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'me@example.com' };
const TASK = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';

// A stand-in for supabase-js: records each query (table, filters, payload) and answers it with
// whatever `answer(query)` returns.
function fakeSupabase(answer = () => ({ data: [], error: null }), user = USER) {
  const queries = [];
  const builder = (table) => {
    const q = { table, calls: [] };
    queries.push(q);
    const chain = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve(answer(q)).then(resolve, reject);
        return (...args) => {
          q.calls.push([prop, ...args]);
          if (['insert', 'update'].includes(prop)) q[prop] = args[0];
          return chain;
        };
      },
    });
    return chain;
  };
  const client = {
    auth: { getUser: vi.fn(async (token) => (token === 'good' && user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } })) },
    from: builder,
    rpc: (fn, args) => {
      const q = { table: `rpc:${fn}`, args, calls: [] };
      queries.push(q);
      return Promise.resolve(answer(q));
    },
  };
  return { client, queries, createClient: vi.fn(() => client) };
}

const has = (q, method, ...args) => q.calls.some(([m, ...a]) => m === method && args.every((x, i) => a[i] === x));

function post(body, { token = 'good' } = {}) {
  return new Request('https://kahon.test/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function call(name, args, answer) {
  const fake = fakeSupabase(answer);
  const fetch = vi.fn(async () => new Response('{}'));
  const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), ENV, { createClient: fake.createClient, fetch });
  const body = await res.json();
  return { body, result: body.result, queries: fake.queries, fetch };
}

describe('MCP endpoint', () => {
  it('asks for a sign-in, pointing at the resource metadata', async () => {
    const fake = fakeSupabase();
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { token: null }), ENV, fake);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata="https://kahon.test/.well-known/oauth-protected-resource/api/mcp"');
  });

  it('turns away an expired or revoked token', async () => {
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: 'stale' }), ENV, fakeSupabase());
    expect(res.status).toBe(401);
  });

  it('queries as the person, with their own token', async () => {
    const fake = fakeSupabase();
    await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), ENV, fake);
    const [, , options] = fake.createClient.mock.calls[0];
    expect(options.global.headers.Authorization).toBe('Bearer good');
  });

  it('answers CORS preflight and refuses GET (no stream)', async () => {
    expect((await handleMcpRequest(new Request('https://kahon.test/api/mcp', { method: 'OPTIONS' }), ENV)).status).toBe(204);
    expect((await handleMcpRequest(new Request('https://kahon.test/api/mcp'), ENV)).status).toBe(405);
  });

  it('agrees a protocol version', async () => {
    const init = async (protocolVersion) => (await (await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion } }), ENV, fakeSupabase(),
    )).json()).result;
    expect((await init('2025-06-18')).protocolVersion).toBe('2025-06-18');
    expect((await init('1999-01-01')).protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    expect((await init('2025-06-18')).capabilities.tools).toBeDefined();
  });

  it('accepts notifications with 202 and no body', async () => {
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), ENV, fakeSupabase());
    expect(res.status).toBe(202);
  });

  it('lists tools, with no delete among them', async () => {
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), ENV, fakeSupabase());
    const names = (await res.json()).result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['my_tasks', 'get_task', 'create_task', 'update_task', 'add_comment']));
    expect(names.some((n) => /delete|remove/.test(n))).toBe(false);
  });

  it('reports unknown methods and tools', async () => {
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'resources/list' }), ENV, fakeSupabase());
    expect((await res.json()).error.code).toBe(-32601);
    const { body } = await call('drop_everything', {});
    expect(body.error.code).toBe(-32602);
  });

  it('publishes resource metadata naming Supabase Auth', async () => {
    const res = protectedResourceMetadata(new Request('https://kahon.test/.well-known/oauth-protected-resource'), ENV);
    expect(await res.json()).toMatchObject({
      resource: 'https://kahon.test/api/mcp',
      authorization_servers: ['https://ref.supabase.co/auth/v1'],
    });
  });
});

describe('MCP tools', () => {
  it('shows bad arguments to Claude as tool errors', async () => {
    const { result } = await call('update_task', { task_id: 'nope', title: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/task_id/);
  });

  it('finds a task by its short task ID', async () => {
    const { queries } = await call('update_task', { task_id: '#ABC123def', priority: 'high' }, (q) => ({
      data: q.update ? { id: TASK, project_id: PROJECT, title: 't' } : { id: TASK, project_id: PROJECT, section_id: SECTION, parent_id: null, assignee_id: null },
      error: null,
    }));
    expect(has(queries[0], 'eq', 'short_id', 'abc123def')).toBe(true);
  });

  it('updates only the fields given, and emails like the app does', async () => {
    const { result, queries, fetch } = await call('update_task', { task_id: TASK, assignee_id: 'me', due_date: null, completed: true }, (q) => ({
      data: q.update ? { id: TASK, project_id: PROJECT, title: 't', completed: true } : { id: TASK, project_id: PROJECT, section_id: SECTION, parent_id: null, assignee_id: null },
      error: null,
    }));
    expect(result.isError).toBeUndefined();
    expect(queries.find((q) => q.update).update).toEqual({ assignee_id: USER.id, due_date: null, completed: true });
    const sent = fetch.mock.calls.map(([url, init]) => [url, JSON.parse(init.body).type]);
    expect(sent).toEqual([
      ['https://ref.supabase.co/functions/v1/notify', 'task_assigned'],
      ['https://ref.supabase.co/functions/v1/notify', 'task_updated'],
    ]);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer good');
  });

  it('says so when row level security blocks an update', async () => {
    const { result } = await call('update_task', { task_id: TASK, title: 'New' }, (q) => ({
      data: q.update ? null : { id: TASK, project_id: PROJECT, section_id: SECTION, parent_id: null },
      error: null,
    }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/view or comment access/);
  });

  it('refuses an update with nothing to change', async () => {
    const { result } = await call('update_task', { task_id: TASK }, () => ({ data: { id: TASK, project_id: PROJECT }, error: null }));
    expect(result.content[0].text).toMatch(/Nothing to change/);
  });

  it('creates a task at the end of the first section', async () => {
    const { result, queries } = await call('create_task', { project_id: PROJECT, title: '  Write release notes ', priority: 'medium' }, (q) => {
      if (q.table === 'sections') return { data: [{ id: SECTION }], error: null };
      if (q.insert) return { data: { id: TASK, project_id: PROJECT, short_id: 'abc123def', title: q.insert.title }, error: null };
      return { data: [{ position: 3000 }], error: null };
    });
    expect(queries.find((q) => q.insert).insert).toEqual({
      project_id: PROJECT, title: 'Write release notes', priority: 'medium', section_id: SECTION, position: 4000,
    });
    expect(result.structuredContent.created.url).toBe(`https://kahon.test/p/${PROJECT}?task=${TASK}`);
  });

  it('rejects a malformed due date', async () => {
    const { result } = await call('create_task', { project_id: PROJECT, title: 'x', due_date: '30/11/2026' });
    expect(result.content[0].text).toMatch(/YYYY-MM-DD/);
  });

  it('comments as the signed-in person and notifies', async () => {
    const { queries, fetch } = await call('add_comment', { task_id: TASK, body: 'Done, see PR' }, (q) => ({
      data: q.insert ? { id: 'c1', created_at: 'now' } : { id: TASK, project_id: PROJECT },
      error: null,
    }));
    expect(queries.find((q) => q.insert).insert).toEqual({ task_id: TASK, author_id: USER.id, body: 'Done, see PR' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ type: 'comment_added', comment_id: 'c1' });
  });
});
