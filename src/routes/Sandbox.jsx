import { useEffect, useState } from 'react';
import { extractHandoffToken, consumeTokenAndCleanUrl, buildPassportRedirectUrl } from '../services/passportClient';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;



function Sandbox() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Using an explicit state to hide the login button instantly when processing begins
  const [processingToken, setProcessingToken] = useState(false);
  const [authState, setAuthState] = useState('Logged Out');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setAuthState('Authenticated');
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setAuthState('Authenticated');
      else setAuthState('Logged Out');
    });
    return () => subscription.unsubscribe();
  }, []);


  useEffect(() => {
    const token = extractHandoffToken();
    if (token) {
      setProcessingToken(true);
      setLoading(true);
      const consumeToken = async () => {
        try {
          const workerUrl = import.meta.env.VITE_PASSPORT_WORKER_URL || 'http://localhost:8787';
          const data = await consumeTokenAndCleanUrl({ workerUrl, supabaseClient: supabase });
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
      <div style={{ marginTop: '1rem', padding: '10px', backgroundColor: '#222', display: 'inline-block', borderRadius: '4px' }}>
        <strong>Supabase Auth State: </strong>
        <span style={{ color: authState === 'Authenticated' ? '#00ffcc' : '#ffcc00' }}>{authState}</span>
      </div><br/>

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
