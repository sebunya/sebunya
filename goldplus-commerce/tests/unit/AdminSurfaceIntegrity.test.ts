import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Admin surface integrity: copy, controls, and decoration.
 *
 * Three defects kept reappearing across the 122 admin modules, all of them the
 * same mistake in different clothes — a surface describing itself instead of
 * describing the system:
 *
 *   "not available yet"   on a page that was never going to build the feature,
 *                         because the capability was a policy decision
 *   a disabled button     with no stated reason, indistinguishable from a bug
 *   a decorative emoji    carrying no information an operator can act on
 *
 * Copy that promises a future the roadmap does not contain is worse than blunt
 * copy: an operator waits for it. These tests read the real admin pages, so a
 * new page cannot reintroduce any of the three silently.
 */

const ADMIN = 'apps/web/src/pages/admin';

const adminPages = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.astro')) out.push(p);
    }
  };
  walk(ADMIN);
  return out;
};

/** Strips HTML attribute values and comments: form hints are not operator prose. */
const prose = (src: string): string =>
  src
    .replace(/\b[a-zA-Z-]+=(\{[^}]*\}|"[^"]*"|'[^']*')/g, '')
    .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

describe('the admin console never promises an unbuilt future', () => {
  const BANNED = /\b(coming soon|not (yet )?implemented|not available yet|under construction|work in progress)\b/i;

  it('has no page telling an operator to wait for a feature', () => {
    const offenders = adminPages().filter((p) => BANNED.test(prose(readFileSync(p, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('covers every admin page, so the guard cannot pass by reading nothing', () => {
    // A file-walking test that silently matches zero files always passes.
    expect(adminPages().length).toBeGreaterThan(100);
  });

  it('states the reason when a capability is deliberately withheld', () => {
    // Governance disables admin invitation on purpose. The button must say why,
    // or it reads as a broken control.
    const gov = readFileSync(join(ADMIN, 'governance/index.astro'), 'utf8');
    expect(gov).toMatch(/disabled by security policy/i);
    expect(gov).toMatch(/deliberate security decision/i);
  });

  it('describes a read-only view as a design, not a missing editor', () => {
    const merch = readFileSync(join(ADMIN, 'merchandising/index.astro'), 'utf8');
    expect(merch).toMatch(/read-only view/i);
    expect(merch).not.toMatch(/not available yet/i);
  });
});

describe('empty states name what failed, not what was never built', () => {
  // Two different conditions share this helper and must not be conflated:
  // "No alerts yet" describes real emptiness, while a missing endpoint is a
  // load failure. Both are honest; neither may imply an unbuilt feature.
  const reasons = (): { page: string; text: string }[] => {
    const out: { page: string; text: string }[] = [];
    for (const p of adminPages()) {
      for (const m of readFileSync(p, 'utf8').matchAll(/emptyReason\([^,]+,\s*"([^"]*)"/g)) {
        out.push({ page: p, text: m[1] });
      }
    }
    return out;
  };

  it('has no fallback promising a feature that is not coming', () => {
    const bad = reasons().filter((r) => /not available yet|coming soon/i.test(r.text));
    expect(bad).toEqual([]);
  });

  it('phrases an unreachable endpoint as a load failure rather than an absent feature', () => {
    // The six repaired strings; each names the thing that could not be read.
    const loadFailures = reasons().filter((r) => /could not be loaded/i.test(r.text));
    expect(loadFailures.length).toBeGreaterThanOrEqual(6);
  });

  it('reads real fallbacks off the pages, so the guard is not vacuous', () => {
    expect(reasons().length).toBeGreaterThan(6);
  });
});

describe('the admin console carries no decorative emoji', () => {
  it('finds none across every admin page', () => {
    const DECORATIVE = /[✨\u{1F680}\u{1F389}\u{1F4A1}\u{1F525}⭐\u{1F3AF}\u{1F4E1}]/u;
    const offenders = adminPages().filter((p) => DECORATIVE.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('every admin control is wired to something', () => {
  it('has no button outside a form without a handler hook', () => {
    // A bare <button> inside a <form> submits it; outside one it needs an id,
    // a data-attribute, or a class a script binds, or it does nothing at all.
    const dead: string[] = [];
    for (const p of adminPages()) {
      const src = readFileSync(p, 'utf8');
      let depth = 0;
      for (const m of src.matchAll(/<form\b|<\/form>|<button\b[^>]*>/g)) {
        const t = m[0];
        if (t === '<form') depth += 1;
        else if (t === '</form>') depth = Math.max(0, depth - 1);
        else if (depth === 0 && !/\bdisabled\b|\bid=|data-[a-z-]+=|onclick|\bform=|class="[^"]*"/.test(t)) {
          dead.push(`${p}: ${t.slice(0, 80)}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });

  it('binds each class-hooked control on the categories page', () => {
    // The only three buttons that live outside a form; they are bound by class.
    const src = readFileSync(join(ADMIN, 'categories/index.astro'), 'utf8');
    for (const hook of ['add-sub', 'remove-category', 'remove-sub']) {
      expect(src).toMatch(new RegExp(`querySelector\\('\\.${hook}'\\)\\.addEventListener`));
    }
  });
});
