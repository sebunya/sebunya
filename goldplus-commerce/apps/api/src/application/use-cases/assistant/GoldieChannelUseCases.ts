import { formatWhatsAppReply, whatsappKey, type InboundText, type ReplyParts } from '../../../domain/assistant/WhatsAppGoldie';
import { closesMatter, isAbusive, silenceFor } from '../../../domain/assistant/CareDesk';
import type { ConversationArchiveUseCases } from './ConversationArchiveUseCases';

/** Sends a free-form WhatsApp message inside the 24-hour customer service window. */
export interface IWhatsAppMessenger {
  sendText(input: { phoneNumberId: string; to: string; text: string }): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }>;
}

/** Goldie's brain (the web container runs the router and the model): one turn for a channel. */
export interface IGoldieBrain {
  turn(input: { channel: 'whatsapp'; conversationKey: string; verifiedPhone: string; name: string | null; turns: Array<{ role: 'user' | 'assistant'; content: string }> }): Promise<(ReplyParts & { intent: string; mood: string; route: string; cacheId?: string | null }) | null>;
}

export interface GoldieWhatsAppSettings {
  /** GOLDIE_WHATSAPP_ENABLED=true and a messaging token saved with the WhatsApp settings. */
  enabled: boolean;
  /** Optional rollout allowlist (international digits); empty means everyone. */
  onlyNumbers: string[];
  /** The business number's Cloud API id, used when a delivery does not carry one. */
  phoneNumberId: string | null;
}

export type TeamReplyResult = { ok: true; sent: boolean; channel: string; note?: string } | { ok: false; code: 'NOT_FOUND' | 'NOT_SENT'; message: string };

const HISTORY = 12;

/**
 * Goldie across messaging channels. WhatsApp today: a customer's message is
 * filed first (so nothing is ever lost), then, unless a person from the shop
 * has taken the conversation, Goldie answers through the same brain as the
 * website, with the customer's verified number as their proof for orders and
 * points, and the reply is sent and filed.
 */
export class GoldieChannelUseCases {
  constructor(
    private readonly archive: ConversationArchiveUseCases,
    private readonly brain: IGoldieBrain,
    private readonly whatsapp: IWhatsAppMessenger,
    private readonly settings: () => GoldieWhatsAppSettings,
    private readonly log: (event: string, detail: Record<string, unknown>) => void = () => {},
    private readonly now: () => Date = () => new Date(),
    /** Team members' own numbers: their WhatsApp messages to the shop never get a Goldie reply. */
    private readonly staffNumbers: () => Promise<string[]> = async () => [],
  ) {}
  private staffCache: { at: number; numbers: string[] } = { at: 0, numbers: [] };
  private async staff(): Promise<string[]> {
    if (this.now().getTime() - this.staffCache.at < 5 * 60_000) return this.staffCache.numbers;
    const numbers = await this.staffNumbers().catch(() => this.staffCache.numbers);
    this.staffCache = { at: this.now().getTime(), numbers };
    return numbers;
  }

  status(): { whatsapp: 'on' | 'not_configured'; rollout: 'everyone' | 'test_numbers' } {
    const s = this.settings();
    return { whatsapp: s.enabled ? 'on' : 'not_configured', rollout: s.onlyNumbers.length ? 'test_numbers' : 'everyone' };
  }

