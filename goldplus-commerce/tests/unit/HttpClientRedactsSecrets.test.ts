import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../apps/api/src/infrastructure/http/HttpClient';

describe('outbound error messages never carry credentials into logs', () => {
  it('masks secret-looking env values and bearer/Zoho key headers', () => {
    process.env.ZOHO_WHATSAPP_API_KEY = 'zk_live_abcdef123456';
    const msg = 'fetch failed for https://x/?k=zk_live_abcdef123456 Authorization: Bearer abc.def-123 Zoho-enczapikey QWERTY123456';
    const out = redactSecrets(msg);
    expect(out).not.toContain('zk_live_abcdef123456');
    expect(out).not.toContain('abc.def-123');
    expect(out).not.toContain('QWERTY123456');
    expect(redactSecrets(undefined)).toBe('');
  });
});
