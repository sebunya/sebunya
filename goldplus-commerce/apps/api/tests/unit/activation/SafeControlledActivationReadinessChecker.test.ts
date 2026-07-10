import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SafeControlledActivationReadinessChecker } from '../../../src/infrastructure/activation/SafeControlledActivationReadinessChecker.js';
import fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(actual.existsSync),
      readdirSync: vi.fn(actual.readdirSync),
      statSync: vi.fn(actual.statSync),
      readFileSync: vi.fn(actual.readFileSync)
    }
  };
});

describe('SafeControlledActivationReadinessChecker', () => {
  let checker: SafeControlledActivationReadinessChecker;

  beforeEach(() => {
    checker = new SafeControlledActivationReadinessChecker();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('real scanner finds forbidden GTM publish string in a controlled temp fixture', async () => {
    const originalRead = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((path: any, options: any) => {
      if (path.includes('package.json') || path.includes('api')) {
        return 'measurement:gtm:publish';
      }
      return originalRead(path, options);
    });

    const gates = await checker.runChecks('test-id');
    const gtmGate = gates.find(g => g.gateId === 'GTM_SAFETY');
    expect(gtmGate?.status).toBe('FAIL');
  });

  it('missing GTM config returns NOT_CONFIGURED', async () => {
    const originalGtm = process.env.GTM_CONTAINER_ID;
    delete process.env.GTM_CONTAINER_ID;
    
    const gates = await checker.runChecks('test-id');
    const configGate = gates.find(g => g.gateId === 'GTM_CONFIG');
    expect(configGate?.status).toBe('NOT_CONFIGURED');
    
    process.env.GTM_CONTAINER_ID = originalGtm;
  });

  it('dry-run state returns DRY_RUN for PAID_SOCIAL_SAFETY when no live paths', async () => {
    const originalRead = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((path: any, options: any) => {
      return ''; // clean
    });

    const gates = await checker.runChecks('test-id');
    const paidSocialGate = gates.find(g => g.gateId === 'PAID_SOCIAL_SAFETY');
    expect(paidSocialGate?.status).toBe('DRY_RUN');
  });
  
  it('approval fails without Release Readiness PASS', async () => {
    // Missing release readiness repo causes fail
    const gates = await checker.runChecks('test-id');
    const releaseReadinessGate = gates.find(g => g.gateId === 'RELEASE_READINESS_REVIEW');
    expect(releaseReadinessGate?.status).toBe('FAIL');
  });
});
