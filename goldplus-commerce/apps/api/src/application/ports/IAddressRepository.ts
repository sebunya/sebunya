import { AddressDto } from '@goldplus/shared';

export interface IAddressRepository {
  listForUser(userId: string): Promise<AddressDto[]>;
  createForUser(input: {
    userId: string;
    label: string;
    recipientName: string;
    phone: string;
    district: string;
    areaDetails: string;
    makeDefault: boolean;
  }): Promise<AddressDto>;
  /** Both are user-scoped: an id belonging to another user is a not-found, never a cross-user write. */
  setDefaultForUser(userId: string, addressId: string): Promise<AddressDto | null>;
  deleteForUser(userId: string, addressId: string): Promise<boolean>;
}
