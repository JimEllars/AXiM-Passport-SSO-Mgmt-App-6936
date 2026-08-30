import { useEffect, useState } from 'react';
import { extractHandoffToken, consumeTokenAndCleanUrl, buildPassportRedirectUrl } from '@axim/passport-sdk';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
const passportUrl = import.meta.env.VITE_PASSPORT_URL || 'https://passport.axim.us.com';

function Sandbox() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [authState, setAuthState] = useState('Checking');
  const [sessionInfo, setSessionInfo] = useState(null);
  const [showLegacyLogin, setShowLegacyLogin] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      const token = extractHandoffToken();
      if (token) {
        if (isMounted) setLoading(true);
        try {
          const data = await consumeTokenAndCleanUrl({ workerUrl: passportUrl, supabaseClient: supabase });
          if (isMounted) {
            setResult(data);
            setLoading(false);
            setAuthState('Authenticated');
          }
        } catch (err) {
          if (isMounted) {
            setError(err.message);
            setLoading(false);
            setShowLegacyLogin(true);
          }
        }
        return;
      }

      let currentSession = null;
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        currentSession = session;
        if (session) {
          if (isMounted) {
            setAuthState('Authenticated');
            setSessionInfo(session);
            setLoading(false);
          }
          return;
        }
      }

      if (!currentSession && !token) {
        if (isMounted) {
          setAuthState('Logged Out');
          setLoading(false);
        }
      }
    };

    initAuth();

    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          if (isMounted) {
            setAuthState('Authenticated');
            setSessionInfo(session);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setAuthState('Logged Out');
            setSessionInfo(null);
          }
        }
      });
      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    } else {
      return () => {
        isMounted = false;
      };
    }
  }, []);

  const handleSimulateLogin = async () => {
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    try {
      const res = await fetch(`${passportUrl}/api/v1/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const redirectUrl = buildPassportRedirectUrl({
          passportUrl,
          callbackUrl: window.location.href
        });
        window.location.assign(redirectUrl);
        return;
      } else {
        throw new Error('Passport health check failed');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      setError('Passport SSO gateway is currently unavailable. Falling back to local login.');
      setShowLegacyLogin(true);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#000', color: '#fff', fontSize: '24px', fontFamily: 'monospace' }}>
        Authenticating with AXiM Passport...
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', color: '#fff', fontFamily: 'monospace' }}>
      <h1>Nexus CRM (Sandbox)</h1>
      <p>Simulated target application.</p>

      <div style={{ marginTop: '1rem', padding: '10px', backgroundColor: '#222', display: 'inline-block', borderRadius: '4px' }}>
        <strong>Supabase Auth State: </strong>
        <span style={{ color: authState === 'Authenticated' ? '#00ffcc' : '#ffcc00' }}>{authState}</span>
      </div><br/>

      {sessionInfo && (
        <div style={{ marginTop: '1rem', padding: '10px', backgroundColor: '#222', display: 'inline-block', borderRadius: '4px' }}>
          <strong>Supabase Session Exists!</strong><br/>
          <span>User Sub (ID): {sessionInfo.user?.id}</span><br/>
          <span>Role: {sessionInfo.user?.role}</span>
        </div>
      )}
      <br/>

      {authState === 'Logged Out' && !showLegacyLogin && !result && (
        <button onClick={handleSimulateLogin} style={{ marginTop: '2rem', padding: '10px', backgroundColor: '#00ffcc', color: '#000', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>
          Simulate Nexus Login
        </button>
      )}

      {showLegacyLogin && (
        <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #444', borderRadius: '4px', maxWidth: '400px' }}>
          <h3>Legacy Local Login</h3>
          <p>Please enter your credentials below to log in directly.</p>
          <input type="text" placeholder="Username" style={{ display: 'block', margin: '10px 0', padding: '10px', width: '100%' }} />
          <input type="password" placeholder="Password" style={{ display: 'block', margin: '10px 0', padding: '10px', width: '100%' }} />
          <button style={{ padding: '10px', width: '100%', backgroundColor: '#00ffcc', color: '#000', border: 'none', cursor: 'pointer' }}>Log In</button>
        </div>
      )}

      {error && <p style={{ color: 'red', marginTop: '1rem' }}>{error}</p>}

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
