import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, '../../../apps/web/src/pages/admin/delivery/index.astro'), 'utf8');
const publish = page.slice(page.indexOf('intent === "switches-publish"'), page.indexOf('intent === "ladder-dry-run"'));

describe('Control Centre switches publish', () => {
  it('requires the operator to confirm the preview', () => {
    expect(publish).toMatch(/form\.get\("confirmed"\) !== "on"/);
    expect(page).toMatch(/name="confirmed" required/);
  });
  it('re-reads the preview and refuses when it lists problems', () => {
    expect(publish).toMatch(/\/preview`/);
    expect(publish).toMatch(/problems\.length > 0/);
    expect(publish.indexOf('problems.length > 0')).toBeLessThan(publish.indexOf('/publish`'));
  });
  it('shows no publish button when the preview has problems', () => {
    expect(page).toMatch(/switchesPreview\.problems\?\.length > 0 \? \(/);
  });
});
