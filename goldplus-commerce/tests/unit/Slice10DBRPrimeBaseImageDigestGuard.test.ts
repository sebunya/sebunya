import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const OLD_DIGEST = 'sha256:c13b26e6de602defad90aa7afaf3905581177651a2d59ad0cb233ec7c813350b';
// Node 22 LTS since 2026-10-07 (Node 20 is end of life; Astro 6 needs 22.12+).
const NODE_ALPINE_PIN = 'node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402';
const productionDockerfiles = ['Dockerfile.api', 'Dockerfile.web'] as const;

describe('Slice 10-D BR PRIME immutable Node base-image guard', () => {
  for (const dockerfile of productionDockerfiles) {
    const source = readFileSync(resolve(process.cwd(), dockerfile), 'utf8');

    it(`${dockerfile} pins Node 22 Alpine to the registry-resolved digest`, () => {
      expect(source).toContain(`FROM ${NODE_ALPINE_PIN} AS base`);
    });

    it(`${dockerfile} contains neither the unavailable digest nor a floating Node base`, () => {
      expect(source).not.toContain(OLD_DIGEST);
      expect(source).not.toMatch(/^FROM node:2\d-alpine(?:\s|$)/m);
    });
  }
});
