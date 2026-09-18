
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
      value: readiness.turnstile ? 'Active' : (readiness.turnstileState === 'blocked' ? 'Blocked' : (readiness.turnstileState === 'loading' ? 'Verifying...' : (readiness.turnstileState === 'simulated' ? 'Bypass' : 'Challenge Required'))),
      color: readiness.turnstile ? 'text-emerald-400' : (readiness.turnstileState === 'blocked' ? 'text-rose-400' : 'text-amber-400')
    },
    {
      icon: FiActivity,
      label: 'Telemetry',
      value: 'Active',
      color: 'text-emerald-400'
    },
    {
      icon: FiZap,
      label: 'Edge Node',
      value: connectionStatus === 'connected' ? (latency > 0 ? `${latency}ms` : 'Connected') : connectionStatus === 'degraded' ? 'Degraded' : 'Offline',
      color: connectionStatus === 'connected' ? 'text-emerald-400' : connectionStatus === 'degraded' ? 'text-amber-400' : 'text-rose-400'
    },
  ];

  const handleRevoke = () => {
     if(window.confirm('Are you sure you want to revoke this session?')) {
        // Find logout button from parent or dispatch event
        const evt = new CustomEvent('passport:revoke_session');
        window.dispatchEvent(evt);
     }
  };

  const operational = items.every((item) => !item.value.includes('Blocked') && !item.value.includes('Required') && !item.value.includes('Offline'));

  return (
    <section className="flex flex-col gap-3 transition-all duration-300" aria-label="Security status" aria-live="polite" role="status">
      <div className="flex justify-end mb-[-24px] z-10 relative">
        <button onClick={handleRevoke} className="text-[9px] bg-slate-800/80 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 px-2 py-1 rounded border border-slate-700 hover:border-rose-700/50 transition-colors uppercase tracking-wider font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-rose-500 shadow-sm active:scale-[0.98]">
           Revoke Session
        </button>
      </div>
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
            <strong aria-label={`${label} is ${value}`} className={`text-xs transition-colors duration-300 ${color === 'text-emerald-400' ? 'bg-emerald-900/40 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded w-fit mt-1 flex items-center gap-1.5 shadow-[0_0_8px_rgba(16,185,129,0.15)] relative before:absolute before:-left-1 before:top-1.5 before:w-1.5 before:h-1.5 before:bg-emerald-400 before:rounded-full before:animate-pulse' : color === 'text-amber-400' ? 'bg-amber-900/40 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded w-fit mt-1 flex items-center gap-1.5 shadow-[0_0_8px_rgba(245,158,11,0.15)] relative before:absolute before:-left-1 before:top-1.5 before:w-1.5 before:h-1.5 before:bg-amber-400 before:rounded-full before:animate-pulse' : 'bg-rose-900/40 border border-rose-500/30 text-rose-400 px-2 py-0.5 rounded w-fit mt-1 flex items-center gap-1.5 shadow-[0_0_8px_rgba(244,63,94,0.15)] relative before:absolute before:-left-1 before:top-1.5 before:w-1.5 before:h-1.5 before:bg-rose-400 before:rounded-full'}`}>
              {value}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default SecurityStatus;
