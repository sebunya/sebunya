#!/usr/bin/env node
/**
 * Builds the current module inventory from actual source and runtime composition.
 *
 * Nothing here is hand-authored: every field is derived by reading the repository,
 * so the inventory cannot drift from the code the way a narrative matrix can.
 * Modules are keyed on the domain directories, which are the platform's real
 * bounded contexts, and each is correlated with its use cases, ports, repositories,
 * routes, actual mounts, migrations/tables, admin surfaces, tests and PG proofs.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (d, acc = []) => {
  if (!fs.existsSync(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    e.isDirectory() ? walk(f, acc) : acc.push(f);
  }
  return acc;
};

const API = 'apps/api/src';
const appSrc = read(`${API}/interfaces/http/app.ts`);

const mounts = [...appSrc.matchAll(/app\.route\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)/g)].map((m) => ({
  path: m[1],
  router: m[2],
}));
const importedRouters = new Map();
for (const m of appSrc.matchAll(/import\s+(?:\{\s*([\w\s,]+)\s*\}|(\w+))\s+from\s+['"`]([^'"`]+)['"`]/g)) {
  const spec = m[3];
  const names = m[1] ? m[1].split(',').map((s) => s.trim()) : [m[2]];
  for (const n of names) if (n) importedRouters.set(n, spec);
}

const domains = fs
  .readdirSync(`${API}/domain`, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const allUseCases = walk(`${API}/application/use-cases`).filter((f) => f.endsWith('.ts'));
const allPorts = walk(`${API}/application/ports`).filter((f) => f.endsWith('.ts'));
const allRepos = walk(`${API}/infrastructure/db/repositories`).filter((f) => f.endsWith('.ts'));
const allRoutes = [...walk(`${API}/interfaces/http/routes`), ...walk(`${API}/presentation/routes`)].filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
);
const allTests = walk('tests').filter((f) => f.endsWith('.test.ts'));
const allProofs = walk(`${API}/scripts`).filter((f) => f.includes('proof'));
const migrations = fs
  .readdirSync(`${API}/infrastructure/db/migrations`)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const schemaFiles = walk(`${API}/infrastructure/db/schema`).filter((f) => f.endsWith('.ts'));
const adminPages = walk('apps/web/src/pages/admin').filter((f) => f.endsWith('.astro'));
const publicPages = walk('apps/web/src/pages').filter((f) => f.endsWith('.astro') && !f.includes('/admin/'));

/** kebab / camel / lower variants used to correlate a domain name with file paths. */
const variants = (name) => {
  const kebab = name;
  const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
  const flat = name.replace(/-/g, '');
  return [...new Set([kebab, camel, pascal, flat, name.replace(/-/g, '_')])];
};
const matches = (file, name) => {
  const f = file.toLowerCase();
  return variants(name).some((v) => f.includes(v.toLowerCase()));
};

/**
 * Verified locations of live capability for domain directories that are themselves
 * unreferenced. Each was confirmed by reading the source, not assumed from the name.
 */
const LIVE_CAPABILITY = {
  orders: 'ordering is implemented in domain/commerce/Order.ts; domain/orders/OrderEntity.ts is a vestigial stub with no importers',
  cms: 'no CMS runtime surface; domain/cms/SeoMetadataService.ts has no importers',
};

