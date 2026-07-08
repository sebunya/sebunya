import { Registry } from '../infrastructure/Registry';
const registry = Registry.getInstance();
registry.validateGtmMeasurementPlanUseCase.execute('mock-container', 'web').then(res => {
  console.log(JSON.stringify(res, null, 2));
}).catch(console.error);
