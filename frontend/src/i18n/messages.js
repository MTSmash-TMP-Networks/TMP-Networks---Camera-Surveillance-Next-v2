import { enhancedMessages } from './enhancedMessages.js';
import { coreEnhancements } from './coreEnhancements.js';
import { visualRefinementMessages } from './visualRefinementMessages.js';
import { visualRefinementExtraMessages } from './visualRefinementExtraMessages.js';
import { updatePageMessages } from './updatePageMessages.js';
import { eventPageMessages } from './eventPageMessages.js';
import { notificationMessages } from './notificationMessages.js';
import { recordingMessages } from './recordingMessages.js';
import { aiMessages } from './aiMessages.js';
import { buildGlobalIntlSupplement } from './globalIntlSupplement.js';
import { runtimeLocaleFixes } from './runtimeLocaleFixes.js';
import { demoModeMessages } from './demoModeMessages.js';
import { networkStreamMessages } from './networkStreamMessages.js';
import { demoAdminMessages } from './demoAdminMessages.js';
import { discoveryUiMessages } from './discoveryUiMessages.js';
import { onvifPtzProbeMessages } from './onvifPtzProbeMessages.js';
import { addCameraMessages } from './addCameraMessages.js';
import { recordingStorageMessages } from './recordingStorageMessages.js';
import { kioskMessages } from './kioskMessages.js';
import { updateCenterMessages } from './updateCenterMessages.js';
import { FALLBACK_LOCALE, normalizeLocale } from './languages.js';

const en = {
  'app.loading': 'TMP Camera is loading …',
  'app.uiLoading': 'Loading interface …',
  'common.language': 'Language',
  'common.version': 'Version',
  'common.license': 'License agreement',
  'common.backToApp': 'Back to application',
  'common.print': 'Print',
  'common.refresh': 'Refresh',
  'common.addCamera': 'Add camera',
  'common.online': 'Online',
  'common.offline': 'Offline',
  'common.streamError': 'Stream unavailable',
  'common.audio': 'Audio',
  'common.openLive': 'Open live view',
  'common.openControl': 'Open and control',
  'common.editCamera': 'Edit camera',
  'common.username': 'Username',
  'common.password': 'Password',
  'common.loading': 'Loading …',
  'common.footerInfo': 'Copyright, version and legal information',
  'common.product': 'Product',
  'common.vendorWebsite': 'Vendor website',
  'common.support': 'Support',
  'nav.overview': 'Overview',
  'nav.live': 'Live view',
  'nav.kiosk': 'Kiosk mode',
  'nav.recordings': 'Recordings',
  'nav.addCamera': 'Add camera',
  'nav.users': 'Users',
  'nav.events': 'Events',
  'nav.systemStatus': 'System status',
  'nav.updates': 'Update center',
  'nav.logout': 'Sign out',
  'login.title': 'Sign in',
  'login.subtitle': 'Continue with your surveillance account.',
  'login.heroLine1': 'Video surveillance.',
  'login.heroLine2': 'Securely connected.',
  'login.heroDescription': 'ONVIF camera management with WebRTC live video, audio and intelligent stream fallback.',
  'login.submit': 'Secure sign in',
  'login.pending': 'Signing in …',
  'overview.eyebrow': 'MONITOR CENTER',
  'overview.title': 'Camera overview',
  'overview.description': 'View every location, status and live connection in one place.',
  'overview.total': 'Total cameras',
  'overview.needsAttention': 'Needs attention',
  'overview.loading': 'Loading cameras …',
  'overview.emptyTitle': 'No camera configured yet',
  'overview.emptyDescription': 'Add an ONVIF camera using the guided setup.',
  'role.admin': 'Administrator',
  'role.operator': 'Operator',
  'role.viewer': 'Viewer',
  'license.eyebrow': 'SOFTWARE LICENSE',
  'license.title': 'Software License',
  'license.subtitle': 'This product is governed by the license agreement supplied with the software.',
  'license.vendorTitle': 'TMP Networks License',
  'license.vendorText': 'Proprietary product components are licensed under the agreement supplied with the software. Third-party components keep their own license terms.',
  'license.bindingLanguage': 'The license agreement supplied with the software or a separate written agreement is authoritative. This page is a product summary.',
  'license.section.scope': '1. Scope and license grant',
  'license.section.installation': '2. Permitted use under the purchased license',
  'license.section.restrictions': '3. Restrictions',
  'license.section.compliance': '4. Video surveillance and legal compliance',
  'license.section.privacy': '5. Privacy and data security',
  'license.section.thirdParty': '6. Third-party software',
  'license.section.updates': '7. Community feedback, updates and support',
  'license.section.warranty': '8. Warranty and liability',
  'license.section.termination': '9. Termination',
  'license.section.law': '10. Governing law',
  'license.section.contact': 'Licensor and commercial licensing',
  'license.thirdPartyLink': 'Third-party notices',
  'license.docsLink': 'Product documentation',
  'license.fullTextLink': 'License notice included with the package',
  'language.fallbackNotice': 'Some advanced technical messages may fall back to English.',
};

