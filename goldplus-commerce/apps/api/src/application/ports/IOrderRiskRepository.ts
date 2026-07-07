export interface IOrderRiskRepository {
  countOrdersByPhoneSince(phone: string, since: Date): Promise<number>;
}
