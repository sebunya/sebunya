export interface RunnerIntegrityInput {
  authorization_imports: readonly string[];
  canary_guard_imports: readonly string[];
  diagnostic_transport_imports: readonly string[];
  feature_gate_reader_imports: readonly string[];
  repository_imports: readonly string[];
}

export interface RunnerIntegrityResult {
  authorization_module_instance_count: number;
  canary_guard_instance_count: number;
  diagnostic_transport_instance_count: number;
  feature_gate_reader_instance_count: number;
  repository_instance_count: number;
  duplicate_module_detected: boolean;
  mixed_source_dist_import_detected: boolean;
  mixed_alias_relative_import_detected: boolean;
  safe_to_attempt: boolean;
}

function logicalPath(specifier: string): string {
  return specifier.trim().replaceAll('\\', '/').replace(/\.(?:[cm]?tsx?|jsx?)$/, '')
    .replace('/dist/', '/src/').replace(/^@goldplus\/api\//, 'apps/api/src/');
}

function hasMixedSourceDist(specifiers: readonly string[]): boolean {
  const paths = specifiers.map(value => value.replaceAll('\\', '/'));
  const hasSource = paths.some(path => path.includes('/src/') || (path.startsWith('.') && !path.includes('/dist/')));
  return hasSource && paths.some(path => path.includes('/dist/'));
}

function hasMixedAliasRelative(specifiers: readonly string[]): boolean {
  const hasAlias = specifiers.some(path => path.trim().startsWith('@'));
  const hasRelative = specifiers.some(path => path.trim().startsWith('.'));
  return hasAlias && hasRelative;
}

function instanceCount(specifiers: readonly string[]): number {
  return new Set(specifiers.map(logicalPath)).size;
}

export function runRunnerIntegrityPreflight(input: RunnerIntegrityInput): RunnerIntegrityResult {
  const groups = [
    input.authorization_imports,
    input.canary_guard_imports,
    input.diagnostic_transport_imports,
    input.feature_gate_reader_imports,
    input.repository_imports,
  ];
  const all = groups.flat();
  const counts = groups.map(instanceCount);
  const duplicate = groups.some((group) => new Set(group.map(logicalPath)).size !== 1)
    || new Set(all.map(logicalPath)).size !== groups.length;
  const mixedSourceDist = groups.some(hasMixedSourceDist);
  const mixedAliasRelative = groups.some(hasMixedAliasRelative);
  const safe = counts.every(count => count === 1) && !duplicate && !mixedSourceDist && !mixedAliasRelative;
  return Object.freeze({
    authorization_module_instance_count: counts[0],
    canary_guard_instance_count: counts[1],
    diagnostic_transport_instance_count: counts[2],
    feature_gate_reader_instance_count: counts[3],
    repository_instance_count: counts[4],
    duplicate_module_detected: duplicate,
    mixed_source_dist_import_detected: mixedSourceDist,
    mixed_alias_relative_import_detected: mixedAliasRelative,
    safe_to_attempt: safe,
  });
}

export const CANONICAL_RUNNER_IMPORTS = Object.freeze({
  authorization: './InternalConsentCanaryGuard',
  canary_guard: './InternalEmailDiagnosticCanaryGuard',
  diagnostic_transport: '../../../infrastructure/consent/ZeptoInternalConsentCanaryTransport',
  feature_gate_reader: './ConsentFeatureGates',
  repository: '../../../infrastructure/consent/DrizzleConsentOperatingRepository',
});
