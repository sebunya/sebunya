import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emailCopy, smsText, whatsappText } from '../../apps/api/src/application/notifications/CustomerMessages';
import { EVALUABLE_MISSION_KINDS } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyGamificationUseCases';
import { ordinalWord } from '../../apps/web/src/lib/ordinalWord';
import { PROGRAMME_INTEGER_FIELDS } from '../../apps/web/src/lib/loyaltyProgrammeForm';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('points messages say what is true for that reward', () => {
  it('a completed mission is named, on every channel', () => {
    const d = { points: 300, missionTitle: 'Friends & Family' };
    expect(smsText('LOYALTY_POINTS_EARNED', d)).toMatch(/you completed Friends & Family and earned a bonus of 300 points/i);
    expect(whatsappText('LOYALTY_POINTS_EARNED', d)).toContain('Friends & Family');
    expect(emailCopy('LOYALTY_POINTS_EARNED', d)).toMatchObject({ subject: 'You completed Friends & Family' });
  });

  it('only order points are told they expire; referral and mission points never do', () => {
    expect(emailCopy('LOYALTY_POINTS_EARNED', { points: 500, orderId: 'o1' })!.body).toContain('expire');
    expect(emailCopy('LOYALTY_POINTS_EARNED', { points: 200 })!.body).not.toContain('expire');
    expect(emailCopy('LOYALTY_POINTS_EARNED', { points: 300, missionTitle: 'Five Deliveries' })!.body).not.toContain('expire');
  });
});

describe('a level change is always told, in its own words', () => {
  it('up is a welcome; down says why, on every channel, and never "welcomes"', () => {
    expect(smsText('LOYALTY_TIER_CHANGED', { tierName: 'Gold' })).toMatch(/you are now a Gold member/i);
    const down = { tierName: 'Member', direction: 'down' as const };
    expect(smsText('LOYALTY_TIER_CHANGED', down)).toMatch(/your membership level is now Member, because points from a refund or correction no longer count/i);
    expect(whatsappText('LOYALTY_TIER_CHANGED', down)).toContain('no longer count');
    const email = emailCopy('LOYALTY_TIER_CHANGED', down)!;
    expect(email.subject).toBe('Your membership level is now Member');
    expect(JSON.stringify(email)).not.toMatch(/welcome/i);
  });
});

describe('customers can get their invite link where the site sends them', () => {
  const card = read('apps/web/src/components/ReferralCard.astro');
  const rewards = read('apps/web/src/pages/account/rewards.astro');

  it('the rewards page carries the invite card at #refer, and every "refer" link lands on it', () => {
    expect(card).toContain('id="refer"');
    expect(card).toContain('SITE_ORIGIN');
    expect(rewards).toContain('/account/referral');
    expect(rewards).toContain('<ReferralCard');
    expect(read('apps/web/src/pages/account/loyalty.astro')).toContain('<ReferralCard');
    const nav = read('apps/web/src/components/GpNav.astro');
    expect(nav).toContain('<a href="/account/rewards#refer">Refer a friend');
    expect(nav).toContain("cta:'Get your link', href:'/account/rewards#refer'");
  });

  it('a paid mission stays complete even when today\'s progress no longer meets it', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleGamificationRepository.ts');
    expect(repo).toContain('paidKeys.has(`mission:${m.key}:${userId}`)');
    expect(rewards).toContain('m.completed ? 100 : pct(m.progress, m.threshold)');
  });
});

describe('missions can be run from admin', () => {
  const routes = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
  const page = read('apps/web/src/pages/admin/loyalty/gamification.astro');

  it('only kinds with a real data source can be created or activated', () => {
    expect([...EVALUABLE_MISSION_KINDS].sort()).toEqual(['PURCHASE_COUNT', 'REFERRAL_COUNT', 'STREAK_ORDERS', 'VERIFICATION_COUNT']);
    expect(routes).toContain("routes.patch('/gamification/missions/:id'");
    expect(routes).toContain("code: 'NOT_EVALUABLE'");
    expect(routes).toContain("action: 'GAMIFICATION_MISSION_UPDATED'");
    for (const kind of EVALUABLE_MISSION_KINDS) expect(page).toContain(`value="${kind}"`);
    expect(page).not.toMatch(/value="(REVIEW_COUNT|STREAK_DAYS)"/);
  });

  it('the page can set status, threshold and reward points, and creates with points and a description', () => {
    expect(page).toContain('method: "PATCH"');
    expect(page).toMatch(/name="status"/);
    expect(page.match(/name="rewardPoints"/g)?.length).toBe(2);
    expect(page).toMatch(/name="description"/);
  });

  it('the programme form no longer offers streak settings that pay nothing', () => {
    const keys = PROGRAMME_INTEGER_FIELDS.map((f) => f.key);
    expect(keys).not.toContain('streakTargetOrders');
    expect(keys).not.toContain('streakRewardPoints');
    expect(keys).toContain('streakWindowDays');
  });
});

describe('the public pages advertise what the missions actually pay', () => {
  it('streak and referral bonus come from the active missions, not loyalty_config', () => {
    const route = read('apps/api/src/interfaces/http/routes/commerce.ts');
    expect(route).toContain("missions.find((m) => m.kind === 'STREAK_ORDERS')");
    expect(route).toContain("missions.find((m) => m.kind === 'REFERRAL_COUNT')");
    expect(route).not.toContain('programme.streakRewardPoints');
  });

  it('ordinals read as words', () => {
    expect([1, 2, 3, 10].map(ordinalWord)).toEqual(['first', 'second', 'third', 'tenth']);
    expect([11, 12, 13, 21, 22, 23, 101].map(ordinalWord)).toEqual(['11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
  });
});
