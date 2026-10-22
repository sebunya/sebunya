export interface PersistedAttribute {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  unit: string | null;
  isRequired: boolean;
  displayOrder: number;
}

export interface PersistedAttributeValue {
  productId: string;
  attributeId: string;
  value: string;
  isVerified: boolean;
}

export interface IAttributeRepository {
  findByCategoryId(categoryId: string): Promise<PersistedAttribute[]>;
  findById(id: string): Promise<PersistedAttribute | null>;
  findBySlugInCategory(categoryId: string, slug: string): Promise<PersistedAttribute | null>;
  define(input: {
    categoryId: string;
    slug: string;
    name: string;
    unit: string | null;
    isRequired: boolean;
    displayOrder: number;
  }): Promise<PersistedAttribute>;

  findValuesByProductId(productId: string): Promise<PersistedAttributeValue[]>;
  /**
   * Removes this product's values for every attribute NOT listed: the listing editor submits the full set, so a row
   * the operator blanked or renamed must go. Optional so test doubles need not implement it.
   */
  removeValuesExcept?(productId: string, keepAttributeIds: string[]): Promise<number>;
  setValue(input: {
    productId: string;
    attributeId: string;
    value: string;
    isVerified: boolean;
  }): Promise<PersistedAttributeValue>;
}
