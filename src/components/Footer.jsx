import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_OWNER } from '../lib/constants';
import { APP_VERSION } from '../lib/version';
import { boldSegments, parseChangelog } from '../lib/changelog';
import { Modal } from './ui';

// The footer under every page, signed in or not, stating the build's version. Inside the app
// (`releaseNotes`) the version opens "What's new": CHANGELOG.md, bundled at build time, so the
// notes always match the version that opened them. On the sign-in page it's plain text.

// Loaded only when "What's new" is opened, as its own file, so the sign-in page never
// downloads the release notes.
function useReleases() {
  const [releases, setReleases] = useState(null);
  useEffect(() => {
    let cancelled = false;
    import('../../CHANGELOG.md?raw').then(({ default: changelog }) => {
      if (!cancelled) setReleases(parseChangelog(changelog));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return releases;
}

function Text({ value }) {
  return boldSegments(value).map((segment, index) =>
    segment.bold ? <strong key={index}>{segment.value}</strong> : <span key={index}>{segment.value}</span>);
}

function WhatsNew({ onClose }) {
  const releases = useReleases();
  return (
    <Modal title="What's new" onClose={onClose} width={640}>
      <div className="whats-new">
        {releases === null && <p className="muted">Loading…</p>}
        {releases?.length === 0 && <p className="muted">No release notes yet.</p>}
        {(releases ?? []).map((release) => (
          <section key={release.version}>
            <div className="release-head">
              <h3>v{release.version}</h3>
              {release.date && <span className="muted small">{release.date}</span>}
              {release.version === APP_VERSION && <span className="release-current">This version</span>}
            </div>
            {release.notes.map((note) => <p key={note} className="muted"><Text value={note} /></p>)}
            {release.groups.map((group) => (
              <div key={group.title} className="release-group">
                <p className="release-group-title">{group.title}</p>
                <ul>
                  {group.items.map((item) => <li key={item}><Text value={item} /></li>)}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

export default function Footer({ className = '', releaseNotes = false }) {
  const [showNotes, setShowNotes] = useState(false);
  return (
    <footer className={`app-footer ${className}`.trim()}>
      <span>© {new Date().getFullYear()} {APP_OWNER}</span>
      {releaseNotes ? (
        <button type="button" className="app-version link-like" onClick={() => setShowNotes(true)} title="What's new">
          Kahon v{APP_VERSION}
        </button>
      ) : (
        <span className="app-version">Kahon v{APP_VERSION}</span>
      )}
      {/* Portaled, so a footer inside a scrolling or transformed container can't trap it. */}
      {releaseNotes && showNotes && createPortal(<WhatsNew onClose={() => setShowNotes(false)} />, document.body)}
    </footer>
  );
}
