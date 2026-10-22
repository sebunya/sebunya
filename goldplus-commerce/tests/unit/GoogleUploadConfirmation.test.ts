import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { googleRequestIdOf, googleUploadVerdict } from '../../apps/api/src/infrastructure/measurement/DeliveryService';

/**
 * Google's Data Manager queues an upload and answers later (requestStatus:retrieve). A 200 {requestId} was recorded as
 * delivered and never checked, so rejections after the fact (wrong action, expired or unmatched click id) were never
 * seen (2026-10-22 review; contract read from developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve).
 */
describe('a Google conversion upload is confirmed, not assumed', () => {
  it('reads the requestId from the ingest reply', () => {
    expect(googleRequestIdOf('{"requestId":"abc-123_X"}')).toBe('abc-123_X');
    expect(googleRequestIdOf('{"fieldWarnings":[]}')).toBeNull();
    expect(googleRequestIdOf('not json')).toBeNull();
  });

  it('SUCCESS confirms; PROCESSING or an empty answer waits; FAILED and PARTIAL_SUCCESS fail, with the error counts', () => {
    expect(googleUploadVerdict({ requestStatusPerDestination: [{ requestStatus: 'SUCCESS' }] }).verdict).toBe('SUCCESS');
    expect(googleUploadVerdict({ requestStatusPerDestination: [{ requestStatus: 'PROCESSING' }] }).verdict).toBe('WAITING');
    expect(googleUploadVerdict({}).verdict).toBe('WAITING');
    const failed = googleUploadVerdict({ requestStatusPerDestination: [{ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ reason: 'INVALID_GCLID', recordCount: '1' }] } }] });
    expect(failed).toEqual({ verdict: 'FAILED', errors: ['INVALID_GCLID: 1'] });
    expect(googleUploadVerdict({ requestStatusPerDestination: [{ requestStatus: 'PARTIAL_SUCCESS' }] }).verdict).toBe('FAILED');
  });

  it('the ticker asks Google about accepted uploads every cycle', () => {
    expect(readFileSync(new URL('../../apps/api/src/infrastructure/scheduler/OutboxTicker.ts', import.meta.url), 'utf8')).toContain('await confirmGoogleUploads()');
  });
});
