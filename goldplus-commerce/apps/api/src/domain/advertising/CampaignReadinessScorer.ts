export class CampaignReadinessScorer {
  score(campaign: any, product: any) {
    let score = 100;
    if(!product.hasImage) score -= 20;
    if(!product.hasRetailPrice) score -= 30;
    if(product.stockQuantity === 0) score -= 50;
    return score;
  }
}
