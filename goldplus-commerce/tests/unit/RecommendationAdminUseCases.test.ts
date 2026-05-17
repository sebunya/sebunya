import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateRecommendationRuleUseCase, parseOptionalDate } from '../../apps/api/src/application/recommendations/CreateRecommendationRuleUseCase';
import { UpdateRecommendationRuleUseCase } from '../../apps/api/src/application/recommendations/UpdateRecommendationRuleUseCase';
import { ListRecommendationRulesUseCase } from '../../apps/api/src/application/recommendations/ListRecommendationRulesUseCase';
import { ChangeRecommendationRuleStatusUseCase } from '../../apps/api/src/application/recommendations/ChangeRecommendationRuleStatusUseCase';
import { ArchiveRecommendationRuleUseCase } from '../../apps/api/src/application/recommendations/ArchiveRecommendationRuleUseCase';
import { PreviewRecommendationRulesUseCase } from '../../apps/api/src/application/recommendations/PreviewRecommendationRulesUseCase';
import { GetRecommendationRuleUseCase } from '../../apps/api/src/application/recommendations/GetRecommendationRuleUseCase';
import { GetRecommendationRuleAuditLogUseCase } from '../../apps/api/src/application/recommendations/GetRecommendationRuleAuditLogUseCase';
import { RecommendationRuleValidationService } from '../../apps/api/src/application/recommendations/RecommendationRuleValidationService';
import { RecommendationRuleConflictService } from '../../apps/api/src/application/recommendations/RecommendationRuleConflictService';

