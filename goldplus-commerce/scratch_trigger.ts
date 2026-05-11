import { Registry } from './apps/api/src/infrastructure/Registry';

async function run() {
  process.env.OPS_ALERT_EMAIL = "ops@goldplus.local";
  
  console.log("--- Manually running Outbox Processor Trigger ---");
  const registry = Registry.getInstance();
  const result = await registry.processOutboxBatchUseCase.execute();
  console.log("Process results:", JSON.stringify(result, null, 2));
}

run().catch(console.error);
