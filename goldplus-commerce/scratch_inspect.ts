import { db } from './apps/api/src/infrastructure/db/client';
import { outboxEvents } from './apps/api/src/infrastructure/db/schema/system';
import { desc } from 'drizzle-orm';

async function check() {
  const res = await db.select().from(outboxEvents).orderBy(desc(outboxEvents.createdAt)).limit(5);
  console.log(JSON.stringify(res, null, 2));
}
check().catch(console.error);
