/**
 * robots.txt governance (migration 0120) — the rules, kept pure.
 *
 * robots.txt is a live production control. A single stray `Disallow: /` under
 * `User-agent: *` deindexes the entire storefront, and the damage is invisible
 * until traffic collapses weeks later. So:
 *
 *  * Every change is a NEW version. History is never mutated, and a rollback
 *    is itself a new version carrying `restored_from_id` — not an edit.
 *  * A version travels DRAFT -> PENDING_APPROVAL -> APPROVED -> PUBLISHED.
 *    Exactly one row may be PUBLISHED (a partial unique index enforces it);
 *    publishing supersedes the incumbent in the same transaction.
 *  * Approval is separated from authorship. The person who wrote a robots.txt
 *    change may not be the person who signs it off.
 *  * Dangerous directives are REFUSED with a typed code, never silently
 *    rewritten. The operator may still proceed, but only by acknowledging the
 *    risk explicitly — the acknowledgement is then part of the audit record.
 */

export const ROBOTS_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PUBLISHED',
  'SUPERSEDED',
  'REJECTED',
] as const;
export type RobotsStatus = (typeof ROBOTS_STATUSES)[number];

/** Legal moves. Anything absent here is refused; there is no fallthrough. */
const TRANSITIONS: Record<RobotsStatus, readonly RobotsStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'REJECTED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT'],
  APPROVED: ['PUBLISHED', 'REJECTED'],
  PUBLISHED: ['SUPERSEDED'],
  SUPERSEDED: [],
  REJECTED: [],
};

