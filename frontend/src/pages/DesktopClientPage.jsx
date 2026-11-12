import { Download, Laptop, MonitorPlay, ShieldCheck, Server } from 'lucide-react';

const DOWNLOAD = '/downloads/TMP-Camera-Desktop-Linux-x64.zip';
export function DesktopClientPage() {
  const isGerman = (document.documentElement.lang || 'de').toLowerCase().startsWith('de');
  return <div className="page desktop-client-page">
    <header className="page-header"><div><span className="eyebrow">TMP Camera Desktop</span><h1>{isGerman ? 'Desktop-Client herunterladen' : 'Download desktop client'}</h1><p>{isGerman ? 'Kamerasoftware als eigene Linux-Anwendung – ohne gewöhnliches Browserfenster.' : 'Use your surveillance server in a standalone Linux desktop window.'}</p></div></header>
    <section className="settings-card desktop-client-panel">
      <div className="section-heading"><div><h2><Laptop /> Linux Desktop x64</h2><p>{isGerman ? 'Für Linux-Arbeitsplätze. Der Docker-Server bleibt unverändert.' : 'For Linux workstations. Your Docker server stays unchanged.'}</p></div></div>
      <div className="desktop-client-features"><span><MonitorPlay /> {isGerman ? 'Livebild & Aufnahmen' : 'Live view & recordings'}</span><span><Server /> {isGerman ? 'Bestehenden Server nutzen' : 'Connect to existing server'}</span><span><ShieldCheck /> {isGerman ? 'Server-Login verwenden' : 'Use server login'}</span></div>
      <a className="primary-button desktop-client-download" href={DOWNLOAD} download="TMP-Camera-Desktop-Linux-x64.zip"><Download /> {isGerman ? 'Linux-Client (ZIP) herunterladen' : 'Download Linux client (ZIP)'}</a>
      <p className="desktop-client-note">{isGerman ? 'Entpacken, auf dem Linux-Arbeitsplatz Node.js 20+ und npm bereitstellen und install-linux.sh ausführen. Das Skript lädt beim ersten Mal die Electron-Laufzeit aus dem Internet. Es sind keine Administratorrechte erforderlich.' : 'Extract, install Node.js 20+ and npm on your workstation, and run install-linux.sh. The first installation downloads the Electron runtime. No root permissions required.'}</p>
      <pre className="desktop-client-command">sh ./install-linux.sh</pre>
      <p className="desktop-client-note">{isGerman ? 'Danach im Anwendungsmenü TMP Camera Desktop starten, die Serveradresse eingeben und normal anmelden. HTTPS-Zertifikate werden überprüft.' : 'Launch TMP Camera Desktop from the application menu, enter your server URL, and sign in. TLS certificates are validated.'}</p>
    </section>
  </div>;
}
