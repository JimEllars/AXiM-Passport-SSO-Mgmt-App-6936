const primaryWorkerUrl = (import.meta.env.VITE_PASSPORT_EDGE_URL || '').replace(/\/$/, '');
const fallbackPassportUrl = (import.meta.env.VITE_PASSPORT_FALLBACK_URL || '').replace(/\/$/, '');
const fallbackWorkerUrl = (import.meta.env.VITE_PASSPORT_FALLBACK_EDGE_URL || '').replace(/\/$/, '');
const workerUrl = fallbackPassportUrl
  && fallbackWorkerUrl
  && window.location.origin === fallbackPassportUrl
  ? fallbackWorkerUrl
  : primaryWorkerUrl;
const configuredOrigins = (import.meta.env.VITE_ALLOWED_REDIRECT_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

function assertApprovedRedirect(redirectUrl) {
  if (!redirectUrl) {
    throw new Error('A valid AXiM application callback is required to continue.');
  }

  let url;

  try {
    url = new URL(redirectUrl);
  } catch {
    throw new Error('The requested application callback is invalid.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('The requested application callback is not secure.');
  }

  const isAximSubdomain = /^https:\/\/([a-zA-Z0-9-]+\.)*axim\.us\.com(:[0-9]+)?(\/.*)?$/.test(url.origin);
  const isLocalhost = import.meta.env.MODE === 'development' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');

  if (isAximSubdomain || isLocalhost) {
    return url;
  }

  if (configuredOrigins.length === 0) {
    throw new Error('Approved AXiM redirect origins are not configured.');
  }

  if (!configuredOrigins.includes(url.origin)) {
    throw new Error('The requested application is not an approved AXiM destination.');
  }

  return url;
}

function getRedirectState() {
  const requested = new URLSearchParams(window.location.search).get('redirect');

  if (!requested) {
    return {
      url: '',
      error: 'Open Passport from an approved AXiM application.',
    };
  }

  try {
    assertApprovedRedirect(requested);

    return {
      url: requested,
      error: '',
    };
  } catch (error) {
    return {
      url: '',
      error: error.message || 'The requested application callback is invalid.',
    };
  }
}

function getRedirectUrl() {
  return getRedirectState().url;
}

function requireWorker() {
  if (!workerUrl) {
    throw new Error('Passport Worker is not configured yet.');
  }
}

function requireTurnstile() {
  if (!import.meta.env.VITE_TURNSTILE_SITE_KEY) {
    throw new Error('Turnstile is not configured for this deployment.');
  }
}

async function post(path, payload) {
  requireWorker();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  const correlationId = crypto.randomUUID();

  try {
    const response = await fetch(`${workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-axim-correlation-id': correlationId,
        'x-axim-trace-id': correlationId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('403 Forbidden: Authentication could not be verified.');
      }

      if (response.status === 429) {
        throw new Error('Too many attempts. Please wait and try again.');
      }

      throw new Error('Passport is temporarily unavailable.');
    }

    if (import.meta.env.MODE === 'development') {
       const rayId = response.headers.get('cf-ray');
       if (rayId) console.debug(`[AXiM Passport] API Response ${path} - Ray ID: ${rayId} - Trace: ${correlationId}`);
    }

    const data = await response.json();
    const traceId = response.headers.get('x-axim-trace-id');
    if (traceId) {
      data.traceId = traceId;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('The Passport Worker took too long to respond.');
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function createHandoffUrl(redirectUrl, token) {
  const url = assertApprovedRedirect(redirectUrl);

  if (!token || typeof token !== 'string') {
    throw new Error('The Passport Worker returned an invalid response.');
  }

  url.searchParams.set('token', token);
  return url.toString();
}


export function publishTelemetry(event, payload = {}) {
  try {
    if (!workerUrl) return;

    // Filter out any potential sensitive data if it was passed by mistake
    const safePayload = { ...payload };
    delete safePayload.token;
    delete safePayload.turnstileToken;
    delete safePayload.credential;

    const traceId = safePayload.traceId || window.sessionStorage.getItem('axim_trace_id') || crypto.randomUUID();
    window.sessionStorage.setItem('axim_trace_id', traceId);

    // We intentionally don't await this as telemetry should be non-blocking
    fetch(`${workerUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-axim-trace-id': traceId,
      },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...safePayload
      }),
      keepalive: true,
    }).catch(() => {
      // Ignore telemetry errors silently so as not to disrupt user flow
    });
  } catch (error) {
    // Failsafe
  }
}

