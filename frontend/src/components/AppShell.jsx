import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { ChevronsLeft, ChevronsRight, LogOut, ShieldCheck } from 'lucide-react';
import { logout } from '../features/auth/authSlice.js';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { NAVIGATION_SECTIONS, activeNavigationItem, activeNavigationSection } from '../config/navigation.js';
import { PRODUCT } from '../config/product.js';
import { liveStreamPool } from '../services/liveStreamPool.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { BrandIcon } from './BrandIcon.jsx';

const SIDEBAR_STORAGE_KEY = 'tmp-camera-sidebar-collapsed';

function readCollapsedState() {
  try { return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'; } catch { return false; }
}

export function AppShell() {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const location = useLocation();
  const user = useSelector((state) => state.auth.user);
  const runtime = useSelector((state) => state.auth.runtime);
  const cameras = useSelector((state) => state.cameras.items);
  const cameraStatus = useSelector((state) => state.cameras.status);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsedState);

  useEffect(() => { if (cameraStatus === 'idle') dispatch(loadCameras()); }, [dispatch, cameraStatus]);
  useEffect(() => {
    const path = String(location.pathname || '');
    if (path.startsWith('/kiosk') || path.startsWith('/live')) {
      liveStreamPool.syncPersistentCameras([]);
      return;
    }
    liveStreamPool.syncPersistentCameras(cameras);
  }, [cameras, location.pathname]);
  useEffect(() => () => { liveStreamPool.destroyAll({ force: true }); }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0'); } catch { /* optional preference */ }
      return next;
    });
  }

  const sections = NAVIGATION_SECTIONS.filter((section) => !section.adminOnly || user?.role === 'admin');
  const activeSection = activeNavigationSection(location.pathname, user?.role);
  const activeItem = activeNavigationItem(location.pathname, user?.role);

  return <div className={`app-shell tmp-coreui-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${runtime?.demoMode ? 'demo-mode-active' : ''}`}>
    <aside className="sidebar sidebar-dark tmp-sidebar" aria-label="Application navigation">
      <div className="sidebar-header tmp-sidebar-header">
        <NavLink to="/" className="sidebar-brand tmp-sidebar-brand" aria-label={PRODUCT.name}>
          <BrandIcon size="sidebar" />
          <span className="brand-copy"><strong>TMP Networks</strong><small>Camera Surveillance</small></span>
        </NavLink>
        <button
          type="button"
          className="sidebar-collapse-button"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
          aria-label={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
          aria-expanded={!sidebarCollapsed}
        >{sidebarCollapsed ? <ChevronsRight /> : <ChevronsLeft />}</button>
      </div>

      <nav aria-label="Primary" className="tmp-primary-navigation">
        <ul className="sidebar-nav">
          {sections.map((section) => <li className="tmp-nav-section" key={section.id}>
            <div className="nav-title tmp-nav-title">{t(section.labelKey)}</div>
            <ul className="nav flex-column tmp-nav-list">
              {section.items.map(({ to, icon: Icon, labelKey, end }) => {
                const label = t(labelKey);
                return <li className="nav-item" key={to}>
                  <NavLink
                    to={to}
                    end={Boolean(end)}
                    title={sidebarCollapsed ? label : undefined}
                    aria-label={label}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  >
                    <Icon className="nav-icon" aria-hidden="true" />
                    <span className="nav-label">{label}</span>
                  </NavLink>
                </li>;
              })}
            </ul>
          </li>)}
        </ul>
      </nav>

      <div className="sidebar-footer sidebar-foot tmp-sidebar-footer">
        <div className="user-chip" title={`${user?.username || ''} - ${t(`role.${user?.role}`)}`}>
          <ShieldCheck />
          <span><strong>{user?.username}</strong><small>{t(`role.${user?.role}`)}</small></span>
        </div>
        <button className="ghost-button sidebar-logout" onClick={() => dispatch(logout())} title={t('nav.logout')} aria-label={t('nav.logout')}><LogOut /> <span>{t('nav.logout')}</span></button>
      </div>
    </aside>

    <div className="wrapper d-flex flex-column min-vh-100 tmp-main-wrapper">
      <header className="header tmp-app-header">
        <div className="container-fluid tmp-app-header-inner">
          <div className="tmp-app-context">
            <span className="tmp-app-context-dot" aria-hidden="true" />
            <div><small>{t(activeSection?.labelKey || 'nav.group.monitoring')}</small><strong>{t(activeItem?.labelKey || 'nav.overview')}</strong></div>
          </div>
          <div className="tmp-app-user" title={`${user?.username || ''} - ${t(`role.${user?.role}`)}`}>
            <ShieldCheck aria-hidden="true" />
            <span><strong>{user?.username}</strong><small>{t(`role.${user?.role}`)}</small></span>
          </div>
        </div>
      </header>
      <main className="content body flex-grow-1 tmp-app-content">
        {runtime?.demoMode && <div className="demo-mode-banner" role="status"><strong>{t('demo.bannerTitle')}</strong><span>{t('demo.bannerDescription')}</span><em>{t('demo.readOnly')}</em></div>}
        <Outlet />
      </main>
    </div>
  </div>;
}
