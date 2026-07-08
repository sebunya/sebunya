import * as crypto from 'crypto';

export class Sha256MeasurementHashingService {
  hashString(input: string): string {
    if (!input || input.trim() === '') return '';
    const normalized = input.trim().toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  hashPhone(phone: string): string {
    if (!phone) return '';
    // Strip non-digit characters
    const normalized = phone.replace(/\D/g, '');
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }
}
