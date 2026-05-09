export class ReportFakeProductUseCase {
  async execute(dto: { code: string, reason: string }) {
    if(!dto.code) throw new Error("Code is required");
    // Persist fake product report
  }
}
