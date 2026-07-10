import { ControlledActivationReadinessChecker, ActivationGate, ActivationGateStatus } from '../../application/ports/activation/ControlledActivationReadinessChecker.js';
import { IReleaseReadinessRepository } from '../../application/ports/release/ReleaseReadinessRepository.js';
import fs from 'fs';
import path from 'path';

export class SafeControlledActivationReadinessChecker implements ControlledActivationReadinessChecker {
  constructor(private readonly releaseReadinessRepo?: IReleaseReadinessRepository) {}

  async runChecks(activationRequestId: string): Promise<ActivationGate[]> {
    const results: ActivationGate[] = [];
    const rootDir = process.cwd();

    const gtmPaths = this.grepSync(rootDir, /measurement:gtm:publish/g, ['apps/api', 'package.json']);
    if (gtmPaths.length > 0) {
      results.push(this.failGate(activationRequestId, 'GTM_SAFETY', `Live GTM publish commands detected in: ${gtmPaths.join(', ')}`));
    } else {
      results.push(this.passGate(activationRequestId, 'GTM_SAFETY', 'No live GTM publish commands found in codebase.'));
    }

    const paidSocial = this.grepSync(rootDir, /sendLivePaidSocial/g, ['apps/api']);
    if (paidSocial.length > 0) {
      results.push(this.failGate(activationRequestId, 'PAID_SOCIAL_SAFETY', `Live paid social event dispatch detected in: ${paidSocial.join(', ')}`));
    } else {
      results.push(this.dryRunGate(activationRequestId, 'PAID_SOCIAL_SAFETY', 'Paid social events configured for dry-run only.'));
    }

    const consentOverride = this.grepSync(rootDir, /overrideConsent/g, ['apps/api']);
    if (consentOverride.length > 0) {
      results.push(this.failGate(activationRequestId, 'CONSENT_SAFETY', `Consent override mechanisms detected in: ${consentOverride.join(', ')}`));
    } else {
      results.push(this.consentBlockedGate(activationRequestId, 'CONSENT_SAFETY', 'Consent safely enforced.'));
    }

    const manualConversion = this.grepSync(rootDir, /createManualConversion/g, ['apps/api']);
    if (manualConversion.length > 0) {
      results.push(this.failGate(activationRequestId, 'PURCHASE_CONVERSION_SAFETY', `Manual conversion mechanisms detected in: ${manualConversion.join(', ')}`));
    } else {
      results.push(this.passGate(activationRequestId, 'PURCHASE_CONVERSION_SAFETY', 'No manual conversion mechanisms detected.'));
    }
    
    const forceReconcile = this.grepSync(rootDir, /forceReconcile/g, ['apps/api']);
    if (forceReconcile.length > 0) {
      results.push(this.failGate(activationRequestId, 'PESAPAL_RECONCILIATION_SAFETY', `Force reconcile mechanisms detected in: ${forceReconcile.join(', ')}`));
    } else {
      results.push(this.passGate(activationRequestId, 'PESAPAL_RECONCILIATION_SAFETY', 'No force reconcile mechanisms detected.'));
    }
    
    const productFinderPurchaseQueue = this.grepSync(rootDir, /import.*purchase.*queue/i, ['apps/api/src/application/use-cases/product-finder']);
    if (productFinderPurchaseQueue.length > 0) {
      results.push(this.failGate(activationRequestId, 'PRODUCT_FINDER_SAFETY', `Product Finder imports purchase queue in: ${productFinderPurchaseQueue.join(', ')}`));
    } else {
      results.push(this.passGate(activationRequestId, 'PRODUCT_FINDER_SAFETY', 'Product Finder isolated from purchase queue.'));
    }

    if (!process.env.GTM_CONTAINER_ID) {
      results.push(this.notConfiguredGate(activationRequestId, 'GTM_CONFIG', 'GTM Container ID is not configured.'));
    } else {
      results.push(this.passGate(activationRequestId, 'GTM_CONFIG', 'GTM configured correctly.'));
    }
    
    if (!process.env.PAID_SOCIAL_TOKEN) {
      results.push(this.notConfiguredGate(activationRequestId, 'PAID_SOCIAL_CONFIG', 'Paid social credentials missing.'));
    } else {
      results.push(this.passGate(activationRequestId, 'PAID_SOCIAL_CONFIG', 'Paid social credentials configured.'));
    }

    const runbooksExist = fs.existsSync(path.join(rootDir, 'docs/measurement-control-tower'));
    if (!runbooksExist) {
      results.push(this.failGate(activationRequestId, 'RUNBOOKS', 'Measurement Control Tower runbooks are missing.'));
    } else {
      results.push(this.passGate(activationRequestId, 'RUNBOOKS', 'Runbooks present.'));
    }
    
    let releaseReadinessPass = false;
    if (this.releaseReadinessRepo) {
      const latestRun = await this.releaseReadinessRepo.getLatestReadinessRun();
      if (latestRun && latestRun.status === 'PASS') {
        releaseReadinessPass = true;
      }
    }
    
    if (!releaseReadinessPass) {
      results.push(this.failGate(activationRequestId, 'RELEASE_READINESS_REVIEW', 'Missing release readiness PASS proof from repository.'));
    } else {
      results.push(this.passGate(activationRequestId, 'RELEASE_READINESS_REVIEW', 'Release readiness passed in the repository.'));
    }

    return results;
  }

