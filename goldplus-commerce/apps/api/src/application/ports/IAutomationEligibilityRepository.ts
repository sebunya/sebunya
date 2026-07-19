import { AutomationSuppressionReason } from '../../domain/automation/Automation';

export interface AutomationFrequencyCapRequest {
  executionId: string;
  definitionId: string;
  versionId: string;
  subjectId: string;
  windowKey: string;
  limit: number;
  global: boolean;
}

export type FrequencyCapReservationResult =
  | { reserved: true; reused: boolean; used: number }
  | { reserved: false; reused: false; used: number; reason: 'FREQUENCY_CAPPED' };

export interface IAutomationEligibilityRepository {
  recordSuppression(input: {
    executionId: string;
    subjectId: string | null;
    reason: AutomationSuppressionReason;
  }): Promise<void>;
  reserveFrequencyCap(input: AutomationFrequencyCapRequest): Promise<FrequencyCapReservationResult>;
}
