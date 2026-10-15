/**
 * A WhatsApp location pin becomes a delivery point for an order (address
 * system spec §5.1, §5.2 as corrected by the review board).
 *
 * Runs BEFORE the assistant composes anything: the model never sees a
 * coordinate, a map link or Meta's address string. The customer confirms
 * "deliver here" before a pin is stored; a saved address gets the pin only
 * after a second explicit tap. A rider's phone is a handover, not a customer
 * pin. Contract #5: an order's quote never changes because a pin arrived;
 * the pin improves the rider card, the capture's accuracy tier and the
 * learning loop. Every reply is deterministic copy from the delivery registry.
 */
import {
  ReplyButton,
  buttonTitle,
  parsePinButton,
  pinButton,
  pinDisagreementKm,
  pinSanity,
  purgeDate,
  MAX_REPLY_BUTTONS,
} from '../../../domain/delivery/DeliveryPins';

export interface OpenOrderForPin {
  id: string;
  orderNumber: string;
  areaSlug: string | null;
  areaLabel: string | null;
  customerId: string | null;
  createdAt: Date;
}

export interface PendingLocation {
  wamid: string;
  phoneE164: string;
  lat: number;
  lng: number;
  forwarded: boolean;
  candidateOrderIds: string[];
  riderId: string | null;
  expiresAt: Date;
}

export interface RiderForPin {
  id: string;
  name: string;
}

export interface OpenStopForRider {
  taskId: string;
  orderId: string;
  orderNumber: string;
  areaSlug: string | null;
  areaLabel: string | null;
  attemptsSoFar: number;
}

export interface ILocationPinRepository {
  openOrdersForPhone(phoneE164: string, since: Date): Promise<OpenOrderForPin[]>;
  areaPoint(areaSlug: string): Promise<{ lat: number; lng: number; expectedErrorM: number | null } | null>;
  activeOrigin(): Promise<{ lat: number; lng: number } | null>;
  savePending(p: PendingLocation): Promise<void>;
  pending(wamid: string): Promise<PendingLocation | null>;
  attachPin(p: { orderId: string; lat: number; lng: number; source: 'whatsapp' | 'rider'; sourceRef: string; confirmedAt: Date | null; purgeAfter: Date }): Promise<void>;
  /** The capture row's accuracy tier and point source; nothing about the fee. */
  markCapturePinned(orderId: string, pointSource: 'whatsapp' | 'rider'): Promise<void>;
  /** Writes the order's pin to the customer's saved address for that area; says why when it cannot. */
  savePinToAddress(orderId: string): Promise<'saved' | 'no_address' | 'no_customer' | 'no_pin'>;
  riderByPhone(phoneE164: string): Promise<RiderForPin | null>;
  openStopsForRider(riderId: string): Promise<OpenStopForRider[]>;
  copy(key: string): Promise<string | null>;
  retentionDays(): Promise<number>;
  /** A pin that disagrees with the chosen area by more than the threshold: a person looks, nothing is re-priced. */
  flagDisagreement(input: { orderId: string; orderNumber: string; km: number }): Promise<void>;
}

export interface IHandoverRecorder {
  record(input: {
    taskId: string;
    actorId: string;
    outcome: 'delivered' | 'absent' | 'notfound';
    point: { lat: number; lng: number } | null;
  }): Promise<{ ok: boolean; message?: string }>;
  setFindDifficulty(taskId: string, difficulty: 'easy' | 'hard'): Promise<void>;
}

export interface PinReply {
  text: string;
  buttons?: ReplyButton[];
}

export type LocationOutcome =
  | 'rejected'
  | 'no_order'
  | 'asked_confirm'
  | 'asked_which'
  | 'too_many'
  | 'rider_asked'
  | 'rider_which_stop'
  | 'rider_no_stop';

export type ButtonOutcome =
  | 'not_a_pin_button'
  | 'expired'
  | 'wrong_phone'
  | 'attached'
  | 'declined'
  | 'saved'
  | 'not_saved'
  | 'save_failed'
  | 'handover_recorded'
  | 'handover_failed'
  | 'difficulty_recorded'
  | 'asked_confirm'
  | 'rider_asked';

