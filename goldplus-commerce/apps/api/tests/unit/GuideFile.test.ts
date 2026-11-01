import { describe, it, expect } from 'vitest';
import { parseGuideFile, internalLinks } from '../../src/domain/blog/GuideFile';

const sample = `Title: How to find the right battery

Summary: Match the code, not the shape.

Meta title: Right battery | GoldPlus

Meta description: Find the code.

Related SKUs: GP-C12, gp-c13 GP-C12

Publish: hold

---- Article (paste everything below this line into the Article box) ----

A phone battery is made for one phone.

# Step 1

- Open [the finder](/battery-finder) or [support](/support).
`;

describe('parseGuideFile', () => {
  it('reads the labelled header and the body after the marker', () => {
    const r = parseGuideFile(sample);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('How to find the right battery');
    expect(r.value.excerpt).toBe('Match the code, not the shape.');
    expect(r.value.metaTitle).toBe('Right battery | GoldPlus');
    expect(r.value.metaDescription).toBe('Find the code.');
    expect(r.value.relatedSkus).toEqual(['GP-C12', 'GP-C13']);
    expect(r.value.hold).toBe(true);
    expect(r.value.body.startsWith('A phone battery is made for one phone.')).toBe(true);
    expect(r.value.body).not.toMatch(/---- Article/);
  });

  it('defaults optional fields and does not hold without the line', () => {
    const r = parseGuideFile('Title: T\n\nSummary: S\n\n---- Article ----\n\nBody text.');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metaTitle).toBeNull();
    expect(r.value.relatedSkus).toEqual([]);
    expect(r.value.hold).toBe(false);
  });

  it('refuses a file with no marker, no title, no summary or no body', () => {
    expect(parseGuideFile('Title: T\n\nSummary: S\n\nBody').ok).toBe(false);
    expect(parseGuideFile('Summary: S\n\n---- Article ----\n\nBody').ok).toBe(false);
    expect(parseGuideFile('Title: T\n\n---- Article ----\n\nBody').ok).toBe(false);
    expect(parseGuideFile('Title: T\n\nSummary: S\n\n---- Article ----\n\n   \n').ok).toBe(false);
  });

  it('lists the site-relative links once each', () => {
    const r = parseGuideFile(sample);
    if (!r.ok) throw new Error(r.message);
    expect(internalLinks(r.value.body)).toEqual(['/battery-finder', '/support']);
  });
});
