#!/usr/bin/env node
/**
 * Migration/journal parity recurrence guard.
 *
 * Migrations 0052-0060 once shipped as SQL files while the drizzle journal silently
 * stopped registering entries at 0051 — drizzle only ever applies what the journal
 * lists, so the release looked complete while six migrations would never run. This
 * verifier makes that class of drift a named, non-zero-exit failure instead of a
 * silent gap, and it is meant to run on every checkout, not just this one.
 *
 * Pure logic (`checkMigrationParity`) takes plain arrays/objects so tests can inject
 * fixtures — including impossible-on-disk cases like a duplicate SQL tag — without
 * touching the filesystem. The CLI wrapper is the only part that reads real files.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Reads and structurally validates a drizzle `_journal.json`. Never throws: every
 * failure mode (unreadable file, invalid JSON, unsupported structure) comes back as
 * a named blocker so the caller can report it verbatim.
 */
export function parseJournalFile(journalPath) {
  let raw;
  try {
    raw = fs.readFileSync(journalPath, 'utf8');
  } catch (err) {
    return { ok: false, blocker: 'JOURNAL_FILE_UNREADABLE', detail: `${journalPath}: ${err.message}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, blocker: 'JOURNAL_MALFORMED_JSON', detail: `${journalPath}: ${err.message}` };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, blocker: 'JOURNAL_UNSUPPORTED_STRUCTURE', detail: `${journalPath}: top-level value must be an object` };
  }
  if (!Array.isArray(parsed.entries)) {
    return { ok: false, blocker: 'JOURNAL_UNSUPPORTED_STRUCTURE', detail: `${journalPath}: "entries" must be an array` };
  }

  const entries = [];
  for (let i = 0; i < parsed.entries.length; i++) {
    const e = parsed.entries[i];
    if (
      !e ||
      typeof e !== 'object' ||
      typeof e.idx !== 'number' ||
      !Number.isInteger(e.idx) ||
      typeof e.tag !== 'string' ||
      e.tag.length === 0
    ) {
      return {
        ok: false,
        blocker: 'JOURNAL_UNSUPPORTED_STRUCTURE',
        detail: `${journalPath}: entries[${i}] must have an integer "idx" and a non-empty string "tag"`,
      };
    }
    entries.push({ idx: e.idx, tag: e.tag });
  }

  return { ok: true, entries };
}

/** Sorted stems (filename minus ".sql") of every numbered migration in `sqlDir`. */
export function readSqlMigrationStems(sqlDir) {
  let files;
  try {
    files = fs.readdirSync(sqlDir);
  } catch (err) {
    throw new Error(`SQL_MIGRATIONS_DIR_UNREADABLE: ${sqlDir}: ${err.message}`);
  }
  return files
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, -'.sql'.length))
    .sort();
}

const fail = (blocker, detail) => ({ ok: false, blocker, detail });

/**
 * The parity check itself. `sqlStems` and `journalEntries` are plain arrays so this
 * runs identically whether they came from disk or from a test fixture. `scope`, when
 * provided, is the parsed canonical release-scope object (must expose a string
 * `migrationCeiling`, optionally suffixed with ".sql").
 *
 * Returns the FIRST blocker found — never a partial success — so a caller can never
 * observe PASSED alongside undetected drift.
 */
export function checkMigrationParity({ sqlStems, journalEntries, scope = null }) {
  const sqlCount = sqlStems.length;

  const seenSqlTags = new Set();
  for (const stem of sqlStems) {
    if (seenSqlTags.has(stem)) {
      return fail('DUPLICATE_SQL_MIGRATION_TAG', `sql migration tag "${stem}" appears more than once`);
    }
    seenSqlTags.add(stem);
  }

  const seenSqlNumbers = new Map();
  for (const stem of sqlStems) {
    const m = stem.match(/^(\d+)_/);
    if (!m) continue;
    const num = m[1];
    if (seenSqlNumbers.has(num)) {
      return fail(
        'DUPLICATE_SQL_MIGRATION_NUMBER',
        `migration number "${num}" is used by both "${seenSqlNumbers.get(num)}" and "${stem}"`,
      );
    }
    seenSqlNumbers.set(num, stem);
  }

  const seenJournalTags = new Set();
  for (const e of journalEntries) {
    if (seenJournalTags.has(e.tag)) {
      return fail('DUPLICATE_JOURNAL_TAG', `journal tag "${e.tag}" appears more than once`);
    }
    seenJournalTags.add(e.tag);
  }

  const seenJournalIndices = new Set();
  for (const e of journalEntries) {
    if (seenJournalIndices.has(e.idx)) {
      return fail('DUPLICATE_JOURNAL_INDEX', `journal index ${e.idx} appears more than once`);
    }
    seenJournalIndices.add(e.idx);
  }

  const journalCount = journalEntries.length;
  if (sqlCount !== journalCount) {
    return fail(
      'SQL_JOURNAL_COUNT_MISMATCH',
      `sql migration file count=${sqlCount} journal entry count=${journalCount}`,
    );
  }

  const sortedIndices = journalEntries.map((e) => e.idx).sort((a, b) => a - b);
  if (sortedIndices.length > 0 && sortedIndices[0] !== 0) {
    return fail('JOURNAL_FIRST_INDEX_NOT_ZERO', `first journal index is ${sortedIndices[0]}, expected 0`);
  }
  for (let i = 0; i < sortedIndices.length; i++) {
    if (sortedIndices[i] !== i) {
      return fail(
        'JOURNAL_INDEX_DISCONTINUOUS',
        `expected journal index ${i} at sorted position ${i} but found ${sortedIndices[i]}`,
      );
    }
  }
  const finalIndex = sortedIndices[sortedIndices.length - 1];
  if (finalIndex !== sqlCount - 1) {
    return fail(
      'JOURNAL_FINAL_INDEX_NOT_CEILING',
      `final journal index is ${finalIndex}, expected ${sqlCount - 1} (sql migration count - 1)`,
    );
  }

  const sqlSet = new Set(sqlStems);
  const journalTagsByIdx = journalEntries.slice().sort((a, b) => a.idx - b.idx).map((e) => e.tag);
  const journalTagSet = new Set(journalTagsByIdx);

  for (const tag of journalTagsByIdx) {
    if (!sqlSet.has(tag)) {
      return fail('JOURNAL_TAG_MISSING_SQL_FILE', `journal tag "${tag}" has no corresponding SQL migration file`);
    }
  }
  for (const stem of sqlStems) {
    if (!journalTagSet.has(stem)) {
      return fail('SQL_MIGRATION_MISSING_JOURNAL_ENTRY', `sql migration "${stem}" has no corresponding journal entry`);
    }
  }

  for (let i = 0; i < sqlStems.length; i++) {
    if (sqlStems[i] !== journalTagsByIdx[i]) {
      return fail(
        'ORDER_MISMATCH',
        `position ${i}: ordered sql filename stem is "${sqlStems[i]}" but ordered journal tag is "${journalTagsByIdx[i]}"`,
      );
    }
  }

  const sqlCeiling = sqlStems[sqlStems.length - 1];
  const journalCeiling = journalTagsByIdx[journalTagsByIdx.length - 1];
  if (sqlCeiling !== journalCeiling) {
    return fail('SQL_JOURNAL_CEILING_MISMATCH', `sql ceiling="${sqlCeiling}" journal ceiling="${journalCeiling}"`);
  }

  let declaredReleaseCeiling;
  if (scope !== null) {
    if (!scope || typeof scope.migrationCeiling !== 'string' || scope.migrationCeiling.length === 0) {
      return fail('RELEASE_SCOPE_MISSING_MIGRATION_CEILING', 'release scope has no string "migrationCeiling" field');
    }
    declaredReleaseCeiling = scope.migrationCeiling.endsWith('.sql')
      ? scope.migrationCeiling.slice(0, -'.sql'.length)
      : scope.migrationCeiling;
    if (declaredReleaseCeiling !== sqlCeiling || declaredReleaseCeiling !== journalCeiling) {
      return fail(
        'RELEASE_SCOPE_CEILING_MISMATCH',
        `declared release migrationCeiling="${scope.migrationCeiling}" sql ceiling="${sqlCeiling}" journal ceiling="${journalCeiling}"`,
      );
    }
  }

  return {
    ok: true,
    fields: {
      SQL_MIGRATION_COUNT: sqlCount,
      JOURNAL_ENTRY_COUNT: journalCount,
      JOURNAL_INDEX_RANGE: `0-${finalIndex}`,
      SQL_MIGRATION_CEILING: sqlCeiling,
      JOURNAL_MIGRATION_CEILING: journalCeiling,
      ...(declaredReleaseCeiling !== undefined ? { DECLARED_RELEASE_CEILING: declaredReleaseCeiling } : {}),
    },
  };
}

function parseArgs(argv) {
  const args = {
    sqlDir: 'apps/api/src/infrastructure/db/migrations',
    journal: null,
    scope: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sql-dir') args.sqlDir = argv[++i];
    else if (a === '--journal') args.journal = argv[++i];
    else if (a === '--scope') args.scope = argv[++i];
    else {
      console.error(`UNKNOWN_ARGUMENT: ${a}`);
      process.exit(2);
    }
  }
  if (!args.journal) args.journal = path.join(args.sqlDir, 'meta', '_journal.json');
  return args;
}

function reportBlockerAndExit(blocker, detail) {
  console.error('SQL_JOURNAL_PARITY=FAILED');
  console.error(`MIGRATION_PARITY_BLOCKER=${blocker}`);
  console.error(detail);
  process.exit(1);
}

function readScopeOrExit(scopePath) {
  let raw;
  try {
    raw = fs.readFileSync(scopePath, 'utf8');
  } catch (err) {
    reportBlockerAndExit('RELEASE_SCOPE_FILE_UNREADABLE', `${scopePath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    reportBlockerAndExit('RELEASE_SCOPE_FILE_MALFORMED', `${scopePath}: ${err.message}`);
  }
  return undefined; // unreachable; reportBlockerAndExit always exits
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let sqlStems;
  try {
    sqlStems = readSqlMigrationStems(args.sqlDir);
  } catch (err) {
    reportBlockerAndExit('SQL_MIGRATIONS_DIR_UNREADABLE', err.message);
    return;
  }

  const journalResult = parseJournalFile(args.journal);
  if (!journalResult.ok) {
    reportBlockerAndExit(journalResult.blocker, journalResult.detail);
    return;
  }

  const scope = args.scope ? readScopeOrExit(args.scope) : null;

  const result = checkMigrationParity({ sqlStems, journalEntries: journalResult.entries, scope });
  if (!result.ok) {
    reportBlockerAndExit(result.blocker, result.detail);
    return;
  }

  const f = result.fields;
  console.log(`SQL_MIGRATION_COUNT=${f.SQL_MIGRATION_COUNT}`);
  console.log(`JOURNAL_ENTRY_COUNT=${f.JOURNAL_ENTRY_COUNT}`);
  console.log(`JOURNAL_INDEX_RANGE=${f.JOURNAL_INDEX_RANGE}`);
  console.log(`SQL_MIGRATION_CEILING=${f.SQL_MIGRATION_CEILING}`);
  console.log(`JOURNAL_MIGRATION_CEILING=${f.JOURNAL_MIGRATION_CEILING}`);
  if (f.DECLARED_RELEASE_CEILING !== undefined) {
    console.log(`DECLARED_RELEASE_CEILING=${f.DECLARED_RELEASE_CEILING}`);
  }
  console.log('SQL_JOURNAL_PARITY=PASSED');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
