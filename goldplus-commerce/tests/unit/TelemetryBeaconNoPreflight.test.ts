import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/**
 * sendBeacon always sends credentials. A JSON content type forces a credentialed CORS
 * preflight the API does not allow, so every storefront telemetry batch was blocked with a
 * console error (Lighthouse Best Practices 96 on product pages, 2026-09-14). The beacon uses
 * a CORS-safelisted text/plain blob; the API must keep parsing the raw body as JSON.
 */
describe('storefront telemetry beacon needs no CORS preflight', () => {
  it('the batch blob is text/plain, never application/json', () => {
    const lib = read('apps/web/src/lib/telemetry.ts');
    expect(lib).toContain("new Blob([JSON.stringify(events)], { type: 'text/plain;charset=UTF-8' })");
    expect(lib).not.toMatch(/new Blob\(\[JSON\.stringify\(events\)\], \{ type: 'application\/json' \}\)/);
  });

  it('the API parses the batch body as JSON whatever its content type, and never allows credentials', () => {
    const mw = read('apps/api/src/interfaces/http/middleware/botDetection.ts');
    expect(mw).toContain('const text = await c.req.text();');
    expect(mw).toContain('parsedBody = JSON.parse(text);');
    expect(read('apps/api/src/interfaces/http/app.ts')).not.toMatch(/credentials:\s*true/);
  });

  it('bot-flagged telemetry is discarded with 204, never a 403 that logs a console error', () => {
    const mw = read('apps/api/src/interfaces/http/middleware/botDetection.ts');
    expect(mw).toContain('if (isBotUserAgent(ua)) return c.newResponse(null, 204);');
    expect(mw).toContain('cfBotScore < 30) return c.newResponse(null, 204);');
    expect(mw).not.toMatch(/newResponse\(null, 403\)/);
  });
});

