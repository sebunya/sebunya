export class SeoMetadataService {
  generate(productName: string) {
    return { title: `${productName} | GoldPlus`, description: `Buy original ${productName} in Uganda` };
  }
}
