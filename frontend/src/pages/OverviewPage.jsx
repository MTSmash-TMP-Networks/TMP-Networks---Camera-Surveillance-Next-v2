import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Camera, CircleCheck, CircleX, Plus, RefreshCw } from 'lucide-react';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { CameraCard } from '../components/CameraCard.jsx';
import { CameraCardSkeleton } from '../components/CameraCardSkeleton.jsx';

export function OverviewPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { items, status } = useSelector((state) => state.cameras);
  const user = useSelector((state) => state.auth.user);
  useEffect(() => { dispatch(loadCameras()); const timer = setInterval(() => dispatch(loadCameras()), 30000); return () => clearInterval(timer); }, [dispatch]);
  const online = items.filter((camera) => camera.status === 'online').length;
  const loadingInitial = status === 'loading' && !items.length;

  return <div className="page overview-page">
    <header className="page-header"><div><span className="eyebrow">{t('overview.eyebrow')}</span><h1>{t('overview.title')}</h1><p>{t('overview.description')}</p></div><div className="header-actions"><button className="secondary-button" onClick={() => dispatch(loadCameras())}><RefreshCw/> {t('common.refresh')}</button>{user?.role === 'admin' && <button className="primary-button" onClick={() => navigate('/cameras/add')}><Plus/> {t('common.addCamera')}</button>}</div></header>
    <section className="stats-row" aria-label={t('overview.title')}>
      <div className="stat"><Camera/><span><strong>{items.length}</strong><small>{t('overview.total')}</small></span></div>
      <div className="stat good"><CircleCheck/><span><strong>{online}</strong><small>{t('common.online')}</small></span></div>
      <div className="stat bad"><CircleX/><span><strong>{Math.max(0, items.length - online)}</strong><small>{t('overview.needsAttention')}</small></span></div>
    </section>
    {loadingInitial
      ? <section className="camera-grid" aria-label={t('overview.loading')}>{Array.from({ length: 6 }, (_, index) => <CameraCardSkeleton key={index}/>)}</section>
      : items.length
        ? <section className="camera-grid">{items.map((camera) => <CameraCard key={camera.id} camera={camera}/>)}</section>
        : <div className="empty-panel"><Camera/><h2>{t('overview.emptyTitle')}</h2><p>{t('overview.emptyDescription')}</p></div>}
  </div>;
}
