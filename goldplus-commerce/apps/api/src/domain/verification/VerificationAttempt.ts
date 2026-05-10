export class VerificationAttempt {
  constructor(
    public readonly id: string,
    public readonly code: string,
    public readonly productId: string | null,
    public readonly isSuccessful: boolean,
    public readonly ipAddress: string | null,
    public readonly userAgent: string | null,
    public readonly createdAt: Date
  ) {}

  public static record(
    id: string,
    code: string,
    productId: string | null,
    isSuccessful: boolean,
    ipAddress: string | null,
    userAgent: string | null
  ): VerificationAttempt {
    return new VerificationAttempt(
      id,
      code,
      productId,
      isSuccessful,
      ipAddress,
      userAgent,
      new Date()
    );
  }
}
