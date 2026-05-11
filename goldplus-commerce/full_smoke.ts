import { db } from './apps/api/src/infrastructure/db/client';
import { outboxEvents } from './apps/api/src/infrastructure/db/schema/system';
import { Registry } from './apps/api/src/infrastructure/Registry';
import { desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

async function smoke() {
  process.env.OPS_ALERT_EMAIL = "ops@goldplus.local";
  process.env.OPS_ALERT_WHATSAPP = "+256700000000";

  console.log("1. Manually inserting OUTBOX_EVENT for test...");
  const uuid = randomUUID();
  await db.insert(outboxEvents).values({
    eventType: 'QUOTE_REQUESTED',
    payload: { id: uuid, customer: 'Tester' },
    isProcessed: false,
    nextAttemptAt: new Date(),
  });

  console.log("2. Triggering ProcessOutboxBatchUseCase...");
  const registry = Registry.getInstance();
  const res = await registry.processOutboxBatchUseCase.execute();
  console.log("Result:", JSON.stringify(res, null, 2));

  console.log("3. Checking notification_attempts table results...");
  const attempts = await registry.notificationAttemptRepo.findRecent({ limit: 5 });
  console.log("Recent attempts logged:", attempts.map(a => ({
    channel: a.channel,
    status: a.status,
    providerCode: a.providerCode
  })));
}

smoke().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
