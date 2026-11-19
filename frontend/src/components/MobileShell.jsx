import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Camera, Clapperboard, MoreHorizontal, Smartphone } from 'lucide-react';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { liveStreamPool } from '../services/liveStreamPool.js';
import { setInterfacePreference } from '../services/mobileRouting.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { BrandIcon } from './BrandIcon.jsx';

export function MobileShell() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const cameras = useSelector((state) => state.cameras.items);
  const cameraStatus = useSelector((state) => state.cameras.status);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') dispatch(loadCameras());
    };
    if (cameraStatus === 'idle') refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [dispatch, cameraStatus]);

  // The existing pooled video connection is used only on the selected camera.
  // Do not leave a mobile live subscriber running after leaving the portal.
  useEffect(() => () => liveStreamPool.destroyAll({ force: true }), []);

  const online = cameras.filter((camera) => camera.status === 'online').length;
  const cameraActive = pathname === '/mobile' || pathname.startsWith('/mobile/cameras/');
  const navItems = [
    { path: '/mobile', icon: Camera, label: t('mobile.tabs.cameras'), active: cameraActive, end: true },
    { path: '/mobile/recordings', icon: Clapperboard, label: t('mobile.tabs.recordings'), active: pathname.startsWith('/mobile/recordings') },
    { path: '/mobile/more', icon: MoreHorizontal, label: t('mobile.tabs.more'), active: pathname.startsWith('/mobile/more') },
  ];

  function switchDesktop() {
    setInterfacePreference('desktop');
    navigate('/', { replace: true });
  }

  return <div className="mobile-shell">
    <header className="mobile-header">
      <Link to="/mobile" className="mobile-header-brand" aria-label={t('mobile.tabs.cameras')}>
        <BrandIcon size="sidebar"/>
        <span><strong>TMP Networks</strong><small>Camera Surveillance</small></span>
      </Link>
      <div className="mobile-header-actions">
        <span className="mobile-header-online" title={t('mobile.onlineCount', { online, total: cameras.length })}>
          <span aria-hidden="true" className="mobile-status-dot"/>{online}/{cameras.length}
        </span>
        <button type="button" className="mobile-header-icon" onClick={switchDesktop} title={t('mobile.desktop')} aria-label={t('mobile.desktop')}>
          <Smartphone size={20}/>
        </button>
      </div>
    </header>
    <main id="mobile-main" className="mobile-main">
      <Outlet/>
    </main>
    <nav className="mobile-bottom-nav" aria-label={t('mobile.navigation')}>
      {navItems.map(({ path, icon: Icon, label, active, end }) =>
        <NavLink to={path} key={path} end={end} className={active ? 'mobile-nav-item active' : 'mobile-nav-item'}
          aria-current={active ? 'page' : undefined}>
          <Icon size={22} aria-hidden="true"/><span>{label}</span>
        </NavLink>)}
    </nav>
  </div>;
}
