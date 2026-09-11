import * as FiIcons from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '../common/SafeIcon';
import BrandMark from './BrandMark';
import AuthButton from './AuthButton';
import TurnstileBox from './TurnstileBox';
import SecurityStatus from './SecurityStatus';
import { useState, useRef, useEffect } from 'react';

function getAppNameFromUrl(urlStr) {
  if (!urlStr) return 'AXiM Ecosystem';
  try {
    const url = new URL(urlStr);
    switch (url.hostname) {
      case 'nexus.axim.us.com': return 'Nexus CRM';
      case 'echo.axim.us.com': return 'Echo Recovery';
      case 'onyx.axim.us.com': return 'Onyx Portal';
      case 'greenmachine.axim.us.com': return 'Green Machine';
      case 'support.axim.us.com': return 'Support System';
      case 'asguard.axim.us.com': return 'Asguard SOC';
      case 'voice.axim.us.com': return 'Voice Core';
      case 'groundgame.axim.us.com': return 'Ground Game';
      case 'ceodept.axim.us.com': return 'CEO Dept';
      default: {
        const parts = url.hostname.split('.');
        if (parts.length >= 3 && parts[parts.length - 2] === 'us' && parts[parts.length - 1] === 'com' && parts[parts.length - 3] === 'axim') {
           const subdomain = parts[0];
           return subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
        }
        return 'AXiM Ecosystem';
      }
    }
  } catch (e) {
    return 'AXiM Ecosystem';
  }
}

const {
  FiGlobe,
  FiHexagon,
  FiMail,
  FiLock,
  FiX,
  FiAlertCircle,
  FiSmartphone,
  FiCheckCircle,
  FiPlusCircle
} = FiIcons;

