import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import BrandMark from './BrandMark';
import AuthButton from './AuthButton';
import TurnstileBox from './TurnstileBox';

const { FiGlobe, FiHexagon, FiMail, FiLock, FiX } = FiIcons;

function PassportCard({
  redirectUrl,
  selectedMethod,
  busy,
  error,
  resetKey,
  setTurnstileToken,
  onGoogle,
  onWallet,
  onCancel,
}) {
  const destination = redirectUrl ? new URL(redirectUrl).hostname : '';
  const methodSelected = Boolean(selectedMethod);

  return (
    <main className="passport-card">
      <BrandMark />
      <div className="eyebrow"><span /> SECURE ECOSYSTEM ACCESS</div>
      <h1>One identity.<br /><em>Every AXiM.</em></h1>
      <p className="intro">
        Your secure gateway to the AXiM ecosystem. Sign in once and move
        seamlessly between every workspace.
      </p>

      <div className="access-pill">
        <SafeIcon icon={FiGlobe} />
        <span>Internal access portal</span>
        <b>PHASE 01</b>
      </div>

      <section className="auth-options" aria-label="Authentication options">
        <AuthButton
          icon={FiMail}
          onClick={onGoogle}
          disabled={busy}
        >
          {selectedMethod === 'google' && busy
            ? 'Opening Google…'
            : selectedMethod === 'google'
              ? 'Continue with Google'
              : 'Continue with Google'}
        </AuthButton>

        <div className="or-divider"><span>OR CONNECT</span></div>

        <AuthButton
          icon={FiHexagon}
          onClick={onWallet}
          disabled={busy}
          secondary
        >
          {selectedMethod === 'wallet' && busy
            ? 'Connecting wallet…'
            : 'Connect wallet'}
        </AuthButton>
      </section>

      {methodSelected && !busy && (
        <div className="verification-panel">
          <div className="verification-heading">
            <span>SECURITY CHECK</span>
            <button type="button" onClick={onCancel} aria-label="Cancel authentication">
              <SafeIcon icon={FiX} />
            </button>
          </div>
          <p>Complete the check before continuing securely.</p>
          <TurnstileBox
            resetKey={resetKey}
            onToken={setTurnstileToken}
            onError={() => setTurnstileToken('')}
          />
        </div>
      )}

      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="card-footer">
        <SafeIcon icon={FiLock} />
        <span>Protected by AXiM Core security infrastructure</span>
      </div>

      {destination && (
        <div className="handoff-note">
          Returning to <strong>{destination}</strong> after verification.
        </div>
      )}
    </main>
  );
}

export default PassportCard;