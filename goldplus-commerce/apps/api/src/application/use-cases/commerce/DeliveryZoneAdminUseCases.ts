import { DeliveryZone, validateDeliveryZoneInput } from '../../../domain/commerce/DeliveryFee';
import { IDeliveryZoneRepository } from '../../ports/IDeliveryZoneRepository';

export type DeliveryZoneResult =
  | { ok: true; zone: DeliveryZone }
  | { ok: false; code: string; message: string };

export class ListDeliveryZonesUseCase {
  constructor(private readonly zones: IDeliveryZoneRepository) {}
  async execute(): Promise<DeliveryZone[]> {
    return this.zones.list();
  }
}

export class UpsertDeliveryZoneUseCase {
  constructor(private readonly zones: IDeliveryZoneRepository) {}
  async execute(input: { district?: unknown; feeUgx?: unknown; enabled?: unknown }): Promise<DeliveryZoneResult> {
    const validated = validateDeliveryZoneInput(input);
    if (!validated.ok) return validated;
    const zone = await this.zones.upsert(validated.value);
    return { ok: true, zone };
  }
}

export class DeleteDeliveryZoneUseCase {
  constructor(private readonly zones: IDeliveryZoneRepository) {}
  async execute(id: string): Promise<{ ok: boolean }> {
    if (!id) return { ok: false };
    return { ok: await this.zones.delete(id) };
  }
}
