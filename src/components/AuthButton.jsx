import SafeIcon from '../common/SafeIcon';

function AuthButton({ icon, children, onClick, disabled, secondary }) {
  return (
    <button
      className={`auth-button ${secondary ? 'auth-button-secondary' : ''}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <SafeIcon icon={icon} />
      <span>{children}</span>
      <span className="button-arrow">↗</span>
    </button>
  );
}

export default AuthButton;