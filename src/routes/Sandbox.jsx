import { useEffect, useState } from 'react';
import { extractHandoffToken, consumeTokenAndCleanUrl, buildPassportRedirectUrl } from '../services/passportClient';

function Sandbox() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Using an explicit state to hide the login button instantly when processing begins
  const [processingToken, setProcessingToken] = useState(false);

  useEffect(() => {
    const token = extractHandoffToken();
    if (token) {
      setProcessingToken(true);
      setLoading(true);
      const consumeToken = async () => {
        try {
          const workerUrl = import.meta.env.VITE_PASSPORT_WORKER_URL || 'http://localhost:8787';
          const data = await consumeTokenAndCleanUrl({ workerUrl });
          if (data) {
             setResult(data);
          }
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      };

      consumeToken();
    }
  }, []);

  const loginViaPassport = () => {
    const passportUrl = window.location.origin; // In local this routes to /
    const callbackUrl = window.location.origin + '/sandbox';
    window.location.href = buildPassportRedirectUrl({ passportUrl, callbackUrl });
  };

  return (
    <div style={{ padding: '2rem', color: '#fff', fontFamily: 'monospace' }}>
      <h1>Nexus CRM (Sandbox)</h1>
      <p>Simulated target application.</p>

      {!processingToken && !result && (
        <button
          onClick={loginViaPassport}
          style={{
            padding: '10px 20px',
            backgroundColor: '#00ffcc',
            color: '#080a0d',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            marginTop: '1rem'
          }}
        >
          Simulate Nexus Login
        </button>
      )}

      {loading && <p>Consuming token...</p>}

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {result && (
        <div style={{ marginTop: '2rem', backgroundColor: '#111', padding: '1rem', borderRadius: '4px' }}>
          <h2 style={{ color: '#00ffcc' }}>Authentication Success!</h2>
          <p>Verified: {result.valid ? 'True' : 'False'}</p>
          {result.exp && <p>Expires: {new Date(result.exp * 1000).toLocaleString()}</p>}
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default Sandbox;
