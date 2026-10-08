import { APP_OWNER, APP_VERSION } from '../lib/constants';

export default function Footer({ className = '' }) {
  return (
    <footer className={`app-footer ${className}`.trim()}>
      <span>© {new Date().getFullYear()} {APP_OWNER}</span>
      <span className="app-version">Kahon v{APP_VERSION}</span>
    </footer>
  );
}
