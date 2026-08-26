export interface EmailAttachment {
  filename: string;
  content?: string; // Base64 string
  url?: string;     // Remote resource URL
  content_type?: string;
  content_id?: string;
}

export interface EmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  template?: string;
  variables?: Record<string, any>;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  meta?: Record<string, string>;
  idempotencyKey?: string;
}

export interface DispatchResult {
  success: boolean;
  provider: 'emailit' | 'resend';
  messageId: string;
  rawResponse: any;
}

export interface EmailItTelemetry {
  rateLimitRemaining: number;
  dailyRemaining: number;
  dailyResetSeconds: number;
}

export class EmailDispatchManager {
  private emailitApiKey: string;
  private resendApiKey: string;
  private primaryBaseUrl = 'https://api.emailit.com/v2';
  private secondaryBaseUrl = 'https://api.resend.com';

  private isCircuitOpen = false;
  private circuitCooldownUntil = 0;
  private latestTelemetry: EmailItTelemetry | null = null;

  constructor(emailitApiKey: string, resendApiKey: string) {
    this.emailitApiKey = emailitApiKey;
    this.resendApiKey = resendApiKey;
  }

  /**
   * Main send call: Routes to primary or secondary provider based on system health
   */
  public async send(options: EmailOptions): Promise<DispatchResult> {
    const now = Date.now();

    if (this.isCircuitOpen) {
      if (now > this.circuitCooldownUntil) {
        this.isCircuitOpen = false;
      } else {
        return this.sendViaResend(options, 'Circuit breaker active for EmailIt');
      }
    }

    if (this.latestTelemetry && this.latestTelemetry.dailyRemaining <= 0) {
      return this.sendViaResend(options, 'EmailIt daily sending quota exhausted');
    }

    try {
      return await this.sendViaEmailIt(options);
    } catch (error: any) {
      // Trip circuit breaker for 5 minutes on server errors or failures
      this.tripCircuitBreaker(5 * 60 * 1000);
      return await this.sendViaResend(options, error.message);
    }
  }

  /**
   * Dispatches outbound email using primary provider (EmailIt API v2)
   */
  private async sendViaEmailIt(options: EmailOptions): Promise<DispatchResult> {
    const endpoint = `${this.primaryBaseUrl}/emails`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.emailitApiKey}`,
      'Content-Type': 'application/json'
    };

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const payload = {
      from: options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.reply_to,
      cc: options.cc,
      bcc: options.bcc,
      template: options.template,
      variables: options.variables,
      attachments: options.attachments,
      headers: options.headers,
      meta: options.meta
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      this.extractTelemetryHeaders(response);

      if (response.status === 429) {
        throw new Error('EmailIt Rate Limit Exceeded (HTTP 429)');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`EmailIt API Error [HTTP ${response.status}]: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json<any>();
      return {
        success: true,
        provider: 'emailit',
        messageId: data.id,
        rawResponse: data
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Dispatches outbound email using fallback provider (Resend API v1)
   */
  private async sendViaResend(options: EmailOptions, reason: string): Promise<DispatchResult> {
    const endpoint = `${this.secondaryBaseUrl}/emails`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.resendApiKey}`,
      'Content-Type': 'application/json'
    };

    if (options.idempotencyKey) {
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }

    const processedAttachments = await this.resolveAttachmentsForResend(options.attachments);

    const payload: Record<string, any> = {
      from: options.from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      cc: options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined,
      bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : undefined,
      reply_to: options.reply_to ? (Array.isArray(options.reply_to) ? options.reply_to : [options.reply_to]) : undefined,
      headers: options.headers,
      attachments: processedAttachments
    };

    if (options.meta) {
      payload.tags = Object.entries(options.meta).map(([name, value]) => ({ name, value }));
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(`Critical Secondary Provider Failure (Resend) [HTTP ${response.status}]: ${JSON.stringify(errorBody)}`);
    }

    const data = await response.json<any>();
    return {
      success: true,
      provider: 'resend',
      messageId: data.id,
      rawResponse: data
    };
  }

  /**
   * Extracts rate limit and telemetry headers from EmailIt API responses
   */
  private extractTelemetryHeaders(response: Response): void {
    const remaining = response.headers.get('ratelimit-remaining');
    const dailyRemaining = response.headers.get('ratelimit-daily-remaining');
    const dailyReset = response.headers.get('ratelimit-daily-reset');

    if (dailyRemaining !== null) {
      this.latestTelemetry = {
        rateLimitRemaining: remaining ? parseInt(remaining, 10) : 0,
        dailyRemaining: parseInt(dailyRemaining, 10),
        dailyResetSeconds: dailyReset ? parseInt(dailyReset, 10) : 0
      };
    }
  }

  /**
   * Converts URL-based attachments into Base64 strings for Resend compatibility
   */
  private async resolveAttachmentsForResend(attachments?: EmailAttachment[]): Promise<any[] | undefined> {
    if (!attachments || attachments.length === 0) return undefined;

    const resolved = [];
    for (const att of attachments) {
      if (att.content) {
        resolved.push({ filename: att.filename, content: att.content });
      } else if (att.url) {
        const res = await fetch(att.url);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        // base64 encoding in browser/cloudflare worker
        const base64 = btoa(String.fromCharCode.apply(null, Array.from(buffer)));

        resolved.push({ filename: att.filename, content: base64 });
      }
    }
    return resolved;
  }

  private tripCircuitBreaker(durationMs: number): void {
    this.isCircuitOpen = true;
    this.circuitCooldownUntil = Date.now() + durationMs;
  }
}