export function getPassportReadiness(redirectUrl) {
  return {
    redirect: Boolean(redirectUrl),
    turnstile: Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY),
    worker: Boolean(workerUrl),
    origins: configuredOrigins.length > 0,
  };
}

export async function requestWalletChallenge({
  address,
  chainId,
  turnstileToken,
  redirectUrl,
}) {
  requireTurnstile();
  assertApprovedRedirect(redirectUrl);

  publishTelemetry('wallet_challenge_initiated', { address, chainId, redirect: redirectUrl });

  const result = await post('/api/v1/auth/wallet/challenge', {
    address,
    chainId,
    turnstileToken,
    redirect: redirectUrl,
  });

  if (!result.message || !result.nonce) {
    throw new Error('The Passport Worker returned an invalid wallet challenge.');
  }

  return result;
}

export async function authenticate({
  method,
  credential,
  turnstileToken,
  redirectUrl,
}) {
  requireTurnstile();
  assertApprovedRedirect(redirectUrl);

  publishTelemetry('auth_initiated', { method, redirect: redirectUrl });

  const result = await post('/api/v1/auth/verify', {
    method,
    credential,
    turnstileToken,
    redirect: redirectUrl,
  });

  return createHandoffUrl(redirectUrl, result.token);
}

export function getGoogleAuthUrl(redirectUrl, turnstileToken) {
  assertApprovedRedirect(redirectUrl);
  requireWorker();
  requireTurnstile();

  if (!turnstileToken) {
    throw new Error('Complete the security verification before continuing.');
  }

  publishTelemetry('google_auth_initiated', { redirect: redirectUrl });

  const url = new URL(`${workerUrl}/api/v1/auth/google`);
  url.searchParams.set('redirect', redirectUrl);
  url.searchParams.set('turnstile_token', turnstileToken);

  return url.toString();
}

export {
  getRedirectState,
  getRedirectUrl,
};
export async function checkWorkerHealth() {
  let attempt = 0;
  const maxRetries = 2;
  const correlationId = crypto.randomUUID();
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${workerUrl}/api/health`, {
        signal: controller.signal,
        headers: { "x-axim-correlation-id": correlationId, "x-axim-trace-id": correlationId }
      });
      if (import.meta.env.MODE === "development") {
        const rayId = res.headers.get("cf-ray");
        if (rayId) console.debug(`[AXiM Passport] API Response /api/health - Ray ID: ${rayId} - Trace: ${correlationId}`);
      }
      return res.ok;
    } catch {
      attempt++;
      if (attempt <= maxRetries) await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt - 1)));
    } finally {
      window.clearTimeout(timeout);
    }
  }
  return false;
}

export async function logout(token) {
  if (!workerUrl) return;
  try {
    await fetch(workerUrl + '/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
  } catch (e) {
    // ignore
  }
}


export function getAppleAuthUrl(redirectUrl, turnstileToken) {
  assertApprovedRedirect(redirectUrl);
  requireWorker();
  requireTurnstile();

  if (!turnstileToken) {
    throw new Error('Complete the security verification before continuing.');
  }

  publishTelemetry('apple_auth_initiated', { redirect: redirectUrl });

  const url = new URL(`${workerUrl}/api/v1/auth/apple`);
  url.searchParams.set('redirect', redirectUrl);
  url.searchParams.set('turnstile_token', turnstileToken);

  return url.toString();
}


export async function startEmailOtp(email, redirectUrl, turnstileToken) {
  requireTurnstile();
  assertApprovedRedirect(redirectUrl);
  publishTelemetry('email_otp_initiated', { email, redirect: redirectUrl });
  const result = await post('/api/v1/auth/email/start', { email, redirect: redirectUrl, turnstileToken });
  return result;
}

export async function verifyEmailOtp(email, token, nonce) {
  const result = await post('/api/v1/auth/email/verify', { email, token, nonce });
  return result;
}
