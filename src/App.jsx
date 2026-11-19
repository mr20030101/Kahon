import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { supabaseConfigured } from './lib/supabase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { TimerProvider } from './context/TimerContext';
import Footer from './components/Footer';
import UpdateBanner from './components/UpdateBanner';
import Sidebar from './components/Sidebar';
import { Icon, Lockup, Logo } from './components/ui';
import Home from './pages/Home';
import Login from './pages/Login';
import MyTasks from './pages/MyTasks';
import ProjectPage from './pages/ProjectPage';
import MfaChallenge from './pages/MfaChallenge';
import ResetPassword from './pages/ResetPassword';
import OAuthConsent from './pages/OAuthConsent';
import Inbox from './pages/Inbox';
import AdminUsers from './pages/AdminUsers';
import AdminWorkspaces from './pages/AdminWorkspaces';
import AdminSecurity from './pages/AdminSecurity';
import AdminErrors from './pages/AdminErrors';
import AdminAI from './pages/AdminAI';
import AdminEmails from './pages/AdminEmails';
import AdminFiles from './pages/AdminFiles';
import SearchPalette from './components/SearchPalette';
import Topbar from './components/Topbar';
import FloatingTimer from './components/FloatingTimer';

const CONSENT_KEY = 'kahon:oauth-consent';

function rememberConsent(search) {
  try { sessionStorage.setItem(CONSENT_KEY, search); } catch { /* private mode: no fallback needed */ }
}

function takeConsent() {
  try {
    const search = sessionStorage.getItem(CONSENT_KEY);
    sessionStorage.removeItem(CONSENT_KEY);
    return search;
  } catch {
    return null;
  }
}

// Once signed in, carry on to a connection request that sign-in navigated away from.
function useResumeConsent(session, pathname) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!session) return;
    const search = takeConsent();
    if (search && pathname !== '/oauth/consent') navigate(`/oauth/consent${search}`, { replace: true });
  }, [session, pathname, navigate]);
}

function Shell() {
  const { session, loading, needsMfa, recovering } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  useResumeConsent(session, pathname);

  if (loading) return <div className="splash"><Logo size={56} /></div>;
  if (!session) {
    // Signing in with Google returns to the home page; remember the connection request.
    if (pathname === '/oauth/consent') rememberConsent(window.location.search);
    return <Login />;
  }
  if (needsMfa === null) return <div className="splash"><Logo size={56} /></div>;
  if (needsMfa) return <MfaChallenge />;
  if (recovering) return <ResetPassword />;
  // An app such as Claude asking to connect as this person (src/lib/mcp.js).
  if (pathname === '/oauth/consent') return <OAuthConsent />;

  return (
    <WorkspaceProvider>
      <TimerProvider>
      <div className="app">
        <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        <SearchPalette />
        {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
        <main className="main">
          <Topbar onOpenNav={() => setNavOpen(true)} />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/my-tasks" element={<MyTasks />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/workspaces" element={<AdminWorkspaces />} />
            <Route path="/admin/security" element={<AdminSecurity />} />
            <Route path="/admin/errors" element={<AdminErrors />} />
            <Route path="/admin/ai" element={<AdminAI />} />
            <Route path="/admin/emails" element={<AdminEmails />} />
            <Route path="/admin/files" element={<AdminFiles />} />
            <Route path="/p/:projectId" element={<ProjectPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Footer releaseNotes />
        </main>
        <FloatingTimer />
      </div>
      </TimerProvider>
    </WorkspaceProvider>
  );
}

function SetupNotice() {
  return (
    <div className="splash setup">
      <Logo size={56} />
      <h1>Connect Kahon to Supabase</h1>
      <p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code> (or to your Vercel project's environment variables), then restart the dev server or redeploy.</p>
    </div>
  );
}

export default function App() {
  if (!supabaseConfigured) return <SetupNotice />;
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Shell />
          <UpdateBanner />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
