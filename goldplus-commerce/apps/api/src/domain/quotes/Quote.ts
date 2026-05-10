export type QuoteStatus = 'new' | 'quoted' | 'lost' | 'won' | 'expired';

export class Quote {
  constructor(
    public readonly id: string,
    public readonly customerName: string,
    public readonly email: string,
    public readonly phone: string,
    public readonly productName: string,
    public readonly quantity: number,
    public readonly message: string,
    public readonly status: QuoteStatus,
    public readonly createdAt: Date,
    public readonly quotedPrice?: number,
    public readonly notes?: string
  ) {}

  public static request(
    id: string,
    customerName: string,
    email: string,
    phone: string,
    productName: string,
    quantity: number,
    message: string
  ): Quote {
    return new Quote(
      id,
      customerName,
      email,
      phone,
      productName,
      quantity,
      message,
      'new',
      new Date()
    );
  }
}
