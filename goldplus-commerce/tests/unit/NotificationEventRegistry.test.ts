import { expect, test, describe } from 'vitest';
import { NotificationEventRegistry } from '../../apps/api/src/application/use-cases/notifications/NotificationEventRegistry';

describe('NotificationEventRegistry', () => {
  test('should return rule for ORDER_RECEIVED_UNPAID', () => {
    const rule = NotificationEventRegistry.getRule('ORDER_RECEIVED_UNPAID');
    expect(rule).not.toBeNull();
    expect(rule!.templateName).toBe('ORDER_RECEIVED_UNPAID');
    expect(rule!.eligibleChannels).toContain('email');
    expect(rule!.eligibleChannels).toContain('sms');
    expect(rule!.dryRunOnly).toBe(true);
  });

  test('should return rule for SUPPORT_HANDOFF', () => {
    const rule = NotificationEventRegistry.getRule('SUPPORT_HANDOFF');
    expect(rule).not.toBeNull();
    expect(rule!.templateName).toBe('SUPPORT_HANDOFF');
    expect(rule!.eligibleChannels).toContain('whatsapp_handoff');
    expect(rule!.dryRunOnly).toBe(false);
  });

  test('should return null for unregistered events', () => {
    const rule = NotificationEventRegistry.getRule('UNREGISTERED_EVENT');
    expect(rule).toBeNull();
  });

  test('should return all registered rules', () => {
    const rules = NotificationEventRegistry.getAllRules();
    expect(rules.length).toBe(8);
  });
});
