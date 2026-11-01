/**
 * Text for messaging channels, which get one message per turn (WhatsApp, Messenger, Instagram).
 */
/** Drops sentences that only narrate looking something up ("Let me check.", "I'll pull the power banks again…"). */
export function withoutNarration(raw: string): string {
  const sentences = raw.trim().match(/[^.!?]+[.!?]*\s*/g) ?? [];
  return sentences
    // Only when the checking verb follows the opener directly: "I'll ask the team to look into it" is a promise, kept.
    .filter((s) => !/^\s*((let me|i'?ll|i will|i'?m going to|i am going to)\s+(just\s+|quickly\s+|now\s+)?(check|look|pull|search|see|find|confirm|fetch|go through|run|double.?check)\b|let's see\b|one (moment|sec)\b|give me a (moment|second|sec)\b|(just\s+)?checking\b)/i.test(s))
    .join('').trim();
}
