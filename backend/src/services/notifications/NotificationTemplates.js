const keys = ['test','testBody','motion','cameraOffline','cameraOnline','streamFailure','streamRecovered','recordingFailure','recordingRecovered','systemError','update','camera','location','time','event','severity','details','footer'];
const rows = {
  de: ['Testbenachrichtigung','E-Mail-Benachrichtigungen sind korrekt eingerichtet.','Bewegung erkannt','Kamera offline','Kamera wieder online','Problem mit dem Live-Stream','Live-Stream wiederhergestellt','Problem mit der Aufnahme','Aufnahme wiederhergestellt','Systemwarnung','Update-Vorgang','Kamera','Standort','Zeit','Ereignis','Schweregrad','Details','Automatisch von TMP Camera Surveillance gesendet.'],
  en: ['Test notification','Email notifications are configured correctly.','Motion detected','Camera offline','Camera online again','Live stream problem','Live stream recovered','Recording problem','Recording recovered','System warning','Update operation','Camera','Location','Time','Event','Severity','Details','Sent automatically by TMP Camera Surveillance.'],
  fr: ['Notification de test','Les notifications par e-mail sont correctement configurées.','Mouvement détecté','Caméra hors ligne','Caméra de nouveau en ligne','Problème de flux en direct','Flux en direct rétabli','Problème d’enregistrement','Enregistrement rétabli','Avertissement système','Opération de mise à jour','Caméra','Emplacement','Heure','Événement','Gravité','Détails','Envoyé automatiquement par TMP Camera Surveillance.'],
  es: ['Notificación de prueba','Las notificaciones por correo están configuradas correctamente.','Movimiento detectado','Cámara sin conexión','Cámara de nuevo en línea','Problema con la transmisión en vivo','Transmisión en vivo recuperada','Problema de grabación','Grabación recuperada','Advertencia del sistema','Operación de actualización','Cámara','Ubicación','Hora','Evento','Gravedad','Detalles','Enviado automáticamente por TMP Camera Surveillance.'],
  it: ['Notifica di prova','Le notifiche e-mail sono configurate correttamente.','Movimento rilevato','Telecamera offline','Telecamera di nuovo online','Problema del flusso live','Flusso live ripristinato','Problema di registrazione','Registrazione ripristinata','Avviso di sistema','Operazione di aggiornamento','Telecamera','Posizione','Ora','Evento','Gravità','Dettagli','Inviato automaticamente da TMP Camera Surveillance.'],
  nl: ['Testmelding','E-mailmeldingen zijn correct ingesteld.','Beweging gedetecteerd','Camera offline','Camera weer online','Probleem met livestream','Livestream hersteld','Opnameprobleem','Opname hersteld','Systeemwaarschuwing','Updatebewerking','Camera','Locatie','Tijd','Gebeurtenis','Ernst','Details','Automatisch verzonden door TMP Camera Surveillance.'],
  pl: ['Powiadomienie testowe','Powiadomienia e-mail są skonfigurowane poprawnie.','Wykryto ruch','Kamera offline','Kamera ponownie online','Problem z transmisją na żywo','Transmisja przywrócona','Problem z nagrywaniem','Nagrywanie przywrócone','Ostrzeżenie systemowe','Operacja aktualizacji','Kamera','Lokalizacja','Czas','Zdarzenie','Poziom','Szczegóły','Wysłano automatycznie przez TMP Camera Surveillance.'],
  'pt-BR': ['Notificação de teste','As notificações por e-mail estão configuradas corretamente.','Movimento detectado','Câmera offline','Câmera online novamente','Problema na transmissão ao vivo','Transmissão ao vivo recuperada','Problema de gravação','Gravação recuperada','Aviso do sistema','Operação de atualização','Câmera','Local','Hora','Evento','Gravidade','Detalhes','Enviado automaticamente pelo TMP Camera Surveillance.'],
  tr: ['Test bildirimi','E-posta bildirimleri doğru şekilde yapılandırıldı.','Hareket algılandı','Kamera çevrimdışı','Kamera yeniden çevrimiçi','Canlı yayın sorunu','Canlı yayın kurtarıldı','Kayıt sorunu','Kayıt kurtarıldı','Sistem uyarısı','Güncelleme işlemi','Kamera','Konum','Zaman','Olay','Önem','Ayrıntılar','TMP Camera Surveillance tarafından otomatik gönderildi.'],
  cs: ['Testovací oznámení','E-mailová oznámení jsou správně nastavena.','Detekován pohyb','Kamera offline','Kamera je znovu online','Problém živého streamu','Živý stream obnoven','Problém nahrávání','Nahrávání obnoveno','Systémové upozornění','Operace aktualizace','Kamera','Umístění','Čas','Událost','Závažnost','Podrobnosti','Automaticky odesláno službou TMP Camera Surveillance.'],
  da: ['Testnotifikation','E-mailnotifikationer er konfigureret korrekt.','Bevægelse registreret','Kamera offline','Kamera online igen','Problem med livestream','Livestream gendannet','Problem med optagelse','Optagelse gendannet','Systemadvarsel','Opdateringshandling','Kamera','Placering','Tid','Hændelse','Alvorlighed','Detaljer','Sendt automatisk af TMP Camera Surveillance.'],
  sv: ['Testavisering','E-postaviseringar är korrekt konfigurerade.','Rörelse upptäckt','Kamera offline','Kamera online igen','Problem med liveström','Liveström återställd','Inspelningsproblem','Inspelning återställd','Systemvarning','Uppdateringsåtgärd','Kamera','Plats','Tid','Händelse','Allvarlighetsgrad','Detaljer','Skickat automatiskt av TMP Camera Surveillance.'],
  nb: ['Testvarsel','E-postvarsler er riktig konfigurert.','Bevegelse oppdaget','Kamera offline','Kamera online igjen','Problem med direktestrøm','Direktestrøm gjenopprettet','Opptaksproblem','Opptak gjenopprettet','Systemvarsel','Oppdateringsoperasjon','Kamera','Plassering','Tid','Hendelse','Alvorlighet','Detaljer','Sendt automatisk av TMP Camera Surveillance.'],
  fi: ['Testi-ilmoitus','Sähköposti-ilmoitukset on määritetty oikein.','Liike havaittu','Kamera offline','Kamera jälleen online','Suoratoisto-ongelma','Suoratoisto palautettu','Tallennusongelma','Tallennus palautettu','Järjestelmävaroitus','Päivitystoiminto','Kamera','Sijainti','Aika','Tapahtuma','Vakavuus','Tiedot','TMP Camera Surveillance lähetti tämän automaattisesti.'],
  ro: ['Notificare de test','Notificările prin e-mail sunt configurate corect.','Mișcare detectată','Cameră offline','Cameră din nou online','Problemă flux live','Flux live restabilit','Problemă de înregistrare','Înregistrare restabilită','Avertisment sistem','Operație de actualizare','Cameră','Locație','Ora','Eveniment','Severitate','Detalii','Trimis automat de TMP Camera Surveillance.'],
  hu: ['Tesztértesítés','Az e-mail értesítések megfelelően vannak beállítva.','Mozgás érzékelve','Kamera offline','Kamera újra online','Élő stream probléma','Élő stream helyreállt','Felvételi probléma','Felvétel helyreállt','Rendszerfigyelmeztetés','Frissítési művelet','Kamera','Hely','Idő','Esemény','Súlyosság','Részletek','Automatikusan küldte a TMP Camera Surveillance.'],
  el: ['Δοκιμαστική ειδοποίηση','Οι ειδοποιήσεις e-mail έχουν ρυθμιστεί σωστά.','Εντοπίστηκε κίνηση','Κάμερα εκτός σύνδεσης','Κάμερα ξανά online','Πρόβλημα ζωντανής ροής','Η ζωντανή ροή αποκαταστάθηκε','Πρόβλημα εγγραφής','Η εγγραφή αποκαταστάθηκε','Προειδοποίηση συστήματος','Εργασία ενημέρωσης','Κάμερα','Τοποθεσία','Ώρα','Συμβάν','Σοβαρότητα','Λεπτομέρειες','Αυτόματη αποστολή από το TMP Camera Surveillance.'],
  uk: ['Тестове сповіщення','Сповіщення електронною поштою налаштовано правильно.','Виявлено рух','Камера офлайн','Камера знову онлайн','Проблема з прямим потоком','Прямий потік відновлено','Проблема із записом','Запис відновлено','Системне попередження','Операція оновлення','Камера','Розташування','Час','Подія','Важливість','Деталі','Автоматично надіслано TMP Camera Surveillance.'],
  ru: ['Тестовое уведомление','Уведомления по e-mail настроены правильно.','Обнаружено движение','Камера офлайн','Камера снова онлайн','Проблема прямого потока','Прямой поток восстановлен','Проблема записи','Запись восстановлена','Системное предупреждение','Операция обновления','Камера','Расположение','Время','Событие','Важность','Детали','Автоматически отправлено TMP Camera Surveillance.'],
  ar: ['إشعار اختباري','تم إعداد إشعارات البريد الإلكتروني بشكل صحيح.','تم اكتشاف حركة','الكاميرا غير متصلة','الكاميرا متصلة مجددًا','مشكلة في البث المباشر','تمت استعادة البث المباشر','مشكلة في التسجيل','تمت استعادة التسجيل','تحذير النظام','عملية تحديث','الكاميرا','الموقع','الوقت','الحدث','الخطورة','التفاصيل','تم الإرسال تلقائيًا بواسطة TMP Camera Surveillance.'],
  'zh-CN': ['测试通知','电子邮件通知已正确配置。','检测到移动','摄像机离线','摄像机重新在线','实时视频流问题','实时视频流已恢复','录像问题','录像已恢复','系统警告','更新操作','摄像机','位置','时间','事件','严重性','详细信息','由 TMP Camera Surveillance 自动发送。'],
  'zh-TW': ['測試通知','電子郵件通知已正確設定。','偵測到移動','攝影機離線','攝影機重新上線','即時串流問題','即時串流已復原','錄影問題','錄影已復原','系統警告','更新操作','攝影機','位置','時間','事件','嚴重性','詳細資訊','由 TMP Camera Surveillance 自動傳送。'],
  ja: ['テスト通知','メール通知は正しく設定されています。','モーション検知','カメラがオフライン','カメラが再びオンライン','ライブストリームの問題','ライブストリームが復旧','録画の問題','録画が復旧','システム警告','更新操作','カメラ','場所','時刻','イベント','重要度','詳細','TMP Camera Surveillance から自動送信されました。'],
  ko: ['테스트 알림','이메일 알림이 올바르게 설정되었습니다.','움직임 감지','카메라 오프라인','카메라 다시 온라인','라이브 스트림 문제','라이브 스트림 복구됨','녹화 문제','녹화 복구됨','시스템 경고','업데이트 작업','카메라','위치','시간','이벤트','심각도','세부 정보','TMP Camera Surveillance에서 자동 전송했습니다.'],
};
const translations = Object.fromEntries(Object.entries(rows).map(([locale, values]) => {
  if (values.length !== keys.length) throw new Error(`Invalid mail template row ${locale}: ${values.length}/${keys.length}`);
  return [locale, Object.fromEntries(keys.map((key, index) => [key, values[index]]))];
}));
export function mailText(language) { return translations[language] || translations.en; }

