import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import usePassportAuth from '../hooks/usePassportAuth';

const { FiPlus, FiTrash2, FiRefreshCw, FiCopy, FiCheck, FiActivity } = FiIcons;

function Dashboard() {
  const navigate = useNavigate();
  const auth = usePassportAuth(window.location.origin);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
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
    if (!window.confirm('Are you sure you want to delete this application?')) return;
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
    if (!window.confirm('Are you sure? This will invalidate the old secret immediately.')) return;
    try {
      const res = await fetch(`${workerUrl}/api/v1/apps/${id}/secret`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.session.access_token}`
        }
      });
      if (!res.ok) throw new Error('Failed to rotate secret');
      const data = await res.json();
      alert(`New Client Secret: ${data.client_secret}\nPlease save this now, it won't be shown again.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!auth.session) {
    return (
      <div className="passport-shell flex items-center justify-center p-8">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold mb-4">SSO Developer Dashboard</h1>
          <p className="text-gray-600 mb-8">Please authenticate to manage your applications.</p>
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
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SafeIcon icon={FiActivity} className="text-blue-600 text-xl" />
            <h1 className="text-xl font-bold tracking-tight">AXiM Passport Developer</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{auth.session.email || auth.session.wallet_address || auth.session.sub}</span>
            <button onClick={() => auth.cancel()} className="text-sm text-blue-600 font-medium hover:text-blue-800">Sign Out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold">App Registry</h2>
            <p className="text-gray-500 mt-1">Manage your OIDC client applications</p>
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
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : apps.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
            <SafeIcon icon={FiActivity} className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No applications</h3>
            <p className="mt-1 text-gray-500">Get started by creating a new client application.</p>
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
              <div key={app.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
                <div className="px-6 py-5 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                  <input
                    type="text"
                    defaultValue={app.name}
                    onBlur={(e) => {
                      if (e.target.value !== app.name) updateApp(app.id, { ...app, name: e.target.value });
                    }}
                    className="font-bold text-lg bg-transparent border-none focus:ring-0 p-0 text-gray-900"
                  />
                  <button onClick={() => deleteApp(app.id)} className="text-gray-400 hover:text-red-600 transition p-1">
                    <SafeIcon icon={FiTrash2} />
                  </button>
                </div>

                <div className="px-6 py-5 flex-1 space-y-6">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Client ID</label>
                    <div className="flex items-center bg-gray-50 p-2.5 rounded border border-gray-200 font-mono text-sm">
                      <span className="flex-1 truncate">{app.client_id}</span>
                      <button onClick={() => copyToClipboard(app.client_id, app.client_id)} className="ml-2 text-gray-400 hover:text-gray-600">
                        {copied === app.client_id ? <SafeIcon icon={FiCheck} className="text-green-500" /> : <SafeIcon icon={FiCopy} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-end mb-2">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">Client Secret</label>
                      <button onClick={() => rotateSecret(app.id)} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                        <SafeIcon icon={FiRefreshCw} className="text-[10px]" /> Rotate Secret
                      </button>
                    </div>
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-200 font-mono text-sm text-gray-400 italic">
                      Hidden for security (Hash stored)
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Allowed Redirect URIs</label>
                    <textarea
                      defaultValue={(() => { try { return JSON.parse(app.redirect_uris || '[]').join('\n'); } catch(e){ return ''; } })()}
                      onBlur={(e) => {
                        const uris = e.target.value.split('\n').map(u => u.trim()).filter(Boolean);
                        // Validation: no wildcards
                        if (uris.some(u => u.includes('*'))) {
                          alert('Wildcards are not allowed in Redirect URIs');
                          return;
                        }
                        updateApp(app.id, { ...app, redirect_uris: uris });
                      }}
                      placeholder="https://app.example.com/callback (One per line)"
                      className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 font-mono p-2.5 bg-gray-50 border"
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
  );
}

export default Dashboard;
