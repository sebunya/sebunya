// Collects results from every spec (written as JSON lines by the fixtures)
// into the required artifacts. Specs never write the final reports; they
// append records to $COMPAT_OUT_DIR/records/<file>.jsonl.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const OUT = process.env.COMPAT_OUT_DIR || join(process.cwd(), 'out', 'latest');
export function record(kind, payload) {
  mkdirSync(join(OUT, 'records'), { recursive: true });
  appendFileSync(join(OUT, 'records', `${kind}.jsonl`), JSON.stringify({ ...payload, recorded_at: new Date().toISOString() }) + '\n');
}
