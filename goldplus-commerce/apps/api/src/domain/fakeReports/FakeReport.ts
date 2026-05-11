export type FakeReportStatus = 'new' | 'investigating' | 'verified_fake' | 'dismissed';

export class FakeReport {
  constructor(
    public readonly id: string,
    public readonly reporterName: string | null,
    public readonly reporterContact: string | null,
    public readonly locationFound: string,
    public readonly productDescription: string,
    public readonly hologramCode: string | null,
    public readonly evidenceUrls: string[],
    public readonly status: FakeReportStatus,
    public readonly createdAt: Date,
  ) {}

  public static report(
    id: string,
    locationFound: string,
    productDescription: string,
    opts: {
      reporterName?: string | null;
      reporterContact?: string | null;
      hologramCode?: string | null;
      evidenceUrls?: string[];
    } = {},
  ): FakeReport {
    return new FakeReport(
      id,
      opts.reporterName?.trim() || null,
      opts.reporterContact?.trim() || null,
      locationFound.trim(),
      productDescription.trim(),
      opts.hologramCode?.trim() || null,
      opts.evidenceUrls ?? [],
      'new',
      new Date(),
    );
  }
}
