export interface ProductFinderPreferenceUpdater {
  updateProductInterestsFromFinder(userId: string, interests: string[]): Promise<void>;
  updateShoppingIntentFromFinder(userId: string, intent: string): Promise<void>;
  saveZeroPartySummary(userId: string, summary: any): Promise<void>;
}