const de = {
  ...en,
  'app.loading': 'TMP Camera wird geladen …', 'app.uiLoading': 'Oberfläche wird geladen …',
  'common.language': 'Sprache', 'common.version': 'Version', 'common.license': 'Lizenzvereinbarung',
  'common.backToApp': 'Zurück zur Anwendung', 'common.print': 'Drucken', 'common.refresh': 'Aktualisieren',
  'common.addCamera': 'Kamera hinzufügen', 'common.online': 'Online', 'common.offline': 'Offline',
  'common.streamError': 'Stream gestört', 'common.audio': 'Audio', 'common.openLive': 'Live öffnen',
  'common.openControl': 'Öffnen und steuern', 'common.editCamera': 'Kamera bearbeiten',
  'common.username': 'Benutzername', 'common.password': 'Kennwort', 'common.loading': 'Wird geladen …',
  'common.footerInfo': 'Copyright-, Versions- und Rechtsinformationen', 'common.product': 'Produkt',
  'common.vendorWebsite': 'Anbieter-Website', 'common.support': 'Support',
  'nav.overview': 'Übersicht', 'nav.live': 'Live-Ansicht', 'nav.kiosk': 'Kiosk-Modus',
  'nav.recordings': 'Aufnahmen', 'nav.addCamera': 'Kamera hinzufügen', 'nav.users': 'Benutzer',
  'nav.events': 'Ereignisse', 'nav.systemStatus': 'Systemstatus', 'nav.updates': 'Update-Center', 'nav.logout': 'Abmelden',
  'login.title': 'Anmelden', 'login.subtitle': 'Mit Ihrem Surveillance-Konto fortfahren.',
  'login.heroLine1': 'Videoüberwachung.', 'login.heroLine2': 'Sicher verbunden.',
  'login.heroDescription': 'ONVIF-basierte Kameraverwaltung mit WebRTC-Livebild, Audio und intelligentem Stream-Fallback.',
  'login.submit': 'Sicher anmelden', 'login.pending': 'Anmeldung läuft …',
  'overview.eyebrow': 'MONITOR CENTER', 'overview.title': 'Kameraübersicht',
  'overview.description': 'Alle Standorte, Zustände und Live-Zugriffe zentral im Blick.',
  'overview.total': 'Kameras gesamt', 'overview.needsAttention': 'Prüfung erforderlich',
  'overview.loading': 'Kameras werden geladen …', 'overview.emptyTitle': 'Noch keine Kamera eingerichtet',
  'overview.emptyDescription': 'Fügen Sie eine ONVIF-Kamera über den geführten Assistenten hinzu.',
  'role.admin': 'Administrator', 'role.operator': 'Operator', 'role.viewer': 'Betrachter',
  'license.eyebrow': 'SOFTWARE-LIZENZ', 'license.title': 'Software-Lizenz',
  'license.subtitle': 'Für dieses Produkt gilt die mit der Software bereitgestellte Lizenzvereinbarung.',
  'license.vendorTitle': 'TMP Networks License',
  'license.vendorText': 'Die proprietären Produktbestandteile werden im Umfang der mit der Software bereitgestellten Lizenz genutzt. Drittanbieter-Komponenten behalten ihre eigenen Lizenzbedingungen.',
  'license.bindingLanguage': 'Maßgeblich ist die mit der Software bereitgestellte Lizenzvereinbarung oder eine gesonderte schriftliche Vereinbarung. Diese Seite ist eine Produktzusammenfassung.',
  'license.section.scope': '1. Geltungsbereich und Lizenzgewährung',
  'license.section.installation': '2. Erlaubte Nutzung nach erworbener Lizenz',
  'license.section.restrictions': '3. Beschränkungen',
  'license.section.compliance': '4. Videoüberwachung und Rechtskonformität',
  'license.section.privacy': '5. Datenschutz und Datensicherheit',
  'license.section.thirdParty': '6. Software von Drittanbietern',
  'license.section.updates': '7. Community-Feedback, Updates und Support',
  'license.section.warranty': '8. Gewährleistung und Haftung',
  'license.section.termination': '9. Beendigung',
  'license.section.law': '10. Anwendbares Recht',
  'license.section.contact': 'Lizenzgeber und kommerzielle Lizenzierung',
  'license.thirdPartyLink': 'Drittanbieter-Hinweise', 'license.docsLink': 'Produktdokumentation', 'license.fullTextLink': 'Lizenzhinweis im Paket',
  'language.fallbackNotice': 'Einzelne technische Spezialmeldungen können auf Englisch erscheinen.',
};

