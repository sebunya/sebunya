import { Registry } from '../infrastructure/Registry';
const registry = Registry.getInstance();
registry.createGtmWorkspaceUseCase.execute('mock-container', 'GoldPlus Measurement').then(res => {
  console.log(JSON.stringify(res, null, 2));
}).catch(console.error);
