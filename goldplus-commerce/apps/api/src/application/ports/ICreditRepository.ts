import type { CreditKind } from '../../domain/credit/CreditInstrument';

export interface CreditInstrumentView {
  id: string;
  kind: CreditKind;
  last4: string;
  status: 'pending_approval' | 'active' | 'void';
  initialValueUgx: number;
  balanceUgx: number;
  /** Reserved by orders that are not paid yet (held, not spent): it comes back if that order is cancelled. */
  heldUgx?: number;
  reason: string;
  recipientName: string | null;
  recipientPhone: string | null;
  customerUserId: string | null;
  issuedBy: string;
  approvedBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface CreditLedgerRow {
  type: string;
  amountUgx: number;
  holdState: string | null;
  orderNumber: string | null;
  note: string | null;
  createdAt: Date;
}

export interface ICreditRepository {
  issue(input: {
    kind: CreditKind; codeHash: string; last4: string; valueUgx: number; reason: string; status: 'pending_approval' | 'active';
    recipientName: string | null; recipientPhone: string | null; customerUserId: string | null; sourceOrderId: string | null;
    issuedBy: string; expiresAt: Date | null;
  }): Promise<{ id: string }>;
  findByCodeHash(codeHash: string): Promise<CreditInstrumentView | null>;
  findById(id: string): Promise<CreditInstrumentView | null>;
  list(input: { limit: number; status?: string | null; kind?: CreditKind | null }): Promise<CreditInstrumentView[]>;
  forCustomer(userId: string): Promise<CreditInstrumentView[]>;
  ledger(instrumentId: string): Promise<CreditLedgerRow[]>;
  approve(id: string, approverId: string, now: Date): Promise<boolean>;
  /** Cancels what is left (a VOID entry of the remaining balance) and marks the instrument void. */
  voidInstrument(id: string, actorId: string, note: string, now: Date): Promise<number | null>;
  adjust(id: string, amountUgx: number, actorId: string, note: string): Promise<boolean>;
  /** The order's live hold becomes spent. Idempotent. */
  captureForOrder(orderId: string, now: Date): Promise<number>;
  /** On cancel: a held hold is released; a captured one is given back as a RETURN (once). Returns UGX given back. */
  releaseOrReturnForOrder(orderId: string, note: string, now: Date): Promise<{ released: number; returned: number }>;
}
