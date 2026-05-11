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
  setValue(input: {
    productId: string;
    attributeId: string;
    value: string;
    isVerified: boolean;
  }): Promise<PersistedAttributeValue>;
}
