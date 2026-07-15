export interface LegacyPreferenceCandidate {
  customer_ref: string;
  source: string;
  field: string;
  value: unknown;
}

export interface LegacyPreferenceMigrationDryRunReport {
  candidate_count: number;
  would_map_unknown_count: number;
  would_request_support_assisted_count: number;
  would_reject_auto_grant_count: number;
  risks: string[];
  redacted_samples: Array<{
    customer_ref: string;
    source: string;
    field: string;
    outcome: 'unknown' | 'requested_support_assisted';
    reason: string;
  }>;
}

function redact(reference: string): string {
  const hash = reference.split('').reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
  return `legacy_${hash.toString(16).padStart(8, '0')}`;
}

export class LegacyPreferenceMigrationDryRun {
  execute(candidates: readonly LegacyPreferenceCandidate[]): LegacyPreferenceMigrationDryRunReport {
    const results = candidates.map(candidate => {
      const hasAffirmativeBroadValue = candidate.value === true || candidate.value === 'true' || candidate.value === 1;
      const isSupportSource = candidate.source.toLowerCase().includes('support');
      return {
        customer_ref: redact(candidate.customer_ref),
        source: candidate.source,
        field: candidate.field,
        outcome: isSupportSource ? 'requested_support_assisted' as const : 'unknown' as const,
        reason: hasAffirmativeBroadValue
          ? 'broad_or_ambiguous_flag_cannot_auto_grant'
          : 'legacy_evidence_is_not_canonical_purpose_consent',
        rejectedAutoGrant: hasAffirmativeBroadValue,
      };
    });

    return Object.freeze({
      candidate_count: results.length,
      would_map_unknown_count: results.filter(result => result.outcome === 'unknown').length,
      would_request_support_assisted_count: results.filter(result => result.outcome === 'requested_support_assisted').length,
      would_reject_auto_grant_count: results.filter(result => result.rejectedAutoGrant).length,
      risks: Object.freeze([
        'legacy broad flags are not canonical purpose consent',
        'Measurement consent is not messaging consent',
        'loyalty interest is not Memory Lane consent',
        'Memory Lane consent is not utilisation-aware offer consent',
      ]) as unknown as string[],
      redacted_samples: Object.freeze(results.slice(0, 10).map(({ rejectedAutoGrant: _, ...sample }) => Object.freeze(sample))) as unknown as LegacyPreferenceMigrationDryRunReport['redacted_samples'],
    });
  }
}
