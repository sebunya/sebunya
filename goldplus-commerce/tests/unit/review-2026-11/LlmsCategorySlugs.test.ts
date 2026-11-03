import { describe, it, expect } from 'vitest';
import { DEFAULT_TAXONOMY } from '../../../packages/shared/src/taxonomy';
import { llmsCategoryLines } from '../../../apps/web/src/lib/llmsCategories';

const p = (name: string, categoryName: string) => ({ slug: name.toLowerCase().replace(/\s+/g, '-'), name, categoryName }) as any;

describe('llms.txt category links use the taxonomy slug', () => {
  it('Power Devices links to power-devices; an "Other" mouse is counted where the shop files it', () => {
    const lines = llmsCategoryLines([p('Anker Charger', 'Power Devices'), p('Wireless Mouse', 'Other'), p('Oddity', 'Other')], DEFAULT_TAXONOMY, 'https://x');
    const power = lines.find((l) => l.name === 'Power Devices')!;
    expect(power.href).toBe('https://x/shop?category=power-devices');
    const pc = lines.find((l) => l.name === 'PC Accessories');
    expect(pc?.count).toBe(1);
    expect(pc?.href).toMatch(/category=/);
    expect(lines.find((l) => l.name === 'Other')?.href).toBeNull();
  });
});