  /** One inbound WhatsApp message (webhook signature already checked). Never throws: Meta is answered 200 regardless. */
  async handleWhatsApp(msg: InboundText): Promise<'answered' | 'filed' | 'duplicate' | 'skipped' | 'failed'> {
    const s = this.settings();
    if (!s.enabled) return 'skipped';
    if (s.onlyNumbers.length && !s.onlyNumbers.includes(msg.from)) return 'skipped';
    const key = whatsappKey(msg.from);
    try {
      const filed = await this.archive.logTurn({
        channel: 'whatsapp', channelKey: key, customerId: null,
        contact: { name: msg.name, phone: `+${msg.from}` },
        customer: { content: msg.text, channelMessageId: msg.messageId },
      });
      if (filed.duplicate) return 'duplicate';

      const thread = await this.archive.get(filed.conversationId);
      // When not to answer: a colleague has it, the matter is settled and this is "ok 👍", the same text pasted
      // again and again, a stream of abuse, or a team member's own number. Filed either way, never lost.
      const t = this.now().getTime();
      const customerLines = (thread?.messages ?? []).filter((m) => m.role === 'customer');
      const lastGoldie = [...(thread?.messages ?? [])].reverse().find((m) => m.role === 'goldie' || m.role === 'team');
      const silence = silenceFor({
        text: msg.text,
        teamHasIt: !!(filed.humanUntil && filed.humanUntil.getTime() > t),
        fromStaff: (await this.staff()).includes(msg.from),
        lastGoldieClosed: !!lastGoldie && closesMatter(lastGoldie.content),
        sameTextRecently: customerLines.filter((m) => m.content.trim().toLowerCase() === msg.text.trim().toLowerCase() && t - m.createdAt.getTime() < 10 * 60_000).length,
        abuseRecently: customerLines.filter((m) => isAbusive(m.content) && t - m.createdAt.getTime() < 3600_000).length,
      });
      if (silence) {
        // "ok, thanks" after a settled answer is the customer closing it: file it as resolved (never over a handover).
        if (silence === 'ACK_AFTER_CLOSE' && thread && !['handed_over', 'needs_human'].includes(thread.conversation.outcome)) await this.archive.setOutcome(filed.conversationId, 'resolved');
        this.log('GOLDIE_WHATSAPP_SILENT', { conversationId: filed.conversationId, reason: silence });
        return 'filed';
      }

      const turns = (thread?.messages ?? [])
        .filter((m) => m.role === 'customer' || m.role === 'goldie')
        .slice(-HISTORY)
        .map((m) => ({ role: m.role === 'customer' ? 'user' as const : 'assistant' as const, content: m.content }));
      // The brain wants alternating turns ending with the customer: merge consecutive same-role lines.
      const merged: typeof turns = [];
      for (const t of turns) { const last = merged[merged.length - 1]; if (last && last.role === t.role) last.content = `${last.content}\n${t.content}`; else merged.push({ ...t }); }
      while (merged.length && merged[0]!.role !== 'user') merged.shift();
      if (!merged.length || merged[merged.length - 1]!.role !== 'user') return 'filed';

      const reply = await this.brain.turn({ channel: 'whatsapp', conversationKey: key, verifiedPhone: msg.from, name: msg.name, turns: merged });
      if (!reply?.text) { this.log('GOLDIE_WHATSAPP_NO_REPLY', { conversationId: filed.conversationId }); return 'failed'; }
      const text = formatWhatsAppReply(reply);
      const phoneNumberId = msg.phoneNumberId ?? s.phoneNumberId;
      if (!phoneNumberId) { this.log('GOLDIE_WHATSAPP_NO_NUMBER_ID', {}); return 'failed'; }
      const sent = await this.whatsapp.sendText({ phoneNumberId, to: msg.from, text });
      if (!sent.ok) { this.log('GOLDIE_WHATSAPP_SEND_FAILED', { reason: sent.reason }); return 'failed'; }
      await this.archive.logReply(filed.conversationId, text, reply.route, sent.messageId, reply.intent, reply.mood, reply.cacheId ?? null);
      return 'answered';
    } catch (e) {
      this.log('GOLDIE_WHATSAPP_FAILED', { error: e instanceof Error ? e.message : String(e) });
      return 'failed';
    }
  }

  /** A person from the shop answers from the admin inbox. WhatsApp: sent to the customer, and Goldie stays quiet for 24 hours. */
  async teamReply(conversationId: string, text: string): Promise<TeamReplyResult> {
    const found = await this.archive.get(conversationId);
    if (!found) return { ok: false, code: 'NOT_FOUND', message: 'No such conversation.' };
    const c = found.conversation;
    if (c.channel !== 'whatsapp') {
      await this.archive.addTeamMessage(conversationId, text);
      return { ok: true, sent: false, channel: c.channel, note: 'Website chats cannot receive a reply here. The note is filed; reach the customer by their phone or email.' };
    }
    const s = this.settings();
    const to = (c.contactPhone ?? '').replace(/\D/g, '');
    if (!s.enabled || !s.phoneNumberId || !to) return { ok: false, code: 'NOT_SENT', message: 'WhatsApp sending is not configured, so the reply was not sent.' };
    const sent = await this.whatsapp.sendText({ phoneNumberId: s.phoneNumberId, to, text });
    if (!sent.ok) return { ok: false, code: 'NOT_SENT', message: `WhatsApp did not accept the message (${sent.reason}). Outside 24 hours of the customer's last message, WhatsApp only allows approved templates.` };
    await this.archive.addTeamMessage(conversationId, text);
    await this.archive.takeOver(conversationId, 24);
    return { ok: true, sent: true, channel: 'whatsapp' };
  }
}
