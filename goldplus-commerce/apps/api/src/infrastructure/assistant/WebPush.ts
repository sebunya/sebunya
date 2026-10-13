import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

/**
 * Web Push to staff phones (Care Desk alerts), with no dependency: VAPID (RFC 8292) signs who is sending,
 * and the message body is encrypted for the browser (RFC 8291, aes128gcm). Keys come from
 * CARE_PUSH_VAPID_PUBLIC_KEY / CARE_PUSH_VAPID_PRIVATE_KEY (base64url, as `npx web-push generate-vapid-keys`
 * or any P-256 generator prints them) and CARE_PUSH_CONTACT (mailto: or https: for the push service).
 */
export interface PushSubscriptionKeys { endpoint: string; p256dh: string; auth: string }
export interface VapidKeys { publicKey: string; privateKey: string; contact: string }

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** The VAPID Authorization header value for one push service origin (valid 12 hours). */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.contact })));
  const pub = unb64u(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID public key must be an uncompressed P-256 point');
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** Encrypt a payload for one subscription (RFC 8291, aes128gcm, a single record). Exported for the round-trip test. */
export function encryptPayload(payload: Buffer, sub: { p256dh: string; auth: string }, opts: { salt?: Buffer; serverKeys?: ReturnType<typeof createECDH> } = {}): Buffer {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const ecdh = opts.serverKeys ?? createECDH('prime256v1');
  if (!opts.serverKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Send one notification. 'gone' means the browser unsubscribed (404/410): the subscription should be deleted. */
export async function sendWebPush(sub: PushSubscriptionKeys, message: { title: string; body: string; url: string }, keys: VapidKeys, fetchImpl: typeof fetch = fetch): Promise<PushOutcome> {
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, keys),
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high',
      },
      body: new Uint8Array(encryptPayload(Buffer.from(JSON.stringify(message).slice(0, 3000)), sub)),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidKeys | null {
  const publicKey = (env.CARE_PUSH_VAPID_PUBLIC_KEY ?? '').trim(), privateKey = (env.CARE_PUSH_VAPID_PRIVATE_KEY ?? '').trim();
  const contact = (env.CARE_PUSH_CONTACT ?? '').trim() || 'mailto:support@shopgoldplus.com';
  return publicKey && privateKey ? { publicKey, privateKey, contact } : null;
}
