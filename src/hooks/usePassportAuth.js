import { useCallback, useState, useEffect } from 'react';
import {
  authenticate,
  getGoogleAuthUrl,
  getAppleAuthUrl,
  startEmailOtp,
  verifyEmailOtp,
  requestWalletChallenge,
  publishTelemetry,
  checkWorkerHealth,
  logout as apiLogout,
} from '../services/passportApi';
import { createClient } from '@supabase/supabase-js';
import { getWalletAccount, signWalletChallenge } from '../services/walletAuth';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

function usePassportAuth(redirectUrl) {

  const [session, setSession] = useState(null);
  const [identities, setIdentities] = useState([]);

  useEffect(() => {
    // Fetch session on load
    fetch(`${import.meta.env.VITE_PASSPORT_EDGE_URL}/api/v1/auth/session`, { credentials: 'include' })
      .then(res => {
         if (!res.ok) throw new Error('Worker unreachable');
         return res.json();
      })
      .then(data => {
         if (data.authenticated) {
           localStorage.setItem('optimistic_session', JSON.stringify(data.user));
           setSession(data.user);
           return fetch(`${import.meta.env.VITE_PASSPORT_EDGE_URL}/api/v1/auth/identities`, { credentials: 'include' });
         }
      })
      .then(res => res?.json())
      .then(data => {
         if (data?.identities) {
           setIdentities(data.identities);
         }
      })
      .catch(() => {
         // Optimistic session recovery
         const cached = localStorage.getItem('optimistic_session');
         if (cached) {
           try {
             setSession(JSON.parse(cached));
             // Schedule background retry with exponential backoff
             let attempt = 0;
             const retry = () => {
               attempt++;
               const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
               setTimeout(() => {
                 fetch(`${import.meta.env.VITE_PASSPORT_EDGE_URL}/api/v1/auth/session`, { credentials: 'include' })
                   .then(res => {
                     if (res.ok) return res.json();
                     throw new Error('Still unreachable');
                   })
                   .then(data => {
                     if (data.authenticated) {
                        setSession(data.user);
                        localStorage.setItem('optimistic_session', JSON.stringify(data.user));
                     } else {
                        setSession(null);
                        localStorage.removeItem('optimistic_session');
                     }
                   })
                   .catch(retry);
               }, backoff);
             };
             retry();
           } catch(e){ /* ignore */ }
         }
      });
  }, []);

const [selectedMethod, setSelectedMethod] = useState('');
  const [verificationStage, setVerificationStage] = useState('initial');
  const [pendingWallet, setPendingWallet] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const resetVerification = useCallback(() => {
    setTurnstileToken('');
    setResetKey((value) => value + 1);
  }, []);

  const selectMethod = useCallback((method) => {
    setError('');

    if (selectedMethod !== method) {
      setSelectedMethod(method);
      setVerificationStage('initial');
      setPendingWallet(null);
      resetVerification();
      return false;
    }

    return true;
  }, [resetVerification, selectedMethod]);

  const ensureReady = useCallback(() => {
    if (!redirectUrl) {
      throw new Error('A valid AXiM application callback is required to continue.');
    }

    if (!import.meta.env.VITE_PASSPORT_EDGE_URL) {
      throw new Error('Passport Worker is not configured for this deployment.');
    }

    if (!import.meta.env.VITE_TURNSTILE_SITE_KEY) {
      throw new Error('Turnstile is not configured for this deployment.');
    }

    if (!turnstileToken) {
      throw new Error('Complete the security verification before continuing.');
    }
  }, [redirectUrl, turnstileToken]);

  const fail = useCallback((message, transient = false) => {
    setBusy(false);
    setError(message);
    if (!transient) {
      setPendingWallet(null);
      setVerificationStage('initial');
      resetVerification();
    }
  }, [resetVerification]);

  const startGoogle = useCallback(async () => {
    if (busy) return;
    if (!selectMethod('google')) {
      return;
    }

    try {
      ensureReady();
      setBusy(true);

      const isHealthy = await checkWorkerHealth();
      if (!isHealthy && supabase) {
        setError('Standard gateway unreachable, utilizing direct secure connection...');
        await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl } });
        return;
      }

      window.location.assign(getGoogleAuthUrl(redirectUrl, turnstileToken));
    } catch (authenticationError) {
      if (authenticationError.message && authenticationError.message.includes('403 Forbidden')) {
        publishTelemetry('unauthorized_access', { method: 'google' });
        fail('SECURITY_LOCKOUT');
      } else if (authenticationError.message && authenticationError.message.toLowerCase().includes('cancel')) {
        fail('Authentication was cancelled. Please try again.', true);
      } else {
        publishTelemetry('auth_error', { method: 'google', error: authenticationError.message });
        fail(authenticationError.message || 'Google authentication failed.');
      }
    }
  }, [ensureReady, fail, redirectUrl, selectMethod, turnstileToken]);


  const startApple = useCallback(async () => {
    if (busy) return;
    if (!selectMethod('apple')) {
      return;
    }

    try {
      ensureReady();
      setBusy(true);

      const isHealthy = await checkWorkerHealth();
      if (!isHealthy && supabase) {
        setError('Standard gateway unreachable, utilizing direct secure connection...');
        await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: redirectUrl } });
        return;
      }

      window.location.assign(getAppleAuthUrl(redirectUrl, turnstileToken));
    } catch (authenticationError) {
      if (authenticationError.message && authenticationError.message.includes('403 Forbidden')) {
        publishTelemetry('unauthorized_access', { method: 'apple' });
        fail('SECURITY_LOCKOUT');
      } else if (authenticationError.message && authenticationError.message.toLowerCase().includes('cancel')) {
        fail('Authentication was cancelled. Please try again.');
      } else {
        publishTelemetry('auth_error', { method: 'apple', error: authenticationError.message });
        fail(authenticationError.message || 'Apple authentication failed.');
      }
    }
  }, [ensureReady, fail, redirectUrl, selectMethod, turnstileToken]);


  const [emailState, setEmailState] = useState(null);

  const startEmail = useCallback(async (email) => {
    if (busy) return;

    if (verificationStage === 'email-verify') {
      try {
        setBusy(true);
        const startTime = Date.now();
        const res = await verifyEmailOtp(emailState.email, turnstileToken, emailState.nonce);
        const latency = Date.now() - startTime;
        if (res.traceId) window.sessionStorage.setItem('axim_trace_id', res.traceId);
        publishTelemetry('turnstile_verified', { method: 'email', latency, traceId: res.traceId, sessionHash: 'anon' });
        if (res.token) {
          const url = new URL(redirectUrl);
          url.searchParams.set('token', res.token);
          window.location.assign(url.toString());
        }
      } catch (err) {
        fail(err.message || 'OTP verification failed');
      }
      return;
    }

    if (!selectMethod('email')) return;

    if (!email) {
      fail('Please provide an email address.');
      return;
    }

    try {
      ensureReady();
      setBusy(true);

      const startTime = Date.now();
      const res = await startEmailOtp(email, redirectUrl, turnstileToken);
      const latency = Date.now() - startTime;
      if (res.traceId) window.sessionStorage.setItem('axim_trace_id', res.traceId);
      publishTelemetry('auth_attempt', { method: 'email', latency, traceId: res.traceId, sessionHash: 'anon' });
      setEmailState({ email, nonce: res.nonce });
      setVerificationStage('email-verify');
      setBusy(false);
      resetVerification();
    } catch (error) {
       publishTelemetry('auth_error', { method: 'email', error: error.message });
       fail(error.message || 'Failed to send OTP.');
    }
  }, [busy, verificationStage, selectMethod, ensureReady, turnstileToken, redirectUrl, emailState, resetVerification, fail]);

