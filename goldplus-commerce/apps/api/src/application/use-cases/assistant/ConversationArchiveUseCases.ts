import type { IAssistantConversationStore, ArchiveFilters } from '../../ports/IAssistantConversationStore';
import {
  ARCHIVE_RETENTION_DAYS, isMood, nextOutcome, redact, worseMood,
  type ArchiveChannel, type ArchiveMood, type ArchiveOutcome,
} from '../../../domain/assistant/ConversationArchive';

export interface LogTurnInput {
  channel: ArchiveChannel;
  channelKey: string;
  customerId: string | null;
  page?: string | null;
  contact?: { name?: string | null; phone?: string | null; email?: string | null };
  customer: { content: string; channelMessageId?: string | null };
  goldie?: { content: string; route?: string | null; channelMessageId?: string | null; cacheId?: string | null } | null;
  intent?: string | null;
  mood?: string | null;
}

/** Topics that say nothing about what a customer came for are not filed as a topic. */
const QUIET_TOPICS = new Set(['GREETING', 'IDENTITY', 'CLARIFY', 'UNKNOWN']);

/**
 * The Goldie conversation archive: every turn on every channel filed with its
 * topic, mood and outcome; the admin inbox, the meeting summary, a team
 * takeover (WhatsApp: Goldie stays quiet while a person answers), and the
 * 365-day retention purge.
 */
export class ConversationArchiveUseCases {
  constructor(private readonly store: IAssistantConversationStore, private readonly now: () => Date = () => new Date()) {}

  async logTurn(input: LogTurnInput): Promise<{ conversationId: string; duplicate: boolean; humanUntil: Date | null }> {
    const conv = await this.store.open({ channel: input.channel, channelKey: input.channelKey.slice(0, 128), customerId: input.customerId, page: input.page ?? null, contact: input.contact });
    const mood: ArchiveMood = isMood(input.mood) ? input.mood : 'neutral';
    const intent = (input.intent ?? '').slice(0, 20) || null;
    const filed = await this.store.addMessage(conv.id, { role: 'customer', content: redact(input.customer.content), intent, mood, channelMessageId: input.customer.channelMessageId ?? null });
    if (!filed) return { conversationId: conv.id, duplicate: true, humanUntil: conv.humanUntil };
    if (input.goldie?.content) await this.store.addMessage(conv.id, { role: 'goldie', content: redact(input.goldie.content), intent, route: input.goldie.route ?? null, channelMessageId: input.goldie.channelMessageId ?? null, cacheId: input.goldie.cacheId ?? null });
    const topic = intent && !QUIET_TOPICS.has(intent) ? intent : null;
    await this.store.update(conv.id, {
      lastTopic: topic ?? undefined,
      firstTopic: !conv.firstTopic && topic ? topic : undefined,
      worstMood: worseMood(conv.worstMood, mood),
      outcome: nextOutcome(conv.outcome, { mood }),
      aiTurn: input.goldie?.route === 'ai',
      contact: input.contact,
    });
    return { conversationId: conv.id, duplicate: false, humanUntil: conv.humanUntil };
  }

  /** Goldie's reply sent after the customer's message was filed (WhatsApp: the reply is produced after the inbound is stored). */
  async logReply(conversationId: string, content: string, route: string | null, channelMessageId: string | null, intent?: string | null, mood?: string | null, cacheId?: string | null): Promise<void> {
    const found = await this.store.get(conversationId);
    if (!found) return;
    const m: ArchiveMood = isMood(mood) ? mood : 'neutral';
    const topic = intent && !QUIET_TOPICS.has(intent) ? intent.slice(0, 20) : null;
    await this.store.addMessage(conversationId, { role: 'goldie', content: redact(content), intent: intent ?? null, route, channelMessageId, cacheId: cacheId ?? null });
    await this.store.update(conversationId, {
      aiTurn: route === 'ai', lastTopic: topic ?? undefined, firstTopic: !found.conversation.firstTopic && topic ? topic : undefined,
      worstMood: worseMood(found.conversation.worstMood, m), outcome: nextOutcome(found.conversation.outcome, { mood: m }),
    });
  }

  async markHandover(channel: ArchiveChannel, channelKey: string, input: { ticketId: string | null; contact?: { name?: string | null; phone?: string | null; email?: string | null }; customerId?: string | null }): Promise<void> {
    const conv = await this.store.findByKey(channel, channelKey.slice(0, 128)) ?? await this.store.open({ channel, channelKey: channelKey.slice(0, 128), customerId: input.customerId ?? null, page: null, contact: input.contact });
    await this.store.update(conv.id, { outcome: 'handed_over', supportTicketId: input.ticketId, contact: input.contact });
  }

  /** A person from the shop takes the conversation; on WhatsApp Goldie stays quiet until `hours` from now. 0 hands it back. */
  async takeOver(id: string, hours: number): Promise<boolean> {
    const found = await this.store.get(id);
    if (!found) return false;
    const until = hours > 0 ? new Date(this.now().getTime() + Math.min(hours, 72) * 3600_000) : null;
    await this.store.update(id, { humanUntil: until, outcome: until ? 'handed_over' : found.conversation.outcome });
    return true;
  }

  async setOutcome(id: string, outcome: ArchiveOutcome): Promise<boolean> {
    if (!(await this.store.get(id))) return false;
    await this.store.update(id, { outcome });
    return true;
  }

  /** A note from the team, filed in the thread (WhatsApp: also sent by the caller). */
  async addTeamMessage(id: string, content: string): Promise<boolean> {
    if (!(await this.store.get(id))) return false;
    await this.store.addMessage(id, { role: 'team', content: redact(content) });
    return true;
  }

  list(f: ArchiveFilters) { return this.store.list({ ...f, limit: Math.min(Math.max(f.limit, 1), 200), offset: Math.max(f.offset, 0) }); }
  get(id: string, limit?: number) { return this.store.get(id, limit); }
  findByKey(channel: ArchiveChannel, key: string) { return this.store.findByKey(channel, key); }
  servedMemory(conversationId: string) { return this.store.servedMemory(conversationId); }
  summary(from: Date, to: Date) { return this.store.summary(from, to); }

  /** Nightly: conversations whose last message is older than the retention period are deleted with their messages. */
  purgeExpired(): Promise<number> {
    return this.store.purgeBefore(new Date(this.now().getTime() - ARCHIVE_RETENTION_DAYS * 86400_000));
  }
}
