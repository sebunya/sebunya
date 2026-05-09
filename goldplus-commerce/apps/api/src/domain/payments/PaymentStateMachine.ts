export class PaymentStateMachine {
  public static transition(currentState: string, event: string): string {
    if (currentState === 'PENDING' && event === 'SUCCESS') return 'PAID';
    if (currentState === 'PENDING' && event === 'FAILED') return 'FAILED';
    throw new Error(`Invalid transition from ${currentState} with event ${event}`);
  }
}