const startWallet = useCallback(async () => {
    if (busy) return;
    if (!selectMethod('wallet')) {
      return;
    }

    try {
      ensureReady();
      setBusy(true);

      if (!pendingWallet) {
        const wallet = await getWalletAccount();
        const challenge = await requestWalletChallenge({
          address: wallet.address,
          chainId: wallet.chainId,
          turnstileToken,
          redirectUrl,
        });

        const startTime = Date.now();
        const signedChallenge = await signWalletChallenge({
          provider: wallet.provider,
          address: wallet.address,
          message: challenge.message,
        });
        const latency = Date.now() - startTime;
        if (challenge.traceId) window.sessionStorage.setItem('axim_trace_id', challenge.traceId);
        publishTelemetry('wallet_signed', { address: wallet.address, latency, traceId: challenge.traceId, sessionHash: 'anon' });

        setPendingWallet({
          wallet,
          challenge,
          signedChallenge,
        });
        setVerificationStage('wallet-verify');
        setBusy(false);
        resetVerification();
        return;
      }

      const handoffUrl = await authenticate({
        method: 'wallet',
        credential: {
          ...pendingWallet.signedChallenge,
          nonce: pendingWallet.challenge.nonce,
          chainId: pendingWallet.wallet.chainId,
        },
        turnstileToken,
        redirectUrl,
      });

      window.location.assign(handoffUrl);
    } catch (authenticationError) {
      if (authenticationError.message && authenticationError.message.includes('403 Forbidden')) {
        const address = pendingWallet?.wallet?.address;
        publishTelemetry('unauthorized_access', { method: 'wallet', address });
        fail('SECURITY_LOCKOUT');
      } else if (authenticationError.code === 4001 || (authenticationError.message && authenticationError.message.toLowerCase().includes('cancel'))) {
        fail('Wallet signature was cancelled. Please try again.', true);
      } else {
        fail(authenticationError.message || 'Wallet authentication failed.');
      }
    }
  }, [
    ensureReady,
    fail,
    pendingWallet,
    redirectUrl,
    resetVerification,
    selectMethod,
    turnstileToken,
  ]);

  const performLogout = useCallback(async () => {
    setBusy(true);
    // Grab any existing token from local storage or wherever the frontend stores it
    const storedToken = localStorage.getItem('passport_token');
    if (storedToken) {
      await apiLogout(storedToken);
      localStorage.removeItem('passport_token');
    }

    // Clear Supabase session if using direct Supabase as fallback
    if (supabase) {
      await supabase.auth.signOut();
    }

    setBusy(false);
    setSelectedMethod('');
    setVerificationStage('initial');
    setPendingWallet(null);
    setEmailState(null);
    setTurnstileToken('');
    setError('');

    // Redirect cleanly
    window.location.href = '/';
  }, []);


  const startWalletLink = useCallback(async () => {
    try {
      setError(null);
      setBusy(true);
      setSelectedMethod('link-wallet');
      const account = await getWalletAccount();
      const challengeReq = await fetch(`${import.meta.env.VITE_PASSPORT_EDGE_URL}/api/v1/auth/wallet/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account.address, chainId: account.chainId, redirect: redirectUrl }),
      });
      if (!challengeReq.ok) throw new Error('Could not request linking challenge. Ensure you have an active session.');
      const challengeData = await challengeReq.json();
      const signed = await signWalletChallenge({ provider: account.provider, address: account.address, message: challengeData.message });
      const linkReq = await fetch(`${import.meta.env.VITE_PASSPORT_EDGE_URL}/api/v1/auth/link-wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: { ...signed, chainId: account.chainId, nonce: challengeData.nonce } }),
        credentials: 'include'
      });
      if (!linkReq.ok) throw new Error('Could not link wallet.');
      setBusy(false);
      setSelectedMethod(null);
      window.location.reload();
    } catch (e) {
      setBusy(false);
      setSelectedMethod(null);
      setError(e.message || 'An error occurred while linking wallet.');
    }
  }, [redirectUrl]);

  const cancel = useCallback(() => {
    setSelectedMethod('');
    setVerificationStage('initial');
    setPendingWallet(null);
    setEmailState(null);
    setTurnstileToken('');
    setError('');
    setBusy(false);
    setResetKey((value) => value + 1);
  }, []);

  const handleTurnstileError = useCallback((message) => {
    setTurnstileToken('');
    setError(message || 'Security verification failed. Try again.');
  }, []);

  return {
    selectedMethod,
    verificationStage,
    turnstileToken,
    resetKey,
    busy,
    error,
    setTurnstileToken,
    handleTurnstileError,
    startGoogle,
    startApple,
    startEmail,
    session,
    identities,
    startWallet,
    cancel,
    logout: performLogout,
  };
}

export default usePassportAuth;