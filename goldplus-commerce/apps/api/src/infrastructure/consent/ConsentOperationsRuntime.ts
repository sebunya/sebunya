import {
  ConsentOperationsSummaryService,
  readConsentOperationsFeatureState,
} from '../../application/services/consent/ConsentOperationsSummaryService';
import { DrizzleConsentOperationsSummaryRepository } from './DrizzleConsentOperationsSummaryRepository';

export function createConsentOperationsRuntime(source: Readonly<Record<string, string | undefined>> = process.env) {
  return Object.freeze({
    features: readConsentOperationsFeatureState(source),
    repository: new DrizzleConsentOperationsSummaryRepository(),
    summaryService: new ConsentOperationsSummaryService(),
  });
}

let runtime: ReturnType<typeof createConsentOperationsRuntime> | null = null;

export function getConsentOperationsRuntime(): ReturnType<typeof createConsentOperationsRuntime> {
  runtime ??= createConsentOperationsRuntime();
  return runtime;
}
