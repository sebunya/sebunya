import { describe, expect, it } from 'vitest';
import { classify } from '../../apps/web/src/lib/assistantRouter';
import { SYSTEM_PROMPT } from '../../apps/web/src/lib/assistant';

/**
 * Owner, 2026-10-13: Goldie is "the GoldPlus personal shopper", shown with a lifelike portrait and no
 * "AI" on screen. So the one thing that must never slip: asked whether she is a person, she says she is
 * virtual. The router answers that question itself (fixed text, no model), and the prompt says the same.
 */
describe('Goldie never passes as a person', () => {
  it.each([
    'Are you a real person?', 'are you human', 'Are you a bot?', 'Is this a real person?', 'am I talking to a human',
    'Am I chatting with someone real?', 'who am I talking to', 'Who are you?', 'what are you', 'are you AI?',
  ])('"%s" gets the fixed honest answer', (q) => {
    expect(classify(q)).toMatchObject({ intent: 'IDENTITY', deterministic: true });
  });
  it.each(['What are your prices?', 'Are you open today?', 'Are you in Kampala?', 'who sells original chargers', 'hello'])('"%s" is not mistaken for it', (q) => {
    expect(classify(q).intent).not.toBe('IDENTITY');
  });
  it('the prompt names her role and forbids claiming to be human', () => {
    expect(SYSTEM_PROMPT).toContain('personal shopper');
    expect(SYSTEM_PROMPT).toContain('not a person');
    expect(SYSTEM_PROMPT).toContain('Never claim to be human');
    expect(SYSTEM_PROMPT).not.toMatch(/a friendly, practical person at the shop counter/);
  });
});
