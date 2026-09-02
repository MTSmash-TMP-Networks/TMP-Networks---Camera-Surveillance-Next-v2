const keys = [
  'nav.group.monitoring',
  'nav.group.administration',
  'nav.collapse',
  'nav.expand',
  'overview.locationUnknown',
  'live.moreActions',
  'live.diagnostics',
  'live.restartStream',
  'live.fullscreen',
  'live.exitFullscreen',
  'live.noCamera',
  'live.cameraRail',
  'live.snapshot',
  'live.recording',
  'live.startRecording',
  'live.stopRecording',
  'live.wait',
  'live.kioskOpen',
  'live.kioskDescription',
  'live.actions',
];

const rows = {
  en: ['Monitoring','Administration','Collapse navigation','Expand navigation','Location not set','More actions','Diagnostics','Restart stream','Enter fullscreen','Exit fullscreen','No camera available','Cameras','Snapshot','Recording','Start recording','Stop recording','Please wait …','Open kiosk mode','View all cameras at the same time','Camera actions'],
  de: ['Überwachung','Administration','Navigation einklappen','Navigation ausklappen','Standort nicht gesetzt','Weitere Aktionen','Diagnose','Stream neu aufbauen','Vollbild öffnen','Vollbild beenden','Keine Kamera vorhanden','Kameras','Snapshot','Aufnahme','Aufnahme starten','Aufnahme stoppen','Bitte warten …','Kiosk-Modus öffnen','Alle Kameras gleichzeitig anzeigen','Kameraaktionen'],
  fr: ['Surveillance','Administration','Réduire la navigation','Développer la navigation','Emplacement non défini','Plus d’actions','Diagnostic','Redémarrer le flux','Plein écran','Quitter le plein écran','Aucune caméra disponible','Caméras','Capture','Enregistrement','Démarrer l’enregistrement','Arrêter l’enregistrement','Veuillez patienter …','Ouvrir le mode kiosque','Afficher toutes les caméras simultanément','Actions de la caméra'],
  es: ['Supervisión','Administración','Contraer navegación','Expandir navegación','Ubicación no definida','Más acciones','Diagnóstico','Reiniciar transmisión','Pantalla completa','Salir de pantalla completa','No hay cámaras disponibles','Cámaras','Captura','Grabación','Iniciar grabación','Detener grabación','Espere …','Abrir modo quiosco','Ver todas las cámaras al mismo tiempo','Acciones de cámara'],
  it: ['Sorveglianza','Amministrazione','Comprimi navigazione','Espandi navigazione','Posizione non impostata','Altre azioni','Diagnostica','Riavvia flusso','Schermo intero','Esci da schermo intero','Nessuna telecamera disponibile','Telecamere','Istantanea','Registrazione','Avvia registrazione','Interrompi registrazione','Attendere …','Apri modalità kiosk','Visualizza tutte le telecamere contemporaneamente','Azioni telecamera'],
  nl: ['Bewaking','Beheer','Navigatie inklappen','Navigatie uitklappen','Locatie niet ingesteld','Meer acties','Diagnose','Stream opnieuw starten','Volledig scherm','Volledig scherm sluiten','Geen camera beschikbaar','Camera’s','Momentopname','Opname','Opname starten','Opname stoppen','Even geduld …','Kioskmodus openen','Alle camera’s tegelijk bekijken','Camera-acties'],
  pl: ['Monitoring','Administracja','Zwiń nawigację','Rozwiń nawigację','Brak ustawionej lokalizacji','Więcej działań','Diagnostyka','Uruchom strumień ponownie','Pełny ekran','Wyjdź z pełnego ekranu','Brak dostępnej kamery','Kamery','Migawka','Nagrywanie','Rozpocznij nagrywanie','Zatrzymaj nagrywanie','Proszę czekać …','Otwórz tryb kiosku','Wyświetl wszystkie kamery jednocześnie','Działania kamery'],
  'pt-BR': ['Monitoramento','Administração','Recolher navegação','Expandir navegação','Local não definido','Mais ações','Diagnóstico','Reiniciar transmissão','Tela cheia','Sair da tela cheia','Nenhuma câmera disponível','Câmeras','Captura','Gravação','Iniciar gravação','Parar gravação','Aguarde …','Abrir modo quiosque','Ver todas as câmeras ao mesmo tempo','Ações da câmera'],
  tr: ['İzleme','Yönetim','Gezinmeyi daralt','Gezinmeyi genişlet','Konum ayarlanmamış','Daha fazla işlem','Tanılama','Yayını yeniden başlat','Tam ekran','Tam ekrandan çık','Kullanılabilir kamera yok','Kameralar','Anlık görüntü','Kayıt','Kaydı başlat','Kaydı durdur','Lütfen bekleyin …','Kiosk modunu aç','Tüm kameraları aynı anda görüntüle','Kamera işlemleri'],
  cs: ['Dohled','Správa','Sbalit navigaci','Rozbalit navigaci','Umístění není nastaveno','Další akce','Diagnostika','Restartovat stream','Celá obrazovka','Ukončit celou obrazovku','Není dostupná žádná kamera','Kamery','Snímek','Nahrávání','Spustit nahrávání','Zastavit nahrávání','Čekejte prosím …','Otevřít režim kiosku','Zobrazit všechny kamery současně','Akce kamery'],
  da: ['Overvågning','Administration','Fold navigation sammen','Fold navigation ud','Placering ikke angivet','Flere handlinger','Diagnostik','Genstart stream','Fuld skærm','Afslut fuld skærm','Intet kamera tilgængeligt','Kameraer','Snapshot','Optagelse','Start optagelse','Stop optagelse','Vent venligst …','Åbn kiosktilstand','Vis alle kameraer samtidig','Kamerahandlinger'],
  sv: ['Övervakning','Administration','Fäll ihop navigering','Fäll ut navigering','Plats inte angiven','Fler åtgärder','Diagnostik','Starta om ström','Helskärm','Avsluta helskärm','Ingen kamera tillgänglig','Kameror','Ögonblicksbild','Inspelning','Starta inspelning','Stoppa inspelning','Vänta …','Öppna kioskläge','Visa alla kameror samtidigt','Kameraåtgärder'],
  nb: ['Overvåking','Administrasjon','Skjul navigasjon','Utvid navigasjon','Plassering ikke angitt','Flere handlinger','Diagnostikk','Start strøm på nytt','Fullskjerm','Avslutt fullskjerm','Ingen kamera tilgjengelig','Kameraer','Øyeblikksbilde','Opptak','Start opptak','Stopp opptak','Vennligst vent …','Åpne kioskmodus','Vis alle kameraer samtidig','Kamerahandlinger'],
  fi: ['Valvonta','Hallinta','Pienennä navigointi','Laajenna navigointi','Sijaintia ei ole määritetty','Lisää toimintoja','Diagnostiikka','Käynnistä suoratoisto uudelleen','Koko näyttö','Poistu koko näytöstä','Kameraa ei ole käytettävissä','Kamerat','Tilannekuva','Tallennus','Aloita tallennus','Lopeta tallennus','Odota …','Avaa kioskitila','Näytä kaikki kamerat samanaikaisesti','Kameratoiminnot'],
  ro: ['Supraveghere','Administrare','Restrânge navigarea','Extinde navigarea','Locația nu este setată','Mai multe acțiuni','Diagnosticare','Repornește fluxul','Ecran complet','Ieși din ecran complet','Nicio cameră disponibilă','Camere','Instantaneu','Înregistrare','Pornește înregistrarea','Oprește înregistrarea','Așteptați …','Deschide modul chioșc','Afișează toate camerele simultan','Acțiuni cameră'],
  hu: ['Megfigyelés','Adminisztráció','Navigáció összecsukása','Navigáció kibontása','Nincs hely megadva','További műveletek','Diagnosztika','Stream újraindítása','Teljes képernyő','Kilépés a teljes képernyőből','Nincs elérhető kamera','Kamerák','Pillanatkép','Felvétel','Felvétel indítása','Felvétel leállítása','Kis türelmet …','Kioszk mód megnyitása','Összes kamera egyidejű megjelenítése','Kameraműveletek'],
  el: ['Παρακολούθηση','Διαχείριση','Σύμπτυξη πλοήγησης','Ανάπτυξη πλοήγησης','Δεν έχει οριστεί τοποθεσία','Περισσότερες ενέργειες','Διαγνωστικά','Επανεκκίνηση ροής','Πλήρης οθόνη','Έξοδος από πλήρη οθόνη','Δεν υπάρχει διαθέσιμη κάμερα','Κάμερες','Στιγμιότυπο','Εγγραφή','Έναρξη εγγραφής','Διακοπή εγγραφής','Παρακαλώ περιμένετε …','Άνοιγμα λειτουργίας kiosk','Προβολή όλων των καμερών ταυτόχρονα','Ενέργειες κάμερας'],
  uk: ['Спостереження','Адміністрування','Згорнути навігацію','Розгорнути навігацію','Розташування не задано','Більше дій','Діагностика','Перезапустити потік','Повний екран','Вийти з повного екрана','Немає доступної камери','Камери','Знімок','Запис','Почати запис','Зупинити запис','Зачекайте …','Відкрити режим кіоску','Показати всі камери одночасно','Дії з камерою'],
  ru: ['Наблюдение','Администрирование','Свернуть навигацию','Развернуть навигацию','Местоположение не задано','Дополнительные действия','Диагностика','Перезапустить поток','Полный экран','Выйти из полноэкранного режима','Нет доступной камеры','Камеры','Снимок','Запись','Начать запись','Остановить запись','Подождите …','Открыть режим киоска','Показать все камеры одновременно','Действия с камерой'],
  ar: ['المراقبة','الإدارة','طي التنقل','توسيع التنقل','الموقع غير محدد','إجراءات إضافية','التشخيص','إعادة تشغيل البث','ملء الشاشة','الخروج من ملء الشاشة','لا توجد كاميرا متاحة','الكاميرات','لقطة','التسجيل','بدء التسجيل','إيقاف التسجيل','يرجى الانتظار …','فتح وضع الكشك','عرض جميع الكاميرات في الوقت نفسه','إجراءات الكاميرا'],
  'zh-CN': ['监控','管理','收起导航','展开导航','未设置位置','更多操作','诊断','重启视频流','进入全屏','退出全屏','没有可用摄像机','摄像机','快照','录像','开始录像','停止录像','请稍候 …','打开展台模式','同时查看所有摄像机','摄像机操作'],
  'zh-TW': ['監控','管理','收合導覽','展開導覽','尚未設定位置','更多操作','診斷','重新啟動串流','進入全螢幕','離開全螢幕','沒有可用的攝影機','攝影機','快照','錄影','開始錄影','停止錄影','請稍候 …','開啟展示模式','同時檢視所有攝影機','攝影機操作'],
  ja: ['監視','管理','ナビゲーションを折りたたむ','ナビゲーションを展開','場所が設定されていません','その他の操作','診断','ストリームを再起動','全画面表示','全画面表示を終了','利用可能なカメラがありません','カメラ','スナップショット','録画','録画を開始','録画を停止','お待ちください …','キオスクモードを開く','すべてのカメラを同時に表示','カメラ操作'],
  ko: ['모니터링','관리','탐색 접기','탐색 펼치기','위치가 설정되지 않음','추가 작업','진단','스트림 다시 시작','전체 화면','전체 화면 종료','사용 가능한 카메라 없음','카메라','스냅샷','녹화','녹화 시작','녹화 중지','잠시 기다려 주세요 …','키오스크 모드 열기','모든 카메라를 동시에 보기','카메라 작업'],
};

export const visualRefinementMessages = Object.fromEntries(Object.entries(rows).map(([locale, values]) => {
  if (values.length !== keys.length) throw new Error(`Invalid visual refinement translation row: ${locale}`);
  return [locale, Object.fromEntries(keys.map((key, index) => [key, values[index]]))];
}));
