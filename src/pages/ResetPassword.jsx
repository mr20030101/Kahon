import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Lockup } from '../components/ui';
import Footer from '../components/Footer';

// Shown after someone follows a password-reset link: Supabase signs them in for this one
// purpose, and they choose a new password before carrying on.
export default function ResetPassword() {
  const { user, finishRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    finishRecovery();
  };

  return (
    <div className="auth auth-single">
      <div className="auth-panel">
        <div className="auth-brand"><Lockup height={34} /></div>
        <h1>Set a new password</h1>
        <p className="muted">For {user?.email}.</p>
        <form onSubmit={submit} className="stack">
          <label className="label">New password
            <input className="input" type="password" required minLength={8} autoFocus autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="label">Confirm new password
            <input className="input" type="password" required autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary btn-wide" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
        </form>
        <Footer className="auth-footer" />
      </div>
    </div>
  );
}
