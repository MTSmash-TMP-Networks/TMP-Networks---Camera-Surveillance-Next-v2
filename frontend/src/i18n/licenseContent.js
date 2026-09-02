const english = [
  { key: 'scope', title: '1. Software license', paragraphs: [
    'TMP Networks Camera Surveillance is proprietary software. The license agreement supplied with the software, or a separate written agreement with TMP-SYSTEM-SERVICE GmbH, governs the permitted use of the proprietary product components.',
    'The text shown inside the application is a convenience summary and does not replace or modify the binding license agreement.',
  ]},
  { key: 'installation', title: '2. Permitted use', paragraphs: [
    'Use, installation, copying, source-code distribution, sublicensing and deployment rights depend on the license agreement supplied with the software.',
    'Only use the product within the scope of the rights actually granted to you.',
  ]},
  { key: 'restrictions', title: '3. Redistribution and resale', paragraphs: [
    'Do not resell or redistribute the proprietary product as an unchanged standalone item unless your license explicitly permits it.',
    'Do not remove copyright, trademark, attribution, license or security notices except where the applicable license or mandatory law permits it.',
  ]},
  { key: 'compliance', title: '4. Video surveillance and legal compliance', paragraphs: [
    'The operator is responsible for lawful camera placement, audio recording, motion detection, retention, exports, remote access, notices and consent at each installation location.',
    'The software provides technical functions and does not constitute legal advice.',
  ]},
  { key: 'privacy', title: '5. Privacy and data security', paragraphs: [
    'The standard deployment is self-hosted. Camera credentials, live video, recordings and application data remain inside the configured installation unless the operator deliberately configures external integrations.',
    'Administrators should use HTTPS on untrusted networks, protect accounts, restrict network exposure, install updates and maintain backups.',
  ]},
  { key: 'thirdParty', title: '6. Third-party software', paragraphs: [
    'Third-party components such as FFmpeg, go2rtc, Nginx, Caddy and Node.js packages remain subject to their own licenses. The product license does not replace those third-party terms.',
    'See the supplied third-party notices for component-specific information.',
  ]},
  { key: 'updates', title: '7. Updates and support', paragraphs: [
    'Updates may be delivered through the built-in update center or as a new software package. Support obligations depend on the applicable license or a separate support agreement.',
  ]},
  { key: 'warranty', title: '8. Warranty and liability', paragraphs: [
    'Mandatory statutory rights remain unaffected. Any additional warranty, liability or support obligations are determined by the applicable license, mandatory law and any separate written agreement.',
  ]},
  { key: 'termination', title: '9. License compliance', paragraphs: [
    'Rights to use the proprietary product are limited to the applicable license agreement. A material breach may affect rights granted under those terms.',
  ]},
  { key: 'law', title: '10. Authoritative terms', paragraphs: [
    'The license agreement supplied with the software, or a separate written agreement with TMP-SYSTEM-SERVICE GmbH, is authoritative. This product notice is provided for convenience only.',
  ]},
];

const german = [
  { key: 'scope', title: '1. Software-Lizenz', paragraphs: [
    'TMP Networks Camera Surveillance ist proprietäre Software. Für die zulässige Nutzung der proprietären Produktbestandteile ist die mit der Software bereitgestellte Lizenzvereinbarung oder eine gesonderte schriftliche Vereinbarung mit der TMP-SYSTEM-SERVICE GmbH maßgeblich.',
    'Der in der Anwendung angezeigte Text ist eine Zusammenfassung und ersetzt oder verändert die verbindliche Lizenzvereinbarung nicht.',
  ]},
  { key: 'installation', title: '2. Zulässige Nutzung', paragraphs: [
    'Nutzung, Installation, Vervielfältigung, Quellcode-Weitergabe, Unterlizenzierung und Bereitstellung richten sich nach der mit der Software bereitgestellten Lizenzvereinbarung.',
    'Das Produkt darf nur im Umfang der tatsächlich eingeräumten Rechte verwendet werden.',
  ]},
  { key: 'restrictions', title: '3. Weitergabe und Wiederverkauf', paragraphs: [
    'Das proprietäre Produkt darf nicht unverändert als eigenständiger Artikel weiterverkauft oder weiterverteilt werden, sofern die jeweilige Lizenz dies nicht ausdrücklich erlaubt.',
    'Urheberrechts-, Marken-, Quellen-, Lizenz- und Sicherheitshinweise dürfen nur entfernt werden, soweit die anwendbare Lizenz oder zwingendes Recht dies erlaubt.',
  ]},
  { key: 'compliance', title: '4. Videoüberwachung und rechtmäßige Nutzung', paragraphs: [
    'Der Betreiber ist für die Rechtmäßigkeit von Kamerapositionen, Audioaufzeichnung, Bewegungserkennung, Aufbewahrung, Exporten, Fernzugriff, Hinweisen und Einwilligungen am jeweiligen Installationsort verantwortlich.',
    'Die Software stellt technische Funktionen bereit und ist keine Rechtsberatung.',
  ]},
  { key: 'privacy', title: '5. Datenschutz und Datensicherheit', paragraphs: [
    'Die Standardbereitstellung erfolgt selbstgehostet. Kamerazugangsdaten, Livebilder, Aufnahmen und Anwendungsdaten verbleiben innerhalb der konfigurierten Installation, sofern nicht bewusst externe Integrationen eingerichtet werden.',
    'Administratoren sollten in nicht vertrauenswürdigen Netzen HTTPS verwenden, Konten schützen, Netzwerkzugriffe begrenzen, Updates installieren und Sicherungen pflegen.',
  ]},
  { key: 'thirdParty', title: '6. Drittanbieter-Software', paragraphs: [
    'Drittanbieter-Komponenten wie FFmpeg, go2rtc, Nginx, Caddy und Node.js-Pakete unterliegen weiterhin ihren eigenen Lizenzen. Die Produktlizenz ersetzt diese Bedingungen nicht.',
    'Komponentenspezifische Informationen befinden sich in den mitgelieferten Drittanbieter-Hinweisen.',
  ]},
  { key: 'updates', title: '7. Updates und Support', paragraphs: [
    'Updates können über das integrierte Update-Center oder als neues Softwarepaket bereitgestellt werden. Supportpflichten richten sich nach der anwendbaren Lizenz oder einer gesonderten Supportvereinbarung.',
  ]},
  { key: 'warranty', title: '8. Gewährleistung und Haftung', paragraphs: [
    'Zwingende gesetzliche Rechte bleiben unberührt. Weitere Gewährleistungs-, Haftungs- oder Supportpflichten bestimmen sich nach der anwendbaren Lizenz, zwingendem Recht und gegebenenfalls gesonderten schriftlichen Vereinbarungen.',
  ]},
  { key: 'termination', title: '9. Einhaltung der Lizenz', paragraphs: [
    'Die Rechte zur Nutzung der proprietären Produktbestandteile sind auf den Umfang der anwendbaren Lizenzvereinbarung beschränkt. Ein wesentlicher Verstoß kann die dort eingeräumten Nutzungsrechte beeinträchtigen.',
  ]},
  { key: 'law', title: '10. Maßgebliche Bedingungen', paragraphs: [
    'Maßgeblich ist die mit der Software bereitgestellte Lizenzvereinbarung oder eine gesonderte schriftliche Vereinbarung mit der TMP-SYSTEM-SERVICE GmbH. Dieser Produkthinweis dient ausschließlich der Übersicht.',
  ]},
];

export function getLicenseSections(locale) {
  return locale === 'de' ? german : english;
}
