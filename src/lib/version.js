import { version } from '../../package.json';

// The app's version, from package.json — the one place it's set (bumped with `npm run release`).
// An import rather than a build-time constant, so a running dev server picks up a new version
// straight away. Only `version` is bundled, not the rest of package.json.
export const APP_VERSION = version;

// Where the deployed version is published: every build writes it next to index.html, and the
// dev server answers it from package.json (see vite.config.js).
export const VERSION_URL = '/version.json';

/** True when `candidate` is a later x.y.z than `current`. Anything unparseable is never newer. */
export function isNewerVersion(candidate, current) {
  const parse = (value) => {
    const parts = String(value).split('.').map(Number);
    return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
  };
  const next = parse(candidate);
  const now = parse(current);
  if (!next || !now) return false;

  for (let i = 0; i < 3; i++) {
    if (next[i] !== now[i]) return next[i] > now[i];
  }
  return false;
}

/** The version currently deployed, or null when it can't be read (offline, or an older deploy without the file). */
export async function fetchDeployedVersion() {
  try {
    // no-store: a cached answer would keep reporting the version this tab already has.
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}
