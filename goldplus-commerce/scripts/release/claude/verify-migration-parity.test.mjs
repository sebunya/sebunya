import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkMigrationParity,
  parseJournalFile,
  readSqlMigrationStems,
} from './verify-migration-parity.mjs';

// All 61 real stems (0000-0060), used so pure-logic cases exercise a realistic shape
// rather than a toy 3-entry set.
const VALID_STEMS = Array.from({ length: 61 }, (_, i) => `${String(i).padStart(4, '0')}_migration_${i}`);
const journalFor = (stems) => stems.map((tag, idx) => ({ idx, tag }));

const tmpDirs = [];
function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-parity-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

function writeFixture({ stems, journalEntries, journalRaw }) {
  const dir = makeTmpDir();
  for (const stem of stems) {
    fs.writeFileSync(path.join(dir, `${stem}.sql`), '-- noop\n');
  }
  fs.mkdirSync(path.join(dir, 'meta'));
  const journalPath = path.join(dir, 'meta', '_journal.json');
  if (journalRaw !== undefined) {
    fs.writeFileSync(journalPath, journalRaw);
  } else {
    fs.writeFileSync(
      journalPath,
      JSON.stringify({ version: '5', dialect: 'postgresql', entries: journalEntries }),
    );
  }
  return dir;
}

describe('checkMigrationParity (pure logic)', () => {
  it('passes a valid 61-entry set', () => {
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journalFor(VALID_STEMS) });
    expect(result.ok).toBe(true);
    expect(result.fields.SQL_MIGRATION_COUNT).toBe(61);
    expect(result.fields.JOURNAL_ENTRY_COUNT).toBe(61);
    expect(result.fields.JOURNAL_INDEX_RANGE).toBe('0-60');
    expect(result.fields.SQL_MIGRATION_CEILING).toBe('0060_migration_60');
    expect(result.fields.JOURNAL_MIGRATION_CEILING).toBe('0060_migration_60');
    expect(result.fields.DECLARED_RELEASE_CEILING).toBeUndefined();
  });

  it('fails when the final journal entry is missing', () => {
    const journal = journalFor(VALID_STEMS).slice(0, 60); // drops idx 60
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journal });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('SQL_JOURNAL_COUNT_MISMATCH');
  });

  it('fails when the journal has an extra entry beyond the sql ceiling', () => {
    const journal = [...journalFor(VALID_STEMS), { idx: 61, tag: '0061_ghost_migration' }];
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journal });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('SQL_JOURNAL_COUNT_MISMATCH');
  });

  it('fails when a sql file is missing but the journal still claims it', () => {
    const stems = VALID_STEMS.slice(0, 60); // drops 0060 on disk
    const result = checkMigrationParity({ sqlStems: stems, journalEntries: journalFor(VALID_STEMS) });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('SQL_JOURNAL_COUNT_MISMATCH');
  });

  it('fails on a duplicate journal tag', () => {
    const journal = journalFor(VALID_STEMS);
    journal[10] = { idx: journal[10].idx, tag: journal[9].tag };
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journal });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('DUPLICATE_JOURNAL_TAG');
  });

  it('fails on a duplicate sql migration tag (fixture-only, unreachable on a real filesystem)', () => {
    const stems = [...VALID_STEMS, VALID_STEMS[0]];
    const result = checkMigrationParity({ sqlStems: stems, journalEntries: journalFor(VALID_STEMS) });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('DUPLICATE_SQL_MIGRATION_TAG');
  });

  it('fails on a duplicate sql migration number across two different filenames', () => {
    const stems = VALID_STEMS.slice(0, 60).concat(['0059_alternate_name']); // reuses number 0059
    const result = checkMigrationParity({ sqlStems: stems.sort(), journalEntries: journalFor(stems.sort()) });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('DUPLICATE_SQL_MIGRATION_NUMBER');
  });

  it('fails on a discontinuous journal index', () => {
    const journal = journalFor(VALID_STEMS).filter((e) => e.idx !== 30);
    journal.push({ idx: 61, tag: VALID_STEMS[30] }); // keeps count equal, opens a gap at 30
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journal });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('JOURNAL_INDEX_DISCONTINUOUS');
  });

  it('fails when the first journal index is not zero', () => {
    const journal = journalFor(VALID_STEMS).map((e) => ({ idx: e.idx + 1, tag: e.tag }));
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journal });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('JOURNAL_FIRST_INDEX_NOT_ZERO');
  });

  it('fails on incorrect ordering between sql stems and journal tags', () => {
    const journal = journalFor(VALID_STEMS);
    // swap two tags' positions without touching idx or duplicating anything
    const tmp = journal[5].tag;
    journal[5] = { idx: journal[5].idx, tag: journal[6].tag };
    journal[6] = { idx: journal[6].idx, tag: tmp };
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journal });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('ORDER_MISMATCH');
  });

  it('fails when the sql ceiling and journal ceiling disagree', () => {
    // Same count, same set, but idx 60 and idx 59's tags are swapped so the
    // final journal index no longer names the same migration as the last sql file.
    const journal = journalFor(VALID_STEMS);
    const last = journal[60].tag;
    journal[60] = { idx: 60, tag: journal[59].tag };
    journal[59] = { idx: 59, tag: last };
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journal });
    expect(result.ok).toBe(false);
    // Caught as an ordering problem before the dedicated ceiling comparison runs;
    // either way this drift must never report success.
    expect(['ORDER_MISMATCH', 'SQL_JOURNAL_CEILING_MISMATCH']).toContain(result.blocker);
  });

  it('fails when the declared release-scope ceiling disagrees with sql/journal', () => {
    const result = checkMigrationParity({
      sqlStems: VALID_STEMS,
      journalEntries: journalFor(VALID_STEMS),
      scope: { migrationCeiling: '0049_module_activation_approvals' },
    });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('RELEASE_SCOPE_CEILING_MISMATCH');
  });

  it('accepts a release-scope ceiling with a .sql suffix as equivalent to the bare tag', () => {
    const result = checkMigrationParity({
      sqlStems: VALID_STEMS,
      journalEntries: journalFor(VALID_STEMS),
      scope: { migrationCeiling: `${VALID_STEMS[60]}.sql` },
    });
    expect(result.ok).toBe(true);
    expect(result.fields.DECLARED_RELEASE_CEILING).toBe(VALID_STEMS[60]);
  });

  it('never reports PASSED alongside a blocker', () => {
    const journal = journalFor(VALID_STEMS).slice(0, 60);
    const result = checkMigrationParity({ sqlStems: VALID_STEMS, journalEntries: journal });
    expect(result.ok).toBe(false);
    expect(result.fields).toBeUndefined();
  });
});

