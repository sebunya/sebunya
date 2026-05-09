export class CreateAttributionEventUseCase {
  async execute(payload: any) {
    if (!payload.utmSource) throw new Error("Missing UTM Source");
    // Save attribution
  }
}