describe('Recommendation Admin Use Cases', () => {
  let mockRepo: any;
  let mockAudit: any;
  const validator = new RecommendationRuleValidationService();
  const conflictService = new RecommendationRuleConflictService();

  describe('parseOptionalDate utility', () => {
    it('returns Date for ISO datetime string', () => {
      const parsed = parseOptionalDate('2026-06-01T00:00:00.000Z');
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });

    it('returns Date for simple YYYY-MM-DD string', () => {
      const parsed = parseOptionalDate('2026-06-01');
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString().startsWith('2026-06-01')).toBe(true);
    });

    it('returns undefined for undefined or "undefined"', () => {
      expect(parseOptionalDate(undefined)).toBeUndefined();
      expect(parseOptionalDate('undefined')).toBeUndefined();
    });

    it('returns null for null, "null", or empty string', () => {
      expect(parseOptionalDate(null)).toBeNull();
      expect(parseOptionalDate('null')).toBeNull();
      expect(parseOptionalDate('')).toBeNull();
    });

    it('returns same Date object if Date passed', () => {
      const d = new Date('2026-06-01T12:00:00Z');
      expect(parseOptionalDate(d)).toEqual(d);
    });
  });


  beforeEach(() => {
    mockRepo = {
      create: vi.fn((r) => Promise.resolve({ id: 'generated-123', ...r, createdAt: new Date() })),
      update: vi.fn((id, r) => Promise.resolve({ id, ...r })),
      findById: vi.fn(() => Promise.resolve(null)),
      findAdminRules: vi.fn(() => Promise.resolve([])),
      countAdminRules: vi.fn(() => Promise.resolve(0)),
      findActiveRulesForPlacement: vi.fn(() => Promise.resolve([])),
      changeStatus: vi.fn(() => Promise.resolve()),
    };
    mockAudit = {
      record: vi.fn(() => Promise.resolve()),
      findByRuleId: vi.fn(() => Promise.resolve([])),
    };
  });

  describe('CreateRecommendationRuleUseCase', () => {
    it('creates a valid BOOST rule and writes audit log', async () => {
      const uc = new CreateRecommendationRuleUseCase(mockRepo, mockAudit, validator, conflictService);
      const result = await uc.execute({
        rule: {
          name: 'Valid Rule',
          placement: 'home_trending',
          type: 'BOOST',
          status: 'DRAFT',
          priority: 100,
          targetType: 'GLOBAL',
          action: { type: 'BOOST', boostScore: 10 },
          conditions: {},
        },
        performedBy: 'admin-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
         expect(result.rule.name).toBe('Valid Rule');
      }
      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATED',
        performedBy: 'admin-1'
      }));
    });

    it('rejects a validation-invalid rule', async () => {
      const uc = new CreateRecommendationRuleUseCase(mockRepo, mockAudit, validator, conflictService);
      const result = await uc.execute({
        rule: { name: '' } as any, // missing mandatory fields
      });
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe('VALIDATION_FAILED');
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('blocks conflicting active PIN rule', async () => {
      const uc = new CreateRecommendationRuleUseCase(mockRepo, mockAudit, validator, conflictService);
      
      // Mock existing active rule that will conflict
      mockRepo.findActiveRulesForPlacement.mockResolvedValueOnce([
        {
           id: 'existing-pin',
           placement: 'home_trending',
           type: 'PIN',
           status: 'ACTIVE',
           priority: 100,
           action: { type: 'PIN', pinPosition: 1 }
        }
      ]);

      const result = await uc.execute({
        rule: {
          name: 'New Conflicting Pin',
          placement: 'home_trending',
          type: 'PIN',
          status: 'ACTIVE', // Activating this triggers conflict
          priority: 100,
          targetType: 'PRODUCT',
          targetValue: 'prod-xyz',
          action: { type: 'PIN', pinPosition: 1 },
          conditions: {},
        },
      });

      expect(result.ok).toBe(false);
      expect((result as any).code).toBe('CONFLICT_DETECTED');
    });
  });

  describe('ListRecommendationRulesUseCase', () => {
    it('passes page values directly to count and find', async () => {
      const uc = new ListRecommendationRulesUseCase(mockRepo);
      await uc.execute({ page: 2, pageSize: 5 });

      expect(mockRepo.findAdminRules).toHaveBeenCalledWith(expect.objectContaining({
        page: 2,
        pageSize: 5
      }));
      expect(mockRepo.countAdminRules).toHaveBeenCalled();
    });
  });

  describe('GetRecommendationRuleUseCase', () => {
    it('returns rule by id', async () => {
      const expected = { id: '123', name: 'T' };
      mockRepo.findById.mockResolvedValueOnce(expected);
      const uc = new GetRecommendationRuleUseCase(mockRepo);
      const result = await uc.execute('123');
      expect(result).toEqual(expected);
    });

    it('returns null for non-existent id', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const uc = new GetRecommendationRuleUseCase(mockRepo);
      const result = await uc.execute('non-exist');
      expect(result).toBeNull();
    });
  });

  describe('UpdateRecommendationRuleUseCase', () => {
    it('successfully updates and records before/after audit', async () => {
      const existing = { id: '123', name: 'Old Name', status: 'DRAFT', placement: 'home_trending', type: 'BOOST', targetType: 'GLOBAL', conditions: {}, action: { type: 'BOOST', boostScore: 5 } };
      mockRepo.findById.mockResolvedValueOnce(existing);
      
      const uc = new UpdateRecommendationRuleUseCase(mockRepo, mockAudit, validator, conflictService);
      const result = await uc.execute({
        id: '123',
        updates: { name: 'New Name' },
        performedBy: 'admin-99',
      });

      expect(result.ok).toBe(true);
      expect(mockRepo.update).toHaveBeenCalled();
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'UPDATED',
        before: existing,
        after: expect.objectContaining({ name: 'New Name' })
      }));
    });

    it('returns NOT_FOUND for missing ID', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const uc = new UpdateRecommendationRuleUseCase(mockRepo, mockAudit, validator, conflictService);
      const result = await uc.execute({ id: 'bad', updates: {} });
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe('NOT_FOUND');
    });
  });

  describe('ArchiveRecommendationRuleUseCase', () => {
    it('changes status and records archive action', async () => {
      mockRepo.findById.mockResolvedValueOnce({ id: 'rule-a', status: 'ACTIVE' });
      
      const uc = new ArchiveRecommendationRuleUseCase(mockRepo, mockAudit);
      const result = await uc.execute('rule-a', 'admin-u');
      
      expect(result.ok).toBe(true);
      expect(mockRepo.changeStatus).toHaveBeenCalledWith('rule-a', 'ARCHIVED');
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'ARCHIVED'
      }));
    });
  });

  describe('GetRecommendationRuleAuditLogUseCase', () => {
    it('fetches logs for a rule', async () => {
      const mockLogs = [{ action: 'CREATED', performedBy: 'x' }];
      mockAudit.findByRuleId.mockResolvedValueOnce(mockLogs);
      const uc = new GetRecommendationRuleAuditLogUseCase(mockAudit);
      const result = await uc.execute('rule-1');
      expect(result).toEqual(mockLogs);
    });
  });

  describe('PreviewRecommendationRulesUseCase', () => {
    it('returns validation failure on invalid draft rule', async () => {
       const uc = new PreviewRecommendationRulesUseCase(mockRepo, {} as any, {} as any, validator, {} as any, {} as any);
       const result = await uc.execute({
         placement: 'home_trending',
         draftRule: { name: '' } as any // trigger fail
       });
       expect(result.ok).toBe(false);
       expect((result as any).code).toBe('VALIDATION_FAILED');
    });

    it('performs dry run comparison with draft injection', async () => {
      const mockGenerator = {
        generateV1ScoredCandidates: vi.fn(() => Promise.resolve([
           { productId: 'p1', score: 50, reasonCodes: [] },
           { productId: 'p2', score: 40, reasonCodes: [] }
        ]))
      } as any;

      const mockRuleApplier = {
        apply: vi.fn((input) => Promise.resolve({
          candidates: input.candidates.map((c: any) => c.productId === 'p2' ? { ...c, score: 100 } : c), // Boost p2 artificially
          appliedRuleIds: ['draft_sim_123'],
          suppressedProductIds: [],
          pinnedProductIds: [],
          warnings: []
        }))
      } as any;

      const mockDedupe = { dedupe: vi.fn((x) => x) } as any;
      const mockDiversity = { diversify: vi.fn((x) => x) } as any;

      const uc = new PreviewRecommendationRulesUseCase(
        mockRepo, mockGenerator, mockRuleApplier, validator, mockDedupe, mockDiversity
      );

      const result = await uc.execute({
        placement: 'home_trending',
        draftRule: {
          name: 'Draft Boost',
          placement: 'home_trending',
          status: 'ACTIVE',
          priority: 100,
          targetType: 'GLOBAL',
          type: 'BOOST',
          conditions: {},
          action: { type: 'BOOST', boostScore: 60 }
        }
      });

      expect(result.ok).toBe(true);
      // Should correctly have executed injection without DB save
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockGenerator.generateV1ScoredCandidates).toHaveBeenCalled();
      expect(mockRuleApplier.apply).toHaveBeenCalledWith(expect.objectContaining({
        activeRulesOverride: expect.arrayContaining([
           expect.objectContaining({ name: "Draft Boost" })
        ])
      }));
    });
  });
});
