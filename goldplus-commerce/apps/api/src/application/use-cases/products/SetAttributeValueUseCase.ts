import { IAttributeRepository, PersistedAttribute, PersistedAttributeValue } from '../../ports/IAttributeRepository';

export interface SetAttributeValueInput {
  productId: string;
  attributeId: string;
  value: string;
  isVerified: boolean;
}

export type SetAttributeValueResult =
  | { ok: true; attribute: PersistedAttribute; value: PersistedAttributeValue }
  | { ok: false; code: 'BAD_INPUT' | 'ATTRIBUTE_NOT_FOUND'; message: string };

export class SetAttributeValueUseCase {
  constructor(private readonly attributes: IAttributeRepository) {}

  async execute(input: SetAttributeValueInput): Promise<SetAttributeValueResult> {
    const productId = (input.productId ?? '').trim();
    const attributeId = (input.attributeId ?? '').trim();
    const value = (input.value ?? '').trim();

    if (!productId) return { ok: false, code: 'BAD_INPUT', message: 'productId is required.' };
    if (!attributeId) return { ok: false, code: 'BAD_INPUT', message: 'attributeId is required.' };
    if (!value) return { ok: false, code: 'BAD_INPUT', message: 'value is required.' };
    if (value.length > 255) return { ok: false, code: 'BAD_INPUT', message: 'value is too long (max 255).' };

    const attribute = await this.attributes.findById(attributeId);
    if (!attribute) return { ok: false, code: 'ATTRIBUTE_NOT_FOUND', message: 'Attribute does not exist.' };

    const persisted = await this.attributes.setValue({
      productId,
      attributeId,
      value,
      isVerified: Boolean(input.isVerified),
    });
    return { ok: true, attribute, value: persisted };
  }
}
