import type { AivCompetitor, AivProject } from '../../ports/AiVisibility';
import type { EvidenceContext } from '../../../domain/ai-visibility/Evidence';
import { competitorMentionAliases } from '../../../domain/ai-visibility/Mentions';

/**
 * The one definition of "who is who" when an answer is classified: the
 * project's brand and domains, and its pinned competitors with the names
 * answers actually use. Runs and re-classification both call this, so a
 * re-classified answer is judged exactly as a new one would be.
 */
export function buildEvidenceContext(project: AivProject, competitors: readonly AivCompetitor[]): EvidenceContext {
  return {
    brand: { id: 'BRAND', name: project.brandName, aliases: project.brandAliases },
    ownDomains: project.domains,
    competitors: competitors.map((c) => ({ id: c.id, name: c.name, aliases: [...c.aliases, ...competitorMentionAliases(c)], domains: c.domains })),
  };
}
