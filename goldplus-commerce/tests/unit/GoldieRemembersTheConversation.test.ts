import { describe, expect, it } from 'vitest';
import { classify } from '../../apps/web/src/lib/assistantRouter';
import { isConversationalReply, profileFirstName } from '../../apps/web/src/lib/goldieTurn';

/** Goldie reads a reply WITH the conversation, like a shop assistant, not each message as if it were the first. */
const after = (goldie: string, customer: string) => {
  const turns = [{ role: 'user' as const, content: 'Do you have power banks?' }, { role: 'assistant' as const, content: goldie }, { role: 'user' as const, content: customer }];
  return isConversationalReply(turns, classify(customer));
};
const LISTED = 'We have 3 that match: GoldPlus 10000mAh at UGX 45,000, Oraimo 20000mAh at UGX 89,000 and a 30000mAh at UGX 120,000.';
const ASKED = 'Which phone is it for?';

describe('a reply is read with the conversation', () => {
  it.each([
    [LISTED, 'how much is the second one?'],
    [LISTED, 'is it original?'],
    [LISTED, 'the cheaper one'],
    [LISTED, 'and for Samsung?'],
    [LISTED, 'do you have it in black'],
    [ASKED, 'Tecno Spark 10'],
    [ASKED, 'samsung a14'],
    [ASKED, 'iphone'],
    ['Shall I ask the team to call you?', 'yes please'],
  ])('after "%s", "%s" goes to the model with the history', (g, c) => expect(after(g, c)).toBe(true));

  it.each([
    [LISTED, 'thank you'],
    [LISTED, 'ok'],
    [LISTED, 'where is my order GP-202610-ABCD1234'],
    [LISTED, 'how much is delivery to Ntinda?'],
    [LISTED, 'my charger is fake'],
  ])('after "%s", "%s" keeps its own fixed answer', (g, c) => expect(after(g, c)).toBe(false));

  it('the very first message is never a "reply"', () => {
    expect(isConversationalReply([{ role: 'user', content: 'how much is it?' }], classify('how much is it?'))).toBe(false);
  });
});

describe('a WhatsApp profile name becomes a first name only when it is one', () => {
  it.each([['Rob', 'Rob'], ['sarah nakato', 'Sarah'], ['~ 🌸', null], ['GoldPlus Test', null], ['0772123456', null], ['Mr', null], ['ÉLODIE', 'Élodie']])('%s → %s', (n, want) => expect(profileFirstName(n)).toBe(want));
});
