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

function value(argv: string[], name: string): string | null {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
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
  const revertRunId = value(argv, 'revert');
  const summary = argv.includes('--summary');
  if (revertRunId !== null && !UUID.test(revertRunId)) errors.push('--revert needs a run id (uuid)');
  // `--revert=<run> --apply` CARRIES OUT the revert (the documented undo);
  // `--revert=<run>` alone is its dry run. It never also applies new marks.
  const batch = Number(value(argv, 'batch') ?? 5000);
  const pause = Number(value(argv, 'pause-ms') ?? 200);
  if (!Number.isInteger(batch) || batch < 100 || batch > 50_000) errors.push('--batch must be a whole number from 100 to 50000');
  if (!Number.isInteger(pause) || pause < 0 || pause > 60_000) errors.push('--pause-ms must be a whole number from 0 to 60000');
  const rules = (value(argv, 'rules') ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  const mode: ExclusionArgs['mode'] = summary ? 'SUMMARY' : revertRunId ? 'REVERT' : apply ? 'APPLY' : 'DRY_RUN';
  return {
    mode, rules,
    applyRevert: mode === 'REVERT' && apply,
    from: date(value(argv, 'from'), 'from', errors),
    to: date(value(argv, 'to'), 'to', errors),
    batchSize: batch, pauseMs: pause,
    revertRunId: revertRunId && UUID.test(revertRunId) ? revertRunId : null,
    actor: (value(argv, 'actor') ?? process.env.USER ?? 'ops').slice(0, 80),
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
  const revertRunId = value(argv, 'revert');
  if (revertRunId !== null && !UUID.test(revertRunId)) errors.push('--revert needs a run id (uuid)');
  // `--revert=<run> --apply` carries the revert out; `--revert=<run>` alone is its dry run.
  // There is deliberately no --merge flag: merges are listed for a person, never applied here.
  if (argv.some((a) => a === '--merge' || a.startsWith('--merge='))) errors.push('--merge is not supported: accounts are never merged by this script');
  const show = Number(value(argv, 'show') ?? 50);
  return {
    mode: revertRunId ? 'REVERT' : argv.includes('--apply') ? 'APPLY' : 'DRY_RUN',
    applyRevert: !!revertRunId && argv.includes('--apply'),
    revertRunId: revertRunId && UUID.test(revertRunId) ? revertRunId : null,
    showMerges: Number.isInteger(show) && show > 0 ? Math.min(show, 1000) : 50,
    errors,
  };
}
