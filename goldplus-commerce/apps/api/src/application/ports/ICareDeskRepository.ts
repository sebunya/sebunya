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
  team(activeOnly: boolean): Promise<CareTeamMemberRow[]>;
  saveMember(m: Omit<CareTeamMemberRow, 'id'> & { id?: string | null }): Promise<CareTeamMemberRow>;
  removeMember(id: string): Promise<boolean>;
  /** Phones of active team members (international digits), so their own WhatsApp messages never get a Goldie reply. */
  staffNumbers(): Promise<string[]>;
  today(since: Date): Promise<CareDeskToday>;
  rate(conversationId: string, score: number, comment: string | null): Promise<boolean>;
  setNextAction(conversationId: string, action: string | null): Promise<void>;
}
