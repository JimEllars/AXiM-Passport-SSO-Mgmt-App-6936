import re

with open("src/hooks/usePassportAuth.js", "r") as f:
    content = f.read()

# Make sure if checkSession fails, it sets identities to null or empty array so skeletons stop loading
# Currently checkSession does:
# if (data.authenticated) { ... } else { ... }
# We need it to fetch identities if authenticated, just like the old fetch did!

new_check_session = """  const checkSession = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_PASSPORT_EDGE_URL}/api/v1/auth/session`, {
        credentials: 'include',
        headers: { 'x-axim-ray': 'browser-generated', 'x-axim-trace-id': crypto.randomUUID() }
      });
      if (res.status === 401) throw new Error('Unauthenticated');
      if (!res.ok || res.status >= 500) {
        setIdentities([]); // stop skeleton loading
        return; // Leave optimistic session if edge is down
      }
      const data = await res.json();
      if (data.authenticated) {
        localStorage.setItem('optimistic_session', JSON.stringify({ ...data.user, cachedAt: Date.now() }));
        setSession(data.user);
        setConnectionStatus('connected');

        const identRes = await fetch(`${import.meta.env.VITE_PASSPORT_EDGE_URL}/api/v1/auth/identities`, { credentials: 'include' });
        const identData = await identRes.json();
        if (identData?.identities) setIdentities(identData.identities);
        else setIdentities([]);
      } else {
        localStorage.removeItem('optimistic_session');
        setSession(null);
        setIdentities([]);
      }
    } catch (e) {
      if (e.message === 'Unauthenticated') {
        localStorage.removeItem('optimistic_session');
        setSession(null);
      } else {
        setConnectionStatus('degraded');
      }
      setIdentities([]);
    }
  }, []);"""

content = re.sub(r'  const checkSession = useCallback\(async \(\) => \{[\s\S]*?  \}, \[\]\);', new_check_session, content)

with open("src/hooks/usePassportAuth.js", "w") as f:
    f.write(content)
