import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  makeNonce,
  nonceScriptStream,
  nonceScriptTags,
  strictPolicyMode,
  strictReportOnlyPolicy,
} from '../../apps/web/src/lib/contentSecurityPolicy';
import { CspViolationLog, summariseCspReports } from '../../apps/web/src/lib/cspReports';

/**
 * The strict script policy runs REPORT-ONLY: templates put a per-request nonce on
 * the inline scripts they own, the middleware stamps it on our same-site script
 * files (never on anything else), and what the policy would block is reported.
 * These tests pin the three things that make that safe and useful: every tag is
 * stamped even when the HTML streams in awkward chunks, the report endpoint
 * keeps nothing that identifies a visitor, and inline event handlers — which no
 * nonce can ever permit — cannot come back.
 */

async function streamThrough(chunks: string[], nonce: string): Promise<string> {
  const enc = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
  return new Response(source.pipeThrough(nonceScriptStream(nonce))).text();
}

describe('nonce stamping', () => {
  const html = '<head><script src="/_astro/hoisted.abc.js" type="module"></script><SCRIPT SRC=\'/x.js\'></SCRIPT>'
    + '<script>alert("injected inline")</script><script src="https://evil.example/x.js"></script><script src="//evil.example/y.js"></script>'
    + '<script nonce="T">own()</script><script type="application/ld+json">{}</script></head><p>&lt;script src="/z.js"&gt; is text</p>';
  const out = nonceScriptTags(html, 'N');

  it('stamps only same-site script FILES without a nonce', () => {
    expect(out).toContain('<script nonce="N" src="/_astro/hoisted.abc.js" type="module">');
    expect(out).toContain('<script nonce="N" SRC=\'/x.js\'>');
    expect(out.match(/nonce="N"/g)).toHaveLength(2);
  });

  it('never hands the nonce to an inline or cross-site script (an injected one must stay blocked)', () => {
    expect(out).toContain('<script>alert("injected inline")</script>');
    expect(out).toContain('<script src="https://evil.example/x.js">');
    expect(out).toContain('<script src="//evil.example/y.js">');
    expect(out).toContain('<script nonce="T">own()</script>'); // a template's own nonce is kept
    expect(out).toContain('&lt;script src="/z.js"&gt; is text');
  });

  it('gives the same result however the stream is chunked (tags split across chunks)', async () => {
    for (let size = 1; size <= 13; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < html.length; i += size) chunks.push(html.slice(i, i + size));
      expect(await streamThrough(chunks, 'N')).toBe(out);
    }
  });

  it('keeps multi-byte text intact across chunk boundaries', async () => {
    const text = 'UGX 145,000 · Kampala — ✓ <script src="/_astro/a.js"></script>';
    const bytes = new TextEncoder().encode(text);
    const source = new ReadableStream<Uint8Array>({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } });
    expect(await new Response(source.pipeThrough(nonceScriptStream('N'))).text()).toBe(nonceScriptTags(text, 'N'));
  });

  it('mints a fresh, unguessable nonce per call', () => {
    const a = makeNonce(); const b = makeNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
  });

  it('the policy is nonce-based with strict-dynamic, reports to our endpoint, and blocks plugins and base hijack', () => {
    const p = strictReportOnlyPolicy('abc');
    expect(p).toContain("script-src 'nonce-abc' 'strict-dynamic'");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'self'");
    expect(p).toContain('report-uri /api/csp-report');
  });

  it('every inline executable script a template writes carries the request nonce', () => {
    const root = path.resolve(__dirname, '../../apps/web/src');
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.astro')) continue;
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/<script(?=[\s>])([^>]*)>/g)) {
          const attrs = m[1];
          if (/application\/ld\+json/.test(attrs)) continue;
          const inline = /is:inline|define:vars|set:html/.test(attrs) || /(&&|\?)\s*$/.test(src.slice(Math.max(0, m.index! - 6), m.index));
          if (inline && !/nonce=\{Astro\.locals\.cspNonce\}/.test(attrs)) missing.push(`${path.relative(root, p)}: <script${attrs.slice(0, 60)}>`);
        }
      }
    };
    walk(root);
    expect(missing, 'add nonce={Astro.locals.cspNonce} to inline scripts').toEqual([]);
  });
});

