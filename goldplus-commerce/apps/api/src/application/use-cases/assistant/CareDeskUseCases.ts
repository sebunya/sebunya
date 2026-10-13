import type { ICareDeskRepository, CareTaskRow, CareTeamMemberRow } from '../../ports/ICareDeskRepository';
import { alertAllowed, alertText, needsEscalation, carePriority, isCareKind, onDutyNow, shouldAlert, CARE_KIND_LABEL, DEFAULT_ALERTS_PER_HOUR, type CarePriority, type CareTaskKind, type OnDuty } from '../../../domain/assistant/CareDesk';
import { redact } from '../../../domain/assistant/ConversationArchive';
import { isValidEmail, isValidUgandanPhone, normalizeEmail, normalizePhone, text } from '../../services/validationHelpers';

/** How an alert reaches a team member. Each returns whether it was queued/sent and why not. */
export interface ICareAlertChannels {
  sms(input: { to: string; message: string; key: string; taskId: string }): Promise<{ queued: boolean; reason?: string }>;
  email(input: { to: string; subject: string; text: string; html: string; key: string; taskId: string }): Promise<{ queued: boolean; reason?: string }>;
  whatsapp(input: { to: string; message: string }): Promise<{ queued: boolean; reason?: string }>;
  /** Push notifications to staff phones that subscribed on the Care Desk (optional). */
  push?(input: { title: string; body: string; url: string; key: string }): Promise<{ sent: number }>;
}

export interface OpenTaskInput {
  kind: CareTaskKind;
  title: string;
  detail?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  orderNumber?: string | null;
  conversationId?: string | null;
  channel?: string | null;
  proposedAction?: Record<string, unknown> | null;
  dueAt?: Date | null;
  mood?: string | null;
  urgent?: boolean;
  units?: number | null;
  openedBy?: string;
}

