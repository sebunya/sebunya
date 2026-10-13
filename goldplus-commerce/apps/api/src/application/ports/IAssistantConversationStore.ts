import type { ArchiveChannel, ArchiveMood, ArchiveOutcome, ArchiveRole, MeetingSummary } from '../../domain/assistant/ConversationArchive';

export interface ArchiveConversationRow {
  id: string;
  channel: ArchiveChannel;
  channelKey: string;
  customerId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  firstTopic: string | null;
  lastTopic: string | null;
  worstMood: ArchiveMood;
  outcome: ArchiveOutcome;
  supportTicketId: string | null;
  page: string | null;
  messageCount: number;
  aiTurns: number;
  humanUntil: Date | null;
  startedAt: Date;
  lastMessageAt: Date;
}

export interface ArchiveMessageRow { id: string; role: ArchiveRole; content: string; intent: string | null; mood: string | null; route: string | null; createdAt: Date }

export interface ArchiveFilters {
  channel?: ArchiveChannel;
  outcome?: ArchiveOutcome;
  mood?: ArchiveMood;
  topic?: string;
  q?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface IAssistantConversationStore {
  /** Finds or opens the conversation for this channel key, updating contact and customer when newly known. */
  open(input: { channel: ArchiveChannel; channelKey: string; customerId: string | null; page: string | null; contact?: { name?: string | null; phone?: string | null; email?: string | null } }): Promise<ArchiveConversationRow>;
  /** Files one message; false when a message with this channel message id was already filed (a redelivery). */
  addMessage(conversationId: string, m: { role: ArchiveRole; content: string; intent?: string | null; mood?: ArchiveMood | null; route?: string | null; channelMessageId?: string | null }): Promise<boolean>;
  /** Rolls up topic, mood, outcome and counters after a turn. */
  update(conversationId: string, patch: { lastTopic?: string | null; firstTopic?: string | null; worstMood?: ArchiveMood; outcome?: ArchiveOutcome; aiTurn?: boolean; supportTicketId?: string | null; humanUntil?: Date | null; contact?: { name?: string | null; phone?: string | null; email?: string | null } }): Promise<void>;
  findByKey(channel: ArchiveChannel, channelKey: string): Promise<ArchiveConversationRow | null>;
  get(id: string): Promise<{ conversation: ArchiveConversationRow; messages: ArchiveMessageRow[] } | null>;
  list(f: ArchiveFilters): Promise<{ rows: Array<ArchiveConversationRow & { lastCustomerLine: string }>; total: number }>;
  summary(from: Date, to: Date): Promise<MeetingSummary>;
  purgeBefore(cutoff: Date): Promise<number>;
}
