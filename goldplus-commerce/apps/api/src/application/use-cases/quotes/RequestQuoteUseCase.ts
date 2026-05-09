export class RequestQuoteUseCase {
  async execute(dto: { isCorporate: boolean, products: any[] }) {
    if(dto.products.length === 0) throw new Error("Cannot request quote for empty product list");
    
    throw new Error("REPOSITORY_NOT_IMPLEMENTED: Quote persistence layer is not implemented yet.");
  }
}
