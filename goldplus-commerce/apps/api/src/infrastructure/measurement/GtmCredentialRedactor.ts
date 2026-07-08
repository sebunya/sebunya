export class GtmCredentialRedactor {
  redact(input: any): any {
    if (typeof input === 'string') {
      return this.redactString(input);
    }
    if (Array.isArray(input)) {
      return input.map(i => this.redact(i));
    }
    if (input !== null && typeof input === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(input)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('token') || 
          lowerKey.includes('secret') || 
          lowerKey === 'authorization'
        ) {
          result[key] = '***REDACTED***';
        } else {
          result[key] = this.redact(value);
        }
      }
      return result;
    }
    return input;
  }

  private redactString(input: string): string {
    const patterns = [
      /access_token=[^\s&]+/gi,
      /refresh_token=[^\s&]+/gi,
      /client_secret=[^\s&]+/gi,
      /Bearer\s+[^\s]+/gi,
      /GTM_API_CLIENT_SECRET=[^\s&]+/gi,
      /GTM_API_REFRESH_TOKEN=[^\s&]+/gi
    ];
    let output = input;
    for (const pattern of patterns) {
      output = output.replace(pattern, (match) => {
        const parts = match.split('=');
        if (parts.length > 1) return `${parts[0]}=***REDACTED***`;
        return 'Bearer ***REDACTED***';
      });
    }
    return output;
  }
}
