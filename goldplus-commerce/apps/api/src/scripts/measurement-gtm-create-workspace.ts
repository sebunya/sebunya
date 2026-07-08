import { Registry } from '../infrastructure/Registry';

async function main() {
  const registry = Registry.getInstance();
  const workspace = await registry.gtmRepo.createWorkspace('accounts/1/containers/1', 'New Workspace');
  console.log('Created workspace:', workspace);
}

main().catch(console.error);
