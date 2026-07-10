import { ActivationEvidenceRedactor } from '../../application/ports/activation/ActivationEvidenceRedactor.js';

export class DefaultActivationEvidenceRedactor implements ActivationEvidenceRedactor {
  redact(evidence: string): string {
    let redacted = evidence;
    
    // Auth & Secrets
    redacted = redacted.replace(/(Authorization:\s*Bearer\s+)[a-zA-Z0-9\-._~+/]+/ig, '$1[REDACTED]');
    redacted = redacted.replace(/(access_token=["'=]?)[a-zA-Z0-9\-._~+/]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(refresh_token=["'=]?)[a-zA-Z0-9\-._~+/]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(client_secret=["'=]?)[a-zA-Z0-9\-._~+/]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(PESAPAL_SECRET=["'=]?)[a-zA-Z0-9\-._~+/]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(PESAPAL_KEY=["'=]?)[a-zA-Z0-9\-._~+/]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(payment_token=["'=]?)[a-zA-Z0-9\-._~+/]+(["']?)/ig, '$1[REDACTED]$2');
    
    // PII (customerEmail, rawEmail, email)
    redacted = redacted.replace(/(customerEmail=["'=]?)[^"'\s&]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(rawEmail=["'=]?)[^"'\s&]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(email=["'=]?)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(["']?)/ig, '$1[REDACTED]$2');
    
    // PII (customerPhone, rawPhone, phone)
    redacted = redacted.replace(/(customerPhone=["'=]?)[^"'\s&]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(rawPhone=["'=]?)[^"'\s&]+(["']?)/ig, '$1[REDACTED]$2');
    redacted = redacted.replace(/(phone=["'=]?)\+?[0-9]{10,14}(["']?)/ig, '$1[REDACTED]$2');
    
    return redacted;
  }
}
