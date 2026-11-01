/**
 * Real questions for the eval set: the first customer line of recent Goldie conversations (already redacted when
 * filed: cards, PINs, OTPs, NINs), with the intent the router gave them and whether it went to the model. Review the
 * output by hand (drop anything personal, fix the expected intent) and merge good ones into
 * docs/ai-cx/evals/questions.json.
 *
 *   DATABASE_URL=... npx tsx scripts/qa/goldie-eval-from-archive.ts [--days 30] [--limit 200] > candidates.json
 */
import { createRequire } from 'node:module';
// postgres is the api's dependency (as in tests/integration).
const postgres = createRequire(import.meta.url)('../../apps/api/node_modules/postgres');

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 30;
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 200;
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, prepare: false });

(async () => {
  const rows = await sql`
    select distinct on (lower(m.content)) m.content, m.intent,
      exists (select 1 from assistant_messages g where g.conversation_id = m.conversation_id and g.role = 'goldie' and g.route = 'ai') as used_model
    from assistant_messages m
    where m.role = 'customer' and m.created_at > now() - make_interval(days => ${days})
      and m.created_at = (select min(x.created_at) from assistant_messages x where x.conversation_id = m.conversation_id and x.role = 'customer')
      and length(m.content) between 4 and 300
      and m.content !~ '(\\+?256|0)7[0-9]{8}' and m.content !~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+'
    order by lower(m.content) limit ${limit}`;
  const candidates = (rows as Array<{ content: string; intent: string | null; used_model: boolean }>).map((r, i) => ({ id: 1000 + i, group: 'real', text: r.content, intent: r.intent ?? 'UNKNOWN', deterministic: !r.used_model, note: 'from the archive: review before merging' }));
  console.log(JSON.stringify({ questions: candidates }, null, 2));
  await sql.end();
})();