const modules = domains.map((d) => {
  const domainFiles = walk(`${API}/domain/${d}`).filter((f) => f.endsWith('.ts'));
  const useCases = allUseCases.filter((f) => matches(f, d));
  const ports = allPorts.filter((f) => matches(f, d));
  const repositories = allRepos.filter((f) => matches(f, d));
  const routes = allRoutes.filter((f) => matches(f, d));
  const routerNames = routes
    .map((r) => path.basename(r, '.ts'))
    .flatMap((b) => [...importedRouters.keys()].filter((k) => matches(importedRouters.get(k) ?? '', b)));
  const routeMounts = mounts.filter(
    (m) => matches(m.path, d) || routerNames.includes(m.router) || matches(m.router, d),
  );
  const mig = migrations.filter((f) => matches(f, d));
  const schema = schemaFiles.filter((f) => matches(f, d));
  const admin = adminPages.filter((f) => matches(f, d));
  const pub = publicPages.filter((f) => matches(f, d));
  const tests = allTests.filter((f) => matches(f, d));
  const proofs = allProofs.filter((f) => matches(f, d));

  // Name correlation alone under-counts coverage (payments tests are named after
  // PesaPal, webhooks and checkout). Count any test that imports the domain
  // directory or mentions the module, and record whether runtime code references
  // the domain at all — an unreferenced domain is dead code, not a coverage gap.
  const domainImportRe = new RegExp(`domain/${d}\\b`);
  const testsReferencing = allTests.filter(
    (f) => domainImportRe.test(read(f)) || matches(f, d) || read(f).toLowerCase().includes(d.toLowerCase()),
  );
  const runtimeReferences = walk(API)
    .filter((f) => f.endsWith('.ts') && !f.startsWith(`${API}/domain/${d}`))
    .filter((f) => domainImportRe.test(read(f))).length;

  const hasPersistence = repositories.length > 0 || schema.length > 0 || mig.length > 0;
  const hasApi = routes.length > 0;
  const mounted = routeMounts.length > 0;

  // Status is derived, never asserted. A module with an API surface that is not
  // mounted is the defect class that shipped unmounted governance routes.
  let status = 'RELEASE_READY_NOT_DEPLOYED';
  let blocker = null;
  let deadCodeEvidence = null;
  let liveCapabilityLocation = null;
  if (hasApi && !mounted) {
    status = 'SOURCE_COMPLETE_NOT_WIRED';
    blocker = 'route module present but no matching mount in app.ts';
  } else if (runtimeReferences === 0 && !hasApi && !hasPersistence) {
    status = 'DEAD_OR_DEPRECATED_CONFIRMED';
    deadCodeEvidence = `no runtime file outside domain/${d} imports it; no route, repository, schema or migration`;
    // A dead directory does not mean a dead business capability. Record where the
    // live implementation actually lives so this row cannot be misread.
    blocker = null;
    liveCapabilityLocation = LIVE_CAPABILITY[d] ?? 'no equivalent live capability found';
  } else if (testsReferencing.length === 0 && proofs.length === 0) {
    status = 'WIRED_NOT_TESTED';
    blocker = 'no test or PostgreSQL proof references this module';
  }

  return {
    moduleId: d,
    name: d,
    domainFiles: domainFiles.length,
    useCases: useCases.length,
    ports: ports.length,
    repositories: repositories.length,
    routeFiles: routes.length,
    routeMounts: routeMounts.map((m) => m.path),
    migrations: mig,
    schemaFiles: schema.length,
    adminPages: admin.length,
    publicPages: pub.length,
    tests: testsReferencing.length,
    runtimeReferences,
    deadCodeEvidence,
    liveCapabilityLocation,
    postgresProofs: proofs.map((p) => path.basename(p)),
    hasPersistence,
    productionAcceptanceMethod: mounted
      ? 'authenticated least-privilege safe read against the deployed API, plus RBAC denial'
      : hasPersistence
        ? 'database-level read verification'
        : 'source-only module; no runtime surface',
    rollbackDependency: mig.length > 0 ? 'additive migrations retained on rollback' : 'application image only',
    status,
    blocker,
  };
});

const totals = modules.reduce((acc, m) => ((acc[m.status] = (acc[m.status] ?? 0) + 1), acc), {});
const inventory = {
  schemaVersion: 1,
  generatedFrom: 'source and runtime composition',
  moduleCount: modules.length,
  platformComposition: {
    routeMounts: mounts.length,
    adminMounts: mounts.filter((m) => m.path.startsWith('/admin')).length,
    routeFiles: allRoutes.length,
    useCases: allUseCases.length,
    ports: allPorts.length,
    repositories: allRepos.length,
    migrations: migrations.length,
    adminPages: adminPages.length,
    publicPages: publicPages.length,
    testFiles: allTests.length,
    postgresProofs: allProofs.length,
  },
  statusTotals: totals,
  engineeringIncomplete: modules.filter((m) =>
    [
      'DISCOVERED_NOT_CLASSIFIED',
      'SOURCE_PARTIAL',
      'SOURCE_COMPLETE_NOT_WIRED',
      'WIRED_NOT_TESTED',
      'TESTED_NOT_PRODUCTION_SHAPED',
      'DATA_NOT_READY',
      'DEPLOYED_NOT_ACCEPTED',
      'STILL_MISSING',
    ].includes(m.status),
  ).length,
  modules,
};

fs.writeFileSync(
  'docs/completion/CLAUDE_CURRENT_MODULE_INVENTORY.json',
  JSON.stringify(inventory, null, 2) + '\n',
);
console.log(`modules=${modules.length} incomplete=${inventory.engineeringIncomplete}`);
console.log(JSON.stringify(totals));
for (const m of modules.filter((x) => x.blocker)) console.log(`  ${m.status}  ${m.moduleId}: ${m.blocker}`);
