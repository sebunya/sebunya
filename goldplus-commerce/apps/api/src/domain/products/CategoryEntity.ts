export class CategoryEntity {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly isOther: boolean
  ) {}

  public canBeAdvertised(): boolean {
    return !this.isOther;
  }
}
