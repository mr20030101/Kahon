import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  // True when the account has two-factor on and this session hasn't passed it yet;
  // null while that's being checked.
  const [needsMfa, setNeedsMfa] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Arrived from a password-reset email: ask for a new password before anything else.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;

  useEffect(() => {
    if (!session) {
      setNeedsMfa(false);
      return;
    }
    setNeedsMfa((cur) => (cur === false ? false : null));
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      setNeedsMfa(data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2');
    });
  }, [session]);
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle().then(({ data }) => setProfile(data));
  }, [userId]);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    needsMfa,
    recovering,
    finishRecovery: () => setRecovering(false),
    signOut: () => supabase.auth.signOut(),
    // Optimistic profile update for the signed-in user; resolves to an error or null.
    updateProfile: async (patch) => {
      const previous = profile;
      setProfile((cur) => (cur ? { ...cur, ...patch } : cur));
      const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
      if (error) setProfile(previous);
      return error;
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
