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
      }, 8000);

      if (cancelled) {
        return;
      }

      if (!window.turnstile) {
        attempts += 1;

        if (attempts >= 40) {
          if (retryCount < 2) {
             const backoff = Math.pow(2, retryCount) * 1000;
             timeoutId = window.setTimeout(() => {
                 setRetryCount(r => r + 1);
                 // Dynamically try to reload the script if it failed
                 const script = document.createElement('script');
                 script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
                 script.async = true;
                 script.defer = true;
                 document.head.appendChild(script);
                 renderWidget();
             }, backoff);
          } else {
             // Permanent block
             setStatus('blocked');
             setShowRetry(true);
          }
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
      {(status === 'error' || status === 'blocked') && (
        <div className="flex flex-col items-center bg-slate-900/80 border border-slate-700 p-4 rounded-lg w-full max-w-sm transition-all duration-300" role="alert" aria-live="assertive">
          <p className="turnstile-status text-rose-400 mb-3 text-sm flex items-center gap-2">
            <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            {status === 'blocked' ? 'Verification blocked by browser settings.' : 'Security verification unavailable.'}
          </p>
          <button onClick={() => { setRetryCount(0); setShowRetry(false); setStatus('loading'); if (window.turnstile && widgetRef.current !== null) { window.turnstile.reset(widgetRef.current); } else { setStatus('loading'); } }} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded border border-slate-600 transition-colors shadow flex items-center gap-2 focus:ring-2 focus:ring-cyan-500 focus:outline-none">
            {status === 'blocked' ? 'Use Alternate Verification' : 'Retry Verification'}
          </button>
        </div>
      )}
    </div>
  );
});

export default TurnstileBox;
