// Vercel Function behind /.well-known/oauth-protected-resource (see vercel.json): tells MCP
// clients that Kahon's MCP server signs people in with Supabase Auth. See src/lib/mcp.js.
import { protectedResourceMetadata } from '../src/lib/mcp.js';

export function GET(request) {
  return protectedResourceMetadata(request, process.env);
}
