export class VerificationAudit {
  constructor(
    public readonly id: string,
    public readonly productId: string | null,
    public readonly inputCode: string,
    public readonly result: 'success' | 'failure' | 'missing_info',
    public readonly timestamp: Date,
    public readonly ipAddress?: string
  ) {}

  public static log(
    id: string,
    productId: string | null,
    inputCode: string,
    result: 'success' | 'failure' | 'missing_info'
  ): VerificationAudit {
    return new VerificationAudit(id, productId, inputCode, result, new Date());
  }
}
