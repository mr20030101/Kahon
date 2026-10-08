import { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { supabase } from '../lib/supabase';
import { Lockup } from '../components/ui';
import AuthArt from '../components/AuthArt';
import Footer from '../components/Footer';
import { reducedMotion } from '../lib/motion';

export default function Login() {
  const [mode, setMode] = useState('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
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

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    if (mode === 'signin') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) setError(err.message);
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
        <h1>{mode === 'signin' ? 'Sign in to your workspace' : 'Create your account'}</h1>
        <form onSubmit={submit} className="stack">
          {mode === 'signup' && (
            <label className="label">Full name
              <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            </label>
          )}
          <label className="label">Email
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="label">Password
            <input className="input" type="password" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
          </label>
          {error && <p className="form-error">{error}</p>}
          {notice && <p className="form-notice">{notice}</p>}
          <button className="btn btn-primary btn-wide" disabled={busy}>
            {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="muted switch">
          {mode === 'signin' ? 'New to Kahon?' : 'Already have an account?'}{' '}
          <button className="link-btn" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice(''); }}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        <Footer className="auth-footer" />
      </div>
    </div>
  );
}