export const PIN_COPY_DEFAULTS: Record<string, string> = {
  copy_pin_rejected: "That pin doesn't look like a delivery address. Type the area or a landmark instead and we will take it from there.",
  copy_pin_no_order: "Thanks. We don't see an open order for this number, so we have not kept the pin. Place your order on shopgoldplus.com, then send the pin again.",
  copy_pin_confirm: 'Is this where we deliver order {{order}}?',
  copy_pin_which_order: 'Which order is this pin for?',
  copy_pin_too_many: 'You have several open orders. Reply with the order number (like GP-1234) and then send the pin again.',
  copy_pin_received: 'Thanks. We have your location for order {{order}}. The rider will use it when leaving.',
  copy_pin_declined: "No problem, we have not kept that pin. Send the location of the place we should deliver to, or type the area and a landmark.",
  copy_pin_save_ask: 'Save this spot to your address for next time?',
  copy_pin_saved: 'Saved. Remove it any time under Account, Addresses.',
  copy_pin_not_saved: 'Not saved. We will use it for this order only.',
  copy_pin_save_failed: 'We could not save it to an address, but we have it for this order.',
  copy_pin_expired: 'That question has expired. Send the location again and we will ask once more.',
  copy_pin_disagrees: 'Note: this pin is some way from {{area}}. Our team will check with you before dispatch.',
  copy_handover_prompt: 'Order {{order}} at {{area}}. How did it go?',
  copy_handover_which_stop: 'Which stop is this?',
  copy_handover_no_stop: "You have no stops out for delivery right now. Call the office if that's wrong.",
  copy_handover_recorded: 'Recorded: {{outcome}} for {{order}}. Was it easy to find?',
  copy_handover_failed: 'Could not record that: {{message}}. Call the office.',
  copy_handover_difficulty_recorded: 'Noted. Thanks.',
};

const PENDING_HOURS = 24;
const DISAGREE_KM = 5;
const ORDER_WINDOW_DAYS = 14;

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

