// Kahon's MCP server, so Claude (claude.ai, Claude Desktop, Claude Code) can read and update a
// person's projects and tasks. Served by the Vercel Function api/mcp.js. Server only.
//
// Per person: every request carries that person's Supabase access token, issued by Supabase
// Auth's OAuth 2.1 server after they approve the connection on /oauth/consent
// (src/pages/OAuthConsent.jsx). Queries run with that token, so row level security, project
// roles and two-factor rules apply exactly as in the app, and changes are recorded as theirs.
// The server keeps no secrets and no state.
//
// Transport: MCP's Streamable HTTP, stateless, answering each POST with JSON (no SSE stream).
// Auth discovery: a request without a valid token gets 401 with a WWW-Authenticate header
// pointing at /.well-known/oauth-protected-resource (served by protectedResourceMetadata
// below), which names Supabase Auth as the authorization server.

import { createClient } from '@supabase/supabase-js';
import { TOOLS, ToolError } from './mcpTools.js';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const MCP_PATH = '/api/mcp';
const SERVER_INFO = { name: 'kahon', title: 'Kahon', version: '1' };
const INSTRUCTIONS = 'Kahon is a team task manager: workspaces hold projects, projects hold sections (the board\'s '
  + 'columns), sections hold tasks, and tasks can have subtasks and comments. You act as the signed-in person and '
  + 'can only see and change what their project roles allow. Start with my_tasks, list_projects or search_tasks; '
  + 'get_project gives section and member ids for create_task and update_task. Task descriptions and comments are '
  + 'Markdown. Assignees and commenters may get emails about changes, so only make changes the person asked for.';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

const respond = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status,
  headers: { ...CORS, ...(body === null ? {} : { 'Content-Type': 'application/json' }), 'Cache-Control': 'no-store', ...headers },
});

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function config(env) {
  return {
    url: (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
  };
}

/** The app's public address, for links in results and the metadata's resource URL. */
function origin(request, env) {
  return (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

/** RFC 9728 metadata: tells Claude where to sign the person in. */
export function protectedResourceMetadata(request, env) {
  const { url } = config(env);
  if (!url) return respond({ error: 'Supabase is not configured.' }, 500);
  return respond({
    resource: `${origin(request, env)}${MCP_PATH}`,
    authorization_servers: [`${url}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'Kahon',
    resource_documentation: `${origin(request, env)}/`,
  }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

function unauthorized(request, env, description) {
  const metadata = `${origin(request, env)}/.well-known/oauth-protected-resource${MCP_PATH}`;
  return respond(
    { error: 'invalid_token', error_description: description },
    401,
    { 'WWW-Authenticate': `Bearer resource_metadata="${metadata}", error="invalid_token", error_description="${description}"` },
  );
}

/** Answers one JSON-RPC message. Returns the response object, or null for a notification. */
export async function handleMessage(message, ctx) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message?.id, -32600, 'Invalid request');
  }
  const { id, method, params = {} } = message;
  if (id === undefined || id === null) return null; // notifications/initialized, notifications/cancelled, …

  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) },
      };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      const args = params.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'arguments must be an object');
      try {
        const out = await tool.run(ctx, args);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out } };
      } catch (err) {
        if (!(err instanceof ToolError)) console.error(`[mcp] ${tool.name}:`, err);
        const text = err instanceof ToolError ? err.message : 'Something went wrong running that tool. Try again.';
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * The /api/mcp endpoint. `deps` lets tests swap the Supabase client and fetch.
 * @param {Request} request
 */
export async function handleMcpRequest(request, env, deps = {}) {
  const { url, anonKey } = config(env);
  const makeClient = deps.createClient || createClient;
  const doFetch = deps.fetch || fetch;

  if (request.method === 'OPTIONS') return respond(null, 204);
  // Stateless: no server-to-client stream and no sessions to end.
  if (request.method !== 'POST') return respond(rpcError(null, -32000, 'Method not allowed'), 405, { Allow: 'POST, OPTIONS' });
  if (!url || !anonKey) return respond(rpcError(null, -32603, 'Supabase is not configured on the server.'), 500);

  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return unauthorized(request, env, 'Sign in to Kahon to connect.');

  const sb = makeClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: doFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: auth, error: authError } = await sb.auth.getUser(token);
  if (authError || !auth?.user) return unauthorized(request, env, 'The Kahon sign-in has expired or was revoked.');

  let body;
  try {
    body = await request.json();
  } catch {
    return respond(rpcError(null, -32700, 'Parse error'), 400);
  }

  // Same emails the app sends for these changes (supabase/functions/notify). Never blocks a
  // change: a missing or failing function only logs.
  const notify = async (type, payload) => {
    try {
      const res = await doFetch(`${url}/functions/v1/notify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ...payload }),
      });
      if (!res.ok) console.warn(`[mcp] notify ${type}: ${res.status}`);
    } catch (err) {
      console.warn(`[mcp] notify ${type}:`, err.message);
    }
  };

  const ctx = { sb, user: auth.user, appUrl: origin(request, env), notify };
  const messages = Array.isArray(body) ? body : [body];
  if (!messages.length) return respond(rpcError(null, -32600, 'Invalid request'), 400);
  const replies = (await Promise.all(messages.map((m) => handleMessage(m, ctx)))).filter(Boolean);

  if (!replies.length) return respond(null, 202);
  return respond(Array.isArray(body) ? replies : replies[0]);
}