const compact = {
  fr: ['Langue','Contrat de licence','Retour à l’application','Imprimer','Actualiser','Ajouter une caméra','Vue d’ensemble','Vue en direct','Mode kiosque','Enregistrements','Utilisateurs','Événements','État du système','Centre de mise à jour','Se déconnecter','Connexion','Nom d’utilisateur','Mot de passe','Connexion sécurisée','Aperçu des caméras','Caméras au total','À vérifier','JURIDIQUE ET LICENCE','Édition TMP Networks'],
  es: ['Idioma','Acuerdo de licencia','Volver a la aplicación','Imprimir','Actualizar','Añadir cámara','Resumen','Vista en directo','Modo quiosco','Grabaciones','Usuarios','Eventos','Estado del sistema','Centro de actualizaciones','Cerrar sesión','Iniciar sesión','Usuario','Contraseña','Acceso seguro','Resumen de cámaras','Cámaras totales','Requiere atención','LEGAL Y LICENCIAS','Edición TMP Networks'],
  it: ['Lingua','Contratto di licenza','Torna all’applicazione','Stampa','Aggiorna','Aggiungi telecamera','Panoramica','Vista live','Modalità chiosco','Registrazioni','Utenti','Eventi','Stato del sistema','Centro aggiornamenti','Esci','Accedi','Nome utente','Password','Accesso sicuro','Panoramica telecamere','Telecamere totali','Richiede attenzione','NOTE LEGALI E LICENZA','Edizione TMP Networks'],
  nl: ['Taal','Licentieovereenkomst','Terug naar de toepassing','Afdrukken','Vernieuwen','Camera toevoegen','Overzicht','Liveweergave','Kioskmodus','Opnamen','Gebruikers','Gebeurtenissen','Systeemstatus','Updatecentrum','Afmelden','Aanmelden','Gebruikersnaam','Wachtwoord','Veilig aanmelden','Cameraoverzicht','Totaal camera’s','Aandacht vereist','JURIDISCH EN LICENTIE','TMP Networks-editie'],
  pl: ['Język','Umowa licencyjna','Wróć do aplikacji','Drukuj','Odśwież','Dodaj kamerę','Przegląd','Podgląd na żywo','Tryb kiosku','Nagrania','Użytkownicy','Zdarzenia','Stan systemu','Centrum aktualizacji','Wyloguj','Zaloguj','Nazwa użytkownika','Hasło','Bezpieczne logowanie','Przegląd kamer','Łącznie kamer','Wymaga uwagi','PRAWO I LICENCJA','Edycja TMP Networks'],
  'pt-BR': ['Idioma','Contrato de licença','Voltar ao aplicativo','Imprimir','Atualizar','Adicionar câmera','Visão geral','Visualização ao vivo','Modo quiosque','Gravações','Usuários','Eventos','Status do sistema','Central de atualizações','Sair','Entrar','Nome de usuário','Senha','Entrar com segurança','Visão geral das câmeras','Total de câmeras','Requer atenção','LEGAL E LICENÇA','Edição TMP Networks'],
  tr: ['Dil','Lisans sözleşmesi','Uygulamaya dön','Yazdır','Yenile','Kamera ekle','Genel bakış','Canlı görünüm','Kiosk modu','Kayıtlar','Kullanıcılar','Olaylar','Sistem durumu','Güncelleme merkezi','Çıkış','Giriş yap','Kullanıcı adı','Parola','Güvenli giriş','Kamera genel bakışı','Toplam kamera','Dikkat gerekli','YASAL VE LİSANS','TMP Networks Sürümü'],
  cs: ['Jazyk','Licenční smlouva','Zpět do aplikace','Tisk','Obnovit','Přidat kameru','Přehled','Živý náhled','Režim kiosku','Záznamy','Uživatelé','Události','Stav systému','Centrum aktualizací','Odhlásit','Přihlásit','Uživatelské jméno','Heslo','Bezpečné přihlášení','Přehled kamer','Celkem kamer','Vyžaduje pozornost','PRÁVNÍ A LICENČNÍ','Edice TMP Networks'],
  da: ['Sprog','Licensaftale','Tilbage til programmet','Udskriv','Opdater','Tilføj kamera','Oversigt','Livevisning','Kiosktilstand','Optagelser','Brugere','Hændelser','Systemstatus','Opdateringscenter','Log ud','Log ind','Brugernavn','Adgangskode','Sikker login','Kameraoversigt','Kameraer i alt','Kræver opmærksomhed','JURA OG LICENS','TMP Networks-udgave'],
  sv: ['Språk','Licensavtal','Tillbaka till programmet','Skriv ut','Uppdatera','Lägg till kamera','Översikt','Livevy','Kioskläge','Inspelningar','Användare','Händelser','Systemstatus','Uppdateringscenter','Logga ut','Logga in','Användarnamn','Lösenord','Säker inloggning','Kameraöversikt','Kameror totalt','Kräver åtgärd','JURIDIK OCH LICENS','TMP Networks-utgåva'],
  nb: ['Språk','Lisensavtale','Tilbake til programmet','Skriv ut','Oppdater','Legg til kamera','Oversikt','Direktevisning','Kioskmodus','Opptak','Brukere','Hendelser','Systemstatus','Oppdateringssenter','Logg ut','Logg inn','Brukernavn','Passord','Sikker innlogging','Kameraoversikt','Kameraer totalt','Krever oppmerksomhet','JURIDISK OG LISENS','TMP Networks-utgave'],
  fi: ['Kieli','Lisenssisopimus','Takaisin sovellukseen','Tulosta','Päivitä','Lisää kamera','Yleiskatsaus','Suora näkymä','Kioskitila','Tallenteet','Käyttäjät','Tapahtumat','Järjestelmän tila','Päivityskeskus','Kirjaudu ulos','Kirjaudu sisään','Käyttäjänimi','Salasana','Turvallinen kirjautuminen','Kameroiden yleiskatsaus','Kameroita yhteensä','Vaatii huomiota','OIKEUDELLINEN JA LISENSSI','TMP Networks-versio'],
  ro: ['Limbă','Acord de licență','Înapoi la aplicație','Tipărește','Actualizează','Adaugă cameră','Prezentare generală','Vizualizare live','Mod chioșc','Înregistrări','Utilizatori','Evenimente','Starea sistemului','Centru de actualizare','Deconectare','Autentificare','Nume utilizator','Parolă','Autentificare securizată','Prezentare camere','Total camere','Necesită atenție','LEGAL ȘI LICENȚĂ','Ediția TMP Networks'],
  hu: ['Nyelv','Licencszerződés','Vissza az alkalmazáshoz','Nyomtatás','Frissítés','Kamera hozzáadása','Áttekintés','Élőkép','Kioszk mód','Felvételek','Felhasználók','Események','Rendszerállapot','Frissítési központ','Kijelentkezés','Bejelentkezés','Felhasználónév','Jelszó','Biztonságos bejelentkezés','Kameraáttekintés','Kamerák összesen','Figyelmet igényel','JOGI ÉS LICENC','TMP Networks kiadás'],
  el: ['Γλώσσα','Συμφωνία άδειας','Επιστροφή στην εφαρμογή','Εκτύπωση','Ανανέωση','Προσθήκη κάμερας','Επισκόπηση','Ζωντανή προβολή','Λειτουργία kiosk','Εγγραφές','Χρήστες','Συμβάντα','Κατάσταση συστήματος','Κέντρο ενημερώσεων','Αποσύνδεση','Σύνδεση','Όνομα χρήστη','Κωδικός πρόσβασης','Ασφαλής σύνδεση','Επισκόπηση καμερών','Σύνολο καμερών','Χρειάζεται προσοχή','ΝΟΜΙΚΑ ΚΑΙ ΑΔΕΙΑ','Έκδοση TMP Networks'],
  uk: ['Мова','Ліцензійна угода','Назад до застосунку','Друк','Оновити','Додати камеру','Огляд','Прямий ефір','Режим кіоску','Записи','Користувачі','Події','Стан системи','Центр оновлень','Вийти','Увійти','Ім’я користувача','Пароль','Безпечний вхід','Огляд камер','Усього камер','Потребує уваги','ПРАВОВІ УМОВИ ТА ЛІЦЕНЗІЯ','Версія TMP Networks'],
  ru: ['Язык','Лицензионное соглашение','Назад к приложению','Печать','Обновить','Добавить камеру','Обзор','Прямой эфир','Режим киоска','Записи','Пользователи','События','Состояние системы','Центр обновлений','Выйти','Войти','Имя пользователя','Пароль','Безопасный вход','Обзор камер','Всего камер','Требует внимания','ПРАВОВАЯ ИНФОРМАЦИЯ И ЛИЦЕНЗИЯ','Версия TMP Networks'],
  ar: ['اللغة','اتفاقية الترخيص','العودة إلى التطبيق','طباعة','تحديث','إضافة كاميرا','نظرة عامة','عرض مباشر','وضع الكشك','التسجيلات','المستخدمون','الأحداث','حالة النظام','مركز التحديث','تسجيل الخروج','تسجيل الدخول','اسم المستخدم','كلمة المرور','دخول آمن','نظرة عامة على الكاميرات','إجمالي الكاميرات','يتطلب الانتباه','الشؤون القانونية والترخيص','إصدار TMP Networks'],
  'zh-CN': ['语言','许可协议','返回应用','打印','刷新','添加摄像机','概览','实时视图','自助终端模式','录像','用户','事件','系统状态','更新中心','退出登录','登录','用户名','密码','安全登录','摄像机概览','摄像机总数','需要关注','法律与许可','TMP Networks 版本'],
  'zh-TW': ['語言','授權協議','返回應用程式','列印','重新整理','新增攝影機','總覽','即時檢視','資訊站模式','錄影','使用者','事件','系統狀態','更新中心','登出','登入','使用者名稱','密碼','安全登入','攝影機總覽','攝影機總數','需要注意','法律與授權','TMP Networks 版本'],
  ja: ['言語','ライセンス契約','アプリに戻る','印刷','更新','カメラを追加','概要','ライブビュー','キオスクモード','録画','ユーザー','イベント','システム状態','アップデートセンター','ログアウト','ログイン','ユーザー名','パスワード','安全にログイン','カメラ概要','カメラ合計','要確認','法的情報とライセンス','TMP Networks エディション'],
  ko: ['언어','라이선스 계약','애플리케이션으로 돌아가기','인쇄','새로 고침','카메라 추가','개요','라이브 보기','키오스크 모드','녹화','사용자','이벤트','시스템 상태','업데이트 센터','로그아웃','로그인','사용자 이름','비밀번호','안전하게 로그인','카메라 개요','전체 카메라','확인 필요','법률 및 라이선스','TMP Networks 에디션'],
};

