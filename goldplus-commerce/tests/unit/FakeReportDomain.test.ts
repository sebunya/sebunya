/**
 * tests/unit/FakeReportDomain.test.ts
 *
 * The fake-report domain is live — it is reached through IFakeReportRepository,
 * DrizzleFakeReportRepository and ReportFakeProductUseCase — but had no test
 * coverage. Counterfeit reports are anonymous-capable public submissions, so the
 * factory's trimming and optional-contact handling are the behaviours that matter.
 */
import { describe, expect, it } from 'vitest';
import { FakeReport } from '../../apps/api/src/domain/fakeReports/FakeReport';

describe('FakeReport domain', () => {
  it('opens every new report in the new state with an empty evidence list by default', () => {
    const report = FakeReport.report('r1', 'Kampala', 'Counterfeit charger');
    expect(report.status).toBe('new');
    expect(report.evidenceUrls).toEqual([]);
    expect(report.createdAt).toBeInstanceOf(Date);
  });

  it('trims the required location and description', () => {
    const report = FakeReport.report('r2', '  Jinja  ', '  Fake battery pack  ');
    expect(report.locationFound).toBe('Jinja');
    expect(report.productDescription).toBe('Fake battery pack');
  });

  it('supports fully anonymous reporting', () => {
    const report = FakeReport.report('r3', 'Mbarara', 'Counterfeit cable');
    expect(report.reporterName).toBeNull();
    expect(report.reporterContact).toBeNull();
    expect(report.hologramCode).toBeNull();
  });

  it('normalises whitespace-only optional identity fields to null rather than storing blanks', () => {
    const report = FakeReport.report('r4', 'Gulu', 'Fake adapter', {
      reporterName: '   ',
      reporterContact: '   ',
      hologramCode: '   ',
    });
    expect(report.reporterName).toBeNull();
    expect(report.reporterContact).toBeNull();
    expect(report.hologramCode).toBeNull();
  });

  it('preserves supplied reporter identity, hologram code and evidence', () => {
    const report = FakeReport.report('r5', 'Entebbe', 'Counterfeit charger', {
      reporterName: '  Amina  ',
      reporterContact: '  +256700000000  ',
      hologramCode: '  HG-123  ',
      evidenceUrls: ['https://example.test/a.jpg'],
    });
    expect(report.reporterName).toBe('Amina');
    expect(report.reporterContact).toBe('+256700000000');
    expect(report.hologramCode).toBe('HG-123');
    expect(report.evidenceUrls).toEqual(['https://example.test/a.jpg']);
  });

  it('rejects status reassignment at compile time (readonly is not enforced at runtime)', () => {
    const report = FakeReport.report('r6', 'Kampala', 'Counterfeit charger');
    // @ts-expect-error status is readonly; this must remain a compile-time error.
    // The entity is not frozen, so this documents that protection is type-level only.
    report.status = 'dismissed';
    expect(FakeReport.report('r7', 'Kampala', 'Counterfeit charger').status).toBe('new');
  });
});
