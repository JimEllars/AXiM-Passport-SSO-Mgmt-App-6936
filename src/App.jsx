import { useCallback, useMemo, useState } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from './common/SafeIcon';
import PassportCard from './components/PassportCard';
import {
  authenticate,
  getGoogleAuthUrl,
  getRedirectUrl,
  requestWalletChallenge,
} from './services/passportApi';
import { getWalletAccount, signWalletChallenge } from './services/walletAuth';
import './App.css';

const { FiActivity, FiArrowUpRight } = FiIcons;

function App() {
  const redirectUrl = useMemo(getRedirectUrl, []);
  const [selectedMethod, setSelectedMethod] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectMethod = useCallback((method) => {
    setError('');

    if (selectedMethod !== method) {
      setTurnstileToken('');
      setResetKey((value) => value + 1);
      setSelectedMethod(method);
      return false;
    }

    return true;
  }, [selectedMethod]);

  const ensureReady = useCallback(() => {
    if (!redirectUrl) {
      throw new Error('A valid AXiM application callback is required to continue.');
    }

    if (!import.meta.env.VITE_TURNSTILE_SITE_KEY) {
      throw new Error('Turnstile is not configured for this deployment.');
    }

    if (!turnstileToken) {
      throw new Error('Complete the security verification before continuing.');
    }
  }, [redirectUrl, turnstileToken]);

  const startGoogleAuthentication = useCallback(() => {
    if (!selectMethod('google')) {
      return;
    }

    try {
      ensureReady();
      setBusy(true);
      window.location.assign(getGoogleAuthUrl(redirectUrl, turnstileToken));
    } catch (authenticationError) {
      setError(authenticationError.message || 'Google authentication failed.');
      setBusy(false);
    }
  }, [redirectUrl, ensureReady, selectMethod, turnstileToken]);

  const startWalletAuthentication = useCallback(async () => {
    if (!selectMethod('wallet')) {
      return;
    }

    setError('');

    try {
      ensureReady();
      setBusy(true);

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

      const handoffUrl = await authenticate({
        method: 'wallet',
        credential: {
          ...signedChallenge,
          nonce: challenge.nonce,
          chainId: wallet.chainId,
        },
        turnstileToken,
        redirectUrl,
      });

      window.location.assign(handoffUrl);
    } catch (authenticationError) {
      setError(authenticationError.message || 'Wallet authentication failed.');
      setBusy(false);
      setTurnstileToken('');
      setResetKey((value) => value + 1);
    }
  }, [ensureReady, redirectUrl, selectMethod, turnstileToken]);

  const cancelAuthentication = useCallback(() => {
    setSelectedMethod('');
    setTurnstileToken('');
    setError('');
    setResetKey((value) => value + 1);
  }, []);

  return (
    <div className="passport-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div className="topbar-status">
          <SafeIcon icon={FiActivity} /> SYSTEM OPERATIONAL
        </div>
        <span className="topbar-version">PASSPORT / 01.0</span>
      </header>

      <PassportCard
        redirectUrl={redirectUrl}
        selectedMethod={selectedMethod}
        busy={busy}
        error={error}
        resetKey={resetKey}
        setTurnstileToken={setTurnstileToken}
        onGoogle={startGoogleAuthentication}
        onWallet={startWalletAuthentication}
        onCancel={cancelAuthentication}
      />

      <footer className="site-footer">
        <span>© 2025 AXiM CORE</span>
        <span className="footer-link">
          SECURITY FIRST <SafeIcon icon={FiArrowUpRight} />
        </span>
      </footer>
    </div>
  );
}

export default App;