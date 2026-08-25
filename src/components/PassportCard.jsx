import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import BrandMark from './BrandMark';
import AuthButton from './AuthButton';
import TurnstileBox from './TurnstileBox';
import SecurityStatus from './SecurityStatus';

const {
  FiGlobe,
  FiHexagon,
  FiMail,
  FiLock,
  FiX,
  FiAlertCircle,
} = FiIcons;

function PassportCard({
  redirectUrl,
  redirectError,
  readiness,
  selectedMethod,
  busy,
  error,
  resetKey,
  setTurnstileToken,
  onVerificationError,
  onGoogle,
  onWallet,
  onCancel,
}) {
  const destination = redirectUrl ? new URL(redirectUrl).hostname : '';
  const methodSelected = Boolean(selectedMethod);

  return (
    <main className="passport-card">
      <BrandMark />

      <div className="eyebrow">
        <span /> SECURE ECOSYSTEM ACCESS
      </div>

      <h1>
        One identity.
        <br />
        <em>Every AXiM.</em>
      </h1>

      <p className="intro">
        Your secure gateway to the AXiM ecosystem. Sign in once and move
        seamlessly between every workspace.
      </p>

      <div className="access-pill">
        <SafeIcon icon={FiGlobe} />
        <span>Internal access portal</span>
        <b>PHASE 01</b>
      </div>

      <SecurityStatus readiness={readiness} />

      {!redirectUrl && (
        <div className="configuration-warning" role="alert">
          <SafeIcon icon={FiAlertCircle} />
          <span>{redirectError || 'An approved application callback is required.'}</span>
        </div>
      )}

      <section className="auth-options" aria-label="Authentication options">
        <AuthButton icon={FiMail} onClick={onGoogle} disabled={busy || !redirectUrl}>
          {selectedMethod === 'google' && busy
            ? 'Opening Google…'
            : 'Continue with Google'}
        </AuthButton>

        <div className="or-divider">
          <span>OR CONNECT</span>
        </div>

        <AuthButton icon={FiHexagon} onClick={onWallet} disabled={busy || !redirectUrl} secondary>
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

          <p>Complete the managed verification before continuing.</p>

          <TurnstileBox
            resetKey={resetKey}
            onToken={setTurnstileToken}
            onError={onVerificationError}
          />
        </div>
      )}

      {busy && (
        <div className="processing-state" role="status" aria-live="polite">
          <span className="processing-dot" />
          Establishing a protected Passport session…
        </div>
      )}

      {error && (
        <div className="error-message" role="alert">
          <SafeIcon icon={FiAlertCircle} />
          <span>{error}</span>
        </div>
      )}

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