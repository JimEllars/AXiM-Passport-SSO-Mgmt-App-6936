import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';

const { FiCheckCircle, FiLock, FiShield, FiZap, FiAlertTriangle } = FiIcons;

function SecurityStatus({ readiness, errorWarning }) {
  const items = [
    {
      icon: FiShield,
      label: 'Turnstile protection',
      value: readiness.turnstile ? 'Ready' : 'Required',
      color: readiness.turnstile ? 'text-emerald-400' : 'text-rose-400'
    },
    {
      icon: FiLock,
      label: 'Redirect validation',
      value: readiness.redirect && readiness.origins ? 'Approved' : 'Blocked',
      color: readiness.redirect && readiness.origins ? 'text-emerald-400' : 'text-rose-400'
    },
    {
      icon: FiZap,
      label: 'Passport Worker',
      value: readiness.worker ? 'Protected' : 'Required',
      color: readiness.worker ? 'text-emerald-400' : 'text-amber-400'
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
            <strong className={`text-xs ${color}`}>
              {value}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default SecurityStatus;
