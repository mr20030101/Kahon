// Finds commands in an Ask AI answer, so the app can remind people to check them before running
// them and flag the ones that delete, overwrite or reset things.

const COMMAND = /^\s*(?:\$\s+|>\s+)?(?:sudo\s+)?(?:php\s+artisan|artisan|composer|npm|npx|yarn|pnpm|git|rm|mv|cp|chmod|chown|mysql|mysqldump|mariadb|psql|pg_dump|pg_restore|redis-cli|mongo|mongosh|docker|docker-compose|kubectl|helm|ssh|scp|rsync|curl|wget|python3?|pip|node|bash|sh|zsh|supabase|vercel|heroku|aws|gcloud|az|terraform|dd|mkfs|systemctl|service|kill|pkill|truncate)\b/i;
const SQL = /^\s*(?:drop|delete|truncate|alter|update|insert|grant|revoke|create)\s/i;

// [pattern, what it does], checked against each command.
const DESTRUCTIVE = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|-rf|-fr)\b/i, 'deletes files and folders without asking'],
  [/\bdrop\s+(table|database|schema|index|column|view|user)\b/i, 'drops database objects'],
  [/\btruncate\b/i, 'empties tables'],
  [/\bdelete\s+from\b/i, 'deletes rows'],
  [/\bupdate\s+[\w."`]+\s+set\b(?![\s\S]*\bwhere\b)/i, 'changes every row (no WHERE)'],
  [/\bmigrate:(fresh|reset|refresh|rollback)\b|\bdb:wipe\b|\bmigrate\s+reset\b|\bdb\s+reset\b/i, 'resets or rolls back the database'],
  [/--prune\b|\bprune\b/i, 'deletes old or unused files'],
  [/--force\b/i, 'skips safety checks (--force)'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+(?:\S+\s+)*(-f|--force(-with-lease)?)\b|checkout\s+--\s+\.|branch\s+-D)/i, 'discards changes or rewrites history'],
  [/\bchmod\s+(-R\s+)?777\b/i, 'lets anyone change the files'],
  [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, 'runs a script straight from the internet'],
  [/\bmkfs\b|\bdd\s+if=/i, 'overwrites a disk'],
  [/\bdocker\s+(system\s+prune|volume\s+(rm|prune)|rm\s+-f|rmi\s+-f)/i, 'deletes containers, images or volumes'],
  [/\bkubectl\s+delete\b|\bterraform\s+destroy\b/i, 'deletes infrastructure'],
  [/\b(kill|pkill)\s+-9\b/i, 'force-stops processes'],
];

/**
 * { commands, risky }: the commands in an answer (lines in ``` blocks, `inline code`, and lines
 * that start like a command), and the risky ones with what each does.
 */
export function commandRisks(text = '') {
  const found = [];
  let inFence = false;
  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    if (inFence) {
      if (!line.startsWith('#') && !line.startsWith('//')) found.push(line);
      continue;
    }
    const bare = line.replace(/^[-*]\s+/, '');
    if (COMMAND.test(bare) || SQL.test(bare)) found.push(bare);
    for (const m of line.matchAll(/`([^`\n]+)`/g)) if (COMMAND.test(m[1]) || SQL.test(m[1])) found.push(m[1].trim());
  }
  const commands = [...new Set(found)];
  const risky = commands.flatMap((command) => {
    const why = DESTRUCTIVE.filter(([re]) => re.test(command)).map(([, w]) => w);
    return why.length ? [{ command, why }] : [];
  });
  return { commands, risky };
}
