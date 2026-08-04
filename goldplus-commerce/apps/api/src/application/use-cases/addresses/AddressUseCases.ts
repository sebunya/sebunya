import { IAddressRepository } from '../../ports/IAddressRepository';
import { AddressDto } from '@goldplus/shared';

export class ListMyAddressesUseCase {
  constructor(private readonly addresses: IAddressRepository) {}
  execute(userId: string): Promise<AddressDto[]> {
    return this.addresses.listForUser(userId);
  }
}

export interface AddAddressInput {
  userId: string;
  label: string;
  recipientName: string;
  phone: string;
  district: string;
  areaDetails: string;
  makeDefault: boolean;
}

export type AddAddressResult =
  | { ok: true; address: AddressDto }
  | { ok: false; code: 'BAD_INPUT'; message: string };

export class AddAddressUseCase {
  constructor(private readonly addresses: IAddressRepository) {}

  async execute(input: AddAddressInput): Promise<AddAddressResult> {
    const required = ['label', 'recipientName', 'phone', 'district', 'areaDetails'] as const;
    for (const key of required) {
      const value = (input[key] ?? '').toString().trim();
      if (!value) return { ok: false, code: 'BAD_INPUT', message: `Field "${key}" is required.` };
      if (value.length > 200) return { ok: false, code: 'BAD_INPUT', message: `Field "${key}" is too long.` };
    }
    const address = await this.addresses.createForUser({
      userId: input.userId,
      label: input.label.trim(),
      recipientName: input.recipientName.trim(),
      phone: input.phone.trim(),
      district: input.district.trim(),
      areaDetails: input.areaDetails.trim(),
      makeDefault: input.makeDefault,
    });
    return { ok: true, address };
  }
}

export class SetDefaultAddressUseCase {
  constructor(private readonly addresses: IAddressRepository) {}
  async execute(userId: string, addressId: string): Promise<AddressDto | null> {
    if (!addressId.trim()) return null;
    return this.addresses.setDefaultForUser(userId, addressId.trim());
  }
}

export class DeleteAddressUseCase {
  constructor(private readonly addresses: IAddressRepository) {}
  async execute(userId: string, addressId: string): Promise<boolean> {
    if (!addressId.trim()) return false;
    return this.addresses.deleteForUser(userId, addressId.trim());
  }
}
