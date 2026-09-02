import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { login } from '../features/auth/authSlice.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { BrandIcon } from '../components/BrandIcon.jsx';

export function LoginPage() {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const { user, status, error, runtime } = useSelector((state) => state.auth);
  const [form, setForm] = useState({ username: 'admin', password: '' });
  useEffect(() => {
    if (runtime?.demoMode) setForm({ username: 'demo', password: 'demo' });
  }, [runtime?.demoMode]);
  if (user) return <Navigate to="/" replace />;
  return <div className="login-page">
    <div className="login-visual"><div className="login-grid"/><div className="login-copy"><BrandIcon size="hero" decorative={false}/><span className="eyebrow">TMP NETWORKS</span><h1>{t('login.heroLine1')}<br/>{t('login.heroLine2')}</h1><p>{t('login.heroDescription')}</p></div></div>
    <form className="login-card" onSubmit={(event) => { event.preventDefault(); dispatch(login(form)); }}>
      <BrandIcon size="login"/><h2>{t('login.title')}</h2><p>{t('login.subtitle')}</p>
      {runtime?.demoMode && <div className="demo-login-notice"><strong>{t('demo.badge')}</strong><span>{t('demo.loginNotice')}</span><div className="demo-login-credentials"><span><b>{t('common.username')}:</b> <code>demo</code></span><span><b>{t('common.password')}:</b> <code>demo</code></span></div></div>}
      <label>{t('common.username')}<input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })}/></label>
      <label>{t('common.password')}<input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary-button" disabled={status === 'loading'}><LockKeyhole /> {status === 'loading' ? t('login.pending') : t('login.submit')}</button>
    </form>
  </div>;
}
