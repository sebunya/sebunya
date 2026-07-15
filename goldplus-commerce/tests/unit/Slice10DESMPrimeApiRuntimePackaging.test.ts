import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Slice 10-D ESM PRIME API runtime packaging', () => {
  it('emits API runtime modules as Node-compatible CommonJS', () => {
    const tsconfig = JSON.parse(read('apps/api/tsconfig.json'));
    expect(tsconfig.compilerOptions.module).toBe('CommonJS');
    expect(tsconfig.compilerOptions.moduleResolution).toBe('Node');
  });

  it('builds the shared workspace package and selects its compiled runtime entrypoint in the image', () => {
    const dockerfile = read('Dockerfile.api');
    expect(dockerfile).toContain('pnpm exec tsc -p packages/shared/tsconfig.json');
    expect(dockerfile).toContain("pkg.main='dist/index.js'");
    expect(dockerfile).toContain('COPY --from=builder /app/packages/shared ./packages/shared');
  });

  it('provides an isolated image-start smoke with no production network or credentials', () => {
    const smoke = read('scripts/verify-api-image-start-smoke.sh');
    expect(smoke).toContain('--network none');
    expect(smoke).toContain('-e NODE_ENV=test');
    expect(smoke).toContain('/health/live');
    expect(smoke).not.toContain('.env.production');
    expect(smoke).not.toMatch(/docker compose\s+up/);
  });
});
