const workerUrl = (import.meta.env.VITE_PASSPORT_WORKER_URL || '').replace(/\/$/, '');
const configuredOrigins = (import.meta.env.VITE_ALLOWED_REDIRECT_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function assertApprovedRedirect(redirectUrl) {
  if (!redirectUrl) {
    throw new Error('A valid AXiM application callback is required to continue.');
  }

  const url = new URL(redirectUrl);

  if (url.protocol !== 'https:') {
    throw new Error('The requested application callback is not secure.');
  }

  if (
    configuredOrigins.length > 0 &&
    !configuredOrigins.includes(url.origin)
  ) {
    throw new Error('The requested application is not an approved AXiM destination.');
  }

  return url;
}

function getRedirectUrl() {
  const requested = new URLSearchParams(window.location.search).get('redirect');

  if (!requested) {
    return '';
  }

  try {
    assertApprovedRedirect(requested);
    return requested;
  } catch {
    return '';
  }
}

function requireWorker() {
  if (!workerUrl) {
    throw new Error('Passport Worker is not configured yet.');
  }
}

async function post(path, payload) {
  requireWorker();

  const response = await fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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

  return response.json();
}

function createHandoffUrl(redirectUrl, token) {
  const url = assertApprovedRedirect(redirectUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export async function requestWalletChallenge({
  address,
  chainId,
  turnstileToken,
  redirectUrl,
}) {
  return post('/api/v1/auth/wallet/challenge', {
    address,
    chainId,
    turnstileToken,
    redirect: redirectUrl,
  });
}

export async function authenticate({
  method,
  credential,
  turnstileToken,
  redirectUrl,
}) {
  const result = await post('/api/v1/auth/verify', {
    method,
    credential,
    turnstileToken,
    redirect: redirectUrl,
  });

  if (!result.token) {
    throw new Error('The Passport Worker returned an invalid response.');
  }

  return createHandoffUrl(redirectUrl, result.token);
}

export function getGoogleAuthUrl(redirectUrl, turnstileToken) {
  assertApprovedRedirect(redirectUrl);
  requireWorker();

  const url = new URL(`${workerUrl}/api/v1/auth/google`);
  url.searchParams.set('redirect', redirectUrl);
  url.searchParams.set('turnstile_token', turnstileToken);

  return url.toString();
}

export { getRedirectUrl };