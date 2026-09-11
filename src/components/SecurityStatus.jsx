
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { useState, useEffect } from 'react';

const { FiCheckCircle, FiLock, FiShield, FiZap, FiAlertTriangle, FiActivity } = FiIcons;

function SecurityStatus({ readiness, errorWarning, connectionStatus }) {
  const [latency, setLatency] = useState(0);

  useEffect(() => {
    let mounted = true;
    const measurePing = async () => {
       const start = performance.now();
       try {
         await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
         const duration = Math.round(performance.now() - start);
         if (mounted) setLatency(duration);
       } catch (e) {
         if (mounted) setLatency(-1);
       }
    };
    measurePing();
    const interval = setInterval(measurePing, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const items = [
    {
      icon: FiShield,
      label: 'Bot Protection',
      value: readiness.turnstile ? 'Verified Human' : (readiness.turnstileState === 'blocked' ? 'Verification Blocked' : (readiness.turnstileState === 'loading' ? 'Verifying...' : 'Challenge Required')),
      color: readiness.turnstile ? 'text-emerald-400' : (readiness.turnstileState === 'blocked' ? 'text-rose-400' : 'text-amber-400')
    },
    {
      icon: FiLock,
      label: 'Protocol Security',
      value: 'TLS 1.3 / AES-GCM',
      color: 'text-emerald-400'
    },
    {
      icon: FiZap,
      label: 'Edge Connection',
      value: connectionStatus === 'connected' ? (latency > 0 ? `Active (${latency}ms)` : 'Active') : connectionStatus === 'reconnecting' ? 'Connection Degraded' : 'Offline',
      color: connectionStatus === 'connected' ? 'text-emerald-400' : connectionStatus === 'reconnecting' ? 'text-amber-400' : 'text-rose-400'
    },
  ];

  const operational = items.every((item) => !item.value.includes('Blocked') && !item.value.includes('Required') && !item.value.includes('Offline'));

  return (
    <section className="flex flex-col gap-3 transition-all duration-300" aria-label="Security status" aria-live="polite" role="status">
      {errorWarning && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-amber-200 bg-amber-900/40 border border-amber-700/50 rounded backdrop-blur-md">
          <SafeIcon icon={FiAlertTriangle} />
          <span>{errorWarning}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs font-semibold tracking-wider text-slate-400 uppercase mb-1">
        <span>SECURITY POSTURE</span>
        <span className={operational ? 'text-emerald-400' : 'text-rose-400'}>
          <SafeIcon icon={operational ? FiCheckCircle : FiShield} />
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {items.map(({ icon, label, value, color }) => (
          <div className="flex flex-col gap-1 p-3 bg-slate-900/60 ring-1 ring-white/10 rounded backdrop-blur-md" key={label}>
            <div className="flex items-center gap-2 text-slate-300 text-sm">
              <SafeIcon icon={icon} />
              <span>{label}</span>
            </div>
            <strong className={`text-xs transition-colors duration-300 ${color === 'text-emerald-400' ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded w-fit mt-1 flex items-center gap-1.5 shadow-[0_0_8px_rgba(16,185,129,0.15)] relative before:absolute before:-left-1 before:top-1.5 before:w-1.5 before:h-1.5 before:bg-emerald-400 before:rounded-full before:animate-pulse' : color === 'text-amber-400' ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded w-fit mt-1 flex items-center gap-1.5 shadow-[0_0_8px_rgba(245,158,11,0.15)] relative before:absolute before:-left-1 before:top-1.5 before:w-1.5 before:h-1.5 before:bg-amber-400 before:rounded-full before:animate-pulse' : 'bg-rose-500/20 border border-rose-500/30 text-rose-400 px-2 py-0.5 rounded w-fit mt-1 flex items-center gap-1.5 shadow-[0_0_8px_rgba(244,63,94,0.15)] relative before:absolute before:-left-1 before:top-1.5 before:w-1.5 before:h-1.5 before:bg-rose-400 before:rounded-full'}`}>
              {value}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default SecurityStatus;
