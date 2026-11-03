import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WindowLimiter } from '../../../apps/web/src/lib/windowLimiter';

describe('MCP budget', () => {
  it('a batch spends one unit per member', () => {
    const l = new WindowLimiter(60, 60_000);
    expect(l.take('a')).toBe(true);
    expect(l.take('a', 19)).toBe(true); // 20
    expect(l.take('a', 40)).toBe(true); // 60
    expect(l.take('a')).toBe(false);
  });
  it('a full map prunes expired and oldest keys, never wipes a throttled visitor', () => {
    let t = 0;
    const l = new WindowLimiter(2, 1000, 3, () => t);
    l.take('old'); t = 500;
    l.take('busy'); l.take('busy'); l.take('busy'); // throttled
    l.take('c');
    t = 1200; // 'old' expired
    l.take('d');
    expect(l.size).toBeLessThanOrEqual(3);
    expect(l.take('busy')).toBe(false); // still throttled
  });
  it('mcp.ts reads the body capped in bytes and counts batch members', () => {
    const src = readFileSync(join(__dirname, '../../../apps/web/src/pages/mcp.ts'), 'utf8');
    expect(src).toMatch(/readBodyCapped\(request, MAX_BODY_BYTES\)/);
    expect(src).not.toMatch(/request\.text\(\)/);
    expect(src).toMatch(/limiter\.take\(key, parsed\.length - 1\)/);
    expect(src).not.toMatch(/\.clear\(\)/);
  });
});
