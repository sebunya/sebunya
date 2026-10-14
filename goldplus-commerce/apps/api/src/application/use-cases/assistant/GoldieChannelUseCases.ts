import { MEDIA_MARKER_RE, UNREADABLE_PREFIX, formatWhatsAppReply, optOutWord, whatsappKey, type InboundText, type ReplyParts } from '../../../domain/assistant/WhatsAppGoldie';
import { closesMatter, isAbusive, silenceFor } from '../../../domain/assistant/CareDesk';
import type { ConversationArchiveUseCases } from './ConversationArchiveUseCases';

/** Sends a free-form WhatsApp message inside the 24-hour customer service window. */
export interface IWhatsAppMessenger {
  sendText(input: { phoneNumberId: string; to: string; text: string }): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }>;
  /** Blue ticks and "typing…" while the answer is prepared (best effort). */
  markRead?(input: { phoneNumberId: string; messageId: string; typing: boolean }): Promise<void>;
}

/** WhatsApp opt-outs (STOP / START): customer templates are not sent on WhatsApp to an opted-out number. */
export interface IWhatsAppOptOuts {
  stop(phoneE164: string, messageId: string): Promise<void>;
  start(phoneE164: string): Promise<void>;
}

export const STOP_REPLY = "Done. GoldPlus will not send you updates on WhatsApp any more; order updates will come by SMS. You can still message us here any time. Reply START to turn WhatsApp updates back on.";
export const START_REPLY = 'Welcome back. GoldPlus order updates will come to you on WhatsApp again. Reply STOP at any time to turn them off.';
export const UNREADABLE_REPLY = "Thank you. I can't open that kind of message here, so I'm passing it to the team, and a person will reply shortly. If you can, please type your question too.";

export const MEDIA_REPLY: Record<string, string> = {
  image: "Thank you for the photo. I'm passing it to the team now so a person can look at it properly, and they will reply here shortly.",
  audio: "Thank you for your voice note. I'm passing it to the team so a person can listen, and they will reply here shortly. If it is quicker, you can also type your question.",
  video: "Thank you for the video. I'm passing it to the team so a person can look at it, and they will reply here shortly.",
  document: "Thank you for the document. I'm passing it to the team, and they will reply here shortly.",
  sticker: '',
};

