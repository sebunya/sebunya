export const CONSENT_FEATURE_GATE_NAMES = [
  'CONSENT_PERSISTENCE_COMMANDS_ENABLED',
  'CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED',
  'CONSENT_ADMIN_WORKFLOW_ENABLED',
  'CONSENT_SUPPORT_WORKFLOW_ENABLED',
  'CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED',
  'CONSENT_PROVIDER_DRY_RUN_ENABLED',
  'CONSENT_PROVIDER_LIVE_SENDS_ENABLED',
  'CONSENT_LEGACY_MIGRATION_DRY_RUN_ENABLED',
] as const;

export type ConsentFeatureGateName = (typeof CONSENT_FEATURE_GATE_NAMES)[number];
export type ConsentFeatureGates = Readonly<Record<ConsentFeatureGateName, boolean>>;

export function readConsentFeatureGates(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ConsentFeatureGates {
  return Object.freeze(
    Object.fromEntries(
      CONSENT_FEATURE_GATE_NAMES.map(name => [name, source[name]?.trim().toLowerCase() === 'true']),
    ) as Record<ConsentFeatureGateName, boolean>,
  );
}

export function isConsentFeatureEnabled(gates: ConsentFeatureGates, name: ConsentFeatureGateName): boolean {
  return gates[name] === true;
}
