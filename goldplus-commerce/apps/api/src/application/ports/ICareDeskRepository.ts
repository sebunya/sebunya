import type { CareDeskToday, CarePriority, CareStatus, CareTaskKind, OnDuty } from '../../domain/assistant/CareDesk';

export interface CareTaskRow {
  id: string; kind: CareTaskKind; priority: CarePriority; status: CareStatus; title: string; detail: string | null;
  customerName: string | null; customerPhone: string | null; customerEmail: string | null; orderNumber: string | null;
  conversationId: string | null; channel: string | null; proposedAction: Record<string, unknown> | null;
  dueAt: Date | null; assignedTo: string | null; openedBy: string; resolvedBy: string | null; resolution: string | null;
  alertedAt: Date | null; resolvedAt: Date | null; createdAt: Date;
}

export interface CareTeamMemberRow {
  id: string; name: string; roleLabel: string | null; phone: string | null; email: string | null;
  alertSms: boolean; alertEmail: boolean; alertWhatsapp: boolean; onDuty: OnDuty | null; active: boolean;
}

export type NewCareTask = Omit<CareTaskRow, 'id' | 'status' | 'assignedTo' | 'resolvedBy' | 'resolution' | 'alertedAt' | 'resolvedAt' | 'createdAt'>;

export interface ICareDeskRepository {
  /** Opens a task, or returns the open one of the same kind for the same conversation (no duplicates from a chatty customer). */
  open(task: NewCareTask): Promise<{ task: CareTaskRow; created: boolean }>;
  get(id: string): Promise<CareTaskRow | null>;
  list(f: { status?: CareStatus; kind?: CareTaskKind; limit: number }): Promise<CareTaskRow[]>;
  resolve(id: string, input: { status: 'done' | 'cancelled'; resolvedBy: string; resolution: string | null }): Promise<boolean>;
  assign(id: string, userId: string | null): Promise<boolean>;
  markAlerted(id: string): Promise<void>;
  /** Marks the task as having paged people, only if it has not already (true = this caller won and may page). */
  claimAlert(id: string): Promise<boolean>;
  /** Runs `fn` while holding the shop-wide paging lock (both replicas), so the paging limits cannot be raced. */
  withAlertLock<R>(fn: () => Promise<R>): Promise<R>;
  /** The newest task (any status) whose title starts with `prefix`, for the health watchdog's dedupe. */
  lastTitled(prefix: string): Promise<{ status: CareStatus; createdAt: Date } | null>;
  /** Urgent open tasks nobody has taken that already paged people (health alarms excluded), with their escalation state. */
  urgentUntaken(limit: number): Promise<Array<CareTaskRow & { escalations: number; lastEscalatedAt: Date | null }>>;
  markEscalated(id: string): Promise<void>;
  /** Tasks that paged people since `since`: across the shop, and for this customer phone (any format). */
  alertsSince(since: Date, phone: string | null): Promise<{ shop: number; samePhone: number }>;
  /** Closed tasks resolved before `cutoff` are deleted (retention). */
  purgeClosedBefore(cutoff: Date): Promise<number>;
  team(activeOnly: boolean): Promise<CareTeamMemberRow[]>;
  saveMember(m: Omit<CareTeamMemberRow, 'id'> & { id?: string | null }): Promise<CareTeamMemberRow>;
  removeMember(id: string): Promise<boolean>;
  /** Phones of active team members (international digits), so their own WhatsApp messages never get a Goldie reply. */
  staffNumbers(): Promise<string[]>;
  today(since: Date): Promise<CareDeskToday>;
  rate(conversationId: string, score: number, comment: string | null): Promise<boolean>;
  setNextAction(conversationId: string, action: string | null): Promise<void>;
  addNote(taskId: string, authorId: string | null, note: string): Promise<boolean>;
  notesFor(taskIds: string[]): Promise<Record<string, Array<{ note: string; createdAt: Date; authorId: string | null }>>>;
  savedReplies(): Promise<Array<{ id: string; title: string; body: string; uses: number }>>;
  saveReply(input: { id?: string | null; title: string; body: string; createdBy: string | null }): Promise<{ id: string }>;
  removeReply(id: string): Promise<boolean>;
  usedReply(id: string): Promise<void>;
  addHandover(authorId: string | null, note: string): Promise<void>;
  recentHandovers(limit: number): Promise<Array<{ note: string; createdAt: Date; authorId: string | null }>>;
}
