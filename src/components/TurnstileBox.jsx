import { useEffect, useRef } from 'react';

const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

function TurnstileBox({ onToken, onError, resetKey }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const callbacksRef = useRef({ onToken, onError });

  useEffect(() => {
    callbacksRef.current = { onToken, onError };
  }, [onError, onToken]);

  useEffect(() => {
    if (!siteKey || !containerRef.current) {
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;

    const renderWidget = () => {
      if (cancelled || !window.turnstile || !containerRef.current) {
        if (!cancelled && attempts < 40) {
          attempts += 1;
          window.setTimeout(renderWidget, 250);
        }

        return;
      }

      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'dark',
        action: 'passport_auth',
        callback: (token) => callbacksRef.current.onToken(token),
        'error-callback': () => callbacksRef.current.onError(),
        'expired-callback': () => callbacksRef.current.onToken(''),
      });
    };

    renderWidget();

    return () => {
      cancelled = true;

      if (widgetRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetRef.current);
        widgetRef.current = null;
      }
    };
  }, [resetKey]);

  if (!siteKey) {
    return (
      <div className="turnstile-placeholder">
        Configure <code>VITE_TURNSTILE_SITE_KEY</code> before deployment.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="turnstile-box"
      aria-label="Security verification"
    />
  );
}

export default TurnstileBox;