describe('parseJournalFile (malformed input)', () => {
  it('reports invalid JSON syntax as a named blocker', () => {
    const dir = makeTmpDir();
    const p = path.join(dir, '_journal.json');
    fs.writeFileSync(p, '{ this is not json');
    const result = parseJournalFile(p);
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('JOURNAL_MALFORMED_JSON');
  });

  it('rejects a journal whose entries is not an array', () => {
    const dir = makeTmpDir();
    const p = path.join(dir, '_journal.json');
    fs.writeFileSync(p, JSON.stringify({ version: '5', dialect: 'postgresql', entries: 'nope' }));
    const result = parseJournalFile(p);
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('JOURNAL_UNSUPPORTED_STRUCTURE');
  });

  it('rejects an entry missing a numeric idx', () => {
    const dir = makeTmpDir();
    const p = path.join(dir, '_journal.json');
    fs.writeFileSync(
      p,
      JSON.stringify({ version: '5', dialect: 'postgresql', entries: [{ tag: '0000_x' }] }),
    );
    const result = parseJournalFile(p);
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('JOURNAL_UNSUPPORTED_STRUCTURE');
  });

  it('rejects a top-level array instead of an object', () => {
    const dir = makeTmpDir();
    const p = path.join(dir, '_journal.json');
    fs.writeFileSync(p, JSON.stringify([1, 2, 3]));
    const result = parseJournalFile(p);
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('JOURNAL_UNSUPPORTED_STRUCTURE');
  });

  it('reports a missing file as unreadable, not as malformed JSON', () => {
    const result = parseJournalFile('/definitely/does/not/exist/_journal.json');
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('JOURNAL_FILE_UNREADABLE');
  });
});

describe('end-to-end against real temporary fixture directories', () => {
  it('a valid 61-file fixture on disk passes through readSqlMigrationStems + parseJournalFile', () => {
    const dir = writeFixture({ stems: VALID_STEMS, journalEntries: journalFor(VALID_STEMS) });
    const sqlStems = readSqlMigrationStems(dir);
    const journalResult = parseJournalFile(path.join(dir, 'meta', '_journal.json'));
    expect(journalResult.ok).toBe(true);
    const result = checkMigrationParity({ sqlStems, journalEntries: journalResult.entries });
    expect(result.ok).toBe(true);
    expect(result.fields.SQL_MIGRATION_COUNT).toBe(61);
  });

  it('a fixture missing the final SQL file on disk is caught end-to-end', () => {
    const dir = writeFixture({ stems: VALID_STEMS.slice(0, 60), journalEntries: journalFor(VALID_STEMS) });
    const sqlStems = readSqlMigrationStems(dir);
    const journalResult = parseJournalFile(path.join(dir, 'meta', '_journal.json'));
    expect(journalResult.ok).toBe(true);
    const result = checkMigrationParity({ sqlStems, journalEntries: journalResult.entries });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('SQL_JOURNAL_COUNT_MISMATCH');
  });

  it('does not mutate the tracked migrations directory it never touches', () => {
    const before = fs.readdirSync('apps/api/src/infrastructure/db/migrations').sort();
    writeFixture({ stems: VALID_STEMS, journalEntries: journalFor(VALID_STEMS) });
    const after = fs.readdirSync('apps/api/src/infrastructure/db/migrations').sort();
    expect(after).toEqual(before);
  });
});
