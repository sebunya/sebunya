import { describe, expect, it, vi } from 'vitest';
import { createCipheriv, createDecipheriv, createECDH, createHmac, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { rememberable } from '../../apps/api/src/domain/assistant/AnswerMemory';
import { cleanTranscript } from '../../apps/api/src/domain/assistant/ChatTranscript';
import { redact } from '../../apps/api/src/domain/assistant/ConversationArchive';
import { encryptPayload, generateVapidKeys, vapidAuthorization } from '../../apps/api/src/infrastructure/assistant/WebPush';

vi.mock('../../apps/web/src/lib/api', () => ({ apiBase: 'http://api.test' }));

/**
 * Security boundaries of the Goldie module (owner, 2026-10-13: enterprise readiness, item 5). What an attacker
 * could try without credentials, and what must never survive into memory, emails or the archive.
 */
// Importing the routes loads the whole Registry: slow under a full parallel run, so these get room to start.
describe('endpoints without credentials', { timeout: 60_000 }, () => {
  it('the api internal routes answer 401 without the internal key', async () => {
    const routes = (await import('../../apps/api/src/interfaces/http/routes/internal/assistant')).default;
    for (const path of ['/context', '/log', '/care-task', '/care-by-phone', '/handover', '/transcript', '/memory/lookup', '/csat']) {
      const res = await routes.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(res.status, path).toBe(401);
    }
    const wrong = await routes.request('/care-by-phone', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goldplus-internal-key': 'not-the-key-not-the-key-not-the-key' }, body: '{"phone":"256772123456"}' });
    expect(wrong.status).toBe(401);
  });

  it('the Care Desk admin routes refuse a request with no session', async () => {
    const routes = (await import('../../apps/api/src/interfaces/http/routes/admin/care')).default;
    for (const [method, path] of [['GET', '/today'], ['GET', '/tasks'], ['POST', '/tasks'], ['PUT', '/team'], ['POST', '/team/test-alert'], ['PUT', '/push-subscriptions']] as const) {
      const res = await routes.request(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      expect([401, 403], `${method} ${path}`).toContain(res.status);
    }
  });

  it("the web's WhatsApp turn endpoint is invisible without the internal key", async () => {
    const prev = process.env.INTERNAL_API_KEY;
    process.env.INTERNAL_API_KEY = 'k'.repeat(40);
    const { POST } = await import('../../apps/web/src/pages/api/internal/goldie/turn');
    const call = (key?: string) => POST({ request: new Request('http://web/api/internal/goldie/turn', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-goldplus-internal-key': key } : {}) }, body: JSON.stringify({ channel: 'whatsapp', verifiedPhone: '256772123456', turns: [{ role: 'user', content: 'hi' }] }) }) } as never);
    expect((await call()).status).toBe(404);
    expect((await call('k'.repeat(39) + 'x')).status).toBe(404);
    process.env.INTERNAL_API_KEY = prev;
  });
});

describe('nothing an attacker plants survives', () => {
  it('memory never keeps an answer with an outside link', () => {
    expect(rememberable('The GoldPlus 20W is UGX 45,000. Details: https://shopgoldplus.com/products/gp-20w')).toBe(true);
    expect(rememberable('Buy it cheaper at https://evil.example/deal, UGX 10,000.')).toBe(false);
    expect(rememberable('Visit www.cheap-chargers.xyz for the same charger at half price today.')).toBe(false);
  });
  it('emailed and handed-over chats lose the links the customer typed', () => {
    const t = cleanTranscript([{ role: 'user', content: 'click https://phish.example/login and www.bad.xyz now' }, { role: 'assistant', content: 'ok' }])!;
    expect(t[0]!.content).not.toMatch(/phish|bad\.xyz/);
  });
  it('the archive never keeps cards, national ID numbers, PINs or OTPs', () => {
    const r = redact('card 4111 1111 1111 1111, NIN CM90012345ABCD, my PIN is 1234, OTP: 998877');
    expect(r).not.toMatch(/4111|CM90012345ABCD|1234\b|998877/);
  });
});

describe('Web Push is real cryptography', () => {
  const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  it('a browser holding the subscription keys can decrypt the alert (RFC 8291 round trip)', () => {
    const ua = createECDH('prime256v1'); ua.generateKeys();
    const auth = randomBytes(16);
    const body = encryptPayload(Buffer.from('{"title":"GoldPlus Care","body":"Urgent"}'), { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) });
    // Parse the aes128gcm header: salt(16) rs(4) idlen(1) keyid(idlen) ciphertext
    const salt = body.subarray(0, 16); const idlen = body[20]!; const asPublic = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen);
    const shared = ua.computeSecret(asPublic);
    const h = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
    const ikm = h(h(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
    const prk = h(salt, ikm);
    const cek = h(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
    const nonce = h(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
    const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    expect(plain.subarray(0, plain.length - 1).toString()).toBe('{"title":"GoldPlus Care","body":"Urgent"}');
    expect(plain[plain.length - 1]).toBe(2);
    void createCipheriv;
  });
  it('the VAPID token is a valid ES256 signature for the push service origin', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = privateKey.export({ format: 'jwk' }) as { d: string; x: string; y: string };
    const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey: b64u(pub), privateKey: jwk.d, contact: 'mailto:ops@example.com' });
    const token = header.match(/^vapid t=([^,]+), k=/)![1]!;
    const [h64, c64, s64] = token.split('.');
    expect(JSON.parse(Buffer.from(c64!, 'base64url').toString())).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:ops@example.com' });
    expect(verify('sha256', Buffer.from(`${h64}.${c64}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s64!, 'base64url'))).toBe(true);
  });
});

describe('push keys made by the api itself', () => {
  it('a generated pair signs a VAPID token the public key verifies', async () => {
    const { createPublicKey } = await import('node:crypto');
    const k = generateVapidKeys();
    const pub = Buffer.from(k.publicKey, 'base64url');
    expect(pub.length).toBe(65);
    const header = vapidAuthorization('https://web.push.apple.com/abc', { ...k, contact: 'mailto:ops@example.com' });
    const [h64, c64, s64] = header.match(/^vapid t=([^,]+), k=/)![1]!.split('.');
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h64}.${c64}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s64!, 'base64url'))).toBe(true);
    expect(generateVapidKeys().publicKey).not.toBe(k.publicKey);
  });
});

describe('WhatsApp alert template variable', () => {
  it('is one tidy line: no line breaks, tabs or long runs of spaces (Meta refuses those)', async () => {
    const { templateParam } = await import('../../apps/api/src/infrastructure/assistant/GoldieChannelAdapters');
    expect(templateParam('Order never came\n\tCustomer:      Sarah')).toBe('Order never came Customer: Sarah');
    expect(templateParam('x'.repeat(2000)).length).toBe(1000);
  });
});
