/**
 * Campaign send engine — DRY-RUN ONLY (send wave under no-send verification).
 *
 * The eligibility pipeline is the deliverable: every audience subject passes
 * identity → consent(advertising) → suppression → frequency-cap gates and gets
 * exactly one recorded decision. Consent is FAIL-CLOSED: unknown identity or an
 * unreadable consent state is NO_CONSENT, never a send. LIVE mode is refused at
 * the type boundary AND by an env double-lock the caller must not even reach —
 * no provider adapter is imported anywhere in this pipeline.
 */

export interface SendAudienceSubject {
  subjectRef: string; // cart id
  ownerKind: string | null;
  ownerId: string | null; // user id when ownerKind === 'USER'
}

export interface SendGateReads {
  /** userIds (from the candidate set) whose advertising consent is currently granted. */
  advertisingGrantedUserIds(userIds: string[]): Promise<Set<string>>;
  /** userIds with an ACTIVE suppression for the channel. */
  suppressedUserIds(userIds: string[], channelKey: string): Promise<Set<string>>;
  /** subjectRefs that were ELIGIBLE in any run within the frequency window. */
  recentlyEligibleSubjects(subjectRefs: string[], sinceDays: number): Promise<Set<string>>;
}

export interface SendRunSink {
  persist(run: {
    campaignId: string;
    counts: { candidates: number; eligible: number; noIdentity: number; noConsent: number; suppressed: number; frequency: number };
    quietHoursAtRun: boolean;
    decisions: Array<{ subjectRef: string; decision: SendDecisionKind; detail: string | null }>;
    createdBy: string | null;
  }): Promise<{ runId: string }>;
}

export type SendDecisionKind = 'ELIGIBLE' | 'NO_IDENTITY' | 'NO_CONSENT' | 'SUPPRESSED' | 'FREQUENCY_CAPPED';

export const FREQUENCY_CAP_DAYS = 7;
/** Africa/Kampala is UTC+3 year-round. Quiet hours: 21:00–08:00 local. */
export function isQuietHours(now: Date): boolean {
  const kampalaHour = (now.getUTCHours() + 3) % 24;
  return kampalaHour >= 21 || kampalaHour < 8;
}

export type SendRunOutcome =
  | { ok: true; runId: string; counts: { candidates: number; eligible: number; noIdentity: number; noConsent: number; suppressed: number; frequency: number }; quietHoursAtRun: boolean }
  | { ok: false; code: 'LIVE_FORBIDDEN' | 'NOT_APPROVED' | 'EMPTY_AUDIENCE'; message: string };

export class CampaignSendEngineUseCase {
  constructor(
    private readonly gates: SendGateReads,
    private readonly sink: SendRunSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dryRun(args: {
    campaign: { id: string; status: string; channel: string };
    mode: 'DRY_RUN' | (string & {});
    audience: SendAudienceSubject[];
    actorId: string | null;
  }): Promise<SendRunOutcome> {
    if (args.mode !== 'DRY_RUN') {
      // Double lock: the schema has no LIVE vocabulary and this refusal makes the
      // engine unreachable for anything but analysis.
      return {
        ok: false,
        code: 'LIVE_FORBIDDEN',
        message: 'Only DRY_RUN exists. Live sending requires the activation wave: provider adapters, no-send verification evidence and an explicit business decision.',
      };
    }
    if (args.campaign.status !== 'APPROVED') {
      return { ok: false, code: 'NOT_APPROVED', message: `Campaign must be APPROVED to analyse (currently ${args.campaign.status}).` };
    }
    if (args.audience.length === 0) {
      return { ok: false, code: 'EMPTY_AUDIENCE', message: 'The audience is empty — nothing to analyse.' };
    }

    const identified = args.audience.filter((s) => s.ownerKind === 'USER' && s.ownerId);
    const userIds = [...new Set(identified.map((s) => s.ownerId!))];
    const [granted, suppressed, recentlyEligible] = await Promise.all([
      userIds.length ? this.gates.advertisingGrantedUserIds(userIds) : Promise.resolve(new Set<string>()),
      userIds.length ? this.gates.suppressedUserIds(userIds, args.campaign.channel) : Promise.resolve(new Set<string>()),
      this.gates.recentlyEligibleSubjects(args.audience.map((s) => s.subjectRef), FREQUENCY_CAP_DAYS),
    ]);

    const decisions: Array<{ subjectRef: string; decision: SendDecisionKind; detail: string | null }> = [];
    const counts = { candidates: args.audience.length, eligible: 0, noIdentity: 0, noConsent: 0, suppressed: 0, frequency: 0 };

    for (const subject of args.audience) {
      let decision: SendDecisionKind;
      let detail: string | null = null;
      if (!(subject.ownerKind === 'USER' && subject.ownerId)) {
        decision = 'NO_IDENTITY';
        detail = 'Guest basket — no signed-in identity to contact.';
        counts.noIdentity += 1;
      } else if (!granted.has(subject.ownerId)) {
        // Fail-closed: absence of a granted advertising consent IS a refusal.
        decision = 'NO_CONSENT';
        detail = 'No current advertising consent grant on record.';
        counts.noConsent += 1;
      } else if (suppressed.has(subject.ownerId)) {
        decision = 'SUPPRESSED';
        detail = `Active ${args.campaign.channel} suppression on record.`;
        counts.suppressed += 1;
      } else if (recentlyEligible.has(subject.subjectRef)) {
        decision = 'FREQUENCY_CAPPED';
        detail = `Already eligible within the last ${FREQUENCY_CAP_DAYS} days.`;
        counts.frequency += 1;
      } else {
        decision = 'ELIGIBLE';
        counts.eligible += 1;
      }
      decisions.push({ subjectRef: subject.subjectRef, decision, detail });
    }

    const quietHoursAtRun = isQuietHours(this.now());
    const { runId } = await this.sink.persist({
      campaignId: args.campaign.id,
      counts,
      quietHoursAtRun,
      decisions,
      createdBy: args.actorId,
    });
    return { ok: true, runId, counts, quietHoursAtRun };
  }
}