  async getLatestGates(activationRequestId: string): Promise<ActivationGate[]> {
    return this.runChecks(activationRequestId);
  }

  async saveGates(gates: ActivationGate[]): Promise<void> {
    // Port implementation
  }

  async acknowledgeBlocker(activationRequestId: string, gateId: string, reason: string): Promise<void> {
    // Port implementation
  }

  private grepSync(rootDir: string, pattern: RegExp, dirs: string[]): string[] {
    const matches: string[] = [];
    const ignoreDirs = ['node_modules', 'dist', 'build', '.git', '.verification'];
    
    const scanDir = (currentDir: string) => {
      if (!fs.existsSync(currentDir)) return;
      const currentStat = fs.statSync(currentDir);
      if (currentStat.isFile()) {
        const content = fs.readFileSync(currentDir, "utf8");
        if (pattern.test(content)) matches.push(`${currentDir}:1`);
        return;
      }
      const files = fs.readdirSync(currentDir);
      for (const file of files) {
        if (ignoreDirs.includes(file)) continue;
        const fullPath = path.join(currentDir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (stat.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.json') || fullPath.endsWith('.md'))) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (pattern.test(content)) {
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (pattern.test(lines[i])) {
                  matches.push(`${fullPath}:${i + 1}`);
                }
              }
            }
          } catch (_e) {
            // Ignore read errors
          }
        }
      }
    };

    for (const dir of dirs) {
      scanDir(path.join(rootDir, dir));
    }
    return matches;
  }

  private buildGate(activationRequestId: string, gateId: string, status: ActivationGateStatus, severity: string, evidenceSummary: string): ActivationGate {
    return {
      gateId,
      activationRequestId,
      category: 'SAFETY',
      name: gateId,
      status,
      severity,
      evidenceSummary,
      safeReferenceId: null,
      checkedAt: new Date(),
      blockerReason: status === 'FAIL' ? evidenceSummary : null,
      recommendation: null
    };
  }

  private failGate(reqId: string, gateId: string, evidence: string): ActivationGate {
    return this.buildGate(reqId, gateId, 'FAIL', 'CRITICAL', evidence);
  }

  private passGate(reqId: string, gateId: string, evidence: string): ActivationGate {
    return this.buildGate(reqId, gateId, 'PASS', 'INFO', evidence);
  }

  private notConfiguredGate(reqId: string, gateId: string, evidence: string): ActivationGate {
    return this.buildGate(reqId, gateId, 'NOT_CONFIGURED', 'WARNING', evidence);
  }

  private dryRunGate(reqId: string, gateId: string, evidence: string): ActivationGate {
    return this.buildGate(reqId, gateId, 'DRY_RUN', 'INFO', evidence);
  }

  private consentBlockedGate(reqId: string, gateId: string, evidence: string): ActivationGate {
    return this.buildGate(reqId, gateId, 'CONSENT_BLOCKED', 'INFO', evidence);
  }
}
