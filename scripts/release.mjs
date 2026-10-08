// Cuts a release: bumps the version in package.json (the one source of truth — the footer
// reads it, see src/lib/version.js) and files CHANGELOG.md's "Unreleased" notes under the
// new number and today's date.
//
//   npm run release -- patch   1.0.0 -> 1.0.1  fixes only
//   npm run release -- minor   1.0.0 -> 1.1.0  new features
//   npm run release -- major   1.0.0 -> 2.0.0  changes to how existing features work
//
// Refuses to release with nothing under "Unreleased": a version with no notes tells nobody
// what changed. It doesn't commit or tag — that stays a deliberate step:
//   git commit -am "Release vX.Y.Z" && git tag vX.Y.Z

import { readFileSync, writeFileSync } from 'node:fs';

const PARTS = ['major', 'minor', 'patch'];
const part = process.argv[2];

if (!PARTS.includes(part)) {
  console.error('Usage: npm run release -- patch|minor|major');
  process.exit(1);
}

const packageUrl = new URL('../package.json', import.meta.url);
const lockUrl = new URL('../package-lock.json', import.meta.url);
const changelogUrl = new URL('../CHANGELOG.md', import.meta.url);

const pkg = JSON.parse(readFileSync(packageUrl, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[part];

const changelog = readFileSync(changelogUrl, 'utf8');
const heading = '## Unreleased';
const start = changelog.indexOf(heading);

if (start === -1) {
  console.error('CHANGELOG.md has no "## Unreleased" section.');
  process.exit(1);
}

const bodyStart = start + heading.length;
const nextSection = changelog.indexOf('\n## ', bodyStart);
const notes = changelog.slice(bodyStart, nextSection === -1 ? undefined : nextSection).trim();

if (notes === '') {
  console.error('Nothing under "## Unreleased" in CHANGELOG.md — add what changed first.');
  process.exit(1);
}

// Local date, not UTC: a release cut in the evening here would otherwise be dated tomorrow.
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

writeFileSync(
  changelogUrl,
  `${changelog.slice(0, start)}${heading}\n\n## ${next} — ${today}\n\n${notes}\n` +
    (nextSection === -1 ? '' : changelog.slice(nextSection)),
);

pkg.version = next;
writeFileSync(packageUrl, `${JSON.stringify(pkg, null, 2)}\n`);

// The lockfile repeats the version; left alone, the next `npm install` would quietly rewrite it.
const lock = JSON.parse(readFileSync(lockUrl, 'utf8'));
lock.version = next;
if (lock.packages?.['']) lock.packages[''].version = next;
writeFileSync(lockUrl, `${JSON.stringify(lock, null, 2)}\n`);

console.log(`Released v${next}. Commit and tag it with:`);
console.log(`  git commit -am "Release v${next}" && git tag v${next}`);
