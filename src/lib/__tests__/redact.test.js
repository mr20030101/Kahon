import { describe, expect, it } from 'vitest';
import { HIDDEN, lineRedactor, redact } from '../../../supabase/functions/_shared/redact.ts';

describe('redact', () => {
  it('hides .env database and service settings', () => {
    const { text, count } = redact([
      'APP_NAME=Kahon',
      'DB_CONNECTION=mysql',
      'DB_HOST=db.internal.example.com',
      'DB_DATABASE=dev_api_xyinstra',
      'DB_USERNAME=root',
      'DB_PASSWORD="s3cr3t!"',
      'MAIL_PASSWORD=abc123',
      'export STRIPE_SECRET=whatever',
      'DEBUG=true',
    ].join('\n'));
    expect(text).toContain('APP_NAME=Kahon');
    expect(text).toContain('DEBUG=true');
    for (const secret of ['db.internal', 'dev_api_xyinstra', 'root', 's3cr3t', 'abc123', 'whatever']) expect(text).not.toContain(secret);
    expect(count).toBe(7);
  });

  it('hides secrets in YAML and JSON, but leaves prose alone', () => {
    const { text } = redact('password: hunter2\n"api_key": "abcd1234efgh",\nAuth: fix the login page');
    expect(text).toBe(`password: ${HIDDEN}\n"api_key": ${HIDDEN},\nAuth: fix the login page`);
  });

  it('hides connection strings, tokens, keys and flags', () => {
    const input = [
      'mysql://admin:pa55@10.0.4.12:3306/app',
      'Authorization: Bearer abcdefghijklmnop1234',
      'key gsk_abcdefghijklmnopqrstuvwxyz1234',
      'mysqldump -u root -pTopSecret app',
      'php artisan thing --password=letmein',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const { text } = redact(input);
    for (const secret of ['pa55', '10.0.4.12', 'abcdefghijklmnop1234', 'gsk_', 'TopSecret', 'letmein', 'MIIEow']) expect(text).not.toContain(secret);
    expect(text).toContain('mysql://[hidden]@');
  });

  it("leaves code, placeholders and commands that aren't secrets", () => {
    const input = "password = getpass()\nDB_PASSWORD=${DB_PASSWORD}\nAPI_KEY=<your-key>\nphp artisan schema:dump --prune\nmkdir -p storage/app";
    expect(redact(input)).toEqual({ text: input, count: 0 });
  });

  it('hides settings mentioned mid-sentence', () => {
    expect(redact('Set `DB_DATABASE=dev_api_xyinstra` in .env').text).toBe(`Set \`DB_DATABASE=${HIDDEN}\` in .env`);
  });

  it('redacts a stream even when a secret is split across chunks', () => {
    const r = lineRedactor();
    const out = [r.push('Use DB_PASS'), r.push('WORD=sec'), r.push('ret\nthen run it'), r.flush()].join('');
    expect(out).toBe(`Use DB_PASSWORD=${HIDDEN}\nthen run it`);
    expect(r.count).toBe(1);
  });
});
