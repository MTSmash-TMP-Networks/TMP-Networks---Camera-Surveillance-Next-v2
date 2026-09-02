import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Link2, MapPin, Pencil, Radio, Settings2, Volume2, Video, WifiOff, Move3D } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { SnapshotBackdrop } from './SnapshotBackdrop.jsx';
import { cameraSupportsPtz } from '../utils/cameraCapabilities.js';

export function CameraCard({ camera }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useSelector((state) => state.auth.user);
  const online = camera.status === 'online';
  const statusLabel = online ? t('common.online') : camera.status === 'stream_error' ? t('common.streamError') : t('common.offline');
  const locationLabel = camera.location || t('overview.locationUnknown');
  const hasPtz = cameraSupportsPtz(camera);

  return <article className="camera-card">
    <div className="camera-preview" onClick={() => navigate(`/live?camera=${camera.id}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate(`/live?camera=${camera.id}`); }} role="button" tabIndex={0} aria-label={`${t('common.openLive')}: ${camera.name}`}>
      <SnapshotBackdrop cameraId={camera.id} refreshMs={60000}/>
      <div className="preview-shade"/>
      <span className={`camera-state ${online ? 'online' : camera.status === 'stream_error' ? 'warning' : 'offline'}`}>{online ? <Radio/> : <WifiOff/>}{statusLabel}</span>
      <span className="play-live"><Video/> {t('common.openLive')}</span>
    </div>
    <div className="camera-body">
      <div className="camera-card-heading">
        <div><h3 data-i18n-skip="true">{camera.name}</h3><p data-i18n-skip="true"><MapPin/> {locationLabel}</p></div>
        {user?.role === 'admin' && <button className="card-icon-button" onClick={() => navigate(`/cameras/${camera.id}/edit`)} title={t('common.editCamera')} aria-label={t('common.editCamera')}><Pencil/></button>}
      </div>
      <div className="camera-capabilities" aria-label="Camera capabilities">
        <span className="capability-pill">{camera.connectionType === 'stream' ? <><Link2/> {t('stream.driver')}</> : 'ONVIF'}</span>
        {camera.capabilities?.audio && <span className="capability-pill"><Volume2/> {t('common.audio')}</span>}
        {hasPtz && <span className="capability-pill"><Move3D/> PTZ</span>}
      </div>
      <div className="card-actions"><button className="card-link" onClick={() => navigate(`/live?camera=${camera.id}`)}><Settings2/> {t('common.openControl')}</button></div>
    </div>
  </article>;
}
