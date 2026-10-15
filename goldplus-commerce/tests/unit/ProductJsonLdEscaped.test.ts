import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { serializeJsonLd } from '../../apps/web/src/lib/jsonld';

/** Product JSON-LD is escaped: catalogue text containing "</script>" cannot end the tag and run as script. */
describe('ProductJsonLd', () => {
  it('serialises with serializeJsonLd, never a bare JSON.stringify into set:html', () => {
    const src = readFileSync('apps/web/src/components/ProductJsonLd.astro', 'utf8');
    expect(src).toMatch(/import \{ serializeJsonLd(, [\w, ]+)? \} from '\.\.\/lib\/jsonld';/);
    expect(src).toMatch(/const jsonText = serializeJsonLd\(node\)/);
    expect(src).not.toMatch(/const jsonText = JSON\.stringify\(node\)/);
  });
  it('serializeJsonLd neutralises a script break-out', () => {
    const out = serializeJsonLd({ name: 'Cable</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out).name).toBe('Cable</script><script>alert(1)</script>');
  });
});
