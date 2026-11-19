import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Lockup } from '../components/ui';
import Footer from '../components/Footer';

// Supabase Auth's OAuth server sends people here (Authentication → OAuth Server → Authorization
// path) when an app such as Claude asks to connect to Kahon as them. Shown only once they're
// signed in (and past two-factor), so approving hands over a token for this account. What the
// app can then do is limited to the MCP server's tools (src/lib/mcpTools.js) and this person's
// own project roles.
const ABILITIES = [
  'See the workspaces, projects, tasks and comments you can see',
  'Create tasks and subtasks in projects where you\'re an Editor or Admin',
  'Change, assign, move and complete those tasks',
  'Comment on tasks as you',
];

// Local only: /oauth/consent?authorization_id=preview shows the screen with sample details,
// since a real request needs Supabase's OAuth server and a deployed /api/mcp.
const PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).get('authorization_id') === 'preview';
const SAMPLE = { authorization_id: 'preview', client: { name: 'Claude' }, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' };

export default function OAuthConsent() {
  const { user, signOut } = useAuth();
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id');
  const [details, setDetails] = useState(PREVIEW ? SAMPLE : null);
  const [error, setError] = useState(authorizationId ? '' : 'There\'s no connection request here. To connect Claude, add Kahon as a connector in Claude; it opens this page for you.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authorizationId || PREVIEW) return;
    let live = true;
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: err }) => {
      if (!live) return;
      if (err) setError(err.message);
      else if (data.redirect_url) window.location.replace(data.redirect_url); // approved before
      else setDetails(data);
    });
    return () => { live = false; };
  }, [authorizationId]);

  const decide = async (approve) => {
    if (PREVIEW) return setError(`Preview only: this would ${approve ? 'connect' : 'not connect'} Claude and go back to it.`);
    setBusy(true);
    setError('');
    const call = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data, error: err } = await call.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true });
    if (err) {
      setBusy(false);
      return setError(err.message);
    }
    window.location.replace(data.redirect_url);
  };

  const name = details?.client?.name || 'An app';

  return (
    <div className="auth auth-single">
      <div className="auth-panel">
        <div className="auth-brand"><Lockup height={34} /></div>
        {details ? (
          <>
            <h1>Connect {name} to Kahon?</h1>
            <p className="muted">
              {name} will act as <strong>{user?.email}</strong>, only in the projects you belong to and only as far as your role
              in each allows. It can:
            </p>
            <ul className="consent-list">
              {ABILITIES.map((a) => <li key={a}>{a}</li>)}
            </ul>
            <p className="muted">It can't delete anything or change who is in a project. People may get the usual emails about its changes.</p>
            {details.redirect_uri && <p className="muted consent-redirect">You'll go back to {new URL(details.redirect_uri).host}.</p>}
            {error && <p className="form-error">{error}</p>}
            <div className="consent-actions">
              <button className="btn btn-primary" onClick={() => decide(true)} disabled={busy} aria-busy={busy}>Allow</button>
              <button className="btn btn-ghost" onClick={() => decide(false)} disabled={busy}>Deny</button>
            </div>
          </>
        ) : error ? (
          <>
            <h1>Nothing to connect</h1>
            <p className="form-error">{error}</p>
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
        <p className="muted switch">Not {user?.email}? <button className="link-btn" onClick={signOut}>Sign out</button></p>
        <Footer className="auth-footer" />
      </div>
    </div>
  );
}
