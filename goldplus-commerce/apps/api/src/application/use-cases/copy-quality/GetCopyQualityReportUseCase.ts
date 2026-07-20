import { ICopyQualityCatalogReader } from '../../ports/ICopyQualityCatalogReader';
import { COPY_QUALITY_POLICY_VERSION, duplicateCopyIssues, evaluateProductCopy } from '../../../domain/copy-quality/CopyQuality';
export class GetCopyQualityReportUseCase {
  constructor(private readonly catalog: ICopyQualityCatalogReader) {}
  async execute(input: { approvalStatus?: string; active?: boolean } = {}) {
    const products = await this.catalog.list(input); const duplicates = duplicateCopyIssues(products);
    const rows = products.map((product) => { const issues = [...evaluateProductCopy(product), ...(duplicates.get(product.id) ?? [])].sort((a,b) => a.code.localeCompare(b.code) || a.field.localeCompare(b.field)); return { product, status: issues.some((issue) => issue.severity === 'BLOCKER') ? 'BLOCKED' : issues.length ? 'REVIEW' : 'PASS', issues }; });
    return { policyVersion: COPY_QUALITY_POLICY_VERSION, generatedAt: new Date().toISOString(), modelChecks: { status: 'NOT_CONFIGURED' as const, providerCalls: 0 as const }, summary: { products: rows.length, pass: rows.filter((row) => row.status === 'PASS').length, review: rows.filter((row) => row.status === 'REVIEW').length, blocked: rows.filter((row) => row.status === 'BLOCKED').length, issues: rows.reduce((sum,row) => sum + row.issues.length, 0) }, rows };
  }
}