export type OpenTaskResult = { ok: true; task: CareTaskRow; created: boolean; alerted: string[] } | { ok: false; code: 'BAD_INPUT'; message: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The Care Desk: tasks Goldie (or staff) open for people, the alerts that
 * page the on-duty team when something is urgent, the queue staff work from,
 * the team list, and the customer's rating of a chat.
 */
export class CareDeskUseCases {
  constructor(
    private readonly repo: ICareDeskRepository,
    private readonly alerts: ICareAlertChannels,
    private readonly config: { deskUrl: string; alertsPerHour?: number; fallback?: { emails: string[]; phone: string | null } },
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Who gets paged: the active team; before anyone is set up, the shop itself (the order-notification inboxes and
   * the shop phone), so an urgent customer is never left with nobody told. Adding the first team member ends it.
   */
  private async activeTeam(): Promise<CareTeamMemberRow[]> {
    const team = await this.repo.team(true);
    if (team.length || !this.config.fallback) return team;
    const f = this.config.fallback;
    const shop: CareTeamMemberRow[] = f.emails.map((email, i) => ({ id: `shop-email-${i}`, name: 'Shop inbox', roleLabel: null, phone: null, email, alertSms: false, alertEmail: true, alertWhatsapp: false, onDuty: null, active: true }));
    if (f.phone) shop.push({ id: 'shop-phone', name: 'Shop phone', roleLabel: null, phone: f.phone, email: null, alertSms: true, alertEmail: false, alertWhatsapp: false, onDuty: null, active: true });
    return shop;
  }

  async openTask(input: OpenTaskInput): Promise<OpenTaskResult> {
    if (!isCareKind(input.kind)) return { ok: false, code: 'BAD_INPUT', message: 'Unknown task kind.' };
    const title = redact(text(input.title)).slice(0, 200);
    if (title.length < 3) return { ok: false, code: 'BAD_INPUT', message: 'Say what the task is.' };
    const rawPhone = text(input.customerPhone), rawEmail = text(input.customerEmail);
    const phone = rawPhone && isValidUgandanPhone(rawPhone) ? normalizePhone(rawPhone) : rawPhone.replace(/[^\d+]/g, '').slice(0, 20) || null;
    const email = rawEmail && isValidEmail(rawEmail) ? normalizeEmail(rawEmail) : null;
    if ((input.kind === 'callback') && !phone) return { ok: false, code: 'BAD_INPUT', message: 'A callback needs a phone number.' };
    const priority: CarePriority = carePriority({ kind: input.kind, mood: input.mood, urgentHint: input.urgent, units: input.units });
    const { task, created } = await this.repo.open({
      kind: input.kind, priority, title,
      detail: input.detail ? redact(text(input.detail)).slice(0, 4000) : null,
      customerName: text(input.customerName).slice(0, 120) || null, customerPhone: phone, customerEmail: email,
      orderNumber: text(input.orderNumber).toUpperCase().slice(0, 40) || null,
      conversationId: input.conversationId ?? null, channel: input.channel ?? null,
      proposedAction: input.proposedAction ?? null, dueAt: input.dueAt ?? null, openedBy: (input.openedBy ?? 'goldie').slice(0, 40),
    });
    const alerted = created && shouldAlert(task.priority) ? await this.alert(task) : [];
    return { ok: true, task, created, alerted };
  }

  /** Pages every on-duty team member on each channel they chose; at most once per task. Returns what was queued. */
  async alert(task: CareTaskRow): Promise<string[]> {
    if (task.alertedAt) return [];
    const t = this.now().getTime();
    const [hour, recent] = await Promise.all([this.repo.alertsSince(new Date(t - 3600_000), null), this.repo.alertsSince(new Date(t - 30 * 60_000), task.customerPhone)]);
    if (alertAllowed({ samePhoneLast30Min: task.customerPhone ? recent.samePhone : 0, shopLastHour: hour.shop, perHour: this.config.alertsPerHour ?? DEFAULT_ALERTS_PER_HOUR }) !== 'ALLOWED') return [];
    const active = await this.activeTeam();
    const team = active.filter((m) => onDutyNow(m.onDuty, this.now()));
    // Nobody on duty: page everyone active, so an urgent customer is never left with no one told.
    const people = team.length ? team : active;
    const message = alertText(task);
    const sent: string[] = [];
    const subject = `GoldPlus Care: ${CARE_KIND_LABEL[task.kind]}${task.customerName ? `, ${task.customerName}` : ''}`.slice(0, 150);
    const lines = [message, task.detail ? `\n${task.detail.slice(0, 1200)}` : '', `\nCare Desk: ${this.config.deskUrl}`].join('\n');
    const html = `<p><strong>${esc(CARE_KIND_LABEL[task.kind])}</strong></p><p>${esc(task.title)}</p>${task.detail ? `<p style="white-space:pre-wrap">${esc(task.detail.slice(0, 1200))}</p>` : ''}<p>${esc([task.customerName, task.customerPhone, task.customerEmail, task.orderNumber].filter(Boolean).join(' · '))}</p><p><a href="${esc(this.config.deskUrl)}">Open the Care Desk</a></p>`;
    for (const m of people) {
      if (m.alertSms && m.phone) { const r = await this.alerts.sms({ to: m.phone, message, key: `care-alert:${task.id}:${m.id}:sms`, taskId: task.id }).catch(() => ({ queued: false })); if (r.queued) sent.push(`sms:${m.name}`); }
      if (m.alertEmail && m.email) { const r = await this.alerts.email({ to: m.email, subject, text: lines, html, key: `care-alert:${task.id}:${m.id}:email`, taskId: task.id }).catch(() => ({ queued: false })); if (r.queued) sent.push(`email:${m.name}`); }
      if (m.alertWhatsapp && m.phone) { const r = await this.alerts.whatsapp({ to: m.phone, message }).catch(() => ({ queued: false })); if (r.queued) sent.push(`whatsapp:${m.name}`); }
    }
    if (this.alerts.push) {
      const p = await this.alerts.push({ title: `GoldPlus Care: ${CARE_KIND_LABEL[task.kind]}`, body: message, url: this.config.deskUrl, key: `care-alert:${task.id}` }).catch(() => ({ sent: 0 }));
      if (p.sent) sent.push(`push:${p.sent}`);
    }
    if (sent.length) await this.repo.markAlerted(task.id);
    return sent;
  }

  list(f: { status?: 'open' | 'done' | 'cancelled'; kind?: CareTaskKind; limit?: number }) { return this.repo.list({ ...f, limit: Math.min(f.limit ?? 100, 300) }); }
  get(id: string) { return this.repo.get(id); }
  async resolve(id: string, status: 'done' | 'cancelled', resolvedBy: string, resolution: string | null) {
    return this.repo.resolve(id, { status, resolvedBy, resolution: resolution ? text(resolution).slice(0, 1000) : null });
  }
  assign(id: string, userId: string | null) { return this.repo.assign(id, userId); }

  today() {
    const n = this.now();
    // Midnight in Kampala (UTC+3, no daylight saving).
    const k = new Date(n.getTime() + 3 * 3600_000); k.setUTCHours(0, 0, 0, 0);
    return this.repo.today(new Date(k.getTime() - 3 * 3600_000));
  }

  team() { return this.repo.team(false); }
  async saveMember(input: { id?: string | null; name: string; roleLabel?: string | null; phone?: string | null; email?: string | null; alertSms: boolean; alertEmail: boolean; alertWhatsapp: boolean; onDuty?: OnDuty | null; active: boolean }): Promise<{ ok: true; member: CareTeamMemberRow } | { ok: false; message: string }> {
    const name = text(input.name).slice(0, 80);
    if (name.length < 2) return { ok: false, message: 'Give the team member a name.' };
    const phone = text(input.phone); const email = text(input.email);
    if (phone && !isValidUgandanPhone(phone)) return { ok: false, message: 'That phone number does not look right.' };
    if (email && !isValidEmail(email)) return { ok: false, message: 'That email address does not look right.' };
    if (!phone && !email) return { ok: false, message: 'Give a phone number or an email, so alerts can reach them.' };
    const member = await this.repo.saveMember({
      id: input.id ?? null, name, roleLabel: text(input.roleLabel).slice(0, 60) || null, phone: phone ? normalizePhone(phone) : null, email: email ? normalizeEmail(email) : null,
      alertSms: input.alertSms, alertEmail: input.alertEmail, alertWhatsapp: input.alertWhatsapp, onDuty: input.onDuty ?? null, active: input.active,
    });
    return { ok: true, member };
  }
  removeMember(id: string) { return this.repo.removeMember(id); }
  staffNumbers() { return this.repo.staffNumbers(); }

  /** The customer's rating of a chat (1-5; the panel's thumbs map to 5 and 1). */
  async rate(conversationId: string, score: number, comment: string | null): Promise<boolean> {
    if (!Number.isInteger(score) || score < 1 || score > 5) return false;
    return this.repo.rate(conversationId, score, comment ? redact(text(comment)).slice(0, 500) : null);
  }
  setNextAction(conversationId: string, action: string | null) { return this.repo.setNextAction(conversationId, action ? action.slice(0, 40) : null); }

  /**
   * Every minute: an urgent task nobody has taken for 15 minutes pages every active team member again, on every
   * channel they chose (on duty or not, the customer has waited long enough), at most twice per task.
   */
  async escalateOverdue(): Promise<number> {
    const now = this.now();
    const due = (await this.repo.urgentUntaken(50)).filter((t) => needsEscalation(t, now));
    for (const t of due) {
      const waitedMin = Math.round((now.getTime() - t.createdAt.getTime()) / 60000);
      const message = `STILL WAITING ${waitedMin} min. ${alertText(t)}`.slice(0, 300);
      const team = await this.activeTeam();
      for (const m of team) {
        if (m.alertSms && m.phone) await this.alerts.sms({ to: m.phone, message, key: `care-escalate:${t.id}:${t.escalations + 1}:${m.id}:sms`, taskId: t.id }).catch(() => undefined);
        if (m.alertEmail && m.email) await this.alerts.email({ to: m.email, subject: `STILL WAITING: ${CARE_KIND_LABEL[t.kind]}`, text: `${message}\n\nCare Desk: ${this.config.deskUrl}`, html: `<p><strong>${esc(message)}</strong></p><p><a href="${esc(this.config.deskUrl)}">Open the Care Desk</a></p>`, key: `care-escalate:${t.id}:${t.escalations + 1}:${m.id}:email`, taskId: t.id }).catch(() => undefined);
        if (m.alertWhatsapp && m.phone) await this.alerts.whatsapp({ to: m.phone, message }).catch(() => undefined);
      }
      if (this.alerts.push) await this.alerts.push({ title: 'GoldPlus Care: still waiting', body: message, url: this.config.deskUrl, key: `care-escalate:${t.id}:${t.escalations + 1}` }).catch(() => undefined);
      await this.repo.markEscalated(t.id);
    }
    return due.length;
  }

  // ---- notes, saved replies, shift handover (plain text, redacted like everything Goldie keeps)
  async addNote(taskId: string, authorId: string | null, note: string) {
    const n = redact(text(note)).slice(0, 2000);
    return n.length >= 2 ? this.repo.addNote(taskId, authorId, n) : false;
  }
  notesFor(taskIds: string[]) { return taskIds.length ? this.repo.notesFor(taskIds) : Promise.resolve({}); }
  savedReplies() { return this.repo.savedReplies(); }
  async saveReply(input: { id?: string | null; title: string; body: string; createdBy: string | null }) {
    const title = text(input.title).slice(0, 80), body = text(input.body).slice(0, 2000);
    if (title.length < 2 || body.length < 5) return { ok: false as const, message: 'Give the reply a short title and some text.' };
    return { ok: true as const, ...(await this.repo.saveReply({ ...input, title, body })) };
  }
  removeReply(id: string) { return this.repo.removeReply(id); }
  usedReply(id: string) { return this.repo.usedReply(id); }
  async addHandover(authorId: string | null, note: string) {
    const n = redact(text(note)).slice(0, 2000);
    if (n.length < 3) return false;
    await this.repo.addHandover(authorId, n);
    return true;
  }
  recentHandovers(limit = 5) { return this.repo.recentHandovers(limit); }

  /** Nightly: closed tasks older than a year go (they hold customer names and numbers). */
  purgeClosed(days = 365) { return this.repo.purgeClosedBefore(new Date(this.now().getTime() - days * 86400_000)); }

  /** A test page to every active member, so the owner can see alerts arrive before a real customer needs one. */
  async testAlert(): Promise<string[]> {
    const fake: CareTaskRow = { id: `test-${this.now().getTime()}`, kind: 'urgent', priority: 'urgent', status: 'open', title: 'This is a test alert from the Care Desk. No customer is waiting.', detail: null, customerName: null, customerPhone: null, customerEmail: null, orderNumber: null, conversationId: null, channel: null, proposedAction: null, dueAt: null, assignedTo: null, openedBy: 'test', resolvedBy: null, resolution: null, alertedAt: null, resolvedAt: null, createdAt: this.now() };
    const team = await this.activeTeam();
    const sent: string[] = [];
    for (const m of team) {
      if (m.alertSms && m.phone) { const r = await this.alerts.sms({ to: m.phone, message: alertText(fake), key: `${fake.id}:${m.id}:sms`, taskId: fake.id }).catch(() => ({ queued: false })); if (r.queued) sent.push(`sms:${m.name}`); }
      if (m.alertEmail && m.email) { const r = await this.alerts.email({ to: m.email, subject: 'GoldPlus Care: test alert', text: alertText(fake), html: `<p>${esc(alertText(fake))}</p>`, key: `${fake.id}:${m.id}:email`, taskId: fake.id }).catch(() => ({ queued: false })); if (r.queued) sent.push(`email:${m.name}`); }
      if (m.alertWhatsapp && m.phone) { const r = await this.alerts.whatsapp({ to: m.phone, message: alertText(fake) }).catch(() => ({ queued: false })); if (r.queued) sent.push(`whatsapp:${m.name}`); }
    }
    return sent;
  }
}
