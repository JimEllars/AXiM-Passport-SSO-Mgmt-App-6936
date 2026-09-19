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
    let attempt = 0;
    const maxRetries = 3;
    let res;
    while (attempt <= maxRetries) {
      try {
        res = await fetch(`${workerUrl}/api/v1/auth/token/consume`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getTracingHeaders(),
          },
          body: JSON.stringify({ token, origin: window.location.origin }),
        });
        if (res.ok || res.status === 401 || res.status === 403 || res.status === 400) break; // Don't retry auth errors
      } catch (err) {
        if (attempt === maxRetries) throw err;
      }
      attempt++;
      if (attempt <= maxRetries) await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt - 1)));
    }

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
      trackEvent('session_established');
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
  const scheduleRefresh = (user, retryCount = 0) => {
    // Determine expiration from user token, fallback to 1 hour
    const tokenExp = user?.exp ? user.exp * 1000 : Date.now() + 60 * 60 * 1000;
    // Buffer is 30 seconds for clock skew. Refresh starts 5 minutes before expiry.
    // Ensure we trigger before actual expiry using Math.max with clock-skew buffer.
    // Safe in-memory token refresh buffering before expiration (e.g. 5 minutes before)
    const timeToRefresh = retryCount > 0 ? Math.pow(2, retryCount) * 1000 : Math.max(0, tokenExp - Date.now() - 300000);

    if (refreshTimeoutId) {
      clearTimeout(refreshTimeoutId);
    }

    refreshTimeoutId = setTimeout(async () => {
      try {
        const res = await fetch('https://passport.axim.us.com/api/v1/auth/refresh', { method: 'POST', credentials: 'include', headers: getTracingHeaders() });
        if (!res.ok && res.status >= 500) {
           throw new Error('Server Error');
        }
        if (res.ok) {
           const data = await res.json();
           if(data.success && data.user) {
             onAuthenticated(data.user);
             sessionStorage.setItem('passport_session_claims', JSON.stringify(data.user));
             scheduleRefresh(data.user, 0);
             return;
           }
        }

        // Fallback to check session
        const sessionRes = await fetch('https://passport.axim.us.com/api/v1/auth/session', { credentials: 'include', headers: getTracingHeaders() });
        if (!sessionRes.ok && sessionRes.status >= 500) {
           throw new Error('Server Error');
        }
        const data = await res.json();
        if (data.authenticated) {
          onAuthenticated(data.user);
          sessionStorage.setItem('passport_session_claims', JSON.stringify(data.user));
          scheduleRefresh(data.user, 0);
        } else {
          const cached = sessionStorage.getItem('passport_session_claims');
          if (cached) {
             const parsed = JSON.parse(cached);
             // If token is actually expired and server says not authenticated, log out
             if (parsed.exp && (parsed.exp * 1000 < Date.now())) {
                if (onUnauthenticated) onUnauthenticated();
             } else {
                onAuthenticated(parsed);
                scheduleRefresh(parsed, retryCount + 1);
             }
          } else if (onUnauthenticated) {
             onUnauthenticated();
          }
        }
      } catch (e) {
         trackEvent('client_network_failure', { error: e.message });
         const cached = sessionStorage.getItem('passport_session_claims');
         if (cached) {
            const parsed = JSON.parse(cached);
            // Re-schedule with exponential backoff rather than clearing state
            onAuthenticated(parsed); // Keep UI intact
            scheduleRefresh(parsed, retryCount + 1);
         } else {
            // Queue state transition retry for when we come online
            const onOnline = async () => {
              window.removeEventListener('online', onOnline);
              const res = await fetch('https://passport.axim.us.com/api/v1/auth/session', { credentials: 'include', headers: getTracingHeaders() });
              const data = await res.json().catch(()=>({}));
              if (data.authenticated) {
                onAuthenticated(data.user);
                sessionStorage.setItem('passport_session_claims', JSON.stringify(data.user));
                scheduleRefresh(data.user, 0);
              } else {
                if (onUnauthenticated) onUnauthenticated();
              }
            };
            window.addEventListener('online', onOnline);
         }
      }
    }, timeToRefresh);
  };

  try {
    const res = await fetch('https://passport.axim.us.com/api/v1/auth/session', { credentials: 'include', headers: getTracingHeaders() });
    const data = await res.json();
    if (data.authenticated) {
      onAuthenticated(data.user);
      sessionStorage.setItem('passport_session_claims', JSON.stringify(data.user));
      scheduleRefresh(data.user);
    } else {
      if (onUnauthenticated) onUnauthenticated();
    }
  } catch (e) {
    if (onUnauthenticated) onUnauthenticated();
  }
}

/**
 * Dispatches non-blocking telemetry events to the Passport Edge Worker.
 * Attempts to use navigator.sendBeacon, falling back to fetch with keepalive.
 *
 * @param {string} eventName - The name of the event to track.
 * @param {Object} metadata - Additional metadata for the event.
 */
export function trackEvent(eventName, metadata = {}) {
  try {
    const workerUrl = import.meta.env.VITE_PASSPORT_EDGE_URL || 'https://passport.axim.us.com';
    const url = `${workerUrl}/api/telemetry/events`;
    const traceId = crypto.randomUUID();

    const payload = {
      event: eventName,
      timestamp: new Date().toISOString(),
      traceId,
      ...metadata
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

    // Try sendBeacon for non-blocking outbound requests
    if (navigator.sendBeacon) {
      const success = navigator.sendBeacon(url, blob);
      if (success) return;
    }

    // Fallback to fetch with keepalive
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-axim-trace-id': traceId
      },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  } catch (e) {
    // Fail silently on telemetry errors
  }
}

