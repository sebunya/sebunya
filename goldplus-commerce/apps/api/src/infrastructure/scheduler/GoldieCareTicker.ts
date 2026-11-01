import { Registry } from '../Registry';
import { tryAcquireSessionLock } from '../db/sessionLock';
import { logger } from '../logging/logger';
import { goldieMetrics } from '../assistant/GoldieMetrics';

/**
 * Every minute, on one replica: finish WhatsApp replies a restart interrupted (each message at most once more),
 * and page the team again for urgent customers nobody has taken (at most twice per task).
 */
const LOCK_ID = 0x474f4c44; // 'GOLD'
const EVERY_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runGoldieCareOnce(): Promise<{ recovered: number; escalated: number } | 'SKIPPED'> {
  if (running) return 'SKIPPED';
  // Every replica reports the gauges (Prometheus scrapes each one); only the lock holder acts.
  await refreshGoldieGauges().catch((err) => logger.warn({ err: (err as Error).message }, '[goldie] gauges not refreshed'));
  const lock = await tryAcquireSessionLock(LOCK_ID);
  if (!lock) return 'SKIPPED';
  running = true;
  try {
    const registry = Registry.getInstance();
    const recovered = await registry.goldieChannelUseCases.recoverPending().catch((err) => { logger.error({ err: (err as Error).message }, '[goldie] whatsapp recovery failed'); return 0; })
      + await registry.goldieSocialUseCases.recoverPending().catch((err) => { logger.error({ err: (err as Error).message }, '[goldie] messenger/instagram recovery failed'); return 0; });
    const escalated = await registry.careDeskUseCases.escalateOverdue().catch((err) => { logger.error({ err: (err as Error).message }, '[care-desk] escalation failed'); return 0; });
    if (recovered) goldieMetrics.recovered.inc(recovered);
    if (escalated) goldieMetrics.escalations.inc(escalated);
    await watchGoldieHealth().catch((err) => logger.error({ err: (err as Error).message }, '[goldie] health watch failed'));
    if (recovered || escalated) logger.info({ recovered, escalated }, '[goldie] care tick');
    return { recovered, escalated };
  } finally {
    running = false;
    await lock.release().catch(() => undefined);
  }
}

/**
 * Goldie watching herself, through the channels that already reach people: several WhatsApp replies failing in
 * 15 minutes, or this month's model spend near the cap, opens an urgent Care Desk task (which pages the team by
 * SMS and email). At most one such task per problem per hour. The gauges feed Prometheus as well.
 */
const HEALTH_PREFIX = 'Goldie needs attention:';
/** How long after a health task (open or closed) the same problem may open another: spend stays high all month. */
const HEALTH_QUIET_MS: Record<'replies' | 'spend', number> = { replies: 3600_000, spend: 24 * 3600_000 };

async function spendRatio(): Promise<number> {
  const status = await Registry.getInstance().assistantAdmissionUseCases.status().catch(() => null);
  const cap = Number(status?.config?.monthlyCapMicroUsd ?? 0);
  const committed = Number(status?.totals?.settledMicroUsd ?? 0) + Number(status?.totals?.reservedMicroUsd ?? 0);
  return cap > 0 ? committed / cap : 0;
}

export async function refreshGoldieGauges(): Promise<void> {
  const now = Date.now();
  const [today, ratio] = await Promise.all([Registry.getInstance().careDeskUseCases.today(), spendRatio()]);
  const minutes = (iso: string | null | undefined) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)) : 0);
  goldieMetrics.urgentOpen.set(today.urgentOpen);
  goldieMetrics.oldestOpenMinutes.set(minutes(today.oldestOpenAt));
  goldieMetrics.oldestUrgentMinutes.set(minutes(today.oldestUrgentAt));
  goldieMetrics.spendRatio.set(ratio);
}

export async function watchGoldieHealth(): Promise<string[]> {
  const registry = Registry.getInstance();
  const now = Date.now();
  const [failures, ratio] = await Promise.all([
    registry.conversationArchiveUseCases.replyFailuresSince(new Date(now - 15 * 60_000)),
    spendRatio(),
  ]);

  const problems: Array<{ kind: 'replies' | 'spend'; text: string }> = [];
  if (failures >= 3) problems.push({ kind: 'replies', text: `${failures} customer messages (WhatsApp, Messenger or Instagram) could not be answered in the last 15 minutes. Check the channel tokens and the web container; customers got a holding reply.` });
  if (ratio >= 0.9) problems.push({ kind: 'spend', text: `this month's model spend is ${Math.round(ratio * 100)}% of the cap. Goldie keeps answering from shop data and memory; raise the cap in Shop assistant settings if paid answers should continue.` });
  if (!problems.length) return [];
  const opened: string[] = [];
  for (const p of problems) {
    // One task per problem while it is open, and a quiet spell after the last one (an hour for failing replies,
    // a day for spend): the title starts with the type, never with a count that changes.
    const head = `${HEALTH_PREFIX} ${p.kind}.`;
    const last = await registry.careDeskUseCases.lastTitled(head);
    if (last && (last.status === 'open' || now - last.createdAt.getTime() < HEALTH_QUIET_MS[p.kind])) continue;
    const title = `${head} ${p.text}`.slice(0, 200);
    await registry.careDeskUseCases.openTask({ kind: 'urgent', title, openedBy: 'goldie-health', urgent: true });
    opened.push(title);
  }
  return opened;
}

export function startGoldieCareTicker(): void {
  if (timer) return;
  timer = setInterval(() => void runGoldieCareOnce().catch((err) => logger.error({ err: (err as Error).message }, '[goldie] care tick failed')), EVERY_MS);
  timer.unref?.();
}

export function stopGoldieCareTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
