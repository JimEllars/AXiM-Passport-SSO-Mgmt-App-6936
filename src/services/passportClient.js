const getTracingHeaders = () => { const id = crypto.randomUUID(); return { "x-axim-correlation-id": id, "x-axim-trace-id": id }; };
import { useEffect, useState } from 'react';

/**
 * Extracts the handoff token from the URL search parameters.
 * @returns {string|null} The token if present, otherwise null.
 */
export function extractHandoffToken() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('token');
}

/**
 * Consumes the handoff token from the URL, authenticates the Supabase client,
 * and cleans the token from the browser's URL history.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.workerUrl - The base URL of the AXiM Passport edge worker.
 * @param {Object} [params.supabaseClient] - An optional instantiated Supabase client to hydrate with the session.
 * @returns {Promise<Object|null>} A promise that resolves to the token consumption response data, or null if no token is found.
 */
export async function consumeTokenAndCleanUrl({ workerUrl, supabaseClient }) {
  const token = extractHandoffToken();
  if (!token) return null;

  try {
    const res = await fetch(`${workerUrl}/api/v1/auth/token/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getTracingHeaders(),
      },
      body: JSON.stringify({ token, origin: window.location.origin }),
    });

    if (!res.ok) {
      if (workerUrl) {
         fetch(`${workerUrl}/api/v1/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'client_network_failure', error: res.statusText, timestamp: new Date().toISOString() })
         }).catch(()=>{});
      }
      return { success: false, code: 'HTTP_ERROR', message: `Failed to consume token: ${res.statusText}` };
    }

    const data = await res.json();
    const traceId = res.headers.get('x-axim-trace-id');
    if (traceId) {
       window.sessionStorage.setItem('axim_trace_id', traceId);
    }

    // In src/services/passportClient.js, we don't have access to publishTelemetry natively since it's in passportApi.js
    // Wait, let's just do it directly with fetch or just log it. The prompt says "In src/services/passportClient.js and src/hooks/usePassportAuth.js, capture x-axim-trace-id on all responses. Dispatch structured client-side telemetry events"
    if (traceId && workerUrl) {
      fetch(`${workerUrl}/api/v1/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
        ...getTracingHeaders(), 'x-axim-trace-id': traceId },
        body: JSON.stringify({ event: 'session_restored', traceId, timestamp: new Date().toISOString(), sessionHash: 'anon' }),
        keepalive: true
      }).catch(()=>{});
    }

    if (data.valid) {
      if (supabaseClient) {
        await supabaseClient.auth.setSession({
          access_token: data.supabase_access_token,
          refresh_token: ''
        });
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, document.title, url.toString());
    }

    return data;
  } catch (err) {
    return { success: false, code: 'NETWORK_ERROR', message: err.message };
  }
}

/**
 * Builds the redirect URL to send unauthenticated users to the AXiM Passport Hub.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.passportUrl - The base URL of the AXiM Passport Hub (e.g., https://passport.axim.com).
 * @param {string} params.callbackUrl - The URL to redirect back to after successful authentication.
 * @returns {string} The fully constructed URL to redirect the user to.
 */
export function buildPassportRedirectUrl({ passportUrl, callbackUrl }) {
  const url = new URL(passportUrl);
  url.searchParams.set('redirect', callbackUrl);
  return url.toString();
}

async function isReachable(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    // An opaque response is sufficient here: this probe only distinguishes a
    // network/DNS failure from a reachable Passport origin.
    await fetch(url, {
      cache: 'no-store',
      mode: 'no-cors',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function isWorkerHealthy(workerUrl) {
  let attempt = 0;
  const maxRetries = 2;
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    try {
      const response = await fetch(`${workerUrl.replace(/\/$/, '')}/api/health`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: getTracingHeaders(),
      });
      return response.ok
        && (response.headers.get('content-type') || '').includes('application/json');
    } catch {
      attempt++;
      if (attempt <= maxRetries) {
        await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt - 1)));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return false;
}

/**
 * Redirects to Passport after verifying both the API and browser-facing origin.
 * When the primary hostname is unavailable during DNS propagation, it uses the
 * independently configured Pages and Workers.dev fallback pair.
 *
 * Downstream developers should wrap this call in a try/catch block and render a
 * local fallback UI if the SSO gateway is down.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.passportUrl - The base URL of the AXiM Passport Hub.
 * @param {string} params.callbackUrl - The URL to redirect back to after successful authentication.
 * @param {string} params.workerUrl - The base URL of the AXiM Passport edge worker for health checking.
 * @param {string} [params.fallbackPassportUrl] - The Pages fallback URL.
 * @param {string} [params.fallbackWorkerUrl] - The Workers.dev fallback API URL.
 * @returns {Promise<void>} Resolves when the redirect is initiated, throws on pre-flight failure.
 */
export async function executePassportRedirect({
  passportUrl,
  callbackUrl,
  workerUrl,
  fallbackPassportUrl,
  fallbackWorkerUrl,
}) {
  const primaryReady = await isWorkerHealthy(workerUrl) && await isReachable(passportUrl);
  if (primaryReady) {
    window.location.assign(buildPassportRedirectUrl({ passportUrl, callbackUrl }));
    return;
  }

  const fallbackReady = fallbackPassportUrl
    && fallbackWorkerUrl
    && await isWorkerHealthy(fallbackWorkerUrl)
    && await isReachable(fallbackPassportUrl);
  if (fallbackReady) {
    window.location.assign(buildPassportRedirectUrl({
      passportUrl: fallbackPassportUrl,
      callbackUrl,
    }));
    return;
  }

  throw new Error('PASSPORT_UNAVAILABLE');
}

/**
 * A React hook that automatically consumes a handoff token from the URL on mount,
 * hydrates the Supabase client, and cleans the URL.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.workerUrl - The base URL of the AXiM Passport edge worker.
 * @param {Object} [params.supabaseClient] - An optional instantiated Supabase client to hydrate with the session.
 * @returns {Object} An object containing the loading state, the token consumption data, and any error that occurred.
 */
export function usePassportHandoff({ workerUrl, supabaseClient }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    consumeTokenAndCleanUrl({ workerUrl, supabaseClient })
      .then((result) => {
        if (isMounted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [workerUrl, supabaseClient]);

  return { loading, data, error };
}


/**
 * Executes a global logout by terminating the local application session
 * and calling the AXiM Passport edge worker to clear the global Passport session.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.workerUrl - The base URL of the AXiM Passport edge worker.
 * @param {Object} params.supabaseClient - An instantiated Supabase client to clear the local session.
 * @param {string} params.token - The active JWT access token to authenticate the logout request.
 * @returns {Promise<Object>} A promise that resolves to the logout response data.
 */
export async function executeGlobalLogout({ workerUrl, supabaseClient, token }) {
  if (supabaseClient) {
    await supabaseClient.auth.signOut().catch(() => {});
  }

  try {
    const res = await fetch(`${workerUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
        ...getTracingHeaders(),
    },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    return { success: false, code: 'HTTP_ERROR', message: `Failed to execute global logout: ${res.statusText}` };
  }

  return res.json();
  } catch (err) {
    return { success: false, code: 'NETWORK_ERROR', message: err.message };
  }
}


