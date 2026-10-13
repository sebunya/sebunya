import { Registry } from '../Registry';
import { tryAcquireSessionLock } from '../db/sessionLock';
import { logger } from '../logging/logger';

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
  const lock = await tryAcquireSessionLock(LOCK_ID);
  if (!lock) return 'SKIPPED';
  running = true;
  try {
    const registry = Registry.getInstance();
    const recovered = await registry.goldieChannelUseCases.recoverPending().catch((err) => { logger.error({ err: (err as Error).message }, '[goldie] whatsapp recovery failed'); return 0; });
    const escalated = await registry.careDeskUseCases.escalateOverdue().catch((err) => { logger.error({ err: (err as Error).message }, '[care-desk] escalation failed'); return 0; });
    if (recovered || escalated) logger.info({ recovered, escalated }, '[goldie] care tick');
    return { recovered, escalated };
  } finally {
    running = false;
    await lock.release().catch(() => undefined);
  }
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
