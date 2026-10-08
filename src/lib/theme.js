// Light / dark / follow the system. Stored per browser; applied as data-theme on <html>.
// index.html applies it before the app loads so there's no flash of the wrong theme.
const KEY = 'kahon:theme';

export function getTheme() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(value) {
  try {
    if (value === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch { /* storage unavailable: still applies for this visit */ }
  if (value === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', value);
}
