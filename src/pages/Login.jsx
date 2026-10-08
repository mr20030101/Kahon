import { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { supabase } from '../lib/supabase';
import { Lockup } from '../components/ui';
import AuthArt from '../components/AuthArt';
import Footer from '../components/Footer';
import { reducedMotion } from '../lib/motion';

// "Continue with Google" shows once the Google provider is set up in Supabase
// (Authentication -> Sign In / Providers) and VITE_GOOGLE_SIGNIN=true is set.
const GOOGLE = import.meta.env.VITE_GOOGLE_SIGNIN === 'true';

// Invitation emails link to /?signup=<email>: open the sign-up form with it filled in.
const invitedEmail = () => new URLSearchParams(window.location.search).get('signup') || '';

export default function Login() {
  const [mode, setMode] = useState(() => (invitedEmail() ? 'signup' : 'signin'));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const panelRef = useRef(null);

  useEffect(() => {
    if (reducedMotion()) return undefined;
    const a = animate(panelRef.current.children, {
      y: [18, 0], opacity: [0, 1], duration: 700, delay: stagger(80, { start: 150 }), ease: 'outCubic',
    });
    return () => a.revert();
  }, []);

  const switchTo = (next) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const google = async () => {
    setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (err) setError(err.message);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    if (mode === 'signin') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) setError(err.message);
    } else if (mode === 'forgot') {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      if (err) setError(err.message);
      else setNotice(`If ${email.trim()} has a Kahon account, we sent it a link to set a new password.`);
    } else {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin },
      });
      if (err) setError(err.message);
      else if (!data.session) setNotice(`We sent a confirmation link to ${email}. Open it to finish creating your account.`);
    }
    setBusy(false);
  };

  return (
    <div className="auth">
      <AuthArt />
      <div className="auth-panel" ref={panelRef}>
        <div className="auth-brand"><Lockup height={34} /></div>
        <h1>{{ signin: 'Sign in to your workspace', signup: 'Create your account', forgot: 'Reset your password' }[mode]}</h1>
        {mode === 'forgot' && <p className="muted">Enter your email and we'll send you a link to set a new password.</p>}
        <form onSubmit={submit} className="stack">
          {mode === 'signup' && (
            <label className="label">Full name
              <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            </label>
          )}
          <label className="label">Email
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          {mode !== 'forgot' && (
            <label className="label">
              <span className="label-row">
                Password
                {mode === 'signin' && (
                  <button type="button" className="link-btn small" onClick={() => switchTo('forgot')}>Forgot password?</button>
                )}
              </span>
              <input className="input" type="password" required minLength={mode === 'signup' ? 8 : 6} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          {notice && <p className="form-notice">{notice}</p>}
          <button className="btn btn-primary btn-wide" disabled={busy}>
            {busy ? 'One moment…' : { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link' }[mode]}
          </button>
        </form>
        {GOOGLE && mode !== 'forgot' && (
          <>
            <div className="or-line"><span>or</span></div>
            <button type="button" className="btn btn-ghost btn-wide" onClick={google}>
              <GoogleMark /> Continue with Google
            </button>
          </>
        )}
        <p className="muted switch">
          {mode === 'signin' ? 'New to Kahon?' : mode === 'signup' ? 'Already have an account?' : 'Remembered it?'}{' '}
          <button className="link-btn" onClick={() => switchTo(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        <Footer className="auth-footer" />
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
