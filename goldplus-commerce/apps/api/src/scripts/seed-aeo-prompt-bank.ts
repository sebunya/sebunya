import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Seeds the AEO prompt bank with the questions customers actually ask, so the
 * /admin/seo/aeo screen is a checklist rather than an empty form (2026-09-18).
 *
 * Every question is grounded in evidence, named in its category: a Search
 * Console query the shop has already appeared for, or a fact about what the
 * catalogue sells. No question is about a product the shop does not stock.
 * Prompts are PLANNED — nothing here records what an engine answered; that is
 * an observation a person makes in a real session and records on the screen.
 *
 * Idempotent: a (prompt, engine) pair that exists is skipped. Audited like the
 * admin route (SEO_AEO_PROMPT_CREATED).
 *
 *   ACTOR_USER_ID=<admin uuid> [DRY_RUN=1] npx tsx src/scripts/seed-aeo-prompt-bank.ts
 */
const ENGINES = ['CHATGPT', 'GEMINI', 'PERPLEXITY'] as const;

const QUESTIONS: Array<{ prompt: string; category: string; intent: string }> = [
  { prompt: 'What is GoldPlus (shopgoldplus.com) and what does it sell?', category: 'Brand — GSC: "goldplus", "gold plus", "gold plus official website"', intent: 'NAVIGATIONAL' },
  { prompt: 'Are GoldPlus power banks and chargers genuine?', category: 'Brand trust — GSC: "they are fake"', intent: 'INFORMATIONAL' },
  { prompt: 'Where can I buy a GoldPlus power bank in Kampala?', category: 'Power — GSC: "gold plus power bank"', intent: 'COMMERCIAL' },
  { prompt: 'How much is a GoldPlus power bank in Uganda?', category: 'Price — GSC: "what is its price in uganda", "how much?"', intent: 'COMMERCIAL' },
  { prompt: 'Where can I buy memory cards and flash drives in Kampala?', category: 'Storage — GSC: "memory card gold"; catalogue: memory cards + flash drives', intent: 'COMMERCIAL' },
  { prompt: 'Where can I buy a replacement battery for a Tecno or Infinix phone in Kampala?', category: 'Batteries — catalogue: phone batteries', intent: 'COMMERCIAL' },
  { prompt: 'Where can I buy an iPhone replacement battery in Kampala?', category: 'Batteries — catalogue: iPhone X–14 Pro Max batteries', intent: 'COMMERCIAL' },
  { prompt: 'Where can I buy wireless earbuds in Kampala?', category: 'Sound — catalogue: GoldPlus earbuds', intent: 'COMMERCIAL' },
  { prompt: 'Which online shop in Kampala delivers phone accessories the same day?', category: 'Service — business fact: same-day delivery in Kampala and Wakiso', intent: 'COMMERCIAL' },
];

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the admin uuid.');
  const dryRun = process.env.DRY_RUN === '1';
  const registry = Registry.getInstance();
  const repo = registry.seoGrowthRepo;

  const existing = new Set(
    ((await repo.listAeoPrompts()) as Array<{ prompt: string; engine: string }>).map((p) => `${p.engine}|${p.prompt.trim().toLowerCase()}`),
  );
  let created = 0;
  let skipped = 0;
  for (const q of QUESTIONS) {
    for (const engine of ENGINES) {
      if (existing.has(`${engine}|${q.prompt.trim().toLowerCase()}`)) { skipped += 1; continue; }
      if (dryRun) { created += 1; continue; }
      const row = await repo.createAeoPrompt({ prompt: q.prompt, engine, category: q.category, intent: q.intent });
      await registry.createAuditLogUseCase.execute({
        actorId,
        action: 'SEO_AEO_PROMPT_CREATED',
        entity: 'seo_aeo_prompt',
        entityId: String(row?.id ?? ''),
        newState: { engine, source: 'seed-aeo-prompt-bank' },
      });
      created += 1;
    }
  }
  console.log(`${dryRun ? 'DRY RUN — would create' : 'created'} ${created}, skipped ${skipped} existing (${QUESTIONS.length} questions × ${ENGINES.length} engines)`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => endDbConnection());