const compactKeys = [
  'common.language','common.license','common.backToApp','common.print','common.refresh','common.addCamera',
  'nav.overview','nav.live','nav.kiosk','nav.recordings','nav.users','nav.events','nav.systemStatus','nav.updates','nav.logout',
  'login.title','common.username','common.password','login.submit','overview.title','overview.total','overview.needsAttention',
  'license.eyebrow','license.vendorTitle',
];

export const messages = { de, en };
for (const [locale, values] of Object.entries(compact)) {
  messages[locale] = { ...en, ...Object.fromEntries(compactKeys.map((key, index) => [key, values[index]])) };
}
for (const [locale, values] of Object.entries(enhancedMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(coreEnhancements)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(visualRefinementMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(visualRefinementExtraMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(updatePageMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(eventPageMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(notificationMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(recordingMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(aiMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}

const productLicenseLabels = {
  de: {
    'license.eyebrow': 'SOFTWARE-LIZENZ', 'license.title': 'Software-Lizenz',
    'license.subtitle': 'Für dieses Produkt gilt die mit der Software bereitgestellte Lizenzvereinbarung.',
    'license.vendorTitle': 'TMP Networks Lizenz',
    'license.vendorText': 'Die proprietären Produktbestandteile werden im Umfang der mit der Software bereitgestellten Lizenz genutzt. Drittanbieter-Komponenten behalten ihre eigenen Lizenzbedingungen.',
    'license.bindingLanguage': 'Maßgeblich ist die mit der Software bereitgestellte Lizenzvereinbarung oder eine gesonderte schriftliche Vereinbarung. Diese Seite ist eine Produktzusammenfassung.',
    'license.fullTextLink': 'Lizenzhinweis im Paket',
  },
  en: {
    'license.eyebrow': 'SOFTWARE LICENSE', 'license.title': 'Software License',
    'license.subtitle': 'This product is governed by the license agreement supplied with the software.',
    'license.vendorTitle': 'TMP Networks License',
    'license.vendorText': 'Proprietary product components are licensed under the agreement supplied with the software. Third-party components keep their own license terms.',
    'license.bindingLanguage': 'The license agreement supplied with the software or a separate written agreement is authoritative. This page is a product summary.',
    'license.fullTextLink': 'License notice included with the package',
  },
};
for (const locale of Object.keys(messages)) {
  messages[locale] = { ...(messages[locale] || en), ...(productLicenseLabels[locale] || productLicenseLabels.en) };
}

const globalIntlSupplement = buildGlobalIntlSupplement();
for (const [locale, values] of Object.entries(globalIntlSupplement)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(runtimeLocaleFixes)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(demoModeMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(networkStreamMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(demoAdminMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(discoveryUiMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(onvifPtzProbeMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(addCameraMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(recordingStorageMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(kioskMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}
for (const [locale, values] of Object.entries(updateCenterMessages)) {
  messages[locale] = { ...(messages[locale] || en), ...values };
}

export function interpolate(template, variables = {}) {
  return String(template).replace(/\{([\w.]+)\}/g, (_, key) => variables[key] ?? `{${key}}`);
}

export function translate(locale, key, variables) {
  const normalizedLocale = normalizeLocale(locale) || FALLBACK_LOCALE;
  const value = messages[normalizedLocale]?.[key] ?? messages[FALLBACK_LOCALE]?.[key] ?? key;
  return interpolate(value, variables);
}
