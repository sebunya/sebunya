import { describe, expect, it } from 'vitest';
import { canTransitionCampaign, validateUtm, CAMPAIGN_STATUSES } from '../../apps/api/src/application/use-cases/campaigns/CampaignScaffold';

/**
 * Wave 2F: the scaffold can never reach a sending state, transitions are governed,
 * and UTM parts are normalised to a safe charset.
 */
describe('campaign scaffold governance', () => {
  it('forbids every sending state with an honest message', () => {
    for (const to of ['ACTIVE', 'SENDING', 'LIVE', 'active']) {
      const d = canTransitionCampaign('APPROVED', to);
      expect(d).toMatchObject({ allowed: false, code: 'SEND_STATE_FORBIDDEN' });
    }
  });

  it('governs the non-send lifecycle', () => {
    expect(canTransitionCampaign('DRAFT', 'APPROVED')).toEqual({ allowed: true });
    expect(canTransitionCampaign('APPROVED', 'PAUSED')).toEqual({ allowed: true });
    expect(canTransitionCampaign('PAUSED', 'APPROVED')).toEqual({ allowed: true });
    expect(canTransitionCampaign('ARCHIVED', 'APPROVED')).toMatchObject({ allowed: false, code: 'ILLEGAL_TRANSITION' });
    expect(canTransitionCampaign('DRAFT', 'nonsense')).toMatchObject({ allowed: false, code: 'ILLEGAL_STATUS' });
    expect(CAMPAIGN_STATUSES).not.toContain('ACTIVE');
  });

  it('normalises UTM parts and refuses empties', () => {
    expect(validateUtm({ source: ' Face Book! ', medium: 'CPC', campaignName: 'Aug-Recovery_1' })).toEqual({
      ok: true, source: 'facebook', medium: 'cpc', campaignName: 'aug-recovery_1',
    });
    expect(validateUtm({ source: '!!!', medium: 'cpc', campaignName: 'x' })).toMatchObject({ ok: false });
  });
});
