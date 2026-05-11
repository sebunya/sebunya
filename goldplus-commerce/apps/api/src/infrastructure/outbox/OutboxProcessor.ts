import { Registry } from '../Registry';

export class OutboxProcessor {
  async processPendingEvents() {
    // Shim to delegate execution to the centralized architecture pattern Use Case
    const registry = Registry.getInstance();
    return registry.processOutboxBatchUseCase.execute();
  }
}
