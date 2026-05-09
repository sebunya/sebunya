export type DealerStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

export class Dealer {
  constructor(
    public readonly id: string,
    public readonly businessName: string,
    public readonly contactName: string,
    public readonly email: string,
    public readonly phone: string,
    public readonly tinNumber: string,
    public readonly location: string,
    public readonly status: DealerStatus,
    public readonly appliedAt: Date,
    public readonly approvedAt?: Date
  ) {}

  public static apply(
    id: string,
    businessName: string,
    contactName: string,
    email: string,
    phone: string,
    tinNumber: string,
    location: string
  ): Dealer {
    return new Dealer(
      id,
      businessName,
      contactName,
      email,
      phone,
      tinNumber,
      location,
      'pending',
      new Date()
    );
  }

  public approve(): Dealer {
    return new Dealer(
      this.id,
      this.businessName,
      this.contactName,
      this.email,
      this.phone,
      this.tinNumber,
      this.location,
      'approved',
      this.appliedAt,
      new Date()
    );
  }
}
