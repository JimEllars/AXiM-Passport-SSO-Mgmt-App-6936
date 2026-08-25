import { useEffect, useRef, useState } from 'react';

const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

function TurnstileBox({ onToken, onError, resetKey }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const callbacksRef = useRef({ onToken, onError });
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    callbacksRef.current = { onToken, onError };
  }, [onError, onToken]);

  useEffect(() => {
    if (!siteKey || !containerRef.current) {
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;
    let timeoutId;

    const fail = (message) => {
      if (!cancelled) {
        setStatus('error');
        callbacksRef.current.onError(message);
      }
    };

    const renderWidget = () => {
      if (cancelled) {
        return;
      }

      if (!window.turnstile) {
        attempts += 1;

        if (attempts >= 40) {
          fail('Security verification could not be loaded. Refresh and try again.');
          return;
        }

        timeoutId = window.setTimeout(renderWidget, 250);
        return;
      }

      try {
        widgetRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          action: 'passport_auth',
          callback: (token) => {
            setStatus('verified');
            callbacksRef.current.onToken(token);
          },
          'error-callback': () => fail('Security verification failed. Try again.'),
          'expired-callback': () => {
            setStatus('expired');
            callbacksRef.current.onToken('');
          },
        });
        setStatus('ready');
      } catch {
        fail('Security verification could not be initialized.');
      }
    };

    renderWidget();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);

      if (widgetRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetRef.current);
        widgetRef.current = null;
      }
    };
  }, [resetKey]);

  if (!siteKey) {
    return (
      <div className="turnstile-placeholder" role="status">
        Configure <code>VITE_TURNSTILE_SITE_KEY</code> before deployment.
      </div>
    );
  }

  return (
    <div className={`turnstile-wrap turnstile-${status}`}>
      <div
        ref={containerRef}
        className="turnstile-box"
        aria-label="Security verification"
      />
      {status === 'expired' && (
        <p className="turnstile-status">Verification expired. Complete it again.</p>
      )}
      {status === 'error' && (
        <p className="turnstile-status">Verification unavailable. Refresh and try again.</p>
      )}
    </div>
  );
}

export default TurnstileBox;