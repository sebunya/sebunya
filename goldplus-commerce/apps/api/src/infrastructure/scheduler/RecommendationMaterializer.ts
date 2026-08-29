import { Registry } from '../Registry';
import { logger } from '../logging/logger';
import { db } from '../db/client';
import { categories } from '../db/schema/products';
import { lt } from 'drizzle-orm';
import { telemetryDeadLetterQueue } from '../db/schema/telemetry';

export class RecommendationMaterializer {
  async execute(): Promise<{ success: boolean; durationMs: number; processedCount: number }> {
    const start = Date.now();

    // R9 (m3): every cookie-less crawler pageview upserts a profile row, and
    // nothing pruned them. Unlinked profiles idle past the 180-day continuity
    // window are deleted in bounded batches — a LINKED profile is customer
    // history and is never touched here.
    try {
      const { db } = await import('../db/client');
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`
        delete from identity_links where profile_id in (
          select id from experience_profiles
          where customer_id is null and last_seen_at < now() - interval '180 days'
          limit 5000
        )
      `);
      await db.execute(sql`
        delete from experience_profiles where id in (
          select id from experience_profiles
          where customer_id is null and last_seen_at < now() - interval '180 days'
          limit 5000
        )
      `);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'EXPERIENCE_PROFILE_PRUNE_FAILED');
    }
    logger.info('[RecommendationMaterializer] Starting pre-computation of recommendations...');

    // 0. Prune telemetry DLQ records older than 30 days
    try {
      logger.info('[RecommendationMaterializer] Pruning telemetry DLQ records older than 30 days...');
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await db.delete(telemetryDeadLetterQueue).where(lt(telemetryDeadLetterQueue.failedAt, cutoff));
      logger.info('[RecommendationMaterializer] Telemetry DLQ pruning complete.');
    } catch (pruneErr) {
      logger.error({ err: pruneErr }, '[RecommendationMaterializer] Failed to prune telemetry DLQ records');
    }

    let processedCount = 0;
    let failedCount = 0;

    try {
      const registry = Registry.getInstance();
      const recReader = registry.productRecommendationReader;
      const getRecsUseCase = registry.getRecommendationsUseCase;

      // 1. Pre-compute home_trending (global)
      logger.info('[RecommendationMaterializer] Pre-computing home_trending...');
      const trendingCandidates = await getRecsUseCase.generateV1ScoredCandidates({
        placement: 'home_trending'
      }, 20);
      await recReader.saveCachedRecommendations('home_trending', 'global', trendingCandidates);
      processedCount++;

      // 2. Pre-compute cart_addon (global)
      logger.info('[RecommendationMaterializer] Pre-computing cart_addon...');
      const cartAddonCandidates = await getRecsUseCase.generateV1ScoredCandidates({
        placement: 'cart_addon'
      }, 20);
      await recReader.saveCachedRecommendations('cart_addon', 'global', cartAddonCandidates);
      processedCount++;

      // 3. Pre-compute category_popular for each category
      logger.info('[RecommendationMaterializer] Pre-computing category_popular...');
      const allCategories = await db.select().from(categories);
      // One unhappy category must not cost every later category and every
      // product its refresh: this runs hourly, and an abort halfway left the
      // rest of the catalogue serving whatever was cached last time, silently.
      for (const cat of allCategories) {
        try {
          const catCandidates = await getRecsUseCase.generateV1ScoredCandidates({
            placement: 'category_popular',
            categoryId: cat.id
          }, 20);
          await recReader.saveCachedRecommendations('category_popular', cat.id, catCandidates);
          processedCount++;
        } catch (err) {
          failedCount++;
          logger.error({ err, categoryId: cat.id }, '[RecommendationMaterializer] Category skipped');
        }
      }

      // 4. Pre-compute product_related and complete_setup for each product
      logger.info('[RecommendationMaterializer] Pre-computing product_related and complete_setup...');
      const activeProducts = await recReader.findPublicProducts({ limit: 500 });
      for (const prod of activeProducts) {
        try {
          // product_related
          const relatedCandidates = await getRecsUseCase.generateV1ScoredCandidates({
            placement: 'product_related',
            productId: prod.id
          }, 10);
          await recReader.saveCachedRecommendations('product_related', prod.id, relatedCandidates);
          processedCount++;

          // complete_setup
          const setupCandidates = await getRecsUseCase.generateV1ScoredCandidates({
            placement: 'complete_setup',
            productId: prod.id
          }, 10);
          await recReader.saveCachedRecommendations('complete_setup', prod.id, setupCandidates);
          processedCount++;
        } catch (err) {
          failedCount++;
          logger.error({ err, productId: prod.id }, '[RecommendationMaterializer] Product skipped');
        }
      }

      const durationMs = Date.now() - start;
      logger.info({ durationMs, processedCount, failedCount }, '[RecommendationMaterializer] Completed recommendation pre-computation');
      return { success: true, durationMs, processedCount };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      logger.error({ err, durationMs }, '[RecommendationMaterializer] CRITICAL: Recommendation pre-computation failed!');
      return { success: false, durationMs, processedCount };
    }
  }
}
