import '../config/env';
import { endDbConnection } from '../infrastructure/db/client';
import { runOrganicIntelligence } from '../infrastructure/seo/OrganicIntelligenceRunner';

/**
 * Run the organic intelligence materialisation on demand.
 *
 * The same function the hourly scheduler calls. Exists so a change to
 * clustering, intent or ownership can be verified against real data
 * immediately rather than waiting for the next tick. Read-heavy; it writes only
 * the intelligence tables it owns.
 *
 * Usage: MODE=INCREMENTAL|FULL npx tsx src/scripts/run-organic-intelligence.ts
 */
async function main(): Promise<void> {
  const mode = (process.env.MODE ?? 'INCREMENTAL') as 'INCREMENTAL' | 'FULL';
  const result = await runOrganicIntelligence(mode);
  console.log(`MODE=${mode}`);
  for (const [stage, info] of Object.entries(result.stages ?? {})) {
    console.log(`  ${stage.padEnd(22)} ${JSON.stringify(info)}`);
  }
}

main()
  .then(() => endDbConnection())
  .catch(async (err) => {
    console.error('FAILED', err);
    await endDbConnection();
    process.exitCode = 1;
  });
