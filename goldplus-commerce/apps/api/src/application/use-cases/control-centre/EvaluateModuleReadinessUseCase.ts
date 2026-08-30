import {
  CONTROL_CENTRE_CONTRACT_VERSION,
  CONTROL_CENTRE_MODULES,
  type ControlCentreModule,
  type ModuleAccessStatus,
  type ModuleActivationStatus,
  type ModuleReadinessResult,
  type ModuleServiceStatus,
} from '@goldplus/shared';

/**
 * Computes the real operational posture of every Control Centre module.
 *
 * The rule this whole class exists to enforce: a status may only ever be derived
 * from an observation. There is no path through this code that returns LIVE from
 * a literal — the previous admin surface did exactly that and so could not tell
 * "healthy but protected" apart from "broken".
 *
 * The three axes are computed independently:
 *   serviceStatus    from route mounting + dependency probes
 *   accessStatus     from the module's declared permission requirements
 *   activationStatus from its activation policy and provider configuration
 *
 * Crucially, a module the caller cannot use is NOT unavailable. Permission is an
 * access fact, provider configuration is an activation fact; neither may degrade
 * serviceStatus.
 */

export interface DependencyProbe {
  /** Returns true when the dependency answers a trivial query. */
  isUp(name: string, table?: string): Promise<boolean>;
}

export interface RouteMountProbe {
  /** Returns true when the API prefix is actually mounted on the running app. */
  isMounted(apiMount: string): boolean;
}

export interface ProviderConfigProbe {
  /**
   * Whether credentials for a provider are present. Never returns the values —
   * readiness payloads must not carry secrets.
   */
  isConfigured(provider: string): boolean;
}

export interface ApprovalProbe {
  /** Whether an operator has recorded an approval activating this module. */
  isApproved(moduleKey: string): Promise<boolean>;
}

export interface EvaluateModuleReadinessInput {
  /** Permissions held by the caller, used only for accessStatus. */
  readonly actorPermissions: readonly string[];
  readonly traceId: string;
  /** Restrict to one category when the caller only renders one page. */
  readonly category?: ControlCentreModule['category'];
}

export interface ControlCentreReadinessSummary {
  readonly contractVersion: string;
  readonly generatedAt: string;
  readonly totalModules: number;
  readonly liveModules: number;
  readonly degradedModules: number;
  readonly blockedModules: number;
  readonly unavailableModules: number;
  readonly modules: readonly ModuleReadinessResult[];
  readonly traceId: string;
}

/** Answers whether a named capability is achieving its purpose, not merely up. */
export interface HealthProbe {
  check(name: string): Promise<{ healthy: boolean; detail?: string }>;
}

export class EvaluateModuleReadinessUseCase {
  constructor(
    private readonly dependencies: DependencyProbe,
    private readonly routes: RouteMountProbe,
    private readonly providers: ProviderConfigProbe,
    private readonly approvals: ApprovalProbe,
    private readonly now: () => Date = () => new Date(),
    private readonly registry: readonly ControlCentreModule[] = CONTROL_CENTRE_MODULES,
    /**
     * Outcome checks. Optional, so every existing construction keeps working
     * and a module without healthChecks is evaluated exactly as before.
     */
    private readonly health?: HealthProbe,
  ) {}

  async execute(input: EvaluateModuleReadinessInput): Promise<ControlCentreReadinessSummary> {
    const selected = input.category
      ? this.registry.filter((m) => m.category === input.category)
      : this.registry;

    const modules = await Promise.all(
      selected.map((module) => this.evaluateModule(module, input)),
    );

    const count = (status: ModuleServiceStatus): number =>
      modules.filter((m) => m.serviceStatus === status).length;

    return {
      contractVersion: CONTROL_CENTRE_CONTRACT_VERSION,
      generatedAt: this.now().toISOString(),
      totalModules: modules.length,
      liveModules: count('LIVE'),
      degradedModules: count('DEGRADED'),
      blockedModules: count('BLOCKED'),
      unavailableModules: count('UNAVAILABLE'),
      modules,
      traceId: input.traceId,
    };
  }

