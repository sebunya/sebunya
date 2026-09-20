import { describe, expect, it } from 'vitest';
import {
  FULFILMENT_ALERT_CONFIG_REGISTRY,
  alertRecipient,
  isFulfilmentAlertConfigKey,
  normaliseUgandaMobile,
  validateFulfilmentAlertValue,
} from '../../apps/api/src/domain/fulfilment/FulfilmentAlertConfig';

describe('who gets told an order was paid', () => {
  it('accepts the forms a Ugandan number is actually typed in, and stores one shape', () => {
    for (const raw of ['0776004545', '+256776004545', '256776004545', '0776 004 545', '(0776) 004-545']) {
      expect(normaliseUgandaMobile(raw)).toEqual({ ok: true, value: '+256776004545' });
    }
  });

  it('refuses anything that is not a Ugandan mobile, with words a person can act on', () => {
    for (const raw of ['', '12345', '0776004', '+254776004545', 'not a phone', '0176004545']) {
      const r = normaliseUgandaMobile(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/Ugandan mobile number/);
    }
  });

  it('is a closed registry: an unknown key cannot be written', () => {
    expect(isFulfilmentAlertConfigKey('paid_order_sms_recipient')).toBe(true);
    expect(isFulfilmentAlertConfigKey('send_everything_to')).toBe(false);
    expect(validateFulfilmentAlertValue('send_everything_to', '0776004545').ok).toBe(false);
  });

  it('sends nothing until a number exists AND the alert is switched on', () => {
    expect(alertRecipient({})).toBeNull();
    expect(alertRecipient({ paid_order_sms_recipient: '+256776004545' })).toBeNull();
    expect(alertRecipient({ paid_order_sms_recipient: '+256776004545', paid_order_sms_enabled: 'false' })).toBeNull();
    expect(alertRecipient({ paid_order_sms_enabled: 'true' })).toBeNull();
    expect(alertRecipient({ paid_order_sms_recipient: '+256776004545', paid_order_sms_enabled: 'true' })).toBe('+256776004545');
  });

  it('every registry entry explains itself to the person editing it', () => {
    for (const e of FULFILMENT_ALERT_CONFIG_REGISTRY) {
      expect(e.label.length).toBeGreaterThan(8);
      expect(e.help).toMatch(/Unset means/);
    }
  });
});
