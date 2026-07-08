export class PreferenceRedactor {
  static redact(payload: any): any {
    if (!payload) return payload;
    if (typeof payload !== 'object') return payload;
    
    if (Array.isArray(payload)) {
      return payload.map(item => this.redact(item));
    }

    const result = { ...payload };
    const piiKeys = ['email', 'phone', 'customerEmail', 'customerPhone', 'rawEmail', 'rawPhone'];
    const secretKeys = ['Authorization', 'access_token', 'refresh_token', 'client_secret', 'payment_token', 'PESAPAL_CONSUMER_KEY', 'PESAPAL_CONSUMER_SECRET'];

    for (const key of Object.keys(result)) {
      // exact match or substring depending on strictness. The requirements say "redact email, phone..."
      // Let's do exact match or simple includes for safety
      const lowerKey = key.toLowerCase();
      if (piiKeys.some(k => lowerKey.includes(k.toLowerCase()))) {
        // Exception: if it's explicitly a hashed value, preserve it
        if (!lowerKey.includes('hashed')) {
          result[key] = '[REDACTED_PII]';
        }
      } else if (secretKeys.some(k => lowerKey.includes(k.toLowerCase()))) {
        result[key] = '[REDACTED_SECRET]';
      } else if (typeof result[key] === 'object') {
        result[key] = this.redact(result[key]);
      }
    }
    return result;
  }
}
