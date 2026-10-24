import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * docker-compose.production.yml passes environment variables to each container BY NAME. A setting the api
 * reads but compose does not list never arrives, whatever is in .env.production: Goldie's WhatsApp switch,
 * its token and number id, and the Care Desk alert settings were all missing at first (2026-10-13), so
 * WhatsApp could never have been turned on. Every Goldie or Care Desk setting the api reads must be passed
 * through to the api service, and documented in .env.example.
 */
const API = join(__dirname, '../../apps/api/src');
const compose = readFileSync(join(__dirname, '../../docker-compose.production.yml'), 'utf8');
const example = readFileSync(join(__dirname, '../../.env.example'), 'utf8');

function files(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) files(f, acc);
    else if (e.endsWith('.ts')) acc.push(f);
  }
  return acc;
}

describe('Goldie settings reach the api container', () => {
  const names = new Set<string>();
  for (const f of files(API)) for (const m of readFileSync(f, 'utf8').matchAll(/\benv\.((?:GOLDIE|CARE)_[A-Z_]+|WEB_INTERNAL_ORIGIN)/g)) names.add(m[1]!);
  // Read by code that is written but not wired (GoldieOrderActionsUseCases); passed through when it is.
  names.delete('GOLDIE_REFUND_CAP_UGX');

  it('finds the settings the api reads', () => {
    expect([...names]).toEqual(expect.arrayContaining(['GOLDIE_WHATSAPP_ENABLED', 'GOLDIE_WHATSAPP_TOKEN', 'CARE_ALERTS_PER_HOUR', 'WEB_INTERNAL_ORIGIN']));
  });
  it('passes each one to the api service and documents it', () => {
    const apiBlock = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  web:'));
    const missing = [...names].filter((n) => !new RegExp(`- ${n}=\\$\\{${n}`).test(apiBlock));
    const undocumented = [...names].filter((n) => !new RegExp(`^${n}=`, 'm').test(example));
    expect({ missing, undocumented }).toEqual({ missing: [], undocumented: [] });
  });
});

describe('measurement keys reach the api container', () => {
  it('YOUTUBE_API_KEY (0206) is passed through to the api service, else the key in .env.production never arrives', () => {
    const api = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  web:'));
    expect(api).toContain('- YOUTUBE_API_KEY=${YOUTUBE_API_KEY:-}');
    expect(example).toContain('YOUTUBE_API_KEY=');
    expect(api).toContain('- BOU_FX_TOKEN=${BOU_FX_TOKEN:-}');
    expect(example).toContain('BOU_FX_TOKEN=');
  });
});
