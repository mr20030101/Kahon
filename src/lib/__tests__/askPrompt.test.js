import { describe, expect, it } from 'vitest';
import { PROMPTS, SYSTEM, buildMessages, inFolder } from '../../../supabase/functions/ask-ai/prompt.ts';

describe('Ask AI prompt', () => {
  it('hides secrets in the task and project before they reach the model', () => {
    const { messages, hidden } = buildMessages({
      project: 'Spec\nDB_DATABASE=dev_api_xyinstra\nDB_PASSWORD=hunter2',
      task: 'Deploy to 10.1.2.3 with key gsk_abcdefghijklmnopqrstuvwxyz1234',
      ask: PROMPTS.summarize,
      today: '2026-11-04',
    });
    const sent = messages.map((m) => m.content).join('\n');
    for (const secret of ['dev_api_xyinstra', 'hunter2', '10.1.2.3', 'gsk_']) expect(sent).not.toContain(secret);
    expect(hidden).toBe(4);
    expect(messages[1].content).toContain('Today is 2026-11-04.');
    expect(messages[1].content).toContain(PROMPTS.summarize);
  });

  it('tells the model the security rules', () => {
    expect(SYSTEM).toMatch(/Never write passwords, API keys/);
    expect(SYSTEM).toMatch(/can't run commands/);
    expect(SYSTEM).toMatch(/deletes, overwrites, drops, prunes, resets or forces/);
  });

  it("reads files in the task's folder and its comments folder only", () => {
    const folder = 'p1/t1/';
    expect(inFolder('p1/t1/a.pdf', folder)).toBe(true);
    expect(inFolder('p1/t1/comments/b.pdf', folder)).toBe(true);
    expect(inFolder('p1/t1/other/c.pdf', folder)).toBe(false);
    expect(inFolder('p1/t2/a.pdf', folder)).toBe(false);
    expect(inFolder('p1/t1/../t2/a.pdf', folder)).toBe(false);
  });
});
