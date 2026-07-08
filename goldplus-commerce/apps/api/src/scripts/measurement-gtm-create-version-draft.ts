import { Registry } from '../infrastructure/Registry';
const registry = Registry.getInstance();
registry.createGtmVersionDraftUseCase.execute('mock-workspace', 'Phase 2 Draft').then(res => {
  console.log(JSON.stringify(res, null, 2));
}).catch(console.error);
