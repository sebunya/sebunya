/**
 * Argument parsing for the first-party ops scripts (0155). Pure, so the
 * "dry run unless --apply" rule is unit-tested rather than trusted.
 */

export interface ExclusionArgs {
  mode: 'DRY_RUN' | 'APPLY' | 'REVERT' | 'SUMMARY';
  /** REVERT only: true = carry the revert out; false = show what it would put back. */
  applyRevert: boolean;
  rules: string[];
  from: Date | null;
  to: Date | null;
  batchSize: number;
  pauseMs: number;
  revertRunId: string | null;
  actor: string;
  errors: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the flag is on the command line at all, with or without a value. */
function present(argv: string[], name: string): boolean {
  return argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

/**
 * The flag's value, or null when the flag is absent. A flag given with no value
 * (`--revert --apply`, `--rules=`) is an error, never a silent "absent": a bare
 * `--revert` must not fall through to a forward APPLY.
 */
function value(argv: string[], name: string, errors: string[]): string | null {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq !== undefined) {
    const v = eq.slice(name.length + 3);
    if (!v.trim()) { errors.push(`--${name} needs a value`); return null; }
    return v;
  }
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--') || !next.trim()) { errors.push(`--${name} needs a value`); return null; }
  return next;
}

function date(raw: string | null, name: string, errors: string[]): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) { errors.push(`--${name} is not a date`); return null; }
  return d;
}

export function parseExclusionArgs(argv: string[]): ExclusionArgs {
  const errors: string[] = [];
  const apply = argv.includes('--apply');
  const revertRunId = value(argv, 'revert', errors);
  const reverting = present(argv, 'revert');
  const summary = argv.includes('--summary');
  if (revertRunId !== null && !UUID.test(revertRunId)) errors.push('--revert needs a run id (uuid)');
  // `--revert=<run> --apply` CARRIES OUT the revert (the documented undo);
  // `--revert=<run>` alone is its dry run. It never also applies new marks.
  const batch = Number(value(argv, 'batch', errors) ?? 5000);
  const pause = Number(value(argv, 'pause-ms', errors) ?? 200);
  if (!Number.isInteger(batch) || batch < 100 || batch > 50_000) errors.push('--batch must be a whole number from 100 to 50000');
  if (!Number.isInteger(pause) || pause < 0 || pause > 60_000) errors.push('--pause-ms must be a whole number from 0 to 60000');
  const rules = (value(argv, 'rules', errors) ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  // Any --revert, even a broken one, is a revert request: it never becomes APPLY.
  const mode: ExclusionArgs['mode'] = summary ? 'SUMMARY' : reverting ? 'REVERT' : apply ? 'APPLY' : 'DRY_RUN';
  return {
    mode, rules,
    applyRevert: mode === 'REVERT' && apply && revertRunId !== null && UUID.test(revertRunId),
    from: date(value(argv, 'from', errors), 'from', errors),
    to: date(value(argv, 'to', errors), 'to', errors),
    batchSize: batch, pauseMs: pause,
    revertRunId: revertRunId && UUID.test(revertRunId) ? revertRunId : null,
    actor: (value(argv, 'actor', errors) ?? process.env.USER ?? 'ops').slice(0, 80),
    errors,
  };
}

export interface PhoneHygieneArgs {
  mode: 'DRY_RUN' | 'APPLY' | 'REVERT';
  /** REVERT only: true = put the values back; false = dry run. */
  applyRevert: boolean;
  revertRunId: string | null;
  showMerges: number;
  errors: string[];
}

export function parsePhoneHygieneArgs(argv: string[]): PhoneHygieneArgs {
  const errors: string[] = [];
  const revertRunId = value(argv, 'revert', errors);
  const reverting = present(argv, 'revert');
  if (revertRunId !== null && !UUID.test(revertRunId)) errors.push('--revert needs a run id (uuid)');
  // `--revert=<run> --apply` carries the revert out; `--revert=<run>` alone is its dry run.
  // There is deliberately no --merge flag: merges are listed for a person, never applied here.
  if (argv.some((a) => a === '--merge' || a.startsWith('--merge='))) errors.push('--merge is not supported: accounts are never merged by this script');
  const show = Number(value(argv, 'show', errors) ?? 50);
  return {
    mode: reverting ? 'REVERT' : argv.includes('--apply') ? 'APPLY' : 'DRY_RUN',
    applyRevert: reverting && revertRunId !== null && UUID.test(revertRunId) && argv.includes('--apply'),
    revertRunId: revertRunId && UUID.test(revertRunId) ? revertRunId : null,
    showMerges: Number.isInteger(show) && show > 0 ? Math.min(show, 1000) : 50,
    errors,
  };
}
