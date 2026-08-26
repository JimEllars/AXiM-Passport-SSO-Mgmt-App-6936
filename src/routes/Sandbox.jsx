import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

function Sandbox() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (token) {
      setLoading(true);
      const consumeToken = async () => {
        try {
          const workerUrl = import.meta.env.VITE_PASSPORT_WORKER_URL || 'http://localhost:8787';
          const res = await fetch(`${workerUrl}/api/v1/auth/token/consume`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token }),
          });

          if (!res.ok) {
            throw new Error(`Failed to consume token: ${res.statusText}`);
          }

          const data = await res.json();
          setResult(data);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      };

      consumeToken();
    }
  }, [token]);

  const loginViaPassport = () => {
    window.location.href = `/?redirect=${encodeURIComponent(window.location.origin + '/sandbox')}`;
  };

  return (
    <div style={{ padding: '2rem', color: '#fff', fontFamily: 'monospace' }}>
      <h1>Nexus CRM (Sandbox)</h1>
      <p>Simulated target application.</p>

      {!token && (
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
          Login via Passport
        </button>
      )}

      {loading && <p>Consuming token...</p>}

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {result && (
        <div style={{ marginTop: '2rem', backgroundColor: '#111', padding: '1rem', borderRadius: '4px' }}>
          <h2 style={{ color: '#00ffcc' }}>Authentication Success!</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default Sandbox;
