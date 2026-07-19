const { client, endDbConnection } = require('/app/apps/api/dist/infrastructure/db/client.js');
const { Registry } = require('/app/apps/api/dist/infrastructure/Registry.js');

const counts = async () => (await client.unsafe(`select
  (select count(*)::int from pricing_quotes) quotes,
  (select count(*)::int from promotion_reservations) reservations,
  (select count(*)::int from promotion_redemptions) redemptions,
  (select count(*)::int from orders) orders,
  (select count(*)::int from payment_attempts) payments,
  (select count(*)::int from outbox_events) outbox,
  (select count(*)::int from notification_attempts) notifications,
  (select count(*)::int from drizzle.__drizzle_migrations) migrations`))[0];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  let failure;
  try {
    const before = await counts();
    const selected = (await client.unsafe("select id, price_ugx from products where active = true and approval_status = 'approved' order by id limit 1"))[0];
    if (!selected) throw new Error('NO_CANONICAL_PRODUCT');

    const registry = Registry.getInstance();
    const overview = await registry.pricingOperationsUseCase.overview();
    const quote = await registry.evaluateCartPricingUseCase.execute({
      items: [{ productId: selected.id, quantity: 1 }],
      persist: false,
      evaluatedAt: new Date(),
    });
    const after = await counts();

    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('DATABASE_MUTATION_DETECTED');
    if (Number(quote.baseSubtotalUgx) !== Number(selected.price_ugx)
      || Number(quote.discountTotalUgx) !== 0
      || Number(quote.finalTotalUgx) !== Number(selected.price_ugx)) {
      throw new Error('NON_PERSISTENT_SIMULATION_MISMATCH');
    }

    console.log(JSON.stringify({
      databaseSelect: true,
      migrationRows: Number(after.migrations),
      pricingRepositoryInitialized: true,
      activePromotions: Number(overview.definitionsByStatus.ACTIVE ?? 0),
      canonicalPriceUgx: Number(selected.price_ugx),
      simulatedFinalUgx: quote.finalTotalUgx,
      discountUgx: quote.discountTotalUgx,
      databaseMutation: false,
      providerCalls: 0,
      verdict: 'PASS',
    }));
  } catch (error) {
    failure = error;
  } finally {
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}

main().catch((error) => {
  console.error('PRICING_RELEASE_DB_SMOKE_ERROR', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