/** Goldie's brain (the web container runs the router and the model): one turn for a channel. */
export interface IGoldieBrain {
  turn(input:
    | { channel: 'whatsapp'; conversationKey: string; verifiedPhone: string; name: string | null; turns: Array<{ role: 'user' | 'assistant'; content: string }> }
    | { channel: 'messenger' | 'instagram'; conversationKey: string; senderId: string; turns: Array<{ role: 'user' | 'assistant'; content: string }> }
  ): Promise<(ReplyParts & { intent: string; mood: string; route: string; cacheId?: string | null }) | null>;
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
/** What a customer hears when Goldie cannot answer just now; a task makes sure a person follows up. */
export const HOLDING_REPLY = "Thank you for your message. I'm passing it to the team now, and someone will reply to you here shortly.";

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
    /** The Care Desk, for a customer Goldie could not answer (so a person does). */
    private readonly openTask: (input: { kind: 'follow_up'; title: string; customerName: string | null; customerPhone: string; conversationId: string; channel: 'whatsapp' }) => Promise<unknown> = async () => undefined,
    /** The account whose verified phone this WhatsApp number is (indexed), so the thread is linked to the customer. */
    private readonly customerForPhone: (digits: string) => Promise<string | null> = async () => null,
    /** Email a team reply to a website customer who left an email (outbox, CARE_REPLY_EMAIL). */
    private readonly emailCustomer: (input: { to: string; firstName: string | null; text: string; conversationId: string }) => Promise<boolean> = async () => false,
    /** Messenger / Instagram threads: the reply goes back through Meta's Send API (GoldieSocialUseCases). */
    private readonly socialReply: (conversation: { id: string; channel: string; channelKey: string }, text: string) => Promise<{ ok: true } | { ok: false; reason: string }> = async () => ({ ok: false, reason: 'not configured' }),
    private readonly optOuts: IWhatsAppOptOuts | null = null,
    /** How long to wait for the rest of a burst before answering (0 in tests). */
    private readonly burstWaitMs: number = 0,
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
    // STOP / START are honoured whether or not Goldie is switched on: they govern the shop's WhatsApp updates.
    const word = optOutWord(msg.text);
    if (word && this.optOuts) {
      // Filed first, like every message (the inbox shows it), and a redelivery of the same message is not answered twice.
      const filed = await this.archive.logTurn({
        channel: 'whatsapp', channelKey: whatsappKey(msg.from), customerId: null,
        contact: { name: msg.name, phone: `+${msg.from}` },
        customer: { content: msg.text, channelMessageId: msg.messageId },
      }).catch(() => null);
      if (filed?.duplicate) return 'duplicate';
      try {
        if (word === 'STOP') await this.optOuts.stop(`+${msg.from}`, msg.messageId); else await this.optOuts.start(`+${msg.from}`);
        const phoneNumberId = msg.phoneNumberId ?? s.phoneNumberId;
        if (phoneNumberId) await this.whatsapp.sendText({ phoneNumberId, to: msg.from, text: word === 'STOP' ? STOP_REPLY : START_REPLY });
        this.log(word === 'STOP' ? 'WHATSAPP_OPT_OUT' : 'WHATSAPP_OPT_IN', {});
        await this.archive.markCustomerMessage(msg.messageId, 'answered').catch(() => undefined);
      } catch (e) {
        this.log('WHATSAPP_OPT_OUT_FAILED', { error: e instanceof Error ? e.message : String(e) });
      }
      return 'answered';
    }
    if (!s.enabled) { this.log('GOLDIE_WHATSAPP_SKIPPED', { reason: 'GOLDIE_WHATSAPP_ENABLED is not true' }); return 'skipped'; }
    if (s.onlyNumbers.length && !s.onlyNumbers.includes(msg.from)) { this.log('GOLDIE_WHATSAPP_SKIPPED', { reason: 'not in GOLDIE_WHATSAPP_TEST_NUMBERS', ending: msg.from.slice(-3) }); return 'skipped'; }
    try {
      const customerId = await this.customerForPhone(msg.from).catch(() => null);
      const filed = await this.archive.logTurn({
        channel: 'whatsapp', channelKey: whatsappKey(msg.from), customerId,
        contact: { name: msg.name, phone: `+${msg.from}` },
        customer: { content: msg.text, channelMessageId: msg.messageId },
      });
      if (filed.duplicate) return 'duplicate';
      return await this.respond(filed.conversationId, msg);
    } catch (e) {
      // Filed but not answered (or not even filed): the recovery pass picks a filed message up within minutes.
      this.log('GOLDIE_WHATSAPP_FAILED', { error: e instanceof Error ? e.message : String(e) });
      return 'failed';
    }
  }

  /**
   * Durable replies: a customer message that was filed but never reached an outcome (the API restarted mid-turn,
   * the brain call crashed) is answered here, once. Each message is marked 'recovering' first, so a message that
   * fails again is not retried forever; it stays visible in the inbox and a person can pick it up.
   */
  async recoverPending(limit = 20): Promise<number> {
    const s = this.settings();
    if (!s.enabled) return 0;
    const t = this.now().getTime();
    // Three minutes: longer than a live turn can take (brain 45 s, send 10 s, alerts), so recovery never answers a
    // message the live path is still answering.
    const pending = await this.archive.pendingWhatsApp(new Date(t - 180_000), new Date(t - 23 * 3600_000), limit);
    let answered = 0;
    for (const p of pending) {
      if (!(await this.archive.claimCustomerMessage(p.messageId))) continue;
      const msg: InboundText = { from: p.phone, name: p.name, text: p.text, messageId: p.messageId, phoneNumberId: null, at: p.at };
      const outcome = await this.respond(p.conversationId, msg).catch(() => 'failed' as const);
      if (outcome === 'answered') answered += 1;
    }
    return answered;
  }

  /** Decide and send Goldie's reply to a filed message; every path records an outcome on the customer's message. */
  private async respond(conversationId: string, msg: InboundText): Promise<'answered' | 'filed' | 'failed'> {
    const s = this.settings();
    // Blue ticks and "typing…" straight away, so the customer sees they were read (best effort, never in the way).
    const readOn = msg.phoneNumberId ?? s.phoneNumberId;
    if (readOn && this.whatsapp.markRead) void this.whatsapp.markRead({ phoneNumberId: readOn, messageId: msg.messageId, typing: true }).catch(() => undefined);
    const mark = (outcome: 'answered' | 'silent' | 'held' | 'send_failed') => this.archive.markCustomerMessage(msg.messageId, outcome).catch(() => undefined);
    // A customer often sends two or three lines in a row ("hi" / "iPhone 11 battery?"): wait a moment, and answer
    // only from the newest line (its reply covers the earlier ones, merged), so a burst gets one reply, not three.
    if (this.burstWaitMs > 0) await new Promise((r) => setTimeout(r, this.burstWaitMs));
    // The last 40 messages are plenty for history, silence rules and repeats.
    const thread = await this.archive.get(conversationId, 40);
    const newestCustomer = [...(thread?.messages ?? [])].reverse().find((m) => m.role === 'customer');
    // Only when the newer line is words Goldie will answer (her reply then covers both): a newer photo, STOP or
    // unreadable message does not answer this one, so this one is answered on its own.
    const newerAnswersThis = !!newestCustomer && !newestCustomer.content.includes('⟦media:') && !newestCustomer.content.startsWith(UNREADABLE_PREFIX) && !optOutWord(newestCustomer.content);
    if (newestCustomer?.channelMessageId && newestCustomer.channelMessageId !== msg.messageId && newerAnswersThis) {
      this.log('GOLDIE_WHATSAPP_SILENT', { conversationId, reason: 'NEWER_MESSAGE' });
      await mark('silent');
      return 'filed';
    }
    // When not to answer: a colleague has it, the matter is settled and this is "ok 👍", the same text pasted
    // again and again, a stream of abuse, or a team member's own number. Filed either way, never lost.
    const t = this.now().getTime();
    const customerLines = (thread?.messages ?? []).filter((m) => m.role === 'customer');
    const lastGoldie = [...(thread?.messages ?? [])].reverse().find((m) => m.role === 'goldie' || m.role === 'team');
    const humanUntil = thread?.conversation.humanUntil ?? null;
    const silence = silenceFor({
      text: msg.text,
      teamHasIt: !!(humanUntil && humanUntil.getTime() > t),
      // A number in the trial list (GOLDIE_WHATSAPP_TEST_NUMBERS) is a tester even when it is also a team line.
      fromStaff: (await this.staff()).includes(msg.from) && !s.onlyNumbers.includes(msg.from),
      lastGoldieClosed: !!lastGoldie && closesMatter(lastGoldie.content),
      sameTextRecently: customerLines.filter((m) => m.content.trim().toLowerCase() === msg.text.trim().toLowerCase() && t - m.createdAt.getTime() < 10 * 60_000).length,
      abuseRecently: customerLines.filter((m) => isAbusive(m.content) && t - m.createdAt.getTime() < 3600_000).length,
    });
    if (silence) {
      // "ok, thanks" after a settled answer is the customer closing it: file it as resolved (never over a handover).
      if (silence === 'ACK_AFTER_CLOSE' && thread && !['handed_over', 'needs_human'].includes(thread.conversation.outcome)) await this.archive.setOutcome(conversationId, 'resolved');
      this.log('GOLDIE_WHATSAPP_SILENT', { conversationId, reason: silence });
      await mark('silent');
      return 'filed';
    }

    // A photo, voice note, video or document: Goldie cannot see it, so a person is asked to look, and the customer is
    // told so. With a caption, Goldie still answers the words.
    if (msg.media?.kind === 'sticker') { await mark('silent'); return 'filed'; }
    if (msg.text.startsWith(UNREADABLE_PREFIX)) {
      await this.openTask({ kind: 'follow_up', title: `WhatsApp message to look at: ${msg.text.slice(UNREADABLE_PREFIX.length, UNREADABLE_PREFIX.length + 40).replace(/\]$/, '').trim()} (open WhatsApp on the shop phone)`, customerName: msg.name, customerPhone: `+${msg.from}`, conversationId, channel: 'whatsapp' }).catch(() => undefined);
      const phoneNumberId = msg.phoneNumberId ?? s.phoneNumberId;
      if (!phoneNumberId) { await mark('held'); return 'filed'; }
      const sent = await this.whatsapp.sendText({ phoneNumberId, to: msg.from, text: UNREADABLE_REPLY });
      if (sent.ok) { await this.archive.logReply(conversationId, UNREADABLE_REPLY, 'deterministic', sent.messageId); await mark('answered'); return 'answered'; }
      await mark('send_failed');
      return 'failed';
    }
    if (msg.media) {
      const caption = msg.text.replace(MEDIA_MARKER_RE, '').replace(/^\[[^\]]*\]\s*/, '').trim();
      const kindWord = msg.media.kind === 'image' ? 'photo' : msg.media.kind === 'audio' ? 'voice note' : msg.media.kind;
      await this.openTask({ kind: 'follow_up', title: `WhatsApp ${kindWord} to look at${caption ? `: ${caption.slice(0, 100)}` : ''}`, customerName: msg.name, customerPhone: `+${msg.from}`, conversationId, channel: 'whatsapp' }).catch(() => undefined);
      if (!caption) {
        const text = MEDIA_REPLY[msg.media.kind] ?? '';
        const phoneNumberId = msg.phoneNumberId ?? s.phoneNumberId;
        if (!text || !phoneNumberId) { await mark('held'); return 'filed'; }
        const sent = await this.whatsapp.sendText({ phoneNumberId, to: msg.from, text });
        if (sent.ok) { await this.archive.logReply(conversationId, text, 'deterministic', sent.messageId); await mark('answered'); return 'answered'; }
        await mark('send_failed');
        return 'failed';
      }
    }

    const turns = (thread?.messages ?? [])
      .filter((m) => m.role === 'customer' || m.role === 'goldie')
      .slice(-HISTORY)
      .map((m) => ({ role: m.role === 'customer' ? 'user' as const : 'assistant' as const, content: m.content.replace(MEDIA_MARKER_RE, '(sent something you cannot see; a person will look at it)') }));
    // The brain wants alternating turns ending with the customer: merge consecutive same-role lines.
    const merged: typeof turns = [];
    for (const x of turns) { const last = merged[merged.length - 1]; if (last && last.role === x.role) last.content = `${last.content}\n${x.content}`; else merged.push({ ...x }); }
    while (merged.length && merged[0]!.role !== 'user') merged.shift();
    if (!merged.length || merged[merged.length - 1]!.role !== 'user') { await mark('silent'); return 'filed'; }

    const reply = await this.brain.turn({ channel: 'whatsapp', conversationKey: whatsappKey(msg.from), verifiedPhone: msg.from, name: msg.name, turns: merged });
    const phoneNumberId = msg.phoneNumberId ?? s.phoneNumberId;
    if (!phoneNumberId) { this.log('GOLDIE_WHATSAPP_NO_NUMBER_ID', {}); return 'failed'; }
    if (!reply?.text) {
      // Goldie could not answer (brain unreachable or failed): never leave the customer unanswered. One warm
      // holding line (not repeated while it is the last thing said) and a task, so a person replies.
      this.log('GOLDIE_WHATSAPP_NO_REPLY', { conversationId });
      if (lastGoldie?.content !== HOLDING_REPLY) {
        const sent = await this.whatsapp.sendText({ phoneNumberId, to: msg.from, text: HOLDING_REPLY });
        if (sent.ok) await this.archive.logReply(conversationId, HOLDING_REPLY, 'fallback', sent.messageId);
      }
      await this.openTask({ kind: 'follow_up', title: `WhatsApp message waiting for a reply: ${msg.text.slice(0, 120)}`, customerName: msg.name, customerPhone: `+${msg.from}`, conversationId, channel: 'whatsapp' }).catch(() => undefined);
      await mark('held');
      return 'failed';
    }
    const text = formatWhatsAppReply(reply);
    const sent = await this.whatsapp.sendText({ phoneNumberId, to: msg.from, text });
    if (!sent.ok) {
      // WhatsApp refused (24-hour window, token, number): a person must reach the customer another way.
      this.log('GOLDIE_WHATSAPP_SEND_FAILED', { reason: sent.reason });
      await this.openTask({ kind: 'follow_up', title: `WhatsApp reply could not be sent (${sent.reason.slice(0, 60)}): ${msg.text.slice(0, 100)}`, customerName: msg.name, customerPhone: `+${msg.from}`, conversationId, channel: 'whatsapp' }).catch(() => undefined);
      await mark('send_failed');
      return 'failed';
    }
    await this.archive.logReply(conversationId, text, reply.route, sent.messageId, reply.intent, reply.mood, reply.cacheId ?? null);
    await mark('answered');
    return 'answered';
  }

  /** A person from the shop answers from the admin inbox. WhatsApp: sent to the customer, and Goldie stays quiet for 24 hours. */
  async teamReply(conversationId: string, text: string): Promise<TeamReplyResult> {
    const found = await this.archive.get(conversationId);
    if (!found) return { ok: false, code: 'NOT_FOUND', message: 'No such conversation.' };
    const c = found.conversation;
    if (c.channel === 'messenger' || c.channel === 'instagram') {
      const where = c.channel === 'messenger' ? 'Messenger' : 'Instagram';
      const r = await this.socialReply({ id: c.id, channel: c.channel, channelKey: c.channelKey }, text);
      return r.ok ? { ok: true, sent: true, channel: c.channel } : { ok: false, code: 'NOT_SENT', message: `${where} did not accept the message (${r.reason}). Outside 24 hours of the customer's last message, ${where} does not allow a normal reply.` };
    }
    if (c.channel !== 'whatsapp') {
      // A website customer who left an email gets the reply by email; otherwise it is a note for the team.
      const sent = c.contactEmail ? await this.emailCustomer({ to: c.contactEmail, firstName: c.contactName ? c.contactName.split(/\s+/)[0]! : null, text, conversationId }).catch(() => false) : false;
      await this.archive.addTeamMessage(conversationId, text);
      return sent
        ? { ok: true, sent: true, channel: 'email' }
        : { ok: true, sent: false, channel: c.channel, note: 'This customer left no email, so the reply is filed as a note. Call or WhatsApp them on the number above.' };
    }
    const s = this.settings();
    const to = (c.contactPhone ?? '').replace(/\D/g, '');
    if (!s.enabled || !s.phoneNumberId || !to) return { ok: false, code: 'NOT_SENT', message: 'WhatsApp sending is not configured, so the reply was not sent.' };
    // Meta accepts a normal message outside the 24-hour window and only reports the failure later, so the admin
    // would show "sent" for a message that never arrives: refuse it here, with the reason.
    const lastCustomer = [...found.messages].reverse().find((m) => m.role === 'customer');
    if (!lastCustomer || this.now().getTime() - lastCustomer.createdAt.getTime() > 24 * 3600_000) {
      return { ok: false, code: 'NOT_SENT', message: "The customer's last WhatsApp message is more than 24 hours old, so WhatsApp will not deliver a normal reply. Call or text them on the number above; the conversation reopens when they write again." };
    }
    const sent = await this.whatsapp.sendText({ phoneNumberId: s.phoneNumberId, to, text });
    if (!sent.ok) return { ok: false, code: 'NOT_SENT', message: `WhatsApp did not accept the message (${sent.reason}). Outside 24 hours of the customer's last message, WhatsApp only allows approved templates.` };
    await this.archive.addTeamMessage(conversationId, text);
    await this.archive.takeOver(conversationId, 24);
    return { ok: true, sent: true, channel: 'whatsapp' };
  }
}