export function isRobotsStatus(value: unknown): value is RobotsStatus {
  return typeof value === 'string' && (ROBOTS_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: unknown, to: unknown): boolean {
  if (!isRobotsStatus(from) || !isRobotsStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

// ── Content validation ──────────────────────────────────────────────────────

export const ROBOTS_FINDING_SEVERITIES = ['INFO', 'WARNING', 'BLOCKING'] as const;
export type RobotsFindingSeverity = (typeof ROBOTS_FINDING_SEVERITIES)[number];

export interface RobotsFinding {
  code: string;
  severity: RobotsFindingSeverity;
  line: number | null;
  message: string;
}

interface ParsedGroup {
  agents: string[];
  disallow: { value: string; line: number }[];
  allow: { value: string; line: number }[];
}

const stripComment = (line: string): string => {
  const hash = line.indexOf('#');
  return (hash === -1 ? line : line.slice(0, hash)).trim();
};

/**
 * Group directives by their User-agent block, the way a crawler reads them.
 * Consecutive User-agent lines share one group; a directive starts a new group
 * boundary on the next agent line.
 */
export function parseRobots(content: string): ParsedGroup[] {
  const groups: ParsedGroup[] = [];
  let current: ParsedGroup | null = null;
  let expectingAgents = false;

  content.split(/\r?\n/).forEach((raw, index) => {
    const line = stripComment(raw);
    if (line === '') return;
    const colon = line.indexOf(':');
    if (colon === -1) return;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!current || !expectingAgents) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value);
      return;
    }
    if (field === 'disallow' || field === 'allow') {
      if (!current) {
        // A directive with no preceding User-agent belongs to no group at all.
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      expectingAgents = false;
      (field === 'disallow' ? current.disallow : current.allow).push({ value, line: index + 1 });
    }
  });

  return groups;
}

/**
 * Findings for a candidate robots.txt. BLOCKING means the change cannot be
 * approved without an explicit risk acknowledgement — it does not mean the
 * content is rewritten. Operator input is never edited behind their back.
 */
export function validateRobotsContent(content: unknown): RobotsFinding[] {
  const findings: RobotsFinding[] = [];
  const text = typeof content === 'string' ? content : '';

  if (text.trim() === '') {
    findings.push({
      code: 'ROBOTS_EMPTY',
      severity: 'BLOCKING',
      line: null,
      message: 'robots.txt is empty. Publish a version with at least one User-agent group.',
    });
    return findings;
  }

  const groups = parseRobots(text);
  if (groups.length === 0) {
    findings.push({
      code: 'ROBOTS_NO_GROUPS',
      severity: 'BLOCKING',
      line: null,
      message: 'No User-agent group was found. Crawlers would have no directives to follow.',
    });
  }

  for (const group of groups) {
    const isWildcard = group.agents.some((a) => a.trim() === '*');
    for (const rule of group.disallow) {
      // Google honours `/*` and `*` exactly as it honours `/` — all three
      // block every URL on the site. Checking only `/` let a whole-site block
      // publish with a clean bill of health.
      const target = rule.value.trim();
      if (target !== '/' && target !== '/*' && target !== '*') continue;
      if (isWildcard) {
        findings.push({
          code: 'ROBOTS_DISALLOW_ALL_WILDCARD',
          severity: 'BLOCKING',
          line: rule.line,
          message:
            'Line ' +
            rule.line +
            ': "Disallow: /" under "User-agent: *" blocks every crawler from the entire site. ' +
            'Publishing this deindexes ShopGoldPlus from Google. Confirm explicitly if this is intended.',
        });
      } else {
        findings.push({
          code: 'ROBOTS_DISALLOW_ALL_AGENT',
          severity: 'WARNING',
          line: rule.line,
          message:
            'Line ' + rule.line + ': "Disallow: /" blocks the entire site for ' +
            (group.agents.join(', ') || 'an unnamed agent') + '.',
        });
      }
    }
  }

  const hasSitemap = text
    .split(/\r?\n/)
    .some((l) => stripComment(l).toLowerCase().startsWith('sitemap:'));
  if (!hasSitemap) {
    findings.push({
      code: 'ROBOTS_NO_SITEMAP',
      severity: 'INFO',
      line: null,
      message: 'No Sitemap: directive. Discovery still works, but the sitemap is not advertised here.',
    });
  }

  const adminBlocked = groups.some(
    (g) => g.agents.some((a) => a.trim() === '*') && g.disallow.some((d) => d.value.startsWith('/admin')),
  );
  if (!adminBlocked) {
    findings.push({
      code: 'ROBOTS_ADMIN_EXPOSED',
      severity: 'WARNING',
      line: null,
      message: '/admin is not disallowed for "User-agent: *". Admin URLs may be crawled and indexed.',
    });
  }

  return findings;
}

export const blockingFindings = (findings: RobotsFinding[]): RobotsFinding[] =>
  findings.filter((f) => f.severity === 'BLOCKING');

export type RobotsGate =
  | { ok: true; findings: RobotsFinding[]; acknowledged: RobotsFinding[] }
  | { ok: false; code: string; message: string; findings: RobotsFinding[] };

/**
 * The gate every draft passes before it can be submitted, approved or
 * published. `acknowledgeRisk: true` is the operator saying "yes, I mean it";
 * without it, blocking findings refuse the change with a typed code.
 */
export function gateRobotsContent(content: unknown, acknowledgeRisk: unknown): RobotsGate {
  const findings = validateRobotsContent(content);
  const blocking = blockingFindings(findings);
  if (blocking.length === 0) return { ok: true, findings, acknowledged: [] };
  if (acknowledgeRisk === true) return { ok: true, findings, acknowledged: blocking };
  return {
    ok: false,
    code: 'ROBOTS_RISK_NOT_ACKNOWLEDGED',
    message:
      blocking.map((f) => f.message).join(' ') +
      ' The content has not been altered. Resubmit with acknowledgeRisk: true to proceed deliberately.',
    findings,
  };
}

// ── Separation of duties ────────────────────────────────────────────────────

export type ApprovalCheck = { ok: true } | { ok: false; code: string; message: string };

/** The author of a robots.txt change may never be its approver. */
export function checkApprover(authorId: unknown, approverId: unknown): ApprovalCheck {
  const author = typeof authorId === 'string' ? authorId.trim() : '';
  const approver = typeof approverId === 'string' ? approverId.trim() : '';
  if (approver === '') {
    return { ok: false, code: 'APPROVER_REQUIRED', message: 'An approver identity is required.' };
  }
  if (author !== '' && author === approver) {
    return {
      ok: false,
      code: 'SEPARATION_OF_DUTIES',
      message:
        'The author of a robots.txt version cannot approve it. A second operator holding ' +
        'seo.approve_high_risk must review and approve this change.',
    };
  }
  return { ok: true };
}

// ── Unified line diff (pure, DB-free) ───────────────────────────────────────

export type RobotsDiffOp = 'context' | 'add' | 'remove';

export interface RobotsDiffLine {
  op: RobotsDiffOp;
  text: string;
  /** 1-based line number in the "from" content, null for additions. */
  fromLine: number | null;
  /** 1-based line number in the "to" content, null for removals. */
  toLine: number | null;
}

export interface RobotsDiffHunk {
  fromStart: number;
  fromCount: number;
  toStart: number;
  toCount: number;
  header: string;
  lines: RobotsDiffLine[];
}

export interface RobotsDiff {
  identical: boolean;
  added: number;
  removed: number;
  hunks: RobotsDiffHunk[];
  unified: string;
}

const splitLines = (v: unknown): string[] => {
  const text = typeof v === 'string' ? v : '';
  const lines = text.split(/\r?\n/);
  // A trailing newline is a line terminator, not an empty final line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/** Longest common subsequence over lines — the basis of the diff. */
function lcsMatrix(a: string[], b: string[]): number[][] {
  const m: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      m[i][j] = a[i] === b[j] ? m[i + 1][j + 1] + 1 : Math.max(m[i + 1][j], m[i][j + 1]);
    }
  }
  return m;
}

/**
 * A unified diff between two robots.txt bodies. Pure and DB-free so the
 * behaviour that operators stake a publish decision on is unit-testable.
 */
