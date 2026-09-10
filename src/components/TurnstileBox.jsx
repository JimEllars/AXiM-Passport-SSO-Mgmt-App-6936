import { useEffect, useRef, useState } from 'react';

const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

import { forwardRef, useImperativeHandle } from 'react';

const TurnstileBox = forwardRef(function TurnstileBox({ onToken, onError, resetKey }, ref) {
  const containerRef = useRef(null);
  useImperativeHandle(ref, () => ({
    resetWidget: () => {
      if (window.turnstile && widgetRef.current !== null) {
        window.turnstile.reset(widgetRef.current);
      }
    }
  }));
  const widgetRef = useRef(null);
  const callbacksRef = useRef({ onToken, onError });
  const [status, setStatus] = useState('loading');
  const [retryCount, setRetryCount] = useState(0);
  const [showRetry, setShowRetry] = useState(false);

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
    let refreshIntervalId; // Add interval reference
    let fallbackTimeoutId;

    const fail = (message) => {
      if (!cancelled) {
        setStatus('error');
        callbacksRef.current.onError(message);
      }
    };

    const startTime = Date.now();
    const renderWidget = () => {
      // 10-second fallback if widget doesn't verify
      fallbackTimeoutId = window.setTimeout(() => {
        if (status === 'loading' || !window.turnstile) {
          setShowRetry(true);
          setStatus('error');
          // intentionally NOT calling fail() so we don't break the top-level UI and just show the inline retry button
        }
      }, 5000);

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
            const latency = Date.now() - startTime;
            callbacksRef.current.onToken(token, latency);
            setStatus('verified');
            callbacksRef.current.onToken(token);

            // Auto-refresh token just before 5m expiration (4m 30s = 270000ms)
            if (refreshIntervalId) clearInterval(refreshIntervalId);
            refreshIntervalId = setInterval(() => {
              if (window.turnstile && widgetRef.current !== null) {
                window.turnstile.reset(widgetRef.current);
              }
            }, 270000);
          },
          'error-callback': () => {
            setStatus('error');
            const retries = retryCount;
            if (retries < 3) {
              const backoff = Math.pow(2, retries) * 1000;
              setTimeout(() => {
                setRetryCount(r => r + 1);
                if (window.turnstile && widgetRef.current !== null) {
                  window.turnstile.reset(widgetRef.current);
                }
              }, backoff);
            } else {
              callbacksRef.current.onError('Security verification failed. Please refresh the page.');
            }
          },
          'expired-callback': () => {
            setStatus('expired');
            callbacksRef.current.onError('Security verification expired. It has been automatically reset.', true);
            callbacksRef.current.onToken('', null);
            if (window.turnstile && widgetRef.current !== null) {
                 window.turnstile.reset(widgetRef.current);
            }
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
      window.clearTimeout(fallbackTimeoutId);
      if (refreshIntervalId) clearInterval(refreshIntervalId);

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
        <div className="flex flex-col items-center">
          <p className="turnstile-status text-rose-400 mb-2">Verification unavailable.</p>
          <button onClick={() => { setRetryCount(0); setStatus('loading'); if (window.turnstile && widgetRef.current !== null) window.turnstile.reset(widgetRef.current); }} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded border border-slate-600 transition-colors">Retry Verification</button>
        </div>
      )}
    </div>
  );
});

export default TurnstileBox;
