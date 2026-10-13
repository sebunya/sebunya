import { formatSocialReply, parseSocialMessages, socialKey, type SocialInbound, type SocialPlatform } from '../../../domain/assistant/SocialGoldie';
import { subscriptionChallenge, verifyWebhookSignature } from '../../../domain/advertising/WhatsAppAdReferrals';
import { closesMatter, isAbusive, silenceFor } from '../../../domain/assistant/CareDesk';
import type { ConversationArchiveUseCases } from './ConversationArchiveUseCases';
import { HOLDING_REPLY, type IGoldieBrain } from './GoldieChannelUseCases';

/** Sends a reply through Meta's Send API inside the 24-hour messaging window. */
export interface ISocialMessenger {
  sendText(input: { platform: SocialPlatform; recipientId: string; text: string }): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }>;
}

export interface GoldieSocialSettings {
  /** GOLDIE_MESSENGER_ENABLED / GOLDIE_INSTAGRAM_ENABLED = true and a page token (GOLDIE_META_PAGE_TOKEN). */
  messenger: boolean;
  instagram: boolean;
}

export type SocialOutcome = 'answered' | 'filed' | 'duplicate' | 'skipped' | 'failed';
const HISTORY = 12;
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Goldie on Facebook Messenger and Instagram Direct. The same promise as WhatsApp: every message is filed first
 * (nothing lost), the same rules decide when not to answer, the same brain answers, and when she cannot, the
 * customer gets a warm holding line and a Care Desk task makes sure a person replies. Off until configured.
 */
export class GoldieSocialUseCases {
  constructor(
    private readonly archive: ConversationArchiveUseCases,
    private readonly brain: IGoldieBrain,
    private readonly messenger: ISocialMessenger,
    private readonly settings: () => GoldieSocialSettings,
    /** The Meta app's secrets (the same app as WhatsApp): signature check and webhook verification. */
    private readonly secrets: () => Promise<{ appSecret: string; verifyToken: string } | null>,
    private readonly openTask: (input: { kind: 'follow_up'; title: string; conversationId: string; channel: SocialPlatform }) => Promise<unknown> = async () => undefined,
    private readonly log: (event: string, detail: Record<string, unknown>) => void = () => {},
    private readonly now: () => Date = () => new Date(),
    private readonly onOutcome: (platform: SocialPlatform, outcome: SocialOutcome) => void = () => {},
  ) {}

  status(): { messenger: 'on' | 'not_configured'; instagram: 'on' | 'not_configured' } {
    const s = this.settings();
    return { messenger: s.messenger ? 'on' : 'not_configured', instagram: s.instagram ? 'on' : 'not_configured' };
  }

  /** Meta's webhook verification handshake (GET). */
  async verifySubscription(query: { mode?: string | null; token?: string | null; challenge?: string | null }): Promise<string | null> {
    const s = this.settings();
    if (!s.messenger && !s.instagram) return null;
    const sec = await this.secrets().catch(() => null);
    return sec?.verifyToken ? subscriptionChallenge(query, sec.verifyToken) : null;
  }

  /**
   * A webhook delivery (POST). The signature is checked against the raw body; each text message is then handled
   * on its own after Meta has been answered (Meta retries slow webhooks, and a retry is a duplicate here).
   */
  async receive(rawBody: string, signatureHeader: string | null | undefined): Promise<{ status: 200 | 401 | 404 | 413; messages: number }> {
    const s = this.settings();
    if (!s.messenger && !s.instagram) return { status: 404, messages: 0 };
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return { status: 413, messages: 0 };
    const sec = await this.secrets().catch(() => null);
    if (!sec?.appSecret || !verifyWebhookSignature(rawBody, signatureHeader, sec.appSecret)) return { status: 401, messages: 0 };
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { return { status: 200, messages: 0 }; }
    const messages = parseSocialMessages(payload, this.now()).filter((m) => s[m.platform]);
    for (const m of messages) void this.handle(m).then((o) => this.onOutcome(m.platform, o));
    return { status: 200, messages: messages.length };
  }

  /** One inbound message. Never throws. */
  async handle(msg: SocialInbound): Promise<SocialOutcome> {
    if (!this.settings()[msg.platform]) return 'skipped';
    try {
      const filed = await this.archive.logTurn({
        channel: msg.platform, channelKey: socialKey(msg.platform, msg.senderId), customerId: null,
        contact: {}, customer: { content: msg.text, channelMessageId: msg.messageId },
      });
      if (filed.duplicate) return 'duplicate';
      return await this.respond(filed.conversationId, msg);
    } catch (e) {
      this.log('GOLDIE_SOCIAL_FAILED', { platform: msg.platform, error: e instanceof Error ? e.message : String(e) });
      return 'failed';
    }
  }

