export class GtmPlanBuilder {
  buildGoldPlusPlan(containerType: 'web' | 'server'): any {
    const tags = [];
    if (containerType === 'web') {
      tags.push(
        { name: 'GoldPlus | Web | Consent Initialization', type: 'html', dryRun: true },
        { name: 'GoldPlus | Web | Canonical Event Listener', type: 'html', dryRun: true },
        { name: 'GoldPlus | Web | Ecommerce DataLayer Bridge', type: 'html', dryRun: true },
        { name: 'GoldPlus | Web | Purchase Event Bridge', type: 'html', dryRun: true },
        { name: 'GoldPlus | Web | Product Finder Complete', type: 'html', dryRun: true }
      );
    } else {
      tags.push(
        { name: 'GoldPlus | Server | GA4 Routing', type: 'gaaw', dryRun: true },
        { name: 'GoldPlus | Server | Google Ads Routing', type: 'goog_rem', dryRun: true },
        { name: 'GoldPlus | Server | Meta CAPI Routing', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | TikTok Events API Routing', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | X Conversion Routing', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | LinkedIn Conversion Routing', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | Pinterest Conversion Routing', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | Snapchat Conversion Routing', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | PostHog Routing', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | Consent Blocking', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | Event ID Deduplication', type: 'html', dryRun: true },
        { name: 'GoldPlus | Server | Verified Purchase Handoff', type: 'html', dryRun: true }
      );
    }
    return { tags };
  }
}
