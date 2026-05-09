export class ProductSearchService {
  search(query: string) {
    if (!query) throw new Error("Query required");
    return [];
  }
}
