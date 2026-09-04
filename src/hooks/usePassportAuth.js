import { useCallback, useState } from 'react';
import {
  authenticate,
  getGoogleAuthUrl,
  requestWalletChallenge,
  publishTelemetry,
  checkWorkerHealth,
} from '../services/passportApi';
import { createClient } from '@supabase/supabase-js';
import { getWalletAccount, signWalletChallenge } from '../services/walletAuth';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

function usePassportAuth(redirectUrl) {
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

  const fail = useCallback((message) => {
    setBusy(false);
    setError(message);
    setPendingWallet(null);
    setVerificationStage('initial');
    resetVerification();
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
        fail('Authentication was cancelled. Please try again.');
      } else {
        fail(authenticationError.message || 'Google authentication failed.');
      }
    }
  }, [ensureReady, fail, redirectUrl, selectMethod, turnstileToken]);

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

        const signedChallenge = await signWalletChallenge({
          provider: wallet.provider,
          address: wallet.address,
          message: challenge.message,
        });

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
        fail('Wallet signature was cancelled. Please try again.');
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

  const cancel = useCallback(() => {
    setSelectedMethod('');
    setVerificationStage('initial');
    setPendingWallet(null);
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
    startWallet,
    cancel,
  };
}

export default usePassportAuth;