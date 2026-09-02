import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { KeyRound, Save, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { api } from '../services/api.js';
import { sessionUpdated } from '../features/auth/authSlice.js';

export function UsersPage() {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth.user);
  const [items, setItems] = useState([]);
  const [create, setCreate] = useState({ username: '', password: '', role: 'viewer' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [resetPasswords, setResetPasswords] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = () => api.users().then((result) => setItems(result.items || [])).catch((reason) => setError(reason.message));
  useEffect(() => { void load(); }, []);

  async function createUser(event) {
    event.preventDefault(); setError(''); setMessage('');
    try {
      await api.createUser(create);
      setCreate({ username: '', password: '', role: 'viewer' });
      setMessage('Benutzer wurde angelegt.');
      await load();
    } catch (reason) { setError(reason.message); }
  }

  async function changePassword(event) {
    event.preventDefault(); setError(''); setMessage('');
    try {
      const result = await api.changePassword(passwords);
      dispatch(sessionUpdated(result));
      setPasswords({ currentPassword: '', newPassword: '' });
      setMessage('Kennwort wurde geändert; andere Sitzungen dieses Benutzers wurden widerrufen.');
    } catch (reason) { setError(reason.message); }
  }

  async function updateUser(user, changes) {
    setError(''); setMessage('');
    try {
      await api.updateUser(user.id, changes);
      setMessage(`Benutzer ${user.username} wurde aktualisiert; bestehende Sitzungen wurden widerrufen.`);
      setResetPasswords((current) => ({ ...current, [user.id]: '' }));
      await load();
    } catch (reason) { setError(reason.message); }
  }

  if (currentUser?.role !== 'admin') return <Navigate to="/" replace/>;
  return <div className="page users-page">
    <header className="page-header"><div><span className="eyebrow">ACCESS CONTROL</span><h1>Benutzer und Rollen</h1><p>Viewer, Operatoren und Administratoren verwalten. Rollen und Aktivstatus werden serverseitig bei jeder Anfrage neu geprüft.</p></div></header>
    {(message || error) && <div className={error ? 'form-error' : 'form-success'}>{error || message}</div>}
    <div className="settings-grid">
      <section className="settings-card user-management-card"><div className="wizard-title"><Users/><div><h2>Vorhandene Benutzer</h2><p>Änderungen widerrufen aktive Sitzungen. Der letzte aktive Administrator ist geschützt.</p></div></div>
        <div className="user-list editable-user-list">{items.map((user) => <div key={user.id} className="editable-user-row">
          <ShieldCheck/><span><strong>{user.username}</strong><small>{user.lastLoginAt ? `Letzte Anmeldung: ${new Date(user.lastLoginAt).toLocaleString()}` : 'Noch keine Anmeldung'}</small></span>
          <select value={user.role} aria-label={`Rolle von ${user.username}`} onChange={(event) => void updateUser(user, { role: event.target.value })}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Administrator</option></select>
          <label className="compact-switch"><input type="checkbox" checked={user.enabled} onChange={(event) => void updateUser(user, { enabled: event.target.checked })}/><span>Aktiv</span></label>
          <input type="password" minLength={12} placeholder="Neues Kennwort" value={resetPasswords[user.id] || ''} onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))}/>
          <button type="button" className="secondary-button" disabled={(resetPasswords[user.id] || '').length < 12} onClick={() => void updateUser(user, { password: resetPasswords[user.id] })}><Save/> Setzen</button>
        </div>)}</div>
      </section>
      <section className="settings-card"><div className="wizard-title"><UserPlus/><div><h2>Benutzer hinzufügen</h2><p>Operatoren dürfen PTZ und Stream-Neustarts ausführen; Viewer verwenden Live- und Wiedergabeansichten.</p></div></div><form onSubmit={createUser}><label>Benutzername<input value={create.username} onChange={(event) => setCreate({ ...create, username: event.target.value })} required minLength={3}/></label><label>Initiales Kennwort<input type="password" value={create.password} onChange={(event) => setCreate({ ...create, password: event.target.value })} required minLength={12}/></label><label>Rolle<select value={create.role} onChange={(event) => setCreate({ ...create, role: event.target.value })}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Administrator</option></select></label><button className="primary-button" type="submit"><UserPlus/> Anlegen</button></form></section>
      <section className="settings-card"><div className="wizard-title"><KeyRound/><div><h2>Eigenes Kennwort ändern</h2><p>Mindestens zwölf Zeichen verwenden. Die aktuelle Sitzung erhält sofort ein neues Token.</p></div></div><form onSubmit={changePassword}><label>Aktuelles Kennwort<input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} required/></label><label>Neues Kennwort<input type="password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} required minLength={12}/></label><button className="secondary-button" type="submit"><KeyRound/> Kennwort ändern</button></form></section>
    </div>
  </div>;
}
