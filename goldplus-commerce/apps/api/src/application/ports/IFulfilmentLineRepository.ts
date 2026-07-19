import { FulfilmentLine, FulfilmentLineSnapshot } from '../../domain/fulfilment/FulfilmentLine';

export interface FulfilmentLineInit {
  orderItemId: string;
  productId: string;
  sku: string;
  orderedQuantity: number;
  reservedQuantity: number;
}

export interface IFulfilmentLineRepository {
  /** Idempotently create lines for a task (unique task+order_item). Returns created count. */
  initialiseForTask(taskId: string, lines: FulfilmentLineInit[]): Promise<{ created: number }>;
  findByTask(taskId: string): Promise<FulfilmentLineSnapshot[]>;
  findById(lineId: string): Promise<FulfilmentLineSnapshot | null>;
  /**
   * Optimistic update: persist the mutated line only if the stored version still
   * equals expectedVersion. Returns updated=false on a stale version.
   */
  updateWithVersion(line: FulfilmentLine, expectedVersion: number): Promise<{ updated: boolean }>;
}

export type PackingSessionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL' | 'ON_HOLD' | 'CANCELLED';

export interface PackingSessionSnapshot {
  id: string;
  fulfilmentTaskId: string;
  status: PackingSessionStatus;
  packerUserId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  packageCount: number | null;
  packageReference: string | null;
  packingNotes: string | null;
  exceptionReason: string | null;
}

export interface IPackingSessionRepository {
  getByTask(taskId: string): Promise<PackingSessionSnapshot | null>;
  /** Idempotently create the session in IN_PROGRESS. Returns the session. */
  startForTask(taskId: string, packerUserId: string): Promise<PackingSessionSnapshot>;
  patch(taskId: string, patch: Partial<Omit<PackingSessionSnapshot, 'id' | 'fulfilmentTaskId'>>): Promise<void>;
}
