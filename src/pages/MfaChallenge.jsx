import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Lockup } from '../components/ui';
import Footer from '../components/Footer';

// Second sign-in step for accounts with an authenticator app. Until it's passed the database
// shows no project data (see mfa_ok() in schema.sql), so the app waits here.
export default function MfaChallenge() {
  const { user, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.find((f) => f.status === 'verified');
    if (listError || !factor) {
      setBusy(false);
      return setError(listError?.message || 'No authenticator is set up for this account.');
    }
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    setBusy(false);
    if (err) setError(err.message.includes('Invalid') ? "That code didn't work. Check your app and try again." : err.message);
    // On success the session refreshes to aal2 and AuthContext lets the app through.
  };

  return (
    <div className="auth auth-single">
      <div className="auth-panel">
        <div className="auth-brand"><Lockup height={34} /></div>
        <h1>Two-factor authentication</h1>
        <p className="muted">Enter the 6-digit code from your authenticator app for {user?.email}.</p>
        <form onSubmit={verify} className="stack">
          <label className="label">Code
            <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary btn-wide" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
        </form>
        <p className="muted switch">Not you? <button className="link-btn" onClick={signOut}>Sign out</button></p>
        <Footer className="auth-footer" />
      </div>
    </div>
  );
}
