export const COPY_QUALITY_POLICY_VERSION = 'copy-quality-v1';
export type CopyIssueSeverity = 'BLOCKER' | 'WARNING';
export interface CopyQualityProduct { id: string; sku: string; name: string; modelNumber: string; shortDescription: string; longDescription: string; approvalStatus: string; active: boolean; }
export interface CopyQualityIssue { code: string; severity: CopyIssueSeverity; field: 'name' | 'modelNumber' | 'shortDescription' | 'longDescription' | 'cross_product'; evidence: Record<string, string | number | boolean>; }

const placeholder = /\b(lorem|ipsum|tbd|todo|test product|sample product|coming soon|missing\. requires admin review)\b/i;
const unsupportedClaim = /\b(best|number one|#1|guaranteed|100% original|cheapest|unbeatable)\b/i;
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function evaluateProductCopy(product: CopyQualityProduct): CopyQualityIssue[] {
  const issues: CopyQualityIssue[] = []; const fields = ['name','modelNumber','shortDescription','longDescription'] as const;
  for (const field of fields) { const value = product[field].trim(); if (!value) issues.push({ code: 'REQUIRED_COPY_MISSING', severity: 'BLOCKER', field, evidence: { actualLength: 0 } }); if (placeholder.test(value)) issues.push({ code: 'PLACEHOLDER_COPY', severity: 'BLOCKER', field, evidence: { pattern: 'placeholder_term' } }); if (unsupportedClaim.test(value)) issues.push({ code: 'CLAIM_REQUIRES_EVIDENCE', severity: 'WARNING', field, evidence: { pattern: 'absolute_claim' } }); if (/\s{2,}/.test(product[field])) issues.push({ code: 'REPEATED_WHITESPACE', severity: 'WARNING', field, evidence: { pattern: 'multiple_spaces' } }); if (/[!?]{2,}/.test(value)) issues.push({ code: 'REPEATED_PUNCTUATION', severity: 'WARNING', field, evidence: { pattern: 'multiple_marks' } }); }
  if (product.name.trim().length > 120) issues.push({ code: 'NAME_LENGTH_EXCEEDED', severity: 'WARNING', field: 'name', evidence: { maximum: 120, actualLength: product.name.trim().length } });
  if (product.shortDescription.trim().length > 0 && product.shortDescription.trim().length < 30) issues.push({ code: 'SHORT_DESCRIPTION_TOO_SHORT', severity: 'WARNING', field: 'shortDescription', evidence: { minimum: 30, actualLength: product.shortDescription.trim().length } });
  if (product.longDescription.trim().length > 0 && product.longDescription.trim().length < 80) issues.push({ code: 'LONG_DESCRIPTION_TOO_SHORT', severity: 'WARNING', field: 'longDescription', evidence: { minimum: 80, actualLength: product.longDescription.trim().length } });
  return issues;
}
export function duplicateCopyIssues(products: CopyQualityProduct[]): Map<string, CopyQualityIssue[]> {
  const result = new Map<string, CopyQualityIssue[]>(); for (const field of ['name','shortDescription','longDescription'] as const) { const groups = new Map<string, CopyQualityProduct[]>(); for (const product of products) { const key = normalize(product[field]); if (key) groups.set(key, [...(groups.get(key) ?? []), product]); } for (const group of groups.values()) if (group.length > 1) for (const product of group) result.set(product.id, [...(result.get(product.id) ?? []), { code: 'DUPLICATE_COPY', severity: 'WARNING', field: 'cross_product', evidence: { duplicatedField: field, duplicateCount: group.length } }]); } return result;
}
