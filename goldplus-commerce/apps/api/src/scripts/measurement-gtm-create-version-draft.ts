import { Registry } from '../infrastructure/Registry';

async function main() {
  const registry = Registry.getInstance();
  const draft = await registry.gtmRepo.createVersionDraft('accounts/1/containers/1/workspaces/1', 'Version Draft');
  console.log('Created version draft:', draft);
}

main().catch(console.error);
