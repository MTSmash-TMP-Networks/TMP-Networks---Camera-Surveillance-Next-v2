import { lazy, Suspense, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { loadRuntime, restoreSession, restoreDesktopSession, sessionUpdated } from './features/auth/authSlice.js';
import { hasDesktopGrant, isDesktopKiosk } from './services/api.js';
import { AppFooter } from './components/AppFooter.jsx';
import { AppShell } from './components/AppShell.jsx';
import { BrandIcon } from './components/BrandIcon.jsx';
import { useI18n } from './i18n/I18nProvider.jsx';

const DesktopClientPage = lazy(() => import('./pages/DesktopClientPage.jsx').then((module) => ({ default: module.DesktopClientPage })));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx').then((module) => ({ default: module.LoginPage })));
const LicensePage = lazy(() => import('./pages/LicensePage.jsx').then((module) => ({ default: module.LicensePage })));
const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx').then((module) => ({ default: module.OverviewPage })));
const LivePage = lazy(() => import('./pages/LivePage.jsx').then((module) => ({ default: module.LivePage })));
const AddCameraPage = lazy(() => import('./pages/AddCameraPage.jsx').then((module) => ({ default: module.AddCameraPage })));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx').then((module) => ({ default: module.UsersPage })));
const EditCameraPage = lazy(() => import('./pages/EditCameraPage.jsx').then((module) => ({ default: module.EditCameraPage })));
const RecordingsPage = lazy(() => import('./pages/RecordingsPage.jsx').then((module) => ({ default: module.RecordingsPage })));
const UpdatePage = lazy(() => import('./pages/UpdatePage.jsx').then((module) => ({ default: module.UpdatePage })));
const EventsPage = lazy(() => import('./pages/EventsPage.jsx').then((module) => ({ default: module.EventsPage })));
const SystemStatusPage = lazy(() => import('./pages/SystemStatusPage.jsx').then((module) => ({ default: module.SystemStatusPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage.jsx').then((module) => ({ default: module.NotificationsPage })));
const KioskPage = lazy(() => import('./pages/KioskPage.jsx').then((module) => ({ default: module.KioskPage })));

function AdminOnly({ children }) {
  const user = useSelector((state) => state.auth.user);
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

function BrandedLoading({ messageKey }) {
  const { t } = useI18n();
  return <div className="boot-screen branded-loading"><BrandIcon size="boot" /><span>{t(messageKey)}</span></div>;
}

function Protected() {
  const { user, token, desktopRestoring, desktopOffline } = useSelector((state) => state.auth);
  if (desktopRestoring || (isDesktopKiosk() && desktopOffline && !user)) return <BrandedLoading messageKey="app.loading" />;
  if (!token) return <Navigate to="/login" replace />;
  if (!user) return <BrandedLoading messageKey="app.loading" />;
  return <AppShell />;
}

export default function App() {
  const dispatch = useDispatch();
  const token = useSelector((state) => state.auth.token);
  useEffect(() => { dispatch(loadRuntime()); }, [dispatch]);
  useEffect(() => {
    if (isDesktopKiosk()) {
      dispatch(restoreDesktopSession());
      return undefined;
    }
    return undefined;
  }, [dispatch]);
  useEffect(() => {
    if (!isDesktopKiosk() && token) dispatch(restoreSession());
  }, [dispatch, token]);
  useEffect(() => {
    if (!isDesktopKiosk()) return undefined;
    const onRenewed = (event) => {
      if (event.detail?.token) dispatch(sessionUpdated(event.detail));
    };
    const renew = () => {
      if (hasDesktopGrant() && (document.visibilityState === 'visible' || navigator.onLine)) {
        dispatch(restoreDesktopSession());
      }
    };
    // The access token is still short-lived; the HttpOnly device grant is
    // renewed in the background. Network outages do not clear the grant.
    const timer = window.setInterval(renew, 15 * 60 * 1000);
    window.addEventListener('online', renew);
    window.addEventListener('focus', renew);
    window.addEventListener('tmp-desktop-session-renewed', onRenewed);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', renew);
      window.removeEventListener('focus', renew);
      window.removeEventListener('tmp-desktop-session-renewed', onRenewed);
    };
  }, [dispatch]);

  return <BrowserRouter>
    <div className="app-frame">
      <div className="app-frame-content">
        <Suspense fallback={<BrandedLoading messageKey="app.uiLoading" />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/license" element={<LicensePage />} />
            <Route element={<Protected />}>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/live" element={<LivePage />} />
              <Route path="/kiosk" element={<KioskPage />} />
              <Route path="/cameras/add" element={<AddCameraPage />} />
              <Route path="/cameras/:id/edit" element={<EditCameraPage />} />
              <Route path="/recordings" element={<RecordingsPage />} />
              <Route path="/desktop-client" element={<DesktopClientPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/events" element={<AdminOnly><EventsPage /></AdminOnly>} />
              <Route path="/system/status" element={<AdminOnly><SystemStatusPage /></AdminOnly>} />
              <Route path="/system/notifications" element={<AdminOnly><NotificationsPage /></AdminOnly>} />
              <Route path="/system/update" element={<AdminOnly><UpdatePage /></AdminOnly>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
      <AppFooter />
    </div>
  </BrowserRouter>;
}
