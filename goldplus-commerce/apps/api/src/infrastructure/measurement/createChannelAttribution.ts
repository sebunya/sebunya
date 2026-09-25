import {
  AttributeOrderUseCase,
  BackfillOrderAttributionUseCase,
  GetOrderAttributionUseCase,
  GetWeeklyChannelReportUseCase,
  RecordCheckoutAttributionUseCase,
  RecordOrderSourceUseCase,
} from '../../application/use-cases/measurement/ChannelAttributionUseCases';
import { DrizzleChannelAttributionStore, PgChannelSpendSource } from './DrizzleChannelAttributionStore';

/** Composition of the attribution module (0156); one instance, held by the Registry. */
export function createChannelAttribution() {
  const store = new DrizzleChannelAttributionStore();
  const attributeOrder = new AttributeOrderUseCase(store);
  return {
    attributeOrder,
    recordCheckout: new RecordCheckoutAttributionUseCase(store, attributeOrder),
    recordOrderSource: new RecordOrderSourceUseCase(store, attributeOrder),
    backfill: new BackfillOrderAttributionUseCase(store, attributeOrder),
    weeklyReport: new GetWeeklyChannelReportUseCase(store, new PgChannelSpendSource()),
    orderView: new GetOrderAttributionUseCase(store),
  };
}
export type ChannelAttributionModule = ReturnType<typeof createChannelAttribution>;

let instance: ChannelAttributionModule | null = null;
/** Lazily built so importing it (the nightly job does) never touches the database. */
export function channelAttribution(): ChannelAttributionModule {
  if (!instance) instance = createChannelAttribution();
  return instance;
}