const aiKeys = ['analysis','priority','activity','objects','confidence'];
const aiRows = {
  de: ['KI-Analyse','Priorität','Aktivität','Objekte','Konfidenz'],
  en: ['AI analysis','Priority','Activity','Objects','Confidence'],
  fr: ['Analyse IA','Priorité','Activité','Objets','Confiance'],
  es: ['Análisis de IA','Prioridad','Actividad','Objetos','Confianza'],
  it: ['Analisi IA','Priorità','Attività','Oggetti','Affidabilità'],
  nl: ['AI-analyse','Prioriteit','Activiteit','Objecten','Betrouwbaarheid'],
  pl: ['Analiza AI','Priorytet','Aktywność','Obiekty','Pewność'],
  'pt-BR': ['Análise por IA','Prioridade','Atividade','Objetos','Confiança'],
  tr: ['Yapay zeka analizi','Öncelik','Etkinlik','Nesneler','Güven'],
  cs: ['Analýza AI','Priorita','Aktivita','Objekty','Jistota'],
  da: ['AI-analyse','Prioritet','Aktivitet','Objekter','Sikkerhed'],
  sv: ['AI-analys','Prioritet','Aktivitet','Objekt','Säkerhet'],
  nb: ['KI-analyse','Prioritet','Aktivitet','Objekter','Sikkerhet'],
  fi: ['Tekoälyanalyysi','Prioriteetti','Toiminta','Kohteet','Luottamus'],
  ro: ['Analiză AI','Prioritate','Activitate','Obiecte','Încredere'],
  hu: ['MI-elemzés','Prioritás','Tevékenység','Objektumok','Bizonyosság'],
  el: ['Ανάλυση AI','Προτεραιότητα','Δραστηριότητα','Αντικείμενα','Βεβαιότητα'],
  uk: ['Аналіз ШІ','Пріоритет','Активність','Об’єкти','Впевненість'],
  ru: ['Анализ ИИ','Приоритет','Активность','Объекты','Уверенность'],
  ar: ['تحليل الذكاء الاصطناعي','الأولوية','النشاط','الكائنات','الثقة'],
  'zh-CN': ['AI 分析','优先级','活动','对象','置信度'],
  'zh-TW': ['AI 分析','優先級','活動','物件','信心度'],
  ja: ['AI 分析','優先度','アクティビティ','オブジェクト','確信度'],
  ko: ['AI 분석','우선순위','활동','객체','신뢰도'],
};
const aiTranslations = Object.fromEntries(Object.entries(aiRows).map(([locale, values]) => [locale, Object.fromEntries(aiKeys.map((key, index) => [key, values[index]]))]));
export function aiMailText(language) { return aiTranslations[language] || aiTranslations.en; }
export function renderNotificationMail({ language='en', kind='systemError', camera=null, code='', level='info', createdAt=new Date().toISOString(), details='', analysis=null }) {
  const t = mailText(language); const ai = aiMailText(language); const title = t[kind] || t.systemError; const rowsOut = [];
  if (camera?.name) rowsOut.push([t.camera, camera.name]); if (camera?.location) rowsOut.push([t.location, camera.location]); rowsOut.push([t.time, new Date(createdAt).toLocaleString(language)]); if (code) rowsOut.push([t.event, code]); if (level) rowsOut.push([t.severity, level.toUpperCase()]);
  const aiLines = analysis ? [
    `${ai.analysis}: ${analysis.title || ''}`,
    analysis.description || '',
    `${ai.priority}: ${String(analysis.priority || 'normal').toUpperCase()}`,
    `${ai.activity}: ${analysis.activity || '—'}`,
    `${ai.objects}: ${Array.isArray(analysis.objects) && analysis.objects.length ? analysis.objects.join(', ') : '—'}`,
    `${ai.confidence}: ${Math.round(Number(analysis.confidence || 0) * 100)}%`,
  ].filter(Boolean) : [];
  const text = [title, '', ...rowsOut.map(([a,b]) => `${a}: ${b}`), details ? `\n${t.details}: ${details}` : '', ...(aiLines.length ? ['', ...aiLines] : []), '', t.footer].filter((x)=>x!== '').join('\n');
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const aiHtml = analysis ? `<div style="margin:18px 0;padding:16px;border:1px solid #cfd7e6;border-radius:12px;background:#f7f9fc"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#53627a">${esc(ai.analysis)}</div><h3 style="margin:7px 0 5px">${esc(analysis.title || '')}</h3><p style="margin:0 0 12px;line-height:1.45">${esc(analysis.description || '')}</p><div style="font-size:13px;line-height:1.7"><strong>${esc(ai.priority)}:</strong> ${esc(String(analysis.priority || 'normal').toUpperCase())}<br><strong>${esc(ai.activity)}:</strong> ${esc(analysis.activity || '—')}<br><strong>${esc(ai.objects)}:</strong> ${esc(Array.isArray(analysis.objects) && analysis.objects.length ? analysis.objects.join(', ') : '—')}<br><strong>${esc(ai.confidence)}:</strong> ${esc(`${Math.round(Number(analysis.confidence || 0) * 100)}%`)}</div></div>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#14213d"><h2>${esc(title)}</h2><table style="border-collapse:collapse;width:100%">${rowsOut.map(([a,b])=>`<tr><td style="padding:7px 12px;border-bottom:1px solid #ddd;font-weight:600">${esc(a)}</td><td style="padding:7px 12px;border-bottom:1px solid #ddd">${esc(b)}</td></tr>`).join('')}</table>${details?`<p><strong>${esc(t.details)}:</strong> ${esc(details)}</p>`:''}${aiHtml}<p style="color:#667085;font-size:12px">${esc(t.footer)}</p></div>`;
  const subjectTitle = kind === 'motion' && analysis?.title ? String(analysis.title).slice(0, 160) : title;
  return { subject: `[TMP Camera] ${subjectTitle}${camera?.name ? ` · ${camera.name}` : ''}`, text, html };
}
export { translations as notificationMailTranslations };
