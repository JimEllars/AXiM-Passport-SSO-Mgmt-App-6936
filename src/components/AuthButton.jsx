import SafeIcon from '../common/SafeIcon';

function AuthButton({ icon, children, onClick, disabled, isLoading, secondary }) {
  return (
    <div className="w-full relative group">
    <button
      className={`auth-button ${secondary ? 'auth-button-secondary' : ''}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Awaiting security verification...' : ''}
    >
      <SafeIcon icon={icon} />
      <span>{children}</span>
      {isLoading ? (
        <span className="processing-dot" style={{ marginLeft: 'auto' }} />
      ) : (
        <span className="button-arrow">↗</span>
      )}
    </button>
  </div>
  );
}

export default AuthButton;