/**
 * Validates the current local Supabase session.
 * Checks if a session exists and has not expired.
 *
 * @param {Object} supabaseClient - An instantiated Supabase client.
 * @returns {Promise<boolean>} True if the session is valid, false otherwise.
 */
export async function validateSession(supabaseClient) {
  if (!supabaseClient) return false;

  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (error || !session || !session.access_token) {
      return false;
    }

    // Check if the session is expired based on the expires_at timestamp if present
    if (session.expires_at) {
      const isExpired = Date.now() / 1000 > session.expires_at;
      return !isExpired;
    }

    return true;
  } catch (err) {
    return false;
  }
}


/**
 * Standalone client SDK helper to perform silent session checks.
 *
 * @param {Object} params - The parameters.
 * @param {Function} params.onAuthenticated - Callback fired when a valid session is found. Receives the user object.
 * @param {Function} [params.onUnauthenticated] - Callback fired when no valid session is found.
 */
// Used to store the active refresh timeout
let refreshTimeoutId = null;

export async function initAximPassport({ onAuthenticated, onUnauthenticated }) {
  const scheduleRefresh = (user) => {
    // Determine expiration from user token, fallback to 1 hour
    const tokenExp = user?.exp ? user.exp * 1000 : Date.now() + 60 * 60 * 1000;
    const timeToRefresh = Math.max(0, tokenExp - Date.now() - 60000); // 60 seconds before expiry

    if (refreshTimeoutId) {
      clearTimeout(refreshTimeoutId);
    }

    refreshTimeoutId = setTimeout(async () => {
      try {
        const res = await fetch('https://passport.axim.us.com/api/v1/auth/session', { credentials: 'include', headers: getTracingHeaders() });
        const data = await res.json();
        if (data.authenticated) {
          onAuthenticated(data.user);
          scheduleRefresh(data.user);
        } else {
          if (onUnauthenticated) onUnauthenticated();
        }
      } catch (e) {
        // Queue state transition retry for when we come online
        const onOnline = async () => {
          window.removeEventListener('online', onOnline);
          const res = await fetch('https://passport.axim.us.com/api/v1/auth/session', { credentials: 'include', headers: getTracingHeaders() });
          const data = await res.json();
          if (data.authenticated) {
            onAuthenticated(data.user);
            scheduleRefresh(data.user);
          } else {
            if (onUnauthenticated) onUnauthenticated();
          }
        };
        window.addEventListener('online', onOnline);
      }
    }, timeToRefresh);
  };

  try {
    const res = await fetch('https://passport.axim.us.com/api/v1/auth/session', { credentials: 'include', headers: getTracingHeaders() });
    const data = await res.json();
    if (data.authenticated) {
      onAuthenticated(data.user);
      scheduleRefresh(data.user);
    } else {
      if (onUnauthenticated) onUnauthenticated();
    }
  } catch (e) {
    if (onUnauthenticated) onUnauthenticated();
  }
}
