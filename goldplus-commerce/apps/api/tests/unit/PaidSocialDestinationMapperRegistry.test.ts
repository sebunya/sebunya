import { describe, it, expect } from 'vitest';
import { PaidSocialDestinationMapperRegistry } from '../../src/infrastructure/measurement/destinations/PaidSocialDestinationMapperRegistry';
import { MetaCapiMapper } from '../../src/infrastructure/measurement/destinations/MetaCapiMapper';
import { TikTokEventsMapper } from '../../src/infrastructure/measurement/destinations/TikTokEventsMapper';
import { XConversionMapper } from '../../src/infrastructure/measurement/destinations/XConversionMapper';
import { LinkedInConversionMapper } from '../../src/infrastructure/measurement/destinations/LinkedInConversionMapper';
import { PinterestConversionMapper } from '../../src/infrastructure/measurement/destinations/PinterestConversionMapper';
import { SnapchatConversionMapper } from '../../src/infrastructure/measurement/destinations/SnapchatConversionMapper';
import { GoogleAdsMeasurementMapper } from '../../src/infrastructure/measurement/destinations/GoogleAdsMeasurementMapper';
import { PostHogMeasurementMapper } from '../../src/infrastructure/measurement/destinations/PostHogMeasurementMapper';
import { Sha256MeasurementHashingService } from '../../src/application/services/measurement/Sha256MeasurementHashingService';

describe('PaidSocialDestinationMapperRegistry', () => {
  const hashingService = new Sha256MeasurementHashingService();
  const registry = new PaidSocialDestinationMapperRegistry([
    new MetaCapiMapper(hashingService),
    new TikTokEventsMapper(hashingService),
    new XConversionMapper(hashingService),
    new LinkedInConversionMapper(hashingService),
    new PinterestConversionMapper(hashingService),
    new SnapchatConversionMapper(hashingService),
    new GoogleAdsMeasurementMapper(hashingService),
    new PostHogMeasurementMapper(hashingService),
  ]);

  it('resolves meta', () => {
    expect(registry.getMapper('meta')).toBeDefined();
    expect(registry.getMapper('meta')?.destinationKey).toBe('meta');
  });

  it('resolves tiktok', () => {
    expect(registry.getMapper('tiktok')).toBeDefined();
  });

  it('resolves x', () => {
    expect(registry.getMapper('x')).toBeDefined();
  });

  it('resolves linkedin', () => {
    expect(registry.getMapper('linkedin')).toBeDefined();
  });

  it('resolves pinterest', () => {
    expect(registry.getMapper('pinterest')).toBeDefined();
  });

  it('resolves snapchat', () => {
    expect(registry.getMapper('snapchat')).toBeDefined();
  });

  it('resolves google_ads', () => {
    expect(registry.getMapper('google_ads')).toBeDefined();
  });

  it('resolves posthog', () => {
    expect(registry.getMapper('posthog')).toBeDefined();
  });

  it('rejects unknown destination', () => {
    expect(registry.getMapper('unknown_destination')).toBeUndefined();
    expect(registry.hasMapper('unknown_destination')).toBe(false);
  });
});
