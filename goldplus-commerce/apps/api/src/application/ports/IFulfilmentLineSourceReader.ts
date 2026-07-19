import { FulfilmentLineInit } from './IFulfilmentLineRepository';

export interface IFulfilmentLineSourceReader {
  /** Authoritative order items joined with real inventory reservation records. */
  readForOrder(orderId: string): Promise<FulfilmentLineInit[]>;
}
