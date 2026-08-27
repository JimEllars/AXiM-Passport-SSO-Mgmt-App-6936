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
          access_token: token,
          refresh_token: token
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