export class LocationPinUseCases {
  constructor(
    private readonly repo: ILocationPinRepository,
    private readonly handover: IHandoverRecorder | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async say(key: string, vars: Record<string, string> = {}): Promise<string> {
    const custom = await this.repo.copy(key).catch(() => null);
    return fill(custom?.trim() || PIN_COPY_DEFAULTS[key] || '', vars);
  }

  /** A `location` message from a customer or a rider. */
  async handleLocation(input: {
    fromDigits: string;
    wamid: string;
    lat: number;
    lng: number;
    forwarded: boolean;
    at?: Date;
  }): Promise<{ reply: PinReply; outcome: LocationOutcome }> {
    const at = input.at ?? this.now();
    const phone = `+${input.fromDigits}`;
    const point = { lat: input.lat, lng: input.lng };
    const origin = await this.repo.activeOrigin();
    if (pinSanity(point, origin) !== null) return { reply: { text: await this.say('copy_pin_rejected') }, outcome: 'rejected' };

    const rider = await this.repo.riderByPhone(phone);
    if (rider) return this.riderLocation(rider, input.wamid, phone, point, at);

    const since = new Date(at.getTime() - ORDER_WINDOW_DAYS * 86_400_000);
    const orders = await this.repo.openOrdersForPhone(phone, since);
    if (orders.length === 0) return { reply: { text: await this.say('copy_pin_no_order') }, outcome: 'no_order' };

    const expiresAt = new Date(at.getTime() + PENDING_HOURS * 3_600_000);
    await this.repo.savePending({
      wamid: input.wamid, phoneE164: phone, lat: point.lat, lng: point.lng, forwarded: input.forwarded,
      candidateOrderIds: orders.map((o) => o.id), riderId: null, expiresAt,
    });
    if (orders.length === 1) {
      return { reply: await this.confirmPrompt(input.wamid, orders[0]), outcome: 'asked_confirm' };
    }
    if (orders.length > MAX_REPLY_BUTTONS) return { reply: { text: await this.say('copy_pin_too_many') }, outcome: 'too_many' };
    return {
      reply: {
        text: await this.say('copy_pin_which_order'),
        buttons: orders.map((o) => ({ id: pinButton.whichOrder(input.wamid, o.id), title: buttonTitle(o.orderNumber) })),
      },
      outcome: 'asked_which',
    };
  }

  private async confirmPrompt(wamid: string, order: OpenOrderForPin): Promise<PinReply> {
    return {
      text: await this.say('copy_pin_confirm', { order: order.orderNumber, area: order.areaLabel ?? '' }),
      buttons: [
        { id: pinButton.confirm(wamid, order.id, true), title: 'Yes, deliver here' },
        { id: pinButton.confirm(wamid, order.id, false), title: "No, it's elsewhere" },
      ],
    };
  }

  private async riderLocation(
    rider: RiderForPin,
    wamid: string,
    phone: string,
    point: { lat: number; lng: number },
    at: Date,
  ): Promise<{ reply: PinReply; outcome: LocationOutcome }> {
    const stops = await this.repo.openStopsForRider(rider.id);
    if (stops.length === 0) return { reply: { text: await this.say('copy_handover_no_stop') }, outcome: 'rider_no_stop' };
    await this.repo.savePending({
      wamid, phoneE164: phone, lat: point.lat, lng: point.lng, forwarded: false,
      candidateOrderIds: stops.map((s) => s.orderId), riderId: rider.id, expiresAt: new Date(at.getTime() + 2 * 3_600_000),
    });
    if (stops.length === 1) return { reply: await this.handoverPrompt(wamid, stops[0]), outcome: 'rider_asked' };
    return {
      reply: {
        text: await this.say('copy_handover_which_stop'),
        buttons: stops.slice(0, MAX_REPLY_BUTTONS).map((s) => ({ id: pinButton.whichStop(wamid, s.taskId), title: buttonTitle(s.orderNumber) })),
      },
      outcome: 'rider_which_stop',
    };
  }

  private async handoverPrompt(wamid: string, stop: OpenStopForRider): Promise<PinReply> {
    return {
      text: await this.say('copy_handover_prompt', { order: stop.orderNumber, area: stop.areaLabel ?? '' }),
      buttons: [
        { id: pinButton.handover(wamid, stop.taskId, 'delivered'), title: 'Delivered' },
        { id: pinButton.handover(wamid, stop.taskId, 'absent'), title: 'Customer not there' },
        { id: pinButton.handover(wamid, stop.taskId, 'notfound'), title: "Couldn't find it" },
      ],
    };
  }

  /** A reply-button tap. Only an id that parses is an answer; a typed word never is. */
  async handleButton(input: { fromDigits: string; buttonId: string; at?: Date }): Promise<{ reply: PinReply | null; outcome: ButtonOutcome }> {
    const at = input.at ?? this.now();
    const phone = `+${input.fromDigits}`;
    const parsed = parsePinButton(input.buttonId);
    if (!parsed) return { reply: null, outcome: 'not_a_pin_button' };

    if (parsed.kind === 'save') {
      if (!parsed.yes) return { reply: { text: await this.say('copy_pin_not_saved') }, outcome: 'not_saved' };
      const r = await this.repo.savePinToAddress(parsed.orderId);
      return r === 'saved'
        ? { reply: { text: await this.say('copy_pin_saved') }, outcome: 'saved' }
        : { reply: { text: await this.say('copy_pin_save_failed') }, outcome: 'save_failed' };
    }
    if (parsed.kind === 'find_difficulty') {
      await this.handover?.setFindDifficulty(parsed.taskId, parsed.difficulty);
      return { reply: { text: await this.say('copy_handover_difficulty_recorded') }, outcome: 'difficulty_recorded' };
    }

    const pending = await this.repo.pending(parsed.wamid);
    if (!pending || pending.expiresAt.getTime() < at.getTime()) return { reply: { text: await this.say('copy_pin_expired') }, outcome: 'expired' };
    if (pending.phoneE164 !== phone) return { reply: null, outcome: 'wrong_phone' };

    if (parsed.kind === 'which_order') {
      if (!pending.candidateOrderIds.includes(parsed.orderId)) return { reply: null, outcome: 'wrong_phone' };
      const since = new Date(at.getTime() - ORDER_WINDOW_DAYS * 86_400_000);
      const order = (await this.repo.openOrdersForPhone(phone, since)).find((o) => o.id === parsed.orderId);
      if (!order) return { reply: { text: await this.say('copy_pin_expired') }, outcome: 'expired' };
      return { reply: await this.confirmPrompt(parsed.wamid, order), outcome: 'asked_confirm' };
    }

    if (parsed.kind === 'confirm') {
      if (!pending.candidateOrderIds.includes(parsed.orderId)) return { reply: null, outcome: 'wrong_phone' };
      if (!parsed.yes) return { reply: { text: await this.say('copy_pin_declined') }, outcome: 'declined' };
      const since = new Date(at.getTime() - ORDER_WINDOW_DAYS * 86_400_000);
      const order = (await this.repo.openOrdersForPhone(phone, since)).find((o) => o.id === parsed.orderId);
      if (!order) return { reply: { text: await this.say('copy_pin_expired') }, outcome: 'expired' };
      const retention = await this.repo.retentionDays();
      await this.repo.attachPin({
        orderId: order.id, lat: pending.lat, lng: pending.lng, source: 'whatsapp', sourceRef: pending.wamid,
        confirmedAt: at, purgeAfter: purgeDate(at, retention),
      });
      await this.repo.markCapturePinned(order.id, 'whatsapp');
      let text = await this.say('copy_pin_received', { order: order.orderNumber });
      if (order.areaSlug) {
        const areaPoint = await this.repo.areaPoint(order.areaSlug);
        const km = pinDisagreementKm({ lat: pending.lat, lng: pending.lng }, areaPoint);
        if (km !== null && km > DISAGREE_KM) {
          await this.repo.flagDisagreement({ orderId: order.id, orderNumber: order.orderNumber, km });
          text += `\n${await this.say('copy_pin_disagrees', { area: order.areaLabel ?? 'your area' })}`;
        }
      }
      if (order.customerId && order.areaSlug) {
        return {
          reply: {
            text: `${text}\n\n${await this.say('copy_pin_save_ask')}`,
            buttons: [
              { id: pinButton.save(order.id, true), title: 'Save for next time' },
              { id: pinButton.save(order.id, false), title: "Don't save" },
            ],
          },
          outcome: 'attached',
        };
      }
      return { reply: { text }, outcome: 'attached' };
    }

    // Rider route from here: the pending row must be the rider's own.
    if (!pending.riderId) return { reply: null, outcome: 'wrong_phone' };
    const rider = await this.repo.riderByPhone(phone);
    if (!rider || rider.id !== pending.riderId) return { reply: null, outcome: 'wrong_phone' };
    const stops = await this.repo.openStopsForRider(rider.id);

    if (parsed.kind === 'which_stop') {
      const stop = stops.find((s) => s.taskId === parsed.taskId);
      if (!stop) return { reply: { text: await this.say('copy_handover_no_stop') }, outcome: 'expired' };
      return { reply: await this.handoverPrompt(parsed.wamid, stop), outcome: 'rider_asked' };
    }
    if (parsed.kind === 'handover') {
      const stop = stops.find((s) => s.taskId === parsed.taskId);
      if (!stop) return { reply: { text: await this.say('copy_handover_no_stop') }, outcome: 'expired' };
      if (!this.handover) return { reply: { text: await this.say('copy_handover_failed', { message: 'not wired' }) }, outcome: 'handover_failed' };
      const point = { lat: pending.lat, lng: pending.lng };
      const r = await this.handover.record({ taskId: stop.taskId, actorId: `rider_whatsapp:${rider.id}`, outcome: parsed.outcome, point });
      if (!r.ok) return { reply: { text: await this.say('copy_handover_failed', { message: r.message ?? 'refused' }) }, outcome: 'handover_failed' };
      if (parsed.outcome === 'delivered') {
        const retention = await this.repo.retentionDays();
        await this.repo.attachPin({ orderId: stop.orderId, ...point, source: 'rider', sourceRef: pending.wamid, confirmedAt: at, purgeAfter: purgeDate(at, retention) });
        await this.repo.markCapturePinned(stop.orderId, 'rider');
      }
      const outcomeWord = parsed.outcome === 'delivered' ? 'delivered' : parsed.outcome === 'absent' ? 'customer not there' : 'could not find it';
      return {
        reply: {
          text: await this.say('copy_handover_recorded', { outcome: outcomeWord, order: stop.orderNumber }),
          buttons: [
            { id: pinButton.findDifficulty(stop.taskId, 'easy'), title: 'Easy to find' },
            { id: pinButton.findDifficulty(stop.taskId, 'hard'), title: 'Hard to find' },
          ],
        },
        outcome: 'handover_recorded',
      };
    }
    return { reply: null, outcome: 'not_a_pin_button' };
  }
}