describe('mode switch', () => {
  it('defaults to report-only; only exact values enforce or switch off', () => {
    expect(strictPolicyMode(undefined)).toBe('report');
    expect(strictPolicyMode('')).toBe('report');
    expect(strictPolicyMode('enforced')).toBe('report'); // a typo never starts blocking
    expect(strictPolicyMode(' ENFORCE ')).toBe('enforce');
    expect(strictPolicyMode('off')).toBe('off');
  });
});

describe('violation reports', () => {
  it('reads both wire formats and drops query strings, fragments and anything personal', () => {
    const legacy = { 'csp-report': { 'document-uri': 'https://shopgoldplus.com/checkout?phone=0700000000#x', 'effective-directive': 'script-src-elem', 'blocked-uri': 'inline', 'source-file': 'https://shopgoldplus.com/checkout?phone=0700000000', disposition: 'report' } };
    const modern = [{ type: 'csp-violation', body: { documentURL: 'https://shopgoldplus.com/', effectiveDirective: 'script-src-elem', blockedURL: 'https://ajax.cloudflare.com/cdn-cgi/scripts/rocket-loader.min.js?v=1', sourceFile: 'https://shopgoldplus.com/', disposition: 'report' } }];
    expect(summariseCspReports(legacy)).toEqual([{ directive: 'script-src-elem', blocked: 'inline', source: 'https://shopgoldplus.com/checkout', disposition: 'report' }]);
    expect(summariseCspReports(modern)).toEqual([{ directive: 'script-src-elem', blocked: 'https://ajax.cloudflare.com', source: 'https://shopgoldplus.com/', disposition: 'report' }]);
    expect(JSON.stringify(summariseCspReports(legacy))).not.toContain('0700000000');
    expect(summariseCspReports({ nonsense: true })).toEqual([]);
    expect(summariseCspReports(null)).toEqual([]);
  });

  it('logs a violation once per window with the count it saw, and bounds its memory', () => {
    let now = 0;
    const log = new CspViolationLog({ windowMs: 1000, maxKeys: 2, now: () => now });
    const v = { directive: 'script-src-elem', blocked: 'inline', source: '/', disposition: 'report' };
    expect(log.record(v)).toEqual([{ ...v, seenInWindow: 0 }]);
    expect(log.record(v)).toEqual([]);
    expect(log.record(v)).toEqual([]);
    now = 1500;
    expect(log.record(v)).toEqual([{ ...v, seenInWindow: 3 }]);
    log.record({ ...v, blocked: 'a' });
    log.record({ ...v, blocked: 'b' });
    expect((log as any).seen.size).toBe(2);
  });

  it('caps the total lines per window, so unique junk reports cannot flood the log', () => {
    let now = 0;
    const log = new CspViolationLog({ windowMs: 1000, maxKeys: 500, maxLinesPerWindow: 3, now: () => now });
    const lines = Array.from({ length: 50 }, (_, i) => log.record({ directive: 'script-src', blocked: `https://junk${i}.example`, source: '/', disposition: 'report' })).flat();
    expect(lines).toHaveLength(3);
    now = 1000;
    const next = log.record({ directive: 'script-src', blocked: 'inline', source: '/', disposition: 'report' });
    expect(next[0]).toEqual({ suppressedInPreviousWindow: 47 });
    expect(next).toHaveLength(2);
  });
});

describe('no inline event handlers (a strict policy can never allow them)', () => {
  it('no template or script under apps/web/src uses on<event>= attributes', () => {
    const root = path.resolve(__dirname, '../../apps/web/src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(astro|ts|tsx|js)$/.test(e.name) && !e.name.startsWith('DeclarativeActions')) {
          const src = fs.readFileSync(p, 'utf8');
          const hit = src.match(/\son(click|dblclick|load|error|change|submit|input|keydown|keyup|mouseover|mouseout|focus|blur)\s*=\s*["'{`]/i);
          if (hit) offenders.push(`${path.relative(root, p)}: ${hit[0].trim()}`);
        }
      }
    };
    walk(root);
    expect(offenders, 'use data-confirm / data-action / data-submit-on-change (components/DeclarativeActions.astro) or addEventListener').toEqual([]);
  });
});
