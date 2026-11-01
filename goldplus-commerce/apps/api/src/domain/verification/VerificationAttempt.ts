export class VerificationAttempt {
  constructor(
    public readonly id: string,
    public readonly code: string,
    public readonly productId: string | null,
    public readonly isSuccessful: boolean,
    public readonly ipAddress: string | null,
    public readonly userAgent: string | null,
    public readonly createdAt: Date,
    /** The signed-in customer who scanned, when there is one (0085). Anonymous scans stay null. */
    public readonly userId: string | null = null,
  ) {}

  public static record(
    id: string,
    code: string,
    productId: string | null,
    isSuccessful: boolean,
    ipAddress: string | null,
    userAgent: string | null,
    userId: string | null = null,
  ): VerificationAttempt {
    return new VerificationAttempt(
      id,
      code,
      productId,
      isSuccessful,
      ipAddress,
      userAgent,
      new Date(),
      userId,
    );
  }
}
