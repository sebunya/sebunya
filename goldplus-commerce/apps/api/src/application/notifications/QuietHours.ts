/**
 * Africa/Kampala is UTC+3 year-round. Quiet hours: 21:00–08:00 local. No customer reminder is sent inside them:
 * campaigns first, and since 2026-10-22 the payment, review and card-expiry reminders too (the expiry text went out
 * between midnight and 01:00 every time, because a card's expiry is 23:59:59 Kampala). Each reminder's window is
 * wide enough that a held message simply goes at 08:00.
 */
export function isQuietHours(now: Date): boolean {
  const kampalaHour = (now.getUTCHours() + 3) % 24;
  return kampalaHour >= 21 || kampalaHour < 8;
}
