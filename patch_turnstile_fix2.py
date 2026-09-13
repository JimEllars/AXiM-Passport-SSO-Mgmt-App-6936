import re

with open("src/components/TurnstileBox.jsx", "r") as f:
    content = f.read()

# Restore TurnstileBox component gracefully to not break UI bounds
replacement = """      {(status === 'error' || status === 'blocked') && (
        <div className="flex flex-col items-center bg-slate-900/80 border border-slate-700 p-4 rounded-lg w-full max-w-sm transition-all duration-300 relative z-10" role="alert" aria-live="assertive">
          <p className="turnstile-status text-rose-400 mb-3 text-sm flex items-center gap-2">
            <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            {status === 'blocked' ? 'Verification blocked by browser settings.' : 'Security verification unavailable.'}
          </p>
          <button onClick={() => { setRetryCount(0); setShowRetry(false); setStatus('loading'); if (window.turnstile && widgetRef.current !== null) { window.turnstile.reset(widgetRef.current); } else { setStatus('loading'); } }} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded border border-slate-600 transition-colors shadow flex items-center gap-2 focus:ring-2 focus:ring-cyan-500 focus:outline-none">
            {status === 'blocked' ? 'Use Alternate Verification' : 'Retry Verification'}
          </button>
        </div>
      )}"""

content = re.sub(
    r'      \{\(status === \'error\' \|\| status === \'blocked\'\) && \([\s\S]*?      \)\}',
    replacement,
    content
)

with open("src/components/TurnstileBox.jsx", "w") as f:
    f.write(content)
