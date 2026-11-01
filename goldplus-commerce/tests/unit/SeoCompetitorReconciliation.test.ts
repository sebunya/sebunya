import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Competitor-universe reconciliation contract (2026-08-10).
 *
 * The forensic source workbook names 58 competitors. The seed script is the
 * repository's canonical representation of that universe, so this test pins
 * the seed source against the workbook by NAME, not by count — adding a row
 * to satisfy a number is exactly the failure mode this guards against.
 *
 * The seed reads env/DB at import time, so we assert against its source text
 * (house precedent: the admin-route sweeps do the same).
 */
const seedSource = readFileSync(
  resolve(__dirname, '../../apps/api/src/scripts/seed-seo-competitors.ts'),
  'utf8',
);

// Workbook entry 27 "Computers.co.ug / Pavan" is seeded as canonical
// 'Computers.co.ug' with alias 'Pavan' — asserted separately below.
const SOURCE_COMPETITORS = [
  'Jumia Uganda', 'Jiji Uganda', 'Kilimall Uganda', 'MoMo Market',
  'Oraimo Uganda', 'BLACK', 'TechXpress Uganda', 'Gadget Craze Uganda',
  'Gadget Shop Uganda', 'Dondolo', 'Discount Store Uganda', 'Abanista',
  'Nabellas Stores', 'Mtunda', 'Dombelo', 'KYG World', 'Odukar', 'Kibuga',
  'Mr Gadget Uganda', 'MobileShop Uganda', 'TheHub Uganda', 'Kwesi Stores',
  'Noble Gadgets', 'Sefbuy', 'BHT Store Uganda', 'Orbit Uganda',
  'Computers.co.ug', 'Computer Store Uganda', 'Vision Shop Uganda',
  'Ubuy Uganda', 'Simba Telecom', 'AppsTech Uganda', 'GadgetsWorld Uganda',
  'Authentic Gadgets Uganda', 'Mercury Computers Uganda', 'RedSMS Uganda',
  'Kampala Arcade', 'Anker', 'Green Lion', 'Porodo', 'HOCO', 'KWT Tech Mart',
  'Dantty', 'BuBu eMarket', 'Risi Shop', 'Tamemah Gadgets', 'VAZ Uganda',
  'Crystal Gadgets', 'Fix It Uganda', 'Legends Accessories', 'Stepify Uganda',
  'Tupewo', 'Twix Consult Uganda', 'Sarada Technologies',
  'UpTech Electronics Shop UG', 'O&O Gadgets Uganda', 'Nexus Computers Uganda',
  'StarTech Uganda',
] as const;

describe('SEO competitor seed reconciles the 58-entry source workbook', () => {
  it('contains every workbook competitor by exact canonical name', () => {
    for (const name of SOURCE_COMPETITORS) {
      expect(seedSource, `workbook competitor missing from seed: ${name}`).toContain(`'${name}'`);
    }
    expect(SOURCE_COMPETITORS).toHaveLength(58);
  });

  it('keeps the Pavan alias on Computers.co.ug (workbook entry 27)', () => {
    expect(seedSource).toMatch(/canonicalName: 'Computers\.co\.ug', aliases: \[[^\]]*'Pavan'/);
  });

  it('documents Ayne Uganda as the single deliberate extra beyond the workbook', () => {
    expect(seedSource).toContain("'Ayne Uganda'");
  });

  it('keeps MoMo Market a distinct first-class REGIONAL_MARKETPLACE entity', () => {
    const momo = seedSource.split('\n').find((l) => l.includes("canonicalName: 'MoMo Market'"))!;
    expect(momo).toBeTruthy();
    expect(momo).toContain("businessType: 'REGIONAL_MARKETPLACE'");
    expect(momo).toContain("'Market by MoMo'");
    expect(momo).toContain("'MTN MoMo Market'");
    expect(momo).toContain('isMarketplace: true');
    // Never merged into telecom entities: Simba Telecom must be its own row
    // and no telecom alias may appear on the MoMo row.
    expect(seedSource).toContain("'Simba Telecom'");
    expect(momo).not.toMatch(/Simba|mobile.money|MTN corporate/i);
  });

  it('never merges similarly named retailers', () => {
    expect(seedSource).toContain("'Gadget Shop Uganda'");
    expect(seedSource).toContain("'Gadget Craze Uganda'");
  });

  it('classifies the two workbook late additions honestly as UNRESOLVED', () => {
    for (const name of ['RedSMS Uganda', 'Kampala Arcade']) {
      const line = seedSource.split('\n').find((l) => l.includes(`'${name}'`))!;
      expect(line, `${name} must not carry an invented classification`).toContain("businessType: 'UNRESOLVED'");
    }
  });
});
