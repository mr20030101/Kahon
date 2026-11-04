// Hides secrets in text going to or coming from Ask AI: passwords, API keys, tokens, private keys,
// connection strings, .env-style settings for databases and services, and IP addresses. The AI
// never sees them, and anything secret-looking in its answer is masked before it's shown.
// Plain TypeScript (no Deno APIs), so the app's tests can check it too.

export const HIDDEN = '[hidden]';

// Setting names whose values are secret or say where a server or database is.
const SECRET_NAME = /pass(word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credential|auth|session|cookie|signing|salt|dsn|database|db[_-]|mysql|postgres|pgsql|redis|mongo|conn(ection)?[_-]?str|webhook|smtp|mail_(user|pass)|host|username|^user$|_user$/i;
// After "name:" (as in YAML, JSON or prose) only names that clearly are secrets, so prose like
// "Auth: fix the login page" isn't touched.
const STRICT_NAME = /pass(word|wd|phrase)?$|pwd$|secret|token$|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credentials?$|dsn$|database_url|db_(host|database|name|user(name)?|pass(word)?)|conn(ection)?[_-]?string/i;

// Tokens with a recognisable shape, wherever they appear.
const TOKENS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}\b/g, // Stripe
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google
  /\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI, Anthropic
  /\bgsk_[A-Za-z0-9]{20,}\b/g, // Groq
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, // SendGrid
  /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/g, // Resend
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
];

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const HARMLESS_IPS = new Set(['127.0.0.1', '0.0.0.0']);

/** The text with secrets replaced by [hidden], and how many were hidden. */
export function redact(input: string): { text: string; count: number } {
  let count = 0;
  const hide = (replacement: string) => {
    count += 1;
    return replacement;
  };
  let text = input;

  text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, () => hide(`${HIDDEN} private key`));
  // scheme://user:password@host -> scheme://[hidden]@host
  text = text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, (_m, scheme) => hide(`${scheme}${HIDDEN}@`));
  for (const re of TOKENS) text = text.replace(re, () => hide(HIDDEN));
  text = text.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/g, (_m, kind) => hide(`${kind} ${HIDDEN}`));
  // --password=…, --token …, and mysql -pSecret
  text = text.replace(/(--(?:password|pass|token|secret|api-key|apikey)(?:=|\s+))(["']?)[^\s"']+\2/gi, (_m, flag) => hide(`${flag}${HIDDEN}`));
  text = text.replace(/(\b(?:mysql|mysqldump|mariadb)\b[^\n]*?\s-p)(\S+)/g, (_m, before) => hide(`${before}${HIDDEN}`));

  // ENV_NAME=value anywhere in a line, as in "set `DB_PASSWORD=secret` in .env".
  text = text.replace(
    /\b([A-Z][A-Z0-9_]*(?:PASS|PASSWORD|PWD|SECRET|TOKEN|KEY|DATABASE|HOST|USER|USERNAME|DSN|URL))=("[^"\n]*"|'[^'\n]*'|[^\s`'"]+)/g,
    (m, name, value) => (/^(["']?)(\$\{?\w+\}?|<[^>]+>|)\1$/.test(value) || value.includes(HIDDEN) ? m : hide(`${name}=${HIDDEN}`)),
  );
  // NAME=value (.env, shell) and NAME: value / "name": "value" (YAML, JSON), one per line.
  text = text.replace(
    /^(\s*(?:export\s+|-\s+)?)(["']?)([A-Za-z][\w.-]*)\2(\s*)([:=])(\s*)(.*?)(,?)\s*$/gm,
    (line, lead, quote, name, s1, sep, s2, value, comma) => {
      const v = value.trim();
      if (!v || v.includes(HIDDEN) || /^[\[{]$/.test(v) || !(sep === '=' ? SECRET_NAME : STRICT_NAME).test(name)) return line;
      // Values that aren't secrets: booleans, empty strings, and placeholders like ${VAR} or <your-key>.
      if (/^(["']?)(true|false|null|none|""|''|\$\{?\w+\}?|<[^>]+>)\1$/i.test(v)) return line;
      // Code, not a value: calls, variables and env lookups (getenv('X'), $request->password, env('DB')).
      if (/[();]/.test(v) || /^\$|^process\.env|^import\.meta/.test(v)) return line;
      return hide(`${lead}${quote}${name}${quote}${s1}${sep}${s2}${HIDDEN}${comma}`);
    },
  );

  text = text.replace(IPV4, (ip) => (HARMLESS_IPS.has(ip) ? ip : hide(HIDDEN)));
  return { text, count };
}

/**
 * Redacts a stream of text line by line, since a secret can be split across chunks: push()
 * returns what's safe to show so far, flush() the rest at the end.
 */
export function lineRedactor() {
  let buffer = '';
  let count = 0;
  const run = (t: string) => {
    const r = redact(t);
    count += r.count;
    return r.text;
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      const end = buffer.lastIndexOf('\n');
      if (end === -1) return '';
      const ready = buffer.slice(0, end + 1);
      buffer = buffer.slice(end + 1);
      return run(ready);
    },
    flush() {
      const rest = buffer;
      buffer = '';
      return rest ? run(rest) : '';
    },
    get count() {
      return count;
    },
  };
}
