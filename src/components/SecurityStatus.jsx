import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';

const { FiCheckCircle, FiLock, FiShield, FiZap } = FiIcons;

function SecurityStatus({ readiness }) {
  const items = [
    {
      icon: FiShield,
      label: 'Turnstile protection',
      value: readiness.turnstile ? 'Ready' : 'Required',
    },
    {
      icon: FiLock,
      label: 'Redirect validation',
      value: readiness.redirect && readiness.origins ? 'Approved' : 'Blocked',
    },
    {
      icon: FiZap,
      label: 'Passport Worker',
      value: readiness.worker ? 'Protected' : 'Required',
    },
  ];

  const operational = items.every((item) => item.value !== 'Blocked' && item.value !== 'Required');

  return (
    <section className="security-status" aria-label="Security status">
      <div className="section-label">
        <span>SECURITY POSTURE</span>
        <SafeIcon icon={operational ? FiCheckCircle : FiShield} />
      </div>

      <div className="status-grid">
        {items.map(({ icon, label, value }) => (
          <div className="status-item" key={label}>
            <SafeIcon icon={icon} />
            <span>{label}</span>
            <strong className={value === 'Blocked' || value === 'Required' ? 'status-blocked' : ''}>
              {value}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default SecurityStatus;