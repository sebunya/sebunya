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
}
