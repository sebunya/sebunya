import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * What ships to every visitor must not carry the team's working notes
 * (2026-10-08 leak audit: the service worker shipped dated incident history and
 * a commit id; inline scripts shipped design notes). Bundled <script>s are
 * minified by the build; is:inline / define:vars scripts and public/ files are
 * not, so notes belong in template comments ({/* … *\/}) outside them.
 */
const root = path.resolve(__dirname, '../..');
const web = path.join(root, 'apps/web/src');

function inlineScriptCommentLines(source: string): number {
  const fm = source.match(/^---\n[\s\S]*?\n---\n/);
  let i = fm ? fm[0].length : 0;
  const tag = /<script\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g;
  let count = 0;
  for (;;) {
    tag.lastIndex = i;
    const m = tag.exec(source);
    if (!m) break;
    const attrs = m[1];
    if (attrs.trimEnd().endsWith('/')) { i = m.index + m[0].length; continue; }
    const end = source.indexOf('</script>', m.index + m[0].length);
    if (end < 0) break;
    const body = source.slice(m.index + m[0].length, end);
    i = end + 9;
    if (!/is:inline|define:vars/.test(attrs) || /set:html|ld\+json/.test(attrs)) continue;
    count += body.split('\n').filter((l) => /^\s*(\/\/|\/\*|\*\s|\*\/)/.test(l)).length;
  }
  return count;
}

function astroFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'admin' ? [] : astroFiles(p);
    return d.name.endsWith('.astro') ? [p] : [];
  });
}

describe('no developer notes in what ships to visitors', () => {
  it('storefront is:inline / define:vars scripts carry no comment lines', () => {
    const offenders = astroFiles(web)
      .map((f) => [path.relative(root, f), inlineScriptCommentLines(fs.readFileSync(f, 'utf8'))] as const)
      .filter(([, n]) => n > 0);
    expect(offenders).toEqual([]);
  });

  it('the scanner itself finds a comment in an inline script and skips self-closing tags', () => {
    const sample = '---\nconst a = "<script>";\n---\n<script type="application/ld+json" set:html={x} />\n<p/>\n<script is:inline>\n  // note\n  run();\n</script>\n';
    expect(inlineScriptCommentLines(sample)).toBe(1);
  });

  it('the build minifies the public files that are otherwise copied verbatim', () => {
    const cfg = fs.readFileSync(path.join(root, 'apps/web/astro.config.mjs'), 'utf8');
    expect(cfg).toMatch(/minifyPublicAssets\(\)/);
    expect(cfg).toMatch(/\['sw\.js', 'js'\]/);
    expect(cfg).toMatch(/\['fonts\/faces\.css', 'css'\]/);
    expect(cfg).toMatch(/not found in the build output/); // a missing file fails the build
  });
});
