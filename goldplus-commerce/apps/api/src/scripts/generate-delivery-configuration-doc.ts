/**
 * Generates docs/delivery/CONFIGURATION.md from the registry.
 *
 * "…generates from it and is never hand-maintained." A doc that drifts from the
 * code is worse than no doc, so this is the only way that file is written and a
 * test asserts the file on disk matches what this produces.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DELIVERY_CONFIG_REGISTRY, LAUNCH_KEYS } from '../domain/delivery/DeliveryConfigRegistry';

const TIER_LABEL: Record<number, string> = {
  1: 'Tier 1 — one approver',
  2: 'Tier 2 — maker and checker',
  3: 'Tier 3 — code only, absent from the UI',
};

export function renderConfigurationDoc(): string {
  const lines: string[] = [];
  lines.push('# Delivery configuration');
  lines.push('');
  lines.push('> GENERATED FROM `DeliveryConfigRegistry.ts`. Do not hand-edit — run');
  lines.push('> `npx tsx src/scripts/generate-delivery-configuration-doc.ts`. A test asserts');
  lines.push('> this file matches the registry, so drift fails the build rather than');
  lines.push('> quietly misleading whoever reads it next.');
  lines.push('');
  lines.push('A key outside this registry cannot be written. That is what stops the');
  lines.push('settings table becoming a junk drawer.');
  lines.push('');
  lines.push(`**${LAUNCH_KEYS.length} mandatory launch values**, plus \`own_rider_max_band\`, gate quoting.`);
  lines.push('Everything else is optional and its absence produces a weaker, honest');
  lines.push('promise rather than a default.');
  lines.push('');

  for (const tier of [1, 2, 3] as const) {
    const entries = DELIVERY_CONFIG_REGISTRY.filter((e) => e.tier === tier);
    if (entries.length === 0) continue;
    lines.push(`## ${TIER_LABEL[tier]}`);
    lines.push('');
    lines.push('| Key | Type | Unit | Ships as | Range | What it is |');
    lines.push('|---|---|---|---|---|---|');
    for (const e of entries) {
      const ships = e.defaultValue === null ? '**unset**' : `\`${String(e.defaultValue).slice(0, 60)}\``;
      const range = e.allowedValues
        ? e.allowedValues.join(' / ')
        : e.min !== undefined || e.max !== undefined
          ? `${e.min ?? '—'} to ${e.max ?? '—'}`
          : '—';
      lines.push(
        `| \`${e.key}\`${e.mandatory ? ' **(required)**' : ''} | ${e.type} | ${e.unit ?? '—'} | ${ships} | ${range} | ${e.label} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Help text, as an operator sees it');
  lines.push('');
  for (const e of DELIVERY_CONFIG_REGISTRY) {
    lines.push(`- **${e.label}** (\`${e.key}\`) — ${e.help}`);
  }
  lines.push('');
  return lines.join('\n');
}

if (require.main === module) {
  const out = resolve(__dirname, '../../../../docs/delivery/CONFIGURATION.md');
  writeFileSync(out, renderConfigurationDoc(), 'utf8');
  console.log(`CONFIGURATION_DOC_OK ${out} (${DELIVERY_CONFIG_REGISTRY.length} entries)`);
}
