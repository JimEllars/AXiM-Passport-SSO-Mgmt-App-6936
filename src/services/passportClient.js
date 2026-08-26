export function extractHandoffToken() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('token');
}

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
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return data;
  } catch (err) {
    throw err;
  }
}

export function buildPassportRedirectUrl({ passportUrl, callbackUrl }) {
  const url = new URL(passportUrl);
  url.searchParams.set('redirect', callbackUrl);
  return url.toString();
}
