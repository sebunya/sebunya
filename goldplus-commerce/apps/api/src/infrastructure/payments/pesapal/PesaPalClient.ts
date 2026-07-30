import { Config } from '../../../config/env';
import { resilientFetch } from '../../http/HttpClient';
import {
  IPesaPalClient,
  PesaPalBillingAddress,
  PesaPalSubmitOrderInput,
  PesaPalSubmitOrderResponse,
  PesaPalTransactionStatusResponse,
} from '../../../application/ports/IPesaPalClient';

export class PesaPalClient implements IPesaPalClient {
  private config: Config;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: Config) {
    this.config = config;
  }

  private isLive(): boolean {
    return this.config.pesapalEnv === 'live' || this.config.pesapalEnv === 'production';
  }

  /**
   * The provider endpoint.
   *
   * `PESAPAL_BASE_URL` was read into config but never used, so an end-to-end test
   * had no way to exercise this client without calling PesaPal's real sandbox — the
   * reason the checkout journey had component tests and no journey test.
   *
   * The override is IGNORED IN LIVE MODE, unconditionally. An environment variable
   * that can redirect live payment traffic to an arbitrary host is a payment
   * redirection primitive, so live mode does not consult it at all rather than
   * validating it: there is no value it could hold that would be correct.
   */
  private getBaseUrl(): string {
    if (this.isLive()) return 'https://pay.pesapal.com/v3';

    const override = (this.config.pesapalBaseUrl || '').trim().replace(/\/+$/, '');
    if (override) {
      try {
        const parsed = new URL(override);
        // http is permitted here only because this branch cannot be reached in live
        // mode, and a local stub has no certificate.
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return override;
      } catch {
        // An unparseable override falls through to the sandbox rather than being
        // used as a bare string, which would produce a confusing fetch error.
      }
    }
    return 'https://cybqa.pesapal.com/pesapalv3';
  }

  public async requestToken(): Promise<string> {
    const consumerKey = this.config.pesapalConsumerKey;
    const consumerSecret = this.config.pesapalConsumerSecret;

    if (!consumerKey || !consumerSecret) {
      throw new Error('PESAPAL_CREDENTIALS_MISSING: PesaPal Consumer Key or Consumer Secret is not configured.');
    }

    const url = `${this.getBaseUrl()}/api/Auth/RequestToken`;
    
    const response = await resilientFetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        consumer_key: consumerKey,
        consumer_secret: consumerSecret,
      }),
      breakerName: 'pesapal',
      timeoutMs: 3000,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No details');
      throw new Error(`PESAPAL_AUTH_FAILED: Failed to authenticate with PesaPal. Status ${response.status}: ${errorText}`);
    }

    const data = await response.json() as { token: string; expiryDate?: string };
    if (!data.token) {
      throw new Error('PESAPAL_AUTH_FAILED: Authentication response did not return a valid token.');
    }

    this.cachedToken = data.token;
    
    // Set expiry in-memory (PesaPal tokens are typically short-lived; we buffer with 5 minutes safety window)
    const bufferMs = 5 * 60 * 1000;
    const expiryTime = data.expiryDate ? new Date(data.expiryDate).getTime() : Date.now() + 15 * 60 * 1000;
    this.tokenExpiresAt = expiryTime - bufferMs;

    return data.token;
  }

  public async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiresAt) {
      return this.cachedToken;
    }
    return this.requestToken();
  }

  private validateLiveUrls(callbackUrl: string, cancellationUrl: string): void {
    if (!this.isLive()) return;

    const urls = [callbackUrl, cancellationUrl];
    for (const urlStr of urls) {
      if (!urlStr) continue;
      try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'https:') {
          throw new Error(`PESAPAL_LIVE_GUARD_VIOLATION: Live mode callback URL "${urlStr}" must use HTTPS.`);
        }
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('cybqa.pesapal.com')) {
          throw new Error(`PESAPAL_LIVE_GUARD_VIOLATION: Live mode callback URL "${urlStr}" cannot point to localhost or staging environments.`);
        }
      } catch (err: any) {
        if (err.message.includes('PESAPAL_LIVE_GUARD_VIOLATION')) {
          throw err;
        }
        throw new Error(`PESAPAL_INVALID_URL: Failed to parse callback URL "${urlStr}". Details: ${err.message}`);
      }
    }
  }

  public async submitOrderRequest(input: PesaPalSubmitOrderInput): Promise<PesaPalSubmitOrderResponse> {
    this.validateLiveUrls(input.callback_url, input.cancellation_url);
    const token = await this.getToken();
    const url = `${this.getBaseUrl()}/api/Transactions/SubmitOrderRequest`;

    const bodyPayload = {
      id: input.id,
      currency: input.currency,
      amount: input.amount,
      description: input.description,
      callback_url: input.callback_url,
      cancellation_url: input.cancellation_url,
      notification_id: input.notification_id,
      redirect_mode: this.config.pesapalRedirectMode || 'TOP_WINDOW',
      branch: this.config.pesapalBranch || 'GoldPlus Online Store',
      billing_address: {
        email_address: input.billing_address.email_address,
        phone_number: input.billing_address.phone_number,
        first_name: input.billing_address.first_name,
        last_name: input.billing_address.last_name,
      },
    };

    const response = await resilientFetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(bodyPayload),
      breakerName: 'pesapal',
      timeoutMs: 3000,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => 'No details');
      throw new Error(`PESAPAL_SUBMIT_FAILED: PesaPal order submission failed. Status ${response.status}: ${errBody}`);
    }

    const data = await response.json() as PesaPalSubmitOrderResponse;
    if (!data.order_tracking_id || !data.redirect_url) {
      throw new Error('PESAPAL_SUBMIT_FAILED: Order submission response lacked critical tracking ID or redirect URL.');
    }

    return data;
  }

  public async getTransactionStatus(orderTrackingId: string): Promise<PesaPalTransactionStatusResponse> {
    const token = await this.getToken();
    const url = `${this.getBaseUrl()}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`;

    const response = await resilientFetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      breakerName: 'pesapal',
      timeoutMs: 3000,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => 'No details');
      throw new Error(`PESAPAL_STATUS_FAILED: PesaPal transaction lookup failed. Status ${response.status}: ${errBody}`);
    }

    const data = await response.json() as any;
    
    // PesaPal JSON API 3.0 response fields mapping
    return {
      order_tracking_id: data.order_tracking_id ?? orderTrackingId,
      merchant_reference: data.merchant_reference,
      amount: Number(data.amount),
      currency: data.currency,
      status_code: Number(data.status_code),
      payment_status_description: data.payment_status_description ?? '',
      payment_method: data.payment_method,
      confirmation_code: data.confirmation_code,
      payment_account: data.payment_account,
    };
  }

  public toJSON(): object {
    return {
      pesapalEnv: this.config.pesapalEnv,
      pesapalBaseUrl: this.getBaseUrl(),
      pesapalConsumerKey: this.config.pesapalConsumerKey ? 'PRESENT' : 'MISSING',
      pesapalConsumerSecret: this.config.pesapalConsumerSecret ? 'PRESENT' : 'MISSING',
      cachedToken: this.cachedToken ? '[REDACTED]' : null,
      tokenExpiresAt: this.tokenExpiresAt,
    };
  }
}

