import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Link a code-less research row to a catalogue battery, on REAL PostgreSQL
 * (disposable production copy). Proves: the source row is untouched, the link
 * forces a new dry run, the dry run then stages the row as a supplier-listed
 * draft action, nothing public is written, and the decision is in the history.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('battery import: link a row to a catalogue battery (real PostgreSQL)', () => {
  let raw: any; let uc: any; let actor: string; let battery: { canonical_code: string; product_id: string };
  let sessionId = '';

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    const { Registry } = await import('../../apps/api/src/infrastructure/Registry');
    uc = Registry.getInstance().batteryImportUseCases;
    actor = (await raw`select id from users limit 1`)[0].id;
    battery = (await raw`select canonical_code, product_id from battery_profiles order by canonical_code limit 1`)[0];
  });

  afterAll(async () => {
    if (sessionId) {
      await raw`delete from battery_import_events where session_id = ${sessionId}`;
      await raw`delete from battery_import_rows where session_id = ${sessionId}`;
      await raw`delete from battery_import_sessions where id = ${sessionId}`;
    }
    await raw.end();
  });

  it('links, re-runs the dry run, and stages an identity-only draft', async () => {
    const csv = `Battery Reference,Device Brand,Marketing Name,Exact Model Number,Evidence Status,Evidence Source\n,ITEST,Linkphone ${Date.now()},IT-1,Inventory-name claim,itest\n`;
    const up = await uc.upload({ importType: 'COMPATIBILITY', name: `itest link ${Date.now()}`, filename: `itest-link-${Date.now()}.csv`, mime: 'text/csv', buffer: Buffer.from(csv), sheetName: null, actorId: actor });
    sessionId = up.session.id;
    let s = await uc.saveMapping({ id: sessionId, expectedVersion: up.session.version, mapping: up.suggestedMapping, templateId: null, saveAsTemplate: null, actorId: actor });
    let run = await uc.preview({ id: sessionId, expectedVersion: (s.session ?? s).version, actorId: actor });
    const row = run.rows[0];
    expect(row.status).toBe('INVALID');
    expect(row.validationErrors.join(' ')).toContain('Battery code is required');

    const before = { devices: (await raw`select count(*)::int n from devices`)[0].n, claims: (await raw`select count(*)::int n from product_device_compatibility`)[0].n };
    const linked = await uc.linkRowBattery({ id: sessionId, rowId: row.id, canonicalCode: battery.canonical_code.toLowerCase(), note: 'itest: this row is about that battery', actorId: actor });
    expect(linked.row.linkedBatteryCode).toBe(battery.canonical_code);
    expect(linked.session.status).toBe('MAPPED'); // approval must wait for a fresh dry run
    expect(linked.row.sourceData['Battery Reference']).toBe(''); // the research is untouched

    run = await uc.preview({ id: sessionId, expectedVersion: linked.session.version, actorId: actor });
    const after = run.rows[0];
    expect(after.validationErrors).toEqual([]);
    expect(after.status).toBe('VALID');
    expect(after.proposedAction).toBe('CREATE_CLAIM');
    expect(after.normalizedData.batteryProductId).toBe(battery.product_id);
    expect(after.normalizedData.evidenceStatus).toBe('SUPPLIER_LISTED');
    expect(after.sourceData['Battery Reference']).toBe('');

    // A dry run writes nothing public.
    expect((await raw`select count(*)::int n from devices`)[0].n).toBe(before.devices);
    expect((await raw`select count(*)::int n from product_device_compatibility`)[0].n).toBe(before.claims);
    const events = await raw`select action, reason from battery_import_events where session_id = ${sessionId} and action = 'ROW_BATTERY_LINKED'`;
    expect(events.length).toBe(1);
    expect(events[0].reason).toContain('itest');
  }, 60_000);
});
