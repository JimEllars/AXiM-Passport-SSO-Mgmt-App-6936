import { useMemo } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from './common/SafeIcon';
import PassportCard from './components/PassportCard';
import usePassportAuth from './hooks/usePassportAuth';
import {
  getPassportReadiness,
  getRedirectState,
} from './services/passportApi';
import './App.css';

const { FiActivity, FiArrowUpRight } = FiIcons;

function App() {
  const redirectState = useMemo(getRedirectState, []);
  const readiness = useMemo(
    () => getPassportReadiness(redirectState.url),
    [redirectState.url],
  );
  const auth = usePassportAuth(redirectState.url);

  return (
    <div className="passport-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div className="topbar-status">
          <SafeIcon icon={FiActivity} />
          SYSTEM OPERATIONAL
        </div>
        <span className="topbar-version">PASSPORT / 01.0</span>
      </header>

      <PassportCard
        redirectUrl={redirectState.url}
        redirectError={redirectState.error}
        readiness={readiness}
        selectedMethod={auth.selectedMethod}
        busy={auth.busy}
        error={auth.error}
        resetKey={auth.resetKey}
        setTurnstileToken={auth.setTurnstileToken}
        onVerificationError={auth.handleTurnstileError}
        onGoogle={auth.startGoogle}
        onWallet={auth.startWallet}
        onCancel={auth.cancel}
      />

      <footer className="site-footer">
        <span>© 2025 AXiM CORE</span>
        <span className="footer-link">
          SECURITY FIRST
          <SafeIcon icon={FiArrowUpRight} />
        </span>
      </footer>
    </div>
  );
}

export default App;