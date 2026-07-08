import { Registry } from '../infrastructure/Registry';

async function main() {
  const registry = Registry.getInstance();
  const plan = await registry.planGtmMeasurementChangesUseCase.execute({
    type: 'ADD_TAG',
    details: 'Add Facebook Pixel',
  });
  console.log('Created plan:', plan);
}

main().catch(console.error);