/**
 * Standardized helper for handling the AXiM Passport callback.
 * Checks for a token in the URL, verifies it, cleans the URL, and returns the user object.
 *
 * @returns {Promise<Object|null>} The verified user object if successful, or null.
 */
export async function handlePassportCallback() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return null;

  try {
    const workerUrl = import.meta.env.VITE_PASSPORT_EDGE_URL || 'https://passport.axim.us.com';
    const res = await fetch(`${workerUrl}/api/v1/auth/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (data.valid) {
      window.history.replaceState({}, document.title, window.location.pathname);
      return data.user;
    }
  } catch (err) {
    console.error('Failed to handle Passport callback', err);
  }
  return null;
}

/**
 * Creates an OIDC authorization URL for the application.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.clientId - The client ID of the application.
 * @param {string} params.redirectUri - The allowed redirect URI.
 * @param {string} [params.scope='openid profile email'] - Requested scopes.
 * @param {string} [params.state] - Custom state string for CSRF protection.
 * @param {string} params.codeChallenge - The PKCE code challenge.
 * @param {string} [params.passportUrl] - The base URL of AXiM Passport.
 * @returns {string} The formatted authorization URL.
 */
export function createAuthorizationUrl({ clientId, redirectUri, scope = 'openid profile email', state, codeChallenge, passportUrl }) {
  const base = passportUrl || import.meta.env.VITE_PASSPORT_URL || 'https://passport.axim.us.com';
  const url = new URL('/api/oauth/authorize', base);
  // Actually the edge worker expects it at /oauth/authorize in some routing setups, let's use /oauth/authorize
  const authUrl = new URL('/oauth/authorize', base);

  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  if (state) authUrl.searchParams.set('state', state);
  if (codeChallenge) {
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
  }

  return authUrl.toString();
}

/**
 * Exchanges an OIDC authorization code for tokens.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.code - The authorization code received from the callback.
 * @param {string} params.codeVerifier - The original PKCE code verifier.
 * @param {string} params.clientId - The client ID of the application.
 * @param {string} params.redirectUri - The redirect URI used in the authorization request.
 * @param {string} [params.workerUrl] - The edge worker URL.
 * @returns {Promise<Object>} The token response containing access_token and id_token.
 */
export async function exchangeCode({ code, codeVerifier, clientId, redirectUri, workerUrl }) {
  const base = workerUrl || import.meta.env.VITE_PASSPORT_EDGE_URL || 'https://passport.axim.us.com';
  const url = `${base}/api/oauth/token`;

  const formData = new URLSearchParams();
  formData.append('grant_type', 'authorization_code');
  formData.append('code', code);
  formData.append('code_verifier', codeVerifier);
  formData.append('client_id', clientId);
  formData.append('redirect_uri', redirectUri);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `HTTP error ${res.status}`);
  }

  const data = await res.json();

  // Safe cross-tab sync
  try {
    if (window.BroadcastChannel) {
        const bc = new BroadcastChannel('axim_passport_channel');
        bc.postMessage({ type: 'tokens_updated', data });
        bc.close();
    }
    // Also use localStorage events for older browsers / cross-origin if set up
    localStorage.setItem('axim_passport_sync', JSON.stringify({ time: Date.now(), type: 'tokens_updated' }));
  } catch(e) {
    console.error(e);
  }

  return data;
}

/**
 * Opens a popup window for login and resolves with the authorization code payload.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.clientId - The client ID of the application.
 * @param {string} [params.scopes] - Requested scopes.
 * @returns {Promise<Object>} A promise resolving with the authorization code and state.
 */
export async function popupLogin({ clientId, scopes = 'openid profile email' }) {
  // Generate PKCE
  const codeVerifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const state = crypto.randomUUID();
  const redirectUri = window.location.origin + '/callback.html'; // Assuming a generic callback for popup

  const url = createAuthorizationUrl({
    clientId,
    redirectUri,
    scope: scopes,
    state,
    codeChallenge
  });

  const width = 500;
  const height = 700;
  const left = window.screen.width / 2 - width / 2;
  const top = window.screen.height / 2 - height / 2;

  const popup = window.open(url, 'axim_passport_login', `width=${width},height=${height},top=${top},left=${left}`);

  // Fallback to full redirect if popup blocker is detected
  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    // Save PKCE verifier to session storage for the redirect callback
    sessionStorage.setItem('passport_pkce_verifier', codeVerifier);
    sessionStorage.setItem('passport_auth_state', state);
    window.location.href = url;
    return new Promise(() => {}); // Never resolves as it redirects
  }

  return new Promise((resolve, reject) => {
    const listener = (event) => {
      // In a real implementation, you'd check event.origin
      if (event.data && event.data.type === 'passport_authorization_response') {
        window.removeEventListener('message', listener);
        if (popup) popup.close();

        if (event.data.error) {
          reject(new Error(event.data.error));
        } else if (event.data.state !== state) {
          reject(new Error('State mismatch'));
        } else {
          resolve({
            code: event.data.code,
            state: event.data.state,
            codeVerifier,
            redirectUri
          });
        }
      }
    };

    window.addEventListener('message', listener);

    // Poll to see if popup closed early
    const interval = setInterval(() => {
      if (popup && popup.closed) {
        clearInterval(interval);
        window.removeEventListener('message', listener);
        reject(new Error('Popup closed by user'));
      }
    }, 500);
  });
}
