import brand192 from '../assets/tmp-camera-icon-192.png';
import brand512 from '../assets/tmp-camera-icon-512.png';
import brand1024 from '../assets/tmp-camera-icon-1024.png';

export function BrandIcon({ size = 'medium', decorative = true, className = '' }) {
  const alt = decorative ? '' : 'TMP Networks Camera Surveillance';
  return <span
    className={`brand-icon brand-icon-${size} ${className}`.trim()}
    aria-hidden={decorative ? 'true' : undefined}
  >
    <img
      src={brand192}
      srcSet={`${brand192} 192w, ${brand512} 512w, ${brand1024} 1024w`}
      sizes={size === 'hero' ? '112px' : size === 'login' ? '82px' : '56px'}
      alt={alt}
      width="192"
      height="192"
      decoding="async"
      draggable="false"
    />
  </span>;
}
