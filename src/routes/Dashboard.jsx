import React, { useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import usePassportAuth from '../hooks/usePassportAuth';

const { FiPlus, FiTrash2, FiRefreshCw, FiCopy, FiCheck, FiActivity } = FiIcons;

function Dashboard() {
  const navigate = useNavigate();
  const auth = usePassportAuth(window.location.origin);
  const [apps, setApps] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  const workerUrl = import.meta.env.VITE_PASSPORT_EDGE_URL || 'https://passport.axim.us.com';

  useEffect(() => {
    if (auth.session) {
      fetchApps();
    }
  }, [auth.session]);

  const fetchApps = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${workerUrl}/api/v1/apps`, {
        headers: {
          'Authorization': `Bearer ${auth.session.access_token}`
        }
      });
      if (!res.ok) throw new Error('Failed to fetch apps');
      const data = await res.json();
      setApps(data.apps || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

    const revokeSession = async () => {
    setRevoking(true);
    try {
        const res = await fetch(`${workerUrl}/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: auth.session.access_token })
        });
        if (res.ok) {
            toast.success('Session revoked');
            auth.cancel();
        } else {
            toast.error('Failed to revoke session');
        }
    } catch (e) {
        toast.error('Error revoking session');
    } finally {
        setRevoking(false);
    }
  };

  const createApp = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${workerUrl}/api/v1/apps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.session.access_token}`
        },
        body: JSON.stringify({ name: 'New Application' })
      });
      if (!res.ok) throw new Error('Failed to create app');
      await fetchApps();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteApp = async (id) => {

    try {
      setLoading(true);
      const res = await fetch(`${workerUrl}/api/v1/apps/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${auth.session.access_token}`
        }
      });
      if (!res.ok) throw new Error('Failed to delete app');
      await fetchApps();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateApp = async (id, data) => {
    try {
      const res = await fetch(`${workerUrl}/api/v1/apps/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.session.access_token}`
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to update app');
      await fetchApps();
    } catch (err) {
      setError(err.message);
    }
  };

  const rotateSecret = async (id) => {
    try {
      const res = await fetch(`${workerUrl}/api/v1/apps/${id}/secret`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.session.access_token}`
        }
      });
      if (!res.ok) throw new Error('Failed to rotate secret');
      const data = await res.json();
      toast.success(`New Secret: ${data.client_secret}
Save this now!`, { duration: 10000 });
    } catch (err) {
      setError(err.message);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!auth.session) {
    return (
      <div className="passport-shell flex items-center justify-center p-8">
        <div className="bg-slate-900/60 backdrop-blur-xl rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold mb-4">SSO Developer Dashboard</h1>
          <p className="text-slate-400 mb-8">Please authenticate to manage your applications.</p>
          <button
            onClick={() => navigate('/')}
            className="w-full bg-blue-600 text-white font-medium py-3 rounded-lg hover:bg-blue-700 transition"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <Toaster position="top-right" toastOptions={{ style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' } }} />
    <div className="min-h-screen bg-[#0A0D14] text-slate-100 font-sans">
      <header className="bg-slate-900/60 backdrop-blur-xl shadow-sm border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SafeIcon icon={FiActivity} className="text-blue-600 text-xl" />
            <h1 className="text-xl font-bold tracking-tight">AXiM Passport Developer</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400">{auth.session.email || auth.session.wallet_address || auth.session.sub}</span>
            <button onClick={() => auth.cancel()} className="text-sm text-blue-600 font-medium hover:text-blue-800">Sign Out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl p-6 shadow-sm flex flex-col">
                <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2"><SafeIcon icon={FiActivity} /> Audit Stream</h3>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2" style={{ maxHeight: '200px' }}>
                    {auditLogs.length === 0 ? <p className="text-sm text-slate-500 italic">No recent activity.</p> : auditLogs.map((log, i) => (
                        <div key={i} className="flex justify-between items-center bg-[#0A0D14] p-3 rounded-lg border border-slate-800 text-sm">
                            <span className="font-mono text-blue-400">{log.event}</span>
                            <span className="text-slate-500">{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl p-6 shadow-sm flex flex-col justify-between">
                <div>
                    <h3 className="text-lg font-bold text-slate-100 mb-2 flex items-center gap-2"><SafeIcon icon={FiCheck} className="text-green-500" /> Active Session</h3>
                    <p className="text-sm text-slate-400 font-mono mb-1 truncate">ID: {auth.session.sub}</p>
                    <p className="text-sm text-slate-400">Authenticated via Passport</p>
                </div>
                <button onClick={revokeSession} disabled={revoking} className="mt-4 w-full bg-red-600/20 text-red-500 border border-red-500/30 hover:bg-red-600/30 py-2 rounded-lg font-medium transition flex justify-center items-center gap-2">
                    {revoking ? 'Revoking...' : 'Revoke Session'}
                </button>
            </div>
        </div>

        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold">App Registry</h2>
            <p className="text-slate-400 mt-1">Manage your OIDC client applications</p>
          </div>
          <button
            onClick={createApp}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center gap-2"
          >
            <SafeIcon icon={FiPlus} />
            Create App
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {loading && apps.length === 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {[1, 2].map(i => (
              <div key={i} className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl shadow-sm h-64 animate-pulse">
                <div className="px-6 py-5 border-b border-slate-800 bg-[#0A0D14] h-16"></div>
                <div className="p-6 space-y-4">
                  <div className="h-4 bg-slate-700 rounded w-1/4"></div>
                  <div className="h-10 bg-slate-800 rounded w-full"></div>
                  <div className="h-4 bg-slate-700 rounded w-1/4 mt-4"></div>
                  <div className="h-10 bg-slate-800 rounded w-full"></div>
                </div>
              </div>
            ))}
          </div>
        ) : apps.length === 0 ? (
          <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl p-12 text-center shadow-sm">
            <SafeIcon icon={FiActivity} className="mx-auto h-12 w-12 text-slate-500 mb-4" />
            <h3 className="text-lg font-medium text-slate-100">No applications</h3>
            <p className="mt-1 text-slate-400">Get started by creating a new client application.</p>
            <div className="mt-6">
              <button onClick={createApp} className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
                <SafeIcon icon={FiPlus} className="-ml-1 mr-2 h-5 w-5" />
                New Application
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {apps.map(app => (
              <div key={app.id} className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col">
                <div className="px-6 py-5 border-b border-slate-800 flex justify-between items-center bg-[#0A0D14]">
                  <input
                    type="text"
                    defaultValue={app.name}
                    onBlur={(e) => {
                      if (e.target.value !== app.name) updateApp(app.id, { ...app, name: e.target.value });
                    }}
                    className="font-bold text-lg bg-transparent border-none focus:ring-0 p-0 text-slate-100"
                  />
                  <button onClick={() => deleteApp(app.id)} className="text-slate-500 hover:text-red-600 transition p-1">
                    <SafeIcon icon={FiTrash2} />
                  </button>
                </div>

                <div className="px-6 py-5 flex-1 space-y-6">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Client ID</label>
                    <div className="flex items-center bg-[#0A0D14] p-2.5 rounded border border-slate-800 font-mono text-sm">
                      <span className="flex-1 truncate">{app.client_id}</span>
                      <button onClick={() => copyToClipboard(app.client_id, app.client_id)} className="ml-2 text-slate-500 hover:text-slate-400">
                        {copied === app.client_id ? <SafeIcon icon={FiCheck} className="text-green-500" /> : <SafeIcon icon={FiCopy} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-end mb-2">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Client Secret</label>
                      <button onClick={() => rotateSecret(app.id)} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                        <SafeIcon icon={FiRefreshCw} className="text-[10px]" /> Rotate Secret
                      </button>
                    </div>
                    <div className="bg-[#0A0D14] p-2.5 rounded border border-slate-800 font-mono text-sm text-slate-500 italic">
                      Hidden for security (Hash stored)
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Allowed Redirect URIs</label>
                    <textarea
                      defaultValue={(() => { try { return JSON.parse(app.redirect_uris || '[]').join('\n'); } catch(e){ return ''; } })()}
                      onBlur={(e) => {
                        const uris = e.target.value.split('\n').map(u => u.trim()).filter(Boolean);
                        // Validation: no wildcards
                        if (uris.some(u => u.includes('*'))) {
                          toast.error('Wildcards are not allowed in Redirect URIs');
                          return;
                        }
                        updateApp(app.id, { ...app, redirect_uris: uris });
                      }}
                      placeholder="https://app.example.com/callback (One per line)"
                      className="w-full text-sm border-slate-700 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 font-mono p-2.5 bg-[#0A0D14] border"
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
    </>
  );
}

export default Dashboard;