  /**
   * Durable replies, as on WhatsApp: a filed message that never reached an outcome (a restart mid-turn) is answered
   * once; each is claimed first, so a message that fails again is not retried forever.
   */
  async recoverPending(limit = 20): Promise<number> {
    const s = this.settings();
    if (!s.messenger && !s.instagram) return 0;
    const t = this.now().getTime();
    const pending = await this.archive.pendingSocial(new Date(t - 90_000), new Date(t - 23 * 3600_000), limit);
    let answered = 0;
    for (const p of pending) {
      if (!s[p.channel] || !(await this.archive.claimCustomerMessage(p.messageId))) continue;
      const senderId = p.channelKey.replace(/^(fb|ig):/, '');
      const outcome = await this.respond(p.conversationId, { platform: p.channel, senderId, recipientId: '', text: p.text, messageId: p.messageId, at: p.at }).catch(() => 'failed' as const);
      if (outcome === 'answered') answered += 1;
    }
    return answered;
  }

  private async respond(conversationId: string, msg: SocialInbound): Promise<'answered' | 'filed' | 'failed'> {
    const mark = (outcome: 'answered' | 'silent' | 'held' | 'send_failed') => this.archive.markCustomerMessage(msg.messageId, outcome).catch(() => undefined);
    const thread = await this.archive.get(conversationId, 40);
    const t = this.now().getTime();
    const customerLines = (thread?.messages ?? []).filter((m) => m.role === 'customer');
    const lastGoldie = [...(thread?.messages ?? [])].reverse().find((m) => m.role === 'goldie' || m.role === 'team');
    const humanUntil = thread?.conversation.humanUntil ?? null;
    const silence = silenceFor({
      text: msg.text,
      teamHasIt: !!(humanUntil && humanUntil.getTime() > t),
      fromStaff: false,
      lastGoldieClosed: !!lastGoldie && closesMatter(lastGoldie.content),
      sameTextRecently: customerLines.filter((m) => m.content.trim().toLowerCase() === msg.text.trim().toLowerCase() && t - m.createdAt.getTime() < 10 * 60_000).length,
      abuseRecently: customerLines.filter((m) => isAbusive(m.content) && t - m.createdAt.getTime() < 3600_000).length,
    });
    if (silence) {
      if (silence === 'ACK_AFTER_CLOSE' && thread && !['handed_over', 'needs_human'].includes(thread.conversation.outcome)) await this.archive.setOutcome(conversationId, 'resolved');
      await mark('silent');
      return 'filed';
    }
    const turns = (thread?.messages ?? [])
      .filter((m) => m.role === 'customer' || m.role === 'goldie')
      .slice(-HISTORY)
      .map((m) => ({ role: m.role === 'customer' ? 'user' as const : 'assistant' as const, content: m.content }));
    const merged: typeof turns = [];
    for (const x of turns) { const last = merged[merged.length - 1]; if (last && last.role === x.role) last.content = `${last.content}\n${x.content}`; else merged.push({ ...x }); }
    while (merged.length && merged[0]!.role !== 'user') merged.shift();
    if (!merged.length || merged[merged.length - 1]!.role !== 'user') { await mark('silent'); return 'filed'; }

    const where = msg.platform === 'messenger' ? 'Messenger' : 'Instagram';
    const reply = await this.brain.turn({ channel: msg.platform, conversationKey: socialKey(msg.platform, msg.senderId), senderId: msg.senderId, turns: merged });
    if (!reply?.text) {
      if (lastGoldie?.content !== HOLDING_REPLY) {
        const sent = await this.messenger.sendText({ platform: msg.platform, recipientId: msg.senderId, text: HOLDING_REPLY });
        if (sent.ok) await this.archive.logReply(conversationId, HOLDING_REPLY, 'fallback', sent.messageId);
      }
      await this.openTask({ kind: 'follow_up', title: `${where} message waiting for a reply: ${msg.text.slice(0, 120)}`, conversationId, channel: msg.platform }).catch(() => undefined);
      await mark('held');
      return 'failed';
    }
    const text = formatSocialReply(reply, msg.platform);
    const sent = await this.messenger.sendText({ platform: msg.platform, recipientId: msg.senderId, text });
    if (!sent.ok) {
      this.log('GOLDIE_SOCIAL_SEND_FAILED', { platform: msg.platform, reason: sent.reason });
      await this.openTask({ kind: 'follow_up', title: `${where} reply could not be sent (${sent.reason.slice(0, 60)}): ${msg.text.slice(0, 100)}`, conversationId, channel: msg.platform }).catch(() => undefined);
      await mark('send_failed');
      return 'failed';
    }
    await this.archive.logReply(conversationId, text, reply.route, sent.messageId, reply.intent, reply.mood, reply.cacheId ?? null);
    await mark('answered');
    return 'answered';
  }

  /** A person replies from the admin inbox to a Messenger or Instagram thread; Goldie stays quiet for 24 hours. */
  async teamReply(conversation: { id: string; channel: string; channelKey: string }, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const platform = conversation.channel as SocialPlatform;
    if (platform !== 'messenger' && platform !== 'instagram') return { ok: false, reason: 'not a social thread' };
    if (!this.settings()[platform]) return { ok: false, reason: `${platform === 'messenger' ? 'Messenger' : 'Instagram'} sending is not configured` };
    const recipientId = conversation.channelKey.replace(/^(fb|ig):/, '');
    const sent = await this.messenger.sendText({ platform, recipientId, text });
    if (!sent.ok) return { ok: false, reason: sent.reason };
    await this.archive.addTeamMessage(conversation.id, text);
    await this.archive.takeOver(conversation.id, 24);
    return { ok: true };
  }
}
