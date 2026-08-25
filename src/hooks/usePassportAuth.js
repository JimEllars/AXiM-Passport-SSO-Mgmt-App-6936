import { useCallback, useState } from 'react';
import {
  authenticate,
  getGoogleAuthUrl,
  requestWalletChallenge,
} from '../services/passportApi';
import { getWalletAccount, signWalletChallenge } from '../services/walletAuth';

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

    if (!import.meta.env.VITE_PASSPORT_WORKER_URL) {
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

  const startGoogle = useCallback(() => {
    if (!selectMethod('google')) {
      return;
    }

    try {
      ensureReady();
      setBusy(true);
      window.location.assign(getGoogleAuthUrl(redirectUrl, turnstileToken));
    } catch (authenticationError) {
      fail(authenticationError.message || 'Google authentication failed.');
    }
  }, [ensureReady, fail, redirectUrl, selectMethod, turnstileToken]);

  const startWallet = useCallback(async () => {
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
      fail(authenticationError.message || 'Wallet authentication failed.');
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