import { useEffect, useState } from 'react';
import { APP_VERSION, fetchDeployedVersion, isNewerVersion } from '../lib/version';
import { Icon } from './ui';

// "A new version is available": a tab left open across a deploy keeps running the old code
// until it's reloaded, so it says so instead of quietly lagging behind.

// Often enough to notice a deploy the same morning, rarely enough to cost nothing.
const CHECK_EVERY_MS = 5 * 60 * 1000;

export default function UpdateBanner() {
  const [available, setAvailable] = useState(null);
  // Dismissed for this one version only; a later release asks again.
  const [dismissed, setDismissed] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const deployed = await fetchDeployedVersion();
      if (!cancelled && deployed && isNewerVersion(deployed, APP_VERSION)) setAvailable(deployed);
    };
    // Also on coming back to the tab: the likeliest moment someone has been away over a deploy.
    const onVisible = () => document.visibilityState === 'visible' && check();

    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!available || dismissed === available) return null;

  return (
    <div className="update-banner" role="status">
      <span className="grow">A new version of Kahon is available (<span className="app-version">v{available}</span>).</span>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      <button type="button" className="icon-btn" onClick={() => setDismissed(available)} aria-label="Dismiss"><Icon.x /></button>
    </div>
  );
}
