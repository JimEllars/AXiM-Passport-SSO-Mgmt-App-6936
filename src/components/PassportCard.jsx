import * as FiIcons from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';
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
  verificationStage,
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
  const walletFinalVerification = verificationStage === 'wallet-verify';

  const verificationCopy = walletFinalVerification
    ? 'Complete the final verification to securely verify your wallet signature.'
    : 'Complete the managed verification before continuing.';

  const walletLabel = walletFinalVerification
    ? 'Verify wallet signature'
    : 'Connect wallet';

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
        <AuthButton icon={FiMail} onClick={onGoogle} disabled={busy || !redirectUrl} isLoading={selectedMethod === 'google' && busy}>
          {selectedMethod === 'google' && busy
            ? 'Opening Google…'
            : 'Continue with Google'}
        </AuthButton>

        <div className="or-divider">
          <span>OR CONNECT</span>
        </div>

        <AuthButton
          icon={FiHexagon}
          onClick={onWallet}
          disabled={busy || !redirectUrl}
          isLoading={selectedMethod === 'wallet' && busy}
          secondary
        >
          {selectedMethod === 'wallet' && busy
            ? 'Verifying wallet…'
            : walletLabel}
        </AuthButton>
      </section>

      <AnimatePresence mode="wait">
      {methodSelected && !busy && (
        <motion.div
          className="verification-panel"
          initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
          animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
          exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
          transition={{ duration: 0.3 }}
        >
          <div className="verification-heading">
            <span>
              {walletFinalVerification ? 'FINAL SECURITY CHECK' : 'SECURITY CHECK'}
            </span>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel authentication"
            >
              <SafeIcon icon={FiX} />
            </button>
          </div>

          <p>{verificationCopy}</p>

          <TurnstileBox
            resetKey={resetKey}
            onToken={setTurnstileToken}
            onError={onVerificationError}
          />
        </motion.div>
      )}

      {busy && (
        <motion.div
          className="processing-state"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
        >
          <div className="cyber-loader">
            <motion.div className="cyber-bar" animate={{ scaleX: [0, 1, 0], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }} />
            <motion.div className="cyber-bar" animate={{ scaleX: [0, 1, 0], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.5, delay: 0.2, repeat: Infinity, ease: "easeInOut" }} />
            <motion.div className="cyber-bar" animate={{ scaleX: [0, 1, 0], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.5, delay: 0.4, repeat: Infinity, ease: "easeInOut" }} />
          </div>
          <span>Establishing a protected Passport session…</span>
        </motion.div>
      )}
      </AnimatePresence>

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