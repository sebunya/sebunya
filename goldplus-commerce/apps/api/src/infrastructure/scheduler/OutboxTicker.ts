import { Registry } from '../Registry';

let tickerHandle: NodeJS.Timeout | null = null;
let isProcessing = false;

const TICK_INTERVAL_MS = 30000; // 30 seconds
const JITTER_MAX_MS = 5000; // 5 seconds maximum first-run delay

async function runTick() {
  if (isProcessing) {
    return; // Skip overlapped tick
  }

  isProcessing = true;
  try {
    const registry = Registry.getInstance();
    const result = await registry.processOutboxBatchUseCase.execute();

    if (result.claimed > 0) {
      console.log(`[OutboxTicker] Processed batch. Claimed: ${result.claimed}, Succeeded: ${result.succeeded}, Retried: ${result.retried}, Exhausted: ${result.exhausted}, Unroutable: ${result.unroutable}`);
    }
  } catch (err) {
    console.error('[OutboxTicker] Fatal exception in processor interval loop:', err);
  } finally {
    isProcessing = false;
  }
}

export function startOutboxTicker() {
  if (process.env.DISABLE_OUTBOX_PROCESSOR === '1') {
    console.warn('[OutboxTicker] Processor explicitly disabled by DISABLE_OUTBOX_PROCESSOR env flag.');
    return;
  }

  if (tickerHandle) {
    return; // Already running
  }

  const initialDelay = Math.floor(Math.random() * JITTER_MAX_MS);
  
  console.log(`[OutboxTicker] Starting outbox processor interval in ${initialDelay}ms. Interval: ${TICK_INTERVAL_MS / 1000}s`);
  
  setTimeout(() => {
    runTick(); // Immediate first run
    tickerHandle = setInterval(runTick, TICK_INTERVAL_MS);
  }, initialDelay);
}

export function stopOutboxTicker() {
  if (tickerHandle) {
    clearInterval(tickerHandle);
    tickerHandle = null;
    console.log('[OutboxTicker] Stopped outbox processor.');
  }
}
