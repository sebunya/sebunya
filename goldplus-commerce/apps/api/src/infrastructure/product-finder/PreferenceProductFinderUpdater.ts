import { ProductFinderPreferenceUpdater } from '../../application/ports/product-finder/ProductFinderPreferenceUpdater';
import { UpdateCustomerPreferenceCentreUseCase } from '../../application/use-cases/preferences/UpdateCustomerPreferenceCentreUseCase';

export class PreferenceProductFinderUpdater implements ProductFinderPreferenceUpdater {
  constructor(private readonly updatePreferenceUseCase: UpdateCustomerPreferenceCentreUseCase) {}

  async updateProductInterestsFromFinder(userId: string, interests: string[]): Promise<void> {
    // We only update if the user has an existing preference centre record.
    // We do NOT modify communication channels or advertising consent.
    try {
      const interestsRecord: Record<string, boolean> = {};
      interests.forEach(cat => { interestsRecord[cat] = true; });

      await this.updatePreferenceUseCase.execute({
        userId,
        interests: interestsRecord
      });
    } catch (err) {
      // Graceful fallback if preferences fail to save, as zero-party data is best-effort.
      console.warn(`[ProductFinder] Failed to update interests for ${userId}:`, err);
    }
  }

  async updateShoppingIntentFromFinder(userId: string, intent: string): Promise<void> {
    // For now, intents are just mapped to interests or skipped.
    return Promise.resolve();
  }

  async saveZeroPartySummary(userId: string, summary: any): Promise<void> {
    // Extension point for phase 8/9.
    return Promise.resolve();
  }
}
