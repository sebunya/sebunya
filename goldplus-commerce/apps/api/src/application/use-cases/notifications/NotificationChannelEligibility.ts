import { NotificationChannel } from './NotificationEventRegistry';

export interface ContactDetails {
  email?: string;
  phone?: string;
}

export interface EligibilityResult {
  isEligible: boolean;
  reason?: string;
  isDeferred?: boolean;
}

export class NotificationChannelEligibility {
  public static evaluate(
    channel: NotificationChannel,
    contact: ContactDetails
  ): EligibilityResult {
    switch (channel) {
      case 'email': {
        const email = (contact.email || '').trim();
        if (!email || !email.includes('@')) {
          return {
            isEligible: false,
            reason: 'Email address is missing or invalid.',
          };
        }
        return {
          isEligible: true,
          reason: 'Eligible for detailed email receipts and status updates (Preview-only in this pass).',
        };
      }

      case 'sms': {
        const phone = (contact.phone || '').trim();
        if (!phone) {
          return {
            isEligible: false,
            reason: 'Customer phone number is missing.',
          };
        }
        return {
          isEligible: true,
          reason: 'Eligible for short transactional SMS alerts only. No long order summaries (Preview-only in this pass).',
        };
      }

      case 'whatsapp_handoff': {
        return {
          isEligible: true,
          reason: 'Eligible for client-side support link handoff only (Target support number: 256705004545). No provider send.',
        };
      }

      case 'whatsapp_api_deferred': {
        return {
          isEligible: false,
          isDeferred: true,
          reason: 'WhatsApp Cloud API integration is deferred and blocked pending Meta setup and template verification.',
        };
      }

      default: {
        return {
          isEligible: false,
          reason: `Unknown notification channel: ${channel}`,
        };
      }
    }
  }
}
