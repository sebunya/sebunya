import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/** The Care Desk (0178) on real PostgreSQL: open/dedupe, priority order, resolve, team, today's numbers, ratings. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('Care Desk repository (real PostgreSQL)', () => {
  let raw: any;
  let repo: import('../../apps/api/src/infrastructure/assistant/DrizzleCareDeskRepository').DrizzleCareDeskRepository;
  let convs: import('../../apps/api/src/infrastructure/assistant/DrizzleAssistantConversationStore').DrizzleAssistantConversationStore;
  const tag = `itest-${randomUUID().slice(0, 8)}`;
  let convId = '';

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    repo = new (await import('../../apps/api/src/infrastructure/assistant/DrizzleCareDeskRepository')).DrizzleCareDeskRepository();
    convs = new (await import('../../apps/api/src/infrastructure/assistant/DrizzleAssistantConversationStore')).DrizzleAssistantConversationStore();
    convId = (await convs.open({ channel: 'web', channelKey: `${tag}-c`, customerId: null, page: null })).id;
  });
  afterAll(async () => {
    await raw`delete from care_tasks where title like ${tag + '%'}`;
    await raw`delete from care_team_members where name like ${tag + '%'}`;
    await raw`delete from assistant_conversations where channel_key like ${tag + '%'}`;
    await raw.end();
  });

  const base = { detail: null, customerName: 'Sarah', customerPhone: '+256772123456', customerEmail: null, orderNumber: null, channel: 'web', proposedAction: null, dueAt: null, openedBy: 'goldie' };

  it('opens once per conversation and kind, raising the priority when the customer escalates', async () => {
    const a = await repo.open({ ...base, kind: 'order_problem', priority: 'high', title: `${tag} late order`, conversationId: convId });
    const b = await repo.open({ ...base, kind: 'order_problem', priority: 'urgent', title: `${tag} late order again`, conversationId: convId, detail: 'Still nothing' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect((await repo.get(a.task.id))!.priority).toBe('urgent');
  });

  it('lists urgent first, resolves once, and counts today', async () => {
    await repo.open({ ...base, kind: 'callback', priority: 'normal', title: `${tag} call back`, conversationId: null });
    const open = (await repo.list({ status: 'open', limit: 300 })).filter((t) => t.title.startsWith(tag));
    expect(open[0]!.priority).toBe('urgent');
    expect(await repo.resolve(open[1]!.id, { status: 'done', resolvedBy: randomUUID(), resolution: 'Called her' })).toBe(true);
    expect(await repo.resolve(open[1]!.id, { status: 'done', resolvedBy: randomUUID(), resolution: 'again' })).toBe(false);
    const today = await repo.today(new Date(Date.now() - 3600_000));
    expect(today.openTasks).toBeGreaterThanOrEqual(1);
    expect(today.urgentOpen).toBeGreaterThanOrEqual(1);
  });

  it('keeps the team and their numbers in international form; records a rating', async () => {
    const m = await repo.saveMember({ name: `${tag} Grace`, roleLabel: 'Shop attendant', phone: '0772000111', email: null, alertSms: true, alertEmail: false, alertWhatsapp: false, onDuty: { days: [1, 2, 3], from: '08:00', to: '18:00' }, active: true });
    expect((await repo.team(true)).some((x) => x.id === m.id)).toBe(true);
    expect(await repo.staffNumbers()).toContain('256772000111');
    expect(await repo.rate(convId, 5, 'very helpful')).toBe(true);
    expect((await raw`select csat from assistant_conversations where id = ${convId}`)[0].csat).toBe(5);
  });

  it('counts alerts by shop and by customer phone in any format, and purges only old closed tasks', async () => {
    const a = await repo.open({ ...base, kind: 'urgent', priority: 'urgent', title: `${tag} paged`, conversationId: null, customerPhone: '0772 123 456' });
    await repo.markAlerted(a.task.id);
    const counts = await repo.alertsSince(new Date(Date.now() - 60_000), '+256772123456');
    expect(counts.shop).toBeGreaterThanOrEqual(1);
    expect(counts.samePhone).toBeGreaterThanOrEqual(1);
    expect((await repo.alertsSince(new Date(Date.now() - 60_000), '0700999888')).samePhone).toBe(0);
    await repo.resolve(a.task.id, { status: 'done', resolvedBy: randomUUID(), resolution: 'sorted' });
    await raw`update care_tasks set resolved_at = now() - interval '400 days' where id = ${a.task.id}`;
    expect(await repo.purgeClosedBefore(new Date(Date.now() - 365 * 86400_000))).toBeGreaterThanOrEqual(1);
    expect(await repo.get(a.task.id)).toBeNull();
  });

  it('claims an alert once under the lock; escalates only paged tasks; finds the last task by title prefix; reports the oldest urgent wait', async () => {
    const t = await repo.open({ ...base, kind: 'urgent', priority: 'urgent', title: `${tag} claim me`, conversationId: null, customerPhone: '0700111000' });
    const both = await Promise.all([repo.withAlertLock(() => repo.claimAlert(t.task.id)), repo.withAlertLock(() => repo.claimAlert(t.task.id))]);
    expect(both.filter(Boolean)).toHaveLength(1);
    const quiet = await repo.open({ ...base, kind: 'urgent', priority: 'urgent', title: `${tag} held back`, conversationId: null });
    await raw`update care_tasks set created_at = now() - interval '20 minutes' where id in (${t.task.id}, ${quiet.task.id})`;
    const due = (await repo.urgentUntaken(300)).map((x) => x.id);
    expect(due).toContain(t.task.id);
    expect(due).not.toContain(quiet.task.id);
    // The prefix is matched literally (a % or _ in it is not a wildcard).
    expect(await repo.lastTitled(`${tag} claim`)).toMatchObject({ status: 'open' });
    expect(await repo.lastTitled(`${tag} cl_im`)).toBeNull();
    const today = await repo.today(new Date(Date.now() - 3600_000));
    expect(today.oldestUrgentAt).not.toBeNull();
  });

  it("opens one task when the same customer's messages arrive together", async () => {
    const c2 = (await convs.open({ channel: 'web', channelKey: `${tag}-burst`, customerId: null, page: null })).id;
    const opened = await Promise.all([1, 2, 3].map((i) => repo.open({ ...base, kind: 'follow_up', priority: 'normal', title: `${tag} burst ${i}`, conversationId: c2 })));
    expect(opened.filter((o) => o.created)).toHaveLength(1);
  });

  it('saves a task a member of staff added from the desk', async () => {
    const r = await repo.open({ ...base, kind: 'follow_up', priority: 'normal', title: `${tag} staff added`, conversationId: null, openedBy: 'staff' });
    expect(r.created).toBe(true);
    expect((await repo.get(r.task.id))!.openedBy).toBe('staff');
  });
});
