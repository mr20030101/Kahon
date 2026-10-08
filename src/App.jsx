import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { supabaseConfigured } from './lib/supabase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import Footer from './components/Footer';
import UpdateBanner from './components/UpdateBanner';
import Sidebar from './components/Sidebar';
import { Icon, Lockup, Logo } from './components/ui';
import Login from './pages/Login';
import MyTasks from './pages/MyTasks';
import ProjectPage from './pages/ProjectPage';

function Shell() {
  const { session, loading } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  if (loading) return <div className="splash"><Logo size={56} /></div>;
  if (!session) return <Login />;

  return (
    <WorkspaceProvider>
      <div className="app">
        <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
        <main className="main">
          <div className="mobile-bar">
            <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Open menu"><Icon.menu /></button>
            <Lockup height={27} />
          </div>
          <Routes>
            <Route path="/" element={<MyTasks />} />
            <Route path="/p/:projectId" element={<ProjectPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Footer releaseNotes />
        </main>
      </div>
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
