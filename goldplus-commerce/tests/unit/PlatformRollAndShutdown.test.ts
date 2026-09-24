import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { otelExportConfigured } from '../../apps/api/src/infrastructure/observability/otel';

const root = join(__dirname, '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('graceful shutdown closes the workers before the database', () => {
  const server = read('apps/api/src/interfaces/http/server.ts');
  const shutdown = server.slice(server.indexOf('async function gracefulShutdown'));

  it('QueueService.closeAll runs before endDbConnection', () => {
    const queues = shutdown.indexOf('QueueService.getInstance().closeAll()');
    const db = shutdown.indexOf('await endDbConnection()');
    expect(queues).toBeGreaterThan(-1);
    expect(db).toBeGreaterThan(queues);
  });

  it('stops every ticker it started', () => {
    expect(shutdown).toContain('stopProductCostTicker()');
  });
});

describe('the production containers stop inside their grace period', () => {
  const compose = read('docker-compose.production.yml');
  const service = (name: string, next: string) => compose.slice(compose.indexOf(`\n  ${name}:\n`), compose.indexOf(`\n  ${next}:\n`));

  it.each([
    ['api', 'web'],
    ['web', 'caddy'],
  ])('%s runs under an init process with a 30s stop budget', (name, next) => {
    const block = service(name, next);
    expect(block).toContain('init: true');
    expect(block).toContain('stop_grace_period: 30s');
  });

  it('the api skips the readiness pause nothing observes', () => {
    expect(service('api', 'web')).toContain('SHUTDOWN_DRAIN_MS=${SHUTDOWN_DRAIN_MS:-0}');
  });
});

describe('tracing runs only when an exporter is configured', () => {
  it('is off by default (it used to export to localhost:4318, where nothing listens)', () => {
    expect(otelExportConfigured({})).toBe(false);
    expect(otelExportConfigured({ OTEL_TRACES_EXPORTER: 'otlp' })).toBe(false);
    expect(otelExportConfigured({ OTEL_TRACES_EXPORTER: 'none', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' })).toBe(false);
  });

  it('is on with an endpoint or a non-default exporter', () => {
    expect(otelExportConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' })).toBe(true);
    expect(otelExportConfigured({ OTEL_TRACES_EXPORTER: 'console' })).toBe(true);
  });
});
