const workerUrl = (import.meta.env.VITE_PASSPORT_WORKER_URL || '').replace(/\/$/, '');
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
  const timeout = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('Authentication could not be verified.');
      }

      if (response.status === 429) {
        throw new Error('Too many attempts. Please wait and try again.');
      }

      throw new Error('Passport is temporarily unavailable.');
    }

    return await response.json();
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

  const url = new URL(`${workerUrl}/api/v1/auth/google`);
  url.searchParams.set('redirect', redirectUrl);
  url.searchParams.set('turnstile_token', turnstileToken);

  return url.toString();
}

export {
  getRedirectState,
  getRedirectUrl,
};