export function diffRobots(fromContent: unknown, toContent: unknown, context = 3): RobotsDiff {
  const a = splitLines(fromContent);
  const b = splitLines(toContent);
  const m = lcsMatrix(a, b);

  const all: RobotsDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      all.push({ op: 'context', text: a[i], fromLine: i + 1, toLine: j + 1 });
      i += 1;
      j += 1;
    } else if (m[i + 1][j] >= m[i][j + 1]) {
      all.push({ op: 'remove', text: a[i], fromLine: i + 1, toLine: null });
      i += 1;
    } else {
      all.push({ op: 'add', text: b[j], fromLine: null, toLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    all.push({ op: 'remove', text: a[i], fromLine: i + 1, toLine: null });
    i += 1;
  }
  while (j < b.length) {
    all.push({ op: 'add', text: b[j], fromLine: null, toLine: j + 1 });
    j += 1;
  }

  const added = all.filter((l) => l.op === 'add').length;
  const removed = all.filter((l) => l.op === 'remove').length;
  if (added === 0 && removed === 0) {
    return { identical: true, added: 0, removed: 0, hunks: [], unified: '' };
  }

  // Keep changed lines plus `context` lines either side; group into hunks.
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((line, index) => {
    if (line.op === 'context') return;
    for (let k = Math.max(0, index - context); k <= Math.min(all.length - 1, index + context); k += 1) {
      keep[k] = true;
    }
  });

  const hunks: RobotsDiffHunk[] = [];
  let cursor = 0;
  while (cursor < all.length) {
    if (!keep[cursor]) {
      cursor += 1;
      continue;
    }
    let end = cursor;
    while (end + 1 < all.length && keep[end + 1]) end += 1;
    const lines = all.slice(cursor, end + 1);
    const fromCount = lines.filter((l) => l.op !== 'add').length;
    const toCount = lines.filter((l) => l.op !== 'remove').length;
    const fromStart = lines.find((l) => l.fromLine !== null)?.fromLine ?? (fromCount === 0 ? 0 : 1);
    const toStart = lines.find((l) => l.toLine !== null)?.toLine ?? (toCount === 0 ? 0 : 1);
    hunks.push({
      fromStart,
      fromCount,
      toStart,
      toCount,
      header: `@@ -${fromStart},${fromCount} +${toStart},${toCount} @@`,
      lines,
    });
    cursor = end + 1;
  }

  const marker = (op: RobotsDiffOp): string => (op === 'add' ? '+' : op === 'remove' ? '-' : ' ');
  const unified = hunks
    .map((h) => [h.header, ...h.lines.map((l) => `${marker(l.op)}${l.text}`)].join('\n'))
    .join('\n');

  return { identical: false, added, removed, hunks, unified };
}

// ── Input shaping ───────────────────────────────────────────────────────────

export interface RobotsDraftInput {
  content: string;
  note?: string | null;
  restoredFromId?: string | null;
  acknowledgeRisk?: boolean;
}

export type RobotsDraftValidation =
  | { ok: true; input: RobotsDraftInput & { findings: RobotsFinding[]; acknowledged: RobotsFinding[] } }
  | { ok: false; code: string; message: string; findings?: RobotsFinding[] };

export function validateRobotsDraft(body: unknown): RobotsDraftValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  const content = typeof b.content === 'string' ? b.content : '';
  if (content.trim() === '') {
    return { ok: false, code: 'CONTENT_REQUIRED', message: 'robots.txt content is required.' };
  }
  if (content.length > 100_000) {
    return { ok: false, code: 'CONTENT_TOO_LARGE', message: 'robots.txt content exceeds 100,000 characters.' };
  }
  const gate = gateRobotsContent(content, b.acknowledgeRisk);
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message, findings: gate.findings };
  return {
    ok: true,
    input: {
      content,
      note: typeof b.note === 'string' && b.note.trim() !== '' ? b.note.trim() : null,
      restoredFromId: typeof b.restoredFromId === 'string' && b.restoredFromId.trim() !== '' ? b.restoredFromId.trim() : null,
      acknowledgeRisk: b.acknowledgeRisk === true,
      findings: gate.findings,
      acknowledged: gate.acknowledged,
    },
  };
}

/**
 * The fallback served when no version has ever been published. It is the
 * storefront's committed static content, so robots.txt is never empty or
 * broken — an unreachable API must not turn into an accidental allow-all.
 */
export function fallbackRobotsTxt(baseUrl: string): string {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return (
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin\n' +
    'Disallow: /admin/\n' +
    'Disallow: /checkout\n' +
    'Disallow: /cart\n' +
    'Disallow: /dealers/dashboard\n' +
    'Disallow: /account\n' +
    'Disallow: /api/\n' +
    '\n' +
    `Sitemap: ${base}/sitemap.xml\n`
  );
}
