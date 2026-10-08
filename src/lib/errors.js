import { supabase } from './supabase';
import { APP_VERSION } from './version';

// Records browser errors in the client_errors table (readable in the Supabase dashboard) so
// bugs people hit get noticed without them having to report them. At most MAX per page
// load, each distinct message once, and only for signed-in people (the table needs a user).
const MAX = 10;
const seen = new Set();

export async function reportError(error, extra = '') {
  try {
    const message = String(error?.message || error || 'Unknown error').slice(0, 2000);
    const key = message.slice(0, 200);
    if (!supabase || seen.has(key) || seen.size >= MAX) return;
    seen.add(key);
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase.from('client_errors').insert({
      message,
      stack: `${error?.stack || ''}${extra ? `\n${extra}` : ''}`.slice(0, 8000) || null,
      url: window.location.href.slice(0, 2000),
      user_agent: navigator.userAgent.slice(0, 500),
      app_version: APP_VERSION,
    });
  } catch {
    // Reporting must never cause a second error.
  }
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
}
