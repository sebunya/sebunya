export class OutboxProcessor {
  async processPendingEvents() {
    // Read from outbox_events where isProcessed = false
    console.log('Processing outbox events...');
  }
}
