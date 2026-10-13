import { randomUUID } from 'node:crypto';
import { SupportTicket } from '../../../domain/support/SupportTicket';
import { renderHandoverMail, renderTranscriptMail, type TranscriptTurn } from '../../../domain/assistant/ChatTranscript';
import type { ISupportRepository } from '../../ports/ISupportRepository';
import type {
  AssistantInterest, AssistantShopperContext, AssistantShopperKey,
  IAssistantContextReader, IAssistantInterestSink, IAssistantMailOutbox, INextBestActionAdvisor,
} from '../../ports/IAssistantConversationPorts';
import { isValidEmail, isValidUgandanPhone, normalizeEmail, normalizePhone, text } from '../../services/validationHelpers';

/** How many chat copies one address may receive in a day: enough for a real shopper, useless for spam. */
export const TRANSCRIPT_DAILY_CAP = 3;

export interface AssistantConversationConfig {
  siteUrl: string;
  whatsappUrl: string;
  supportInboxUrl: string;
}

export type HandoverResult = { ok: true; ticketId: string; copySent: boolean } | { ok: false; code: 'BAD_INPUT'; message: string };
export type TranscriptResult = { ok: true } | { ok: false; code: 'BAD_INPUT' | 'DAILY_CAP'; message: string };

const EMPTY_CONTEXT: AssistantShopperContext = { firstName: null, visits: 1, hasOrdered: false, topCategories: [], recentlyViewed: [], pastTopics: [] };

/**
 * Goldie beyond the answer: who she is talking to (read), what they asked
 * about (Customer DNA, consent-gated), and a chat passed on by email, to the
 * shop as a support ticket plus an email, or to the customer as their copy.
 */
export class AssistantConversationUseCases {
  constructor(
    private readonly support: ISupportRepository,
    private readonly mail: IAssistantMailOutbox,
    private readonly contextReader: IAssistantContextReader,
    private readonly interests: IAssistantInterestSink,
    private readonly config: AssistantConversationConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly nba: INextBestActionAdvisor | null = null,
    /** WhatsApp: the account whose verified phone this is, if exactly one. */
    private readonly userForPhone: (phone: string) => Promise<string | null> = async () => null,
  ) {}

  /** Never throws: a shopper with no history, or a failed read, is simply a new shopper. */
  async context(key: AssistantShopperKey): Promise<AssistantShopperContext> {
    let k = key;
    if (!k.userId && k.verifiedPhone) k = { ...k, userId: await this.userForPhone(k.verifiedPhone).catch(() => null) };
    if (!k.profileId && !k.userId && !k.fpClientId) return EMPTY_CONTEXT;
    try {
      const [ctx, nextBestAction] = await Promise.all([
        this.contextReader.read(k),
        k.userId && this.nba ? this.nba.forCustomer(k.userId).catch(() => null) : Promise.resolve(null),
      ]);
      return { ...ctx, nextBestAction };
    } catch { return EMPTY_CONTEXT; }
  }

  async recordInterest(key: AssistantShopperKey, interest: AssistantInterest): Promise<boolean> {
    const topic = text(interest.topic).slice(0, 120);
    if (!topic || (!key.fpClientId && !key.userId)) return false;
    try {
      return await this.interests.record(key, {
        intent: text(interest.intent).slice(0, 20),
        topic,
        phoneModel: text(interest.phoneModel).slice(0, 60) || null,
        page: text(interest.page).slice(0, 300) || null,
      });
    } catch { return false; }
  }

  async handOver(input: {
    name?: string | null; phone?: string | null; email?: string | null; note?: string | null; page?: string | null;
    turns: TranscriptTurn[]; userId: string | null; sendCopy?: boolean;
  }): Promise<HandoverResult> {
    const name = text(input.name).slice(0, 80) || null;
    const rawPhone = text(input.phone), rawEmail = text(input.email);
    const phone = rawPhone ? normalizePhone(rawPhone) : '';
    const email = rawEmail ? normalizeEmail(rawEmail) : '';
    if (rawPhone && !isValidUgandanPhone(phone)) return { ok: false, code: 'BAD_INPUT', message: 'That phone number does not look right. Check it, or leave it blank and give an email.' };
    if (rawEmail && !isValidEmail(email)) return { ok: false, code: 'BAD_INPUT', message: 'That email address does not look right. Check it, or leave it blank and give a phone number.' };
    if (!phone && !email) return { ok: false, code: 'BAD_INPUT', message: 'Give us a phone number or an email so the team can reply.' };
    const note = text(input.note).slice(0, 500) || null;
    const page = text(input.page).slice(0, 300) || null;
    const at = this.now();

    const ticketId = randomUUID();
    const transcriptText = input.turns.map((t) => `${t.role === 'user' ? (name || 'Customer') : 'Goldie'}: ${t.content}`).join('\n\n');
    const description = [note ? `Still needs: ${note}` : 'Asked Goldie to pass the chat to the team.', '', transcriptText].join('\n').slice(0, 5000);
    await this.support.save(SupportTicket.open(ticketId, input.userId, `Goldie chat: ${name || phone || email}`.slice(0, 255), description, 'inquiry', 'medium', {
      source: 'goldie', name, email, phone, note, page, turns: input.turns, legacyContact: [email, phone].filter(Boolean).join(' | '),
    }));

    const shopMail = renderHandoverMail({ name, phone: phone || null, email: email || null, note, page, turns: input.turns, at, adminUrl: this.config.supportInboxUrl });
    await this.mail.enqueue({ eventType: 'GOLDIE_HANDOVER', recipient: null, ...shopMail, replyTo: email || null, replyToName: name, idempotencyKey: `goldie-handover:${ticketId}`, relatedEntity: 'support_issue', relatedEntityId: ticketId });

    let copySent = false;
    if (email && input.sendCopy !== false) {
      const r = await this.emailTranscript({ email, firstName: name ? name.split(/\s+/)[0]! : null, turns: input.turns, key: `handover:${ticketId}` });
      copySent = r.ok;
    }
    return { ok: true, ticketId, copySent };
  }

  async emailTranscript(input: { email: string; firstName?: string | null; turns: TranscriptTurn[]; key: string }): Promise<TranscriptResult> {
    const email = normalizeEmail(text(input.email));
    if (!isValidEmail(email)) return { ok: false, code: 'BAD_INPUT', message: 'That email address does not look right.' };
    const at = this.now();
    const sent = await this.mail.countTranscriptsSince(email, new Date(at.getTime() - 24 * 3600_000));
    if (sent >= TRANSCRIPT_DAILY_CAP) return { ok: false, code: 'DAILY_CAP', message: 'We have already sent a few copies to that address today. Try again tomorrow, or save the chat on this phone.' };
    const firstName = text(input.firstName).split(/\s+/)[0]?.slice(0, 40) || null;
    const m = renderTranscriptMail({ firstName, turns: input.turns, at, whatsappUrl: this.config.whatsappUrl, siteUrl: this.config.siteUrl });
    await this.mail.enqueue({ eventType: 'GOLDIE_TRANSCRIPT', recipient: email, ...m, idempotencyKey: `goldie-transcript:${text(input.key).slice(0, 80)}`, relatedEntity: 'assistant_chat', relatedEntityId: null });
    return { ok: true };
  }
}
