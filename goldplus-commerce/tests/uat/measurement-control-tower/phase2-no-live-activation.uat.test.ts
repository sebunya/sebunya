import { describe, it } from 'vitest';
import { readText, assertContains, assertNotContains, collectMeasurementControlTowerFiles, assertNoPatternInFiles } from './helpers/phase2UatAssertions';

describe('Phase 2 UAT: No Live Activation Safety Checks', () => {
  it('no Launch button exists in admin pages/components added in Slices 8 to 10', () => {
    const files = collectMeasurementControlTowerFiles();
    assertNoPatternInFiles(files, new RegExp('<button.*>Launch<\/button>', 'i'), 'Launch button forbidden');
  });

  it('no Publish GTM button exists', () => {
    const files = collectMeasurementControlTowerFiles();
    assertNoPatternInFiles(files, new RegExp('<button.*>Publish<\/button>', 'i'), 'Publish button forbidden');
  });

  it('no live paid-social delivery button exists', () => {
    const files = collectMeasurementControlTowerFiles();
    assertNoPatternInFiles(files, new RegExp('<button.*>.*Live Delivery.*<\/button>', 'i'), 'Live delivery button forbidden');
  });

  it('no Override Consent button exists', () => {
    const files = collectMeasurementControlTowerFiles();
    assertNoPatternInFiles(files, new RegExp('<button.*>Override Consent<\/button>', 'i'), 'Override consent button forbidden');
  });

  it('no Create Conversion button exists', () => {
    const files = collectMeasurementControlTowerFiles();
    assertNoPatternInFiles(files, new RegExp('<button.*>Create Conversion<\/button>', 'i'), 'Create conversion button forbidden');
  });

  it('GTM runbook lists only safe commands', () => {
    const text = readText('docs/measurement-control-tower/GTM_SAFE_OPERATIONS_RUNBOOK.md');
    assertContains(text, 'plan', 'Must support plan');
    assertContains(text, 'validate', 'Must support validate');
    assertContains(text, 'diff', 'Must support diff');
    assertContains(text, 'create-workspace', 'Must support workspace creation');
    assertContains(text, 'create-version-draft', 'Must support draft creation');
  });

  it('GTM runbook explicitly states no publish path in Phase 2', () => {
    const text = readText('docs/measurement-control-tower/GTM_SAFE_OPERATIONS_RUNBOOK.md');
    assertContains(text, 'no publish path', 'Publishing explicitly forbidden in docs');
  });
});
