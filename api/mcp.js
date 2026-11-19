// Vercel Function: Kahon's MCP server, so Claude can read and update a person's tasks as them.
// See src/lib/mcp.js, and README "Connect Claude (MCP)" for turning on Supabase's OAuth server.
// Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (public values); optional APP_URL.
import { handleMcpRequest } from '../src/lib/mcp.js';

const handle = (request) => handleMcpRequest(request, process.env);

export { handle as POST, handle as GET, handle as DELETE, handle as OPTIONS };
