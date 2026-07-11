import { ControlledLiveCanaryKillSwitch } from '../../application/ports/activation/ControlledLiveCanaryKillSwitch.js';

export class DefaultControlledLiveCanaryKillSwitch implements ControlledLiveCanaryKillSwitch {
  private triggeredRequests = new Set<string>();

  async isKillSwitchTriggered(activationRequestId: string): Promise<boolean> {
    return this.triggeredRequests.has(activationRequestId);
  }

  // Helper for tests/simulation
  triggerKillSwitch(activationRequestId: string): void {
    this.triggeredRequests.add(activationRequestId);
  }
}
