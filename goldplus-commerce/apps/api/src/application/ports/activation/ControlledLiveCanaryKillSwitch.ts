export interface ControlledLiveCanaryKillSwitch {
  isKillSwitchTriggered(activationRequestId: string): Promise<boolean>;
}
