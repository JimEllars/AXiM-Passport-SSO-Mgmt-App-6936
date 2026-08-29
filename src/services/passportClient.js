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
      },
      body: JSON.stringify({ token, origin: window.location.origin }),
    });

    if (!res.ok) {
      throw new Error(`Failed to consume token: ${res.statusText}`);
    }

    const data = await res.json();

    if (data.valid) {
      if (supabaseClient) {
        await supabaseClient.auth.setSession({
          access_token: data.supabase_access_token,
          refresh_token: ''
        });
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return data;
  } catch (err) {
    throw err;
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

/**
 * Executes a pre-flight health check to the AXiM Passport edge worker.
 * If successful, redirects the user to the AXiM Passport Hub for authentication.
 * If the worker is unreachable (e.g., DNS error, infrastructure outage) or times out,
 * it throws a structured 'PASSPORT_UNAVAILABLE' error.
 *
 * Downstream developers should wrap this call in a try/catch block and render a
 * local fallback UI if the SSO gateway is down.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.passportUrl - The base URL of the AXiM Passport Hub.
 * @param {string} params.callbackUrl - The URL to redirect back to after successful authentication.
 * @param {string} params.workerUrl - The base URL of the AXiM Passport edge worker for health checking.
 * @returns {Promise<void>} Resolves when the redirect is initiated, throws on pre-flight failure.
 */
export async function executePassportRedirect({ passportUrl, callbackUrl, workerUrl }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`${workerUrl}/api/v1/health`, {
      method: 'GET',
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error('PASSPORT_UNAVAILABLE');
    }
  } catch (err) {
    throw new Error('PASSPORT_UNAVAILABLE');
  } finally {
    clearTimeout(timeoutId);
  }

  window.location.assign(buildPassportRedirectUrl({ passportUrl, callbackUrl }));
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
    await supabaseClient.auth.signOut();
  }

  const res = await fetch(`${workerUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    throw new Error(`Failed to execute global logout: ${res.statusText}`);
  }

  return res.json();
}
