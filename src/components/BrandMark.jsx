import SafeIcon from '../common/SafeIcon';
import * as FiIcons from 'react-icons/fi';

const { FiShield } = FiIcons;

function BrandMark() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <SafeIcon icon={FiShield} />
      </div>
      <div>
        <strong>AXiM</strong>
        <span>Passport</span>
      </div>
    </div>
  );
}

export default BrandMark;