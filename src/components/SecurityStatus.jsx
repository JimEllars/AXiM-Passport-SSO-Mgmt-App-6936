import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';

const { FiCheckCircle, FiLock, FiShield, FiZap, FiAlertTriangle } = FiIcons;

function SecurityStatus({ readiness, errorWarning, connectionStatus }) {
  const items = [
    {
      icon: FiShield,
      label: 'Bot Protection',
      value: readiness.turnstile ? 'Verified' : 'Required',
      color: readiness.turnstile ? 'text-emerald-400' : 'text-rose-400'
    },
    {
      icon: FiLock,
      label: 'Session Security',
      value: readiness.redirect && readiness.origins ? 'Approved' : 'Blocked',
      color: readiness.redirect && readiness.origins ? 'text-emerald-400' : 'text-rose-400'
    },
    {
      icon: FiZap,
      label: 'Edge Connection',
      value: connectionStatus === 'connected' ? 'Active' : connectionStatus === 'reconnecting' ? 'Degraded' : 'Offline',
      color: connectionStatus === 'connected' ? 'text-emerald-400' : connectionStatus === 'reconnecting' ? 'text-amber-400' : 'text-rose-400'
    },
  ];

  const operational = items.every((item) => item.value !== 'Blocked' && item.value !== 'Required');

  return (
    <section className="flex flex-col gap-3" aria-label="Security status">
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
            <strong className={`text-xs ${color === 'text-emerald-400' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded w-fit mt-1' : color === 'text-amber-400' ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded w-fit mt-1' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded w-fit mt-1'}`}>
              {value}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default SecurityStatus;
