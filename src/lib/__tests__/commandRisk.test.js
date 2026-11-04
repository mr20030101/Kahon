import { describe, expect, it } from 'vitest';
import { commandRisks } from '../commandRisk';

describe('commandRisks', () => {
  it('finds commands in code blocks, inline code and command lines', () => {
    const { commands, risky } = commandRisks('Run this:\n```\nphp artisan migrate\n```\nThen `npm run build`.\n- git status\nNothing else to do.');
    expect(commands).toEqual(['php artisan migrate', 'npm run build', 'git status']);
    expect(risky).toEqual([]);
  });

  it('flags commands that delete, reset or force', () => {
    const { risky } = commandRisks([
      '```', 'php artisan schema:dump --prune', 'php artisan migrate:fresh --force', 'rm -rf storage', 'DROP TABLE users;', 'UPDATE users SET admin = 1;', '```',
    ].join('\n'));
    expect(risky.map((r) => r.command)).toEqual([
      'php artisan schema:dump --prune', 'php artisan migrate:fresh --force', 'rm -rf storage', 'DROP TABLE users;', 'UPDATE users SET admin = 1;',
    ]);
    expect(risky[1].why).toEqual(['resets or rolls back the database', 'skips safety checks (--force)']);
  });

  it("doesn't flag safe SQL or prose", () => {
    const { commands, risky } = commandRisks('UPDATE users SET name = 1 WHERE id = 2;\nWe should drop the old design.');
    expect(commands).toEqual(['UPDATE users SET name = 1 WHERE id = 2;']);
    expect(risky).toEqual([]);
  });
});
