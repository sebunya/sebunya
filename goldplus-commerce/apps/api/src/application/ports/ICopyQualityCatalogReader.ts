import { CopyQualityProduct } from '../../domain/copy-quality/CopyQuality';
export interface ICopyQualityCatalogReader { list(input: { approvalStatus?: string; active?: boolean }): Promise<CopyQualityProduct[]>; }
