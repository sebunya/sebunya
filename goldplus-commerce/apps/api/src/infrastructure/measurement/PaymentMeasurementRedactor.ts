// Redacts sensitive PII and secrets
export class PaymentMeasurementRedactor {
  redact(payload: any): any {
    if (!payload) return payload;
    
    let stringified = '';
    try {
      stringified = JSON.stringify(payload);
    } catch {
      return { redacted: true };
    }

    const parsed = JSON.parse(stringified);
    
    const redactedKeys = [
      'email', 'phone', 'customerEmail', 'customerPhone', 
      'access_token', 'refresh_token', 'client_secret', 'Authorization',
      'password', 'secret', 'key'
    ];

    const deepRedact = (obj: any) => {
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          deepRedact(obj[key]);
        } else if (redactedKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
          // Allow hashed keys
          if (!key.toLowerCase().includes('hash')) {
            obj[key] = '[REDACTED]';
          }
        }
      }
    };

    deepRedact(parsed);
    return parsed;
  }
}
