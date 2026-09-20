import { useEffect, useState } from 'react';
import { extractHandoffToken, consumeTokenAndCleanUrl, executePassportRedirect, trackEvent } from '../services/passportClient';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
const passportUrl = import.meta.env.VITE_PASSPORT_URL || 'https://passport.axim.us.com';
const workerUrl = import.meta.env.VITE_PASSPORT_EDGE_URL || passportUrl;
const fallbackPassportUrl = import.meta.env.VITE_PASSPORT_FALLBACK_URL || 'https://axim-passport.pages.dev';
const fallbackWorkerUrl = import.meta.env.VITE_PASSPORT_FALLBACK_EDGE_URL || '';

function Sandbox() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [authState, setAuthState] = useState('Checking');
  const [sessionInfo, setSessionInfo] = useState(null);
  const [showLegacyLogin, setShowLegacyLogin] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [events, setEvents] = useState([]);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    const handleStorage = () => {
      const trace = window.sessionStorage.getItem('axim_trace_id');
      const latestEvent = window.sessionStorage.getItem('axim_latest_event');
      if (latestEvent) {
          try {
             const parsed = JSON.parse(latestEvent);
             if (!events.some(e => e.id === parsed.id)) {
                 setEvents(prev => [...prev.slice(-4), parsed]);
             }
          } catch(e) { /* ignore */ }
      }
      if (trace && !logs.includes(trace)) {
        setLogs(prev => [...prev.slice(-4), trace]);
      }
    };
    window.addEventListener('storage', handleStorage);
    // Poll for changes since sessionStorage doesn't always fire events on same tab
    const iv = setInterval(() => {
       const trace = window.sessionStorage.getItem('axim_trace_id');
       setLogs(prev => {
         if (trace && !prev.includes(trace)) return [...prev.slice(-4), trace];
         return prev;
       });
    }, 1000);
    return () => {
       window.removeEventListener('storage', handleStorage);
       clearInterval(iv);
    };
  }, []);


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

    try {
      await executePassportRedirect({
        passportUrl,
        callbackUrl: window.location.href,
        workerUrl,
        fallbackPassportUrl,
        fallbackWorkerUrl,
      });
    } catch (err) {
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
    <>
    <style>
        {".group:hover .group-hover-opacity { opacity: 1 !important; }"}
    </style>
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



      <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#1e293b', borderRadius: '4px', border: '1px solid #334155' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: '#94a3b8' }}>Agent Verification Harness</h3>
        <p style={{ color: '#cbd5e1', fontSize: '12px', marginBottom: '1rem' }}>Simulate autonomous AI agent requests using an agent key.</p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
           <input type="text" id="agentKeyInput" placeholder="Enter Agent Key (sk_...)" style={{ flex: 1, padding: '8px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff', borderRadius: '4px' }} />
           <button onClick={async () => {
              const key = document.getElementById('agentKeyInput').value;
              if (!key) return alert('Enter key');
              try {
                 const res = await fetch(`${workerUrl}/api/v1/auth/agent-verify`, {
                    headers: { 'Authorization': `Bearer ${key}` }
                 });
                 if (res.ok) {
                    const data = await res.json();
                    alert('Verified Agent: ' + JSON.stringify(data.agent));
                 } else {
                    alert('Failed: ' + res.statusText);
                 }
              } catch (e) {
                 alert('Error: ' + e.message);
              }
           }} style={{ padding: '8px 12px', backgroundColor: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
             Verify Scope
           </button>
        </div>
      </div>

      <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#1e293b', borderRadius: '4px', border: '1px solid #334155' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: '#94a3b8' }}>Simulation Controls (Dev Only)</h3>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={() => window.location.href = '/?redirect=' + encodeURIComponent(window.location.href) + '&simulate_latency=true'} style={{ padding: '8px 12px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Simulate Edge Latency
          </button>
          <button onClick={() => { localStorage.setItem('optimistic_session', JSON.stringify({ exp: Date.now() / 1000 - 3600 })); window.location.reload(); }} style={{ padding: '8px 12px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Force Token Expiration
          </button>
          <button onClick={() => window.location.href = '/?redirect=' + encodeURIComponent(window.location.href) + '&fail_turnstile=true'} style={{ padding: '8px 12px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Simulate Turnstile Failure
          </button>
        </div>
      </div>

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
        <div style={{ marginTop: '2rem', backgroundColor: '#1e293b', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ color: '#00ffcc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              Authentication Success!
              {result.latencyMs && (
                <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px', color: '#94a3b8' }}>
                  {result.latencyMs}ms ping
                </span>
              )}
            </h2>
            {result.supabase_access_token && (
                            <button
                onClick={() => {
                  navigator.clipboard.writeText(result.supabase_access_token);
                  setCopiedToken(true);
                  trackEvent('sso_token_copied');
                  setTimeout(() => setCopiedToken(false), 2000);
                }}
                className="group relative"
                style={{
                  padding: '5px 10px', backgroundColor: copiedToken ? '#10b981' : '#334155',
                  color: '#fff', border: '1px solid #475569', borderRadius: '4px', cursor: 'pointer',
                  fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px',
                  transition: 'background-color 0.2s'
                }}
              >
                {copiedToken ? 'Copied!' : 'Copy SSO Token'}
                <span style={{
                    position: 'absolute', top: '-30px', left: '50%', transform: 'translateX(-50%)',
                    backgroundColor: '#1e293b', color: '#fff', fontSize: '10px', padding: '4px 8px',
                    borderRadius: '4px', opacity: 0, transition: 'opacity 0.2s', pointerEvents: 'none',
                    border: '1px solid #475569', whiteSpace: 'nowrap'
                }} className="group-hover-opacity">Click to copy token</span>
              </button>
            )}
          </div>
          <p>Verified: {result.valid ? 'True' : 'False'}</p>
          {result.exp && <p>Expires: {new Date(result.exp * 1000).toLocaleString()}</p>}
          <details style={{ marginTop: '1rem', border: '1px solid #334155', borderRadius: '4px', padding: '0.5rem', backgroundColor: '#0f172a' }} open>
            <summary style={{ cursor: 'pointer', color: '#94a3b8', userSelect: 'none', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                <span>JWT / Claims Inspector</span>
                {result.exp && <span style={{ color: '#10b981', fontSize: '12px', fontWeight: 'normal' }}>TTL: {Math.max(0, Math.floor(((result.exp * 1000) - Date.now()) / 60000))} mins remaining</span>}
            </summary>
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ padding: '10px', backgroundColor: '#1e293b', borderLeft: '4px solid #10b981', borderRadius: '0 4px 4px 0' }}>
                  <h4 style={{ margin: '0 0 5px 0', color: '#10b981' }}>Signature Validity</h4>
                  <p style={{ margin: 0, color: '#94a3b8' }}>✅ Verified against Cloudflare Edge RS256 JWKS</p>
              </div>
              <pre style={{ margin: 0, padding: '10px', backgroundColor: '#000', borderRadius: '4px', overflowX: 'auto', border: '1px solid #334155' }}>
                  <span style={{ color: '#f472b6' }}>// Decoded Payload</span>{'\n'}
                  {JSON.stringify(result, null, 2)}
              </pre>

              {result.supabase_access_token && (
                  <>
                      <h4 style={{ margin: '10px 0 0 0', color: '#94a3b8' }}>Integration Snippets</h4>
                      <pre style={{ margin: 0, padding: '10px', backgroundColor: '#000', borderRadius: '4px', overflowX: 'auto', border: '1px solid #334155' }}>
                          <span style={{ color: '#38bdf8' }}>// cURL</span>{'\n'}
                          curl -H "Authorization: Bearer {result.supabase_access_token.substring(0, 20)}..." https://api.axim.us.com/protected
                      </pre>
                      <pre style={{ margin: 0, padding: '10px', backgroundColor: '#000', borderRadius: '4px', overflowX: 'auto', border: '1px solid #334155' }}>
                          <span style={{ color: '#facc15' }}>// AXiM SDK</span>{'\n'}
                          await axim.edge.fetch('/protected', {'{'} token: '{result.supabase_access_token.substring(0, 15)}...' {'}'})
                      </pre>
                  </>
              )}
            </div>
          </details>
        </div>
      )}
      {/* Live Telemetry & Diagnostics Drawer */}
      <div
        style={{
          position: 'fixed', right: drawerOpen ? '0' : '-350px', top: 0, bottom: 0, width: '350px',
          backgroundColor: '#0f172a', borderLeft: '1px solid #1e293b', padding: '1rem',
          transition: 'right 0.3s ease', zIndex: 9999, overflowY: 'auto'
        }}
      >
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          style={{
            position: 'absolute', left: '-40px', top: '20px', width: '40px', height: '40px',
            backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRight: 'none',
            color: '#38bdf8', cursor: 'pointer', borderRadius: '4px 0 0 4px'
          }}
        >
          {drawerOpen ? '>' : '<'}
        </button>

        <h3 style={{ color: '#38bdf8', borderBottom: '1px solid #1e293b', paddingBottom: '0.5rem', marginTop: 0 }}>
          Live Telemetry & Diagnostics
        </h3>

                <div style={{ marginTop: '1rem' }}>
          <strong style={{ color: '#94a3b8' }}>Recent Trace IDs & Events:</strong>
          {logs.length === 0 ? <p style={{ color: '#475569', fontSize: '12px' }}>No traces yet...</p> :
            <ul style={{ paddingLeft: '1rem', color: '#cbd5e1', fontSize: '12px' }}>
              {events.length > 0 ? events.map((e, i) => <li key={i}>{e.event} - {e.traceId || e.id}</li>) : logs.map((log, i) => <li key={i}>{log}</li>)}
            </ul>
          }
        </div>

        <div style={{ marginTop: '1rem' }}>
          <strong style={{ color: '#94a3b8' }}>Edge Telemetry Insights:</strong>
          {result && result.latencyMs ? (
             <p style={{ color: '#cbd5e1', fontSize: '12px' }}>Edge Roundtrip Latency: {result.latencyMs}ms<br/>Verification State: {result.valid ? 'Verified' : 'Unverified'}</p>
          ) : (
             <p style={{ color: '#475569', fontSize: '12px' }}>No latency data available.</p>
          )}
        </div>

        <div style={{ marginTop: '1rem' }}>
          <strong style={{ color: '#94a3b8' }}>Parsed Session JWT Claims:</strong>
          <pre style={{ backgroundColor: '#1e293b', padding: '10px', borderRadius: '4px', fontSize: '11px', color: '#cbd5e1', overflowX: 'auto' }}>
            {sessionInfo ? JSON.stringify(sessionInfo, null, 2) : 'No active session.'}
          </pre>
        </div>
      </div>
        </div>
    </>
  );
}

export default Sandbox;