  private async evaluateModule(
    module: ControlCentreModule,
    input: EvaluateModuleReadinessInput,
  ): Promise<ModuleReadinessResult> {
    const startedAt = Date.now();
    const degradedReasons: string[] = [];

    // ─── serviceStatus: reachability and health only ───────────────────────
    const mounted = this.routes.isMounted(module.apiMount);
    if (!mounted) {
      degradedReasons.push(`API mount ${module.apiMount} is not registered`);
    }

    const dependencies = await Promise.all(
      module.dataDependencies.map(async (dependency) => {
        try {
          const up = await this.dependencies.isUp(dependency.name, dependency.table);
          if (!up) {
            degradedReasons.push(
              `dependency ${dependency.name}${dependency.table ? `.${dependency.table}` : ''} did not respond`,
            );
          }
          return {
            name: dependency.name,
            status: (up ? 'UP' : 'DOWN') as 'UP' | 'DOWN' | 'UNKNOWN',
            detail: dependency.table,
          };
        } catch (error) {
          degradedReasons.push(
            `dependency ${dependency.name} probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
          return { name: dependency.name, status: 'DOWN' as const, detail: dependency.table };
        }
      }),
    );

    // Reachable and switched on is not the same as working. A module may name
    // checks on what it is actually achieving; a failing one degrades it and
    // says why, so "all green" cannot outlive the capability.
    let anyHealthCheckFailed = false;
    for (const check of module.healthChecks ?? []) {
      if (!this.health) break;
      try {
        const result = await this.health.check(check);
        if (!result.healthy) {
          anyHealthCheckFailed = true;
          degradedReasons.push(result.detail ? `${check}: ${result.detail}` : `health check ${check} is failing`);
        }
      } catch (error) {
        anyHealthCheckFailed = true;
        degradedReasons.push(
          `health check ${check} could not run: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    const anyDependencyDown = dependencies.some((d) => d.status === 'DOWN');

    let serviceStatus: ModuleServiceStatus;
    if (!mounted) {
      // The capability genuinely cannot be reached: this is the only honest
      // UNAVAILABLE, and it is a deployment defect rather than a policy state.
      serviceStatus = 'UNAVAILABLE';
    } else if (anyDependencyDown || anyHealthCheckFailed) {
      serviceStatus = 'DEGRADED';
    } else {
      serviceStatus = 'LIVE';
    }

    // ─── accessStatus: what the caller needs, never a health signal ────────
    const accessStatus = this.resolveAccess(module, input.actorPermissions);

    // ─── activationStatus: business switch, never a health signal ──────────
    const activationStatus = await this.resolveActivation(module, degradedReasons);

    // Only expose actions the caller may actually perform, so no button can be
    // rendered that is guaranteed to fail.
    const availableActions = module.supportedActions.filter(
      (action) =>
        !action.requiredPermission || input.actorPermissions.includes(action.requiredPermission),
    );

    return {
      moduleKey: module.key,
      displayName: module.displayName,
      category: module.category,
      serviceStatus,
      accessStatus,
      activationStatus,
      lastCheckedAt: this.now().toISOString(),
      latencyMs: Date.now() - startedAt,
      contractVersion: CONTROL_CENTRE_CONTRACT_VERSION,
      requiredPermissions: module.requiredPermissions,
      dependencies,
      availableActions,
      degradedReasons,
      deepLink: module.adminRoute,
      traceId: input.traceId,
    };
  }

  private resolveAccess(
    module: ControlCentreModule,
    actorPermissions: readonly string[],
  ): ModuleAccessStatus {
    if (module.activationPolicy === 'OPERATOR_APPROVAL') return 'APPROVAL_REQUIRED';
    if (module.requiredPermissions.length === 0) return 'AUTHENTICATED';
    return 'PROTECTED';
  }

  private async resolveActivation(
    module: ControlCentreModule,
    degradedReasons: string[],
  ): Promise<ModuleActivationStatus> {
    // A module with no side effects is inherently read-only; saying ACTIVE would
    // overstate what it does.
    if (!module.liveMode) return 'READ_ONLY';

    switch (module.activationPolicy) {
      case 'AUTOMATIC':
        return 'ACTIVE';

      case 'PROVIDER_CONFIG': {
        const missing = module.providerDependencies.filter(
          (provider) => !this.providers.isConfigured(provider),
        );
        if (missing.length === module.providerDependencies.length && missing.length > 0) {
          // No provider configured at all. The module still works — it can
          // truthfully report that nothing is connected — so this is an
          // activation fact, not a service failure.
          return 'NOT_CONFIGURED';
        }
        if (missing.length > 0) {
          degradedReasons.push(`providers awaiting configuration: ${missing.join(', ')}`);
          return 'DRY_RUN';
        }
        return 'ACTIVE';
      }

      case 'OPERATOR_APPROVAL': {
        const approved = await this.approvals.isApproved(module.key);
        return approved ? 'ACTIVE' : 'DORMANT';
      }

      case 'OPERATOR_CONFIG':
        return 'NOT_CONFIGURED';

      default:
        return 'DORMANT';
    }
  }
}
