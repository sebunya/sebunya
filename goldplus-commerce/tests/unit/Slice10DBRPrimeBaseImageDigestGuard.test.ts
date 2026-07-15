import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const OLD_DIGEST = 'sha256:c13b26e6de602defad90aa7afaf3905581177651a2d59ad0cb233ec7c813350b';
const NODE_20_ALPINE_PIN = 'node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293';
const productionDockerfiles = ['Dockerfile.api', 'Dockerfile.web'] as const;

describe('Slice 10-D BR PRIME immutable Node base-image guard', () => {
  for (const dockerfile of productionDockerfiles) {
    const source = readFileSync(resolve(process.cwd(), dockerfile), 'utf8');

    it(`${dockerfile} pins Node 20 Alpine to the registry-resolved digest`, () => {
      expect(source).toContain(`FROM ${NODE_20_ALPINE_PIN} AS base`);
    });

    it(`${dockerfile} contains neither the unavailable digest nor a floating Node base`, () => {
      expect(source).not.toContain(OLD_DIGEST);
      expect(source).not.toMatch(/^FROM node:20-alpine(?:\s|$)/m);
    });
  }
});
