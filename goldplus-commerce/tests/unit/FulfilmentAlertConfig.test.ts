import { describe, expect, it } from 'vitest';
import {
  FULFILMENT_ALERT_CONFIG_REGISTRY,
  alertRecipient,
  alertRecipients,
  normaliseRecipientList,
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

  it('takes a whole list, however it is separated, and collapses duplicates', () => {
    const r = normaliseRecipientList('0776004545, 0705770907\n0757033668;0701053486 , +256757212246, 0701377899, 0776004545');
    expect(r).toEqual({
      ok: true,
      value: '+256776004545,+256705770907,+256757033668,+256701053486,+256757212246,+256701377899',
    });
  });

  it('fails the whole save on one bad number rather than dropping it quietly', () => {
    const r = normaliseRecipientList('0776004545, 0999999999');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('0999999999');
  });

  it('refuses a list too long for anyone to act on', () => {
    const many = Array.from({ length: 11 }, (_, i) => `07050000${String(i).padStart(2, '0')}`).join(',');
    expect(normaliseRecipientList(many).ok).toBe(false);
  });

  it('gives every saved number its own alert', () => {
    expect(alertRecipients({ paid_order_sms_recipient: '+256776004545,+256705770907', paid_order_sms_enabled: 'true' }))
      .toEqual(['+256776004545', '+256705770907']);
    expect(alertRecipients({ paid_order_sms_recipient: '+256776004545', paid_order_sms_enabled: 'false' })).toEqual([]);
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