function PassportCard({
  redirectUrl,
  redirectError,
  readiness,
  connectionStatus,
  selectedMethod,
  verificationStage,
  busy,
  error,
  resetKey,
  setTurnstileToken,
  onVerificationError,
  onGoogle,
  onApple,
  onEmail,
  onWallet,
  onCancel,
  onLinkWallet,
  identities = [],
  isEmailAuthenticated,
  isWalletLinked,
}) {
  const destination = redirectUrl ? new URL(redirectUrl).hostname : '';
  const appName = getAppNameFromUrl(redirectUrl);
  const methodSelected = Boolean(selectedMethod);
  const walletFinalVerification = verificationStage === 'wallet-verify';
  const emailFinalVerification = verificationStage === 'email-verify';

  const [emailInput, setEmailInput] = useState('');
  const session = (() => { try { const cached = localStorage.getItem('optimistic_session'); return cached ? JSON.parse(cached) : null; } catch { return null; } })();
  const [sessionExpiryCountdown, setSessionExpiryCountdown] = useState(null);

  useEffect(() => {
    if (session && session.exp) {
      const updateCountdown = () => {
        const timeUntilRefresh = session.exp * 1000 - Date.now();
        if (timeUntilRefresh > 0) {
            setSessionExpiryCountdown(Math.ceil(timeUntilRefresh / 1000));
        } else {
            setSessionExpiryCountdown(0);
        }
      };
      updateCountdown();
      const interval = setInterval(updateCountdown, 1000);
      return () => clearInterval(interval);
    } else {
        setSessionExpiryCountdown(null);
    }
  }, [session]);

  const turnstileRef = useRef(null);

  const verificationCopy = walletFinalVerification
    ? 'Complete the final verification to securely verify your wallet signature.'
    : emailFinalVerification
    ? 'Enter the 6-digit code sent to your email.'
    : 'Complete the managed verification before continuing.';

  const walletLabel = walletFinalVerification
    ? 'Verify wallet signature'
    : 'Connect Web3 Wallet';


const CopyableId = ({ text, children }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span
      onClick={handleCopy}
      className="relative group cursor-pointer flex items-center gap-1 hover:text-white transition-colors"
      title="Copy to clipboard"
      aria-label="Copy identifier"
    >
      {children}
      {copied ? <SafeIcon icon={FiCheckCircle} className="text-emerald-400 w-3 h-3" /> : <SafeIcon icon={FiPlusCircle} className="opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3" />}
      {copied && (
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-xs text-white px-2 py-1 rounded shadow-lg">
          Copied!
        </span>
      )}
    </span>
  );
};

  const renderIdentities = () => {
    if (identities === undefined) {
      return (
        <div className="mt-6 border-t border-slate-700/50 pt-4" aria-live="polite">
          <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">Connected Accounts</h3>
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="animate-pulse bg-slate-800/50 rounded h-10 w-full border border-slate-700"></div>
            ))}
          </div>
        </div>
      );
    }

    if (!identities || identities.length === 0) return null;


    const emailIdentity = identities.find(i => i.provider === 'email' || i.provider === 'google' || i.provider === 'apple');
    const walletIdentity = identities.find(i => i.provider === 'wallet');
    const googleIdentity = identities.find(i => i.provider === 'google');
    const appleIdentity = identities.find(i => i.provider === 'apple');

    return (
      <div className="mt-6 border-t border-slate-700/50 pt-4">
        <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">Connected Accounts</h3>
        <div className="space-y-2">
          {emailIdentity ? (
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-2 text-sm border border-slate-700">
              <CopyableId text={emailIdentity.identifier}><span className="flex items-center gap-2 text-slate-300"><SafeIcon icon={FiMail} /> {emailIdentity.identifier}</span></CopyableId>
              <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 text-xs font-semibold tracking-wide" role="status" aria-live="polite"><SafeIcon icon={FiCheckCircle} /> Active</span>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-2 text-sm border border-slate-700 border-dashed cursor-pointer hover:bg-slate-700/50" onClick={onEmail}>
              <span className="flex items-center gap-2 text-slate-400"><SafeIcon icon={FiMail} /> Connect Email</span>
              <span className="text-slate-500 flex items-center gap-1 text-xs"><SafeIcon icon={FiPlusCircle} /> Link</span>
            </div>
          )}

          {walletIdentity ? (
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-2 text-sm border border-slate-700">
              <CopyableId text={walletIdentity.identifier}><span className="flex items-center gap-2 text-slate-300 font-mono"><SafeIcon icon={FiHexagon} /> {walletIdentity.identifier.slice(0,6)}...{walletIdentity.identifier.slice(-4)}</span></CopyableId>
              <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 text-xs font-semibold tracking-wide" role="status" aria-live="polite"><SafeIcon icon={FiCheckCircle} /> Active</span>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-2 text-sm border border-slate-700 border-dashed cursor-pointer hover:bg-slate-700/50" onClick={onLinkWallet}>
              <span className="flex items-center gap-2 text-slate-400"><SafeIcon icon={FiHexagon} /> Connect Web3 Wallet</span>
              <span className="text-slate-500 flex items-center gap-1 text-xs"><SafeIcon icon={FiPlusCircle} /> Link</span>
            </div>
          )}

          {googleIdentity ? (
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-2 text-sm border border-slate-700">
              <span className="flex items-center gap-2 text-slate-300"><SafeIcon icon={FiGlobe} /> Google Account</span>
              <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 text-xs font-semibold tracking-wide" role="status" aria-live="polite"><SafeIcon icon={FiCheckCircle} /> Active</span>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-2 text-sm border border-slate-700 border-dashed cursor-pointer hover:bg-slate-700/50" onClick={onGoogle}>
              <span className="flex items-center gap-2 text-slate-400"><SafeIcon icon={FiGlobe} /> Connect Google</span>
              <span className="text-slate-500 flex items-center gap-1 text-xs"><SafeIcon icon={FiPlusCircle} /> Link</span>
            </div>
          )}

          {appleIdentity ? (
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-2 text-sm border border-slate-700">
              <span className="flex items-center gap-2 text-slate-300"><SafeIcon icon={FiSmartphone} /> Apple Account</span>
              <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 text-xs font-semibold tracking-wide" role="status" aria-live="polite"><SafeIcon icon={FiCheckCircle} /> Active</span>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-2 text-sm border border-slate-700 border-dashed cursor-pointer hover:bg-slate-700/50" onClick={onApple}>
              <span className="flex items-center gap-2 text-slate-400"><SafeIcon icon={FiSmartphone} /> Connect Apple</span>
              <span className="text-slate-500 flex items-center gap-1 text-xs"><SafeIcon icon={FiPlusCircle} /> Link</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="passport-card relative overflow-hidden backdrop-blur-md bg-slate-900/90 border border-white/10 shadow-2xl shadow-cyan-950/20">
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-emerald-500/20 to-indigo-500/20 opacity-30 animate-pulse" style={{ zIndex: 0, pointerEvents: 'none' }}></div>
      <div className="relative" style={{ zIndex: 1 }}>
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

      <div className="sub-headline" style={{ marginTop: '16px', marginBottom: '16px', fontSize: '14px', color: 'var(--lime)', fontWeight: '600' }}>
        Sign in to continue to {appName}
      </div>

      <div className="access-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
        <SafeIcon icon={FiGlobe} />
        <span>Internal access portal</span>
        <b>PHASE 01</b>
      </div>

      <SecurityStatus readiness={readiness} errorWarning={error} connectionStatus={connectionStatus} />
      {sessionExpiryCountdown !== null && sessionExpiryCountdown < 300 && (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-amber-200 bg-amber-900/40 border border-amber-700/50 rounded backdrop-blur-md mb-4 mt-2" role="status" aria-live="polite">
            <SafeIcon icon={FiAlertCircle} />
            <span>Session expires in {Math.floor(sessionExpiryCountdown / 60)}:{(sessionExpiryCountdown % 60).toString().padStart(2, '0')}</span>
          </div>
      )}

      {!redirectUrl && (
        redirectError === 'The requested application is not an approved AXiM destination.' ? (
          <div className="error-message focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" role="alert" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', borderWidth: '2px', backgroundColor: 'rgba(255, 78, 78, 0.15)', marginBottom: '24px' }}>
            <SafeIcon icon={FiAlertCircle} />
            <span style={{ fontWeight: 600 }}>SECURITY LOCKOUT: Unauthorized Application Callback</span>
          </div>
        ) : (
          <div className="configuration-warning" role="alert">
            <SafeIcon icon={FiAlertCircle} />
            <span>{redirectError || 'An approved application callback is required.'}</span>
          </div>
        )
      )}

      {identities === undefined || (busy && !methodSelected) ? (
      <section className="auth-options" aria-label="Loading authentication" aria-live="polite" aria-busy="true">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="animate-pulse bg-slate-800/50 border border-slate-700/50 rounded-lg h-12 w-full mb-3 shadow"></div>
        ))}
      </section>
    ) : identities && identities.length > 0 ? renderIdentities() : (
      <section className="auth-options" aria-label="Authentication options" aria-live="polite" aria-busy={busy}>
        <AuthButton
          icon={FiHexagon}
          onClick={onWallet}
          disabled={busy || !redirectUrl}
          isLoading={selectedMethod === 'wallet' && busy}
        >
          {selectedMethod === 'wallet' && busy
            ? 'Verifying wallet…'
            : walletLabel}
        </AuthButton>

        <AuthButton icon={FiMail} onClick={() => onEmail(emailInput)} disabled={busy || !redirectUrl} isLoading={selectedMethod === 'email' && busy} secondary>
          {selectedMethod === 'email' && busy
            ? 'Sending OTP...'
            : 'Continue with Email'}
        </AuthButton>

        <AuthButton icon={FiGlobe} onClick={onGoogle} disabled={busy || !redirectUrl} isLoading={selectedMethod === 'google' && busy} secondary>
          {selectedMethod === 'google' && busy
            ? 'Opening Google…'
            : 'Continue with Google'}
        </AuthButton>

        <AuthButton icon={FiSmartphone} onClick={onApple} disabled={busy || !redirectUrl} isLoading={selectedMethod === 'apple' && busy} secondary>
          {selectedMethod === 'apple' && busy
            ? 'Opening Apple…'
            : 'Continue with Apple'}
        </AuthButton>
      </section>
      )}


      <AnimatePresence mode="wait">

      <div className="flex flex-wrap gap-2 mt-4 mb-4 justify-center" style={{ fontSize: '11px', fontWeight: 'bold' }}>
        <span className="px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 shadow flex items-center gap-1">
          <FiHexagon /> SIWE Cryptographic Link
        </span>
        <span className="px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 shadow flex items-center gap-1">
          <SafeIcon icon={FiGlobe} /> Department: Verified
        </span>
        <span className="px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 shadow flex items-center gap-1">
          <SafeIcon icon={FiLock} /> Turnstile Verified
        </span>
      </div>

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
              {walletFinalVerification || emailFinalVerification ? 'FINAL SECURITY CHECK' : 'SECURITY CHECK'}
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

          {selectedMethod === 'email' && !emailFinalVerification && (
             <div className="mb-4">
                <input
                  type="email"
                  placeholder="name@axim.us.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                />
             </div>
          )}

          <TurnstileBox
            ref={turnstileRef}
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

      {error === 'SECURITY_LOCKOUT' ? (
        <div className="error-message focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" role="alert" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', borderWidth: '2px', backgroundColor: 'rgba(255, 78, 78, 0.15)' }}>
          <SafeIcon icon={FiAlertCircle} />
          <span style={{ fontWeight: 600 }}>SECURITY LOCKOUT: Unauthorized Ecosystem Access - Incident Logged</span>
        </div>
      ) : error ? (
        <div className="error-message focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" role="alert">
          <SafeIcon icon={FiAlertCircle} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="card-footer">
        <SafeIcon icon={FiLock} />
        <span>Protected by AXiM Core security infrastructure</span>
      </div>

      {destination && (
        <div className="handoff-note">
          Returning to <strong>{destination}</strong> after verification.
        </div>
      )}
          </div>
    </main>
  );
}

export default PassportCard;
