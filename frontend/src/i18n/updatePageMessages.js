const keys = [
  'update.backups.title',
  'update.backups.subtitle',
  'update.backups.empty',
  'update.backups.includesDatabase',
  'update.history.title',
  'update.history.subtitle',
  'update.history.empty',
  'update.history.status.completed',
  'update.history.status.rolled_back',
  'update.history.status.failed',
  'update.history.status.running',
  'update.security.title',
  'update.security.description',
];

const rows = {
  en: [
    'Backups', 'Created automatically before installations.', 'No update backup available yet.', 'including database',
    'History', 'Recent installations and rollbacks.', 'No update operations logged yet.',
    'Completed', 'Rolled back', 'Failed', 'Running',
    'Security concept',
    'Only administrators can upload or install packages. Docker access is handled by a separate, non-public service. Archives with path traversal, symbolic links, an invalid product identifier or mismatched checksums are rejected. Public error messages expose only safe error classes and diagnostic IDs.',
  ],
  de: [
    'Sicherungen', 'Automatisch vor Installationen erstellt.', 'Noch keine Update-Sicherung vorhanden.', 'inklusive Datenbank',
    'Verlauf', 'Letzte Installationen und Rollbacks.', 'Noch keine Update-Vorgänge protokolliert.',
    'Abgeschlossen', 'Zurückgerollt', 'Fehlgeschlagen', 'Läuft',
    'Sicherheitskonzept',
    'Nur Administratoren können Pakete hochladen oder installieren. Der Docker-Zugriff liegt in einem separaten, nicht veröffentlichten Dienst. Archive mit Pfadwechseln, symbolischen Links, fremder Produktkennung oder abweichenden Prüfsummen werden abgelehnt. Öffentliche Fehlermeldungen enthalten nur sichere Fehlerklassen und Diagnose-IDs.',
  ],
  fr: [
    'Sauvegardes', 'Créées automatiquement avant les installations.', 'Aucune sauvegarde de mise à jour disponible pour le moment.', 'base de données incluse',
    'Historique', 'Installations et restaurations récentes.', 'Aucune opération de mise à jour enregistrée pour le moment.',
    'Terminé', 'Restauré', 'Échec', 'En cours',
    'Concept de sécurité',
    'Seuls les administrateurs peuvent téléverser ou installer des paquets. L’accès à Docker est géré par un service séparé et non public. Les archives contenant une traversée de chemin, des liens symboliques, un identifiant produit invalide ou des sommes de contrôle différentes sont refusées. Les messages d’erreur publics n’exposent que des catégories d’erreurs sûres et des identifiants de diagnostic.',
  ],
  es: [
    'Copias de seguridad', 'Se crean automáticamente antes de las instalaciones.', 'Todavía no hay ninguna copia de seguridad de actualización disponible.', 'incluye la base de datos',
    'Historial', 'Instalaciones y reversiones recientes.', 'Todavía no se han registrado operaciones de actualización.',
    'Completado', 'Revertido', 'Fallido', 'En ejecución',
    'Concepto de seguridad',
    'Solo los administradores pueden cargar o instalar paquetes. El acceso a Docker se gestiona mediante un servicio independiente y no público. Se rechazan los archivos con recorridos de ruta, enlaces simbólicos, un identificador de producto no válido o sumas de comprobación distintas. Los mensajes de error públicos solo muestran clases de error seguras e identificadores de diagnóstico.',
  ],
  it: [
    'Backup', 'Creati automaticamente prima delle installazioni.', 'Nessun backup di aggiornamento ancora disponibile.', 'database incluso',
    'Cronologia', 'Installazioni e rollback recenti.', 'Nessuna operazione di aggiornamento ancora registrata.',
    'Completato', 'Ripristinato', 'Non riuscito', 'In esecuzione',
    'Concetto di sicurezza',
    'Solo gli amministratori possono caricare o installare pacchetti. L’accesso a Docker è gestito da un servizio separato e non pubblico. Gli archivi con attraversamento dei percorsi, collegamenti simbolici, identificatore del prodotto non valido o checksum non corrispondenti vengono rifiutati. I messaggi di errore pubblici mostrano solo classi di errore sicure e ID diagnostici.',
  ],
  nl: [
    'Back-ups', 'Automatisch aangemaakt vóór installaties.', 'Er is nog geen updateback-up beschikbaar.', 'inclusief database',
    'Geschiedenis', 'Recente installaties en rollbacks.', 'Er zijn nog geen updatebewerkingen geregistreerd.',
    'Voltooid', 'Teruggedraaid', 'Mislukt', 'Bezig',
    'Beveiligingsconcept',
    'Alleen beheerders kunnen pakketten uploaden of installeren. Docker-toegang wordt afgehandeld door een afzonderlijke, niet-openbare service. Archieven met padtraversal, symbolische links, een ongeldige product-ID of afwijkende controlesommen worden geweigerd. Openbare foutmeldingen tonen alleen veilige foutklassen en diagnose-ID’s.',
  ],
  pl: [
    'Kopie zapasowe', 'Tworzone automatycznie przed instalacją.', 'Brak dostępnej kopii zapasowej aktualizacji.', 'wraz z bazą danych',
    'Historia', 'Ostatnie instalacje i wycofania.', 'Nie zarejestrowano jeszcze żadnych operacji aktualizacji.',
    'Zakończono', 'Wycofano', 'Niepowodzenie', 'W toku',
    'Koncepcja bezpieczeństwa',
    'Tylko administratorzy mogą przesyłać lub instalować pakiety. Dostęp do Dockera jest obsługiwany przez oddzielną, niepubliczną usługę. Archiwa z przejściem poza ścieżkę, dowiązaniami symbolicznymi, nieprawidłowym identyfikatorem produktu lub niezgodnymi sumami kontrolnymi są odrzucane. Publiczne komunikaty o błędach pokazują wyłącznie bezpieczne klasy błędów i identyfikatory diagnostyczne.',
  ],
  'pt-BR': [
    'Backups', 'Criados automaticamente antes das instalações.', 'Nenhum backup de atualização disponível ainda.', 'incluindo o banco de dados',
    'Histórico', 'Instalações e reversões recentes.', 'Nenhuma operação de atualização registrada ainda.',
    'Concluído', 'Revertido', 'Falhou', 'Em execução',
    'Conceito de segurança',
    'Somente administradores podem enviar ou instalar pacotes. O acesso ao Docker é tratado por um serviço separado e não público. Arquivos com travessia de caminho, links simbólicos, identificador de produto inválido ou checksums divergentes são rejeitados. As mensagens públicas de erro exibem apenas classes de erro seguras e IDs de diagnóstico.',
  ],
  tr: [
    'Yedekler', 'Kurulumlardan önce otomatik olarak oluşturulur.', 'Henüz kullanılabilir bir güncelleme yedeği yok.', 'veritabanı dahil',
    'Geçmiş', 'Son kurulumlar ve geri almalar.', 'Henüz güncelleme işlemi kaydedilmedi.',
    'Tamamlandı', 'Geri alındı', 'Başarısız', 'Çalışıyor',
    'Güvenlik yaklaşımı',
    'Paketleri yalnızca yöneticiler yükleyebilir veya kurabilir. Docker erişimi ayrı ve herkese açık olmayan bir hizmet tarafından yönetilir. Dizin geçişi, sembolik bağlantı, geçersiz ürün kimliği veya uyuşmayan sağlama toplamı içeren arşivler reddedilir. Herkese açık hata mesajları yalnızca güvenli hata sınıflarını ve tanılama kimliklerini gösterir.',
  ],
  cs: [
    'Zálohy', 'Vytvářejí se automaticky před instalací.', 'Zatím není k dispozici žádná záloha aktualizace.', 'včetně databáze',
    'Historie', 'Nedávné instalace a návraty.', 'Zatím nebyly zaznamenány žádné operace aktualizace.',
    'Dokončeno', 'Vráceno zpět', 'Selhalo', 'Probíhá',
    'Bezpečnostní koncepce',
    'Balíčky mohou nahrávat nebo instalovat pouze správci. Přístup k Dockeru zajišťuje samostatná neveřejná služba. Archivy s průchodem mimo cestu, symbolickými odkazy, neplatným identifikátorem produktu nebo nesouhlasícími kontrolními součty jsou odmítnuty. Veřejné chybové zprávy zobrazují pouze bezpečné třídy chyb a diagnostická ID.',
  ],
  da: [
    'Sikkerhedskopier', 'Oprettes automatisk før installationer.', 'Der er endnu ingen opdateringssikkerhedskopi.', 'inklusive database',
    'Historik', 'Seneste installationer og tilbagerulninger.', 'Der er endnu ikke registreret nogen opdateringshandlinger.',
    'Fuldført', 'Rullet tilbage', 'Mislykkedes', 'Kører',
    'Sikkerhedskoncept',
    'Kun administratorer kan uploade eller installere pakker. Docker-adgang håndteres af en separat, ikke-offentlig tjeneste. Arkiver med sti-traversering, symbolske links, ugyldigt produkt-id eller afvigende kontrolsummer afvises. Offentlige fejlmeddelelser viser kun sikre fejlklasser og diagnose-id’er.',
  ],
  sv: [
    'Säkerhetskopior', 'Skapas automatiskt före installationer.', 'Ingen uppdateringssäkerhetskopia finns ännu.', 'inklusive databas',
    'Historik', 'Senaste installationer och återställningar.', 'Inga uppdateringsåtgärder har loggats ännu.',
    'Slutförd', 'Återställd', 'Misslyckades', 'Pågår',
    'Säkerhetskoncept',
    'Endast administratörer kan ladda upp eller installera paket. Docker-åtkomst hanteras av en separat, icke-offentlig tjänst. Arkiv med sökvägstraversering, symboliska länkar, ogiltigt produkt-id eller avvikande kontrollsummor avvisas. Offentliga felmeddelanden visar endast säkra felklasser och diagnostik-id:n.',
  ],
  nb: [
    'Sikkerhetskopier', 'Opprettes automatisk før installasjoner.', 'Ingen oppdateringssikkerhetskopi er tilgjengelig ennå.', 'inkludert database',
    'Historikk', 'Nylige installasjoner og tilbakerullinger.', 'Ingen oppdateringsoperasjoner er logget ennå.',
    'Fullført', 'Rullet tilbake', 'Mislyktes', 'Kjører',
    'Sikkerhetskonsept',
    'Bare administratorer kan laste opp eller installere pakker. Docker-tilgang håndteres av en separat, ikke-offentlig tjeneste. Arkiver med katalogtraversering, symbolske lenker, ugyldig produkt-ID eller avvikende kontrollsummer avvises. Offentlige feilmeldinger viser bare sikre feilklasser og diagnostikk-ID-er.',
  ],
  fi: [
    'Varmuuskopiot', 'Luodaan automaattisesti ennen asennuksia.', 'Päivityksen varmuuskopiota ei ole vielä saatavilla.', 'sisältää tietokannan',
    'Historia', 'Viimeisimmät asennukset ja palautukset.', 'Päivitystoimintoja ei ole vielä kirjattu.',
    'Valmis', 'Palautettu', 'Epäonnistui', 'Käynnissä',
    'Tietoturvakonsepti',
    'Vain järjestelmänvalvojat voivat ladata tai asentaa paketteja. Docker-käyttö hoidetaan erillisellä, ei-julkisella palvelulla. Arkistot, joissa on hakemistopolun ohitus, symbolisia linkkejä, virheellinen tuotetunnus tai poikkeavia tarkistussummia, hylätään. Julkiset virheilmoitukset näyttävät vain turvalliset virheluokat ja diagnostiikkatunnukset.',
  ],
  ro: [
    'Copii de siguranță', 'Create automat înainte de instalări.', 'Nu există încă o copie de siguranță pentru actualizare.', 'inclusiv baza de date',
    'Istoric', 'Instalări și reveniri recente.', 'Nu au fost încă înregistrate operațiuni de actualizare.',
    'Finalizat', 'Revenit', 'Eșuat', 'În curs',
    'Concept de securitate',
    'Numai administratorii pot încărca sau instala pachete. Accesul la Docker este gestionat de un serviciu separat, nepublic. Arhivele cu traversare de cale, legături simbolice, identificator de produs invalid sau sume de control diferite sunt respinse. Mesajele publice de eroare afișează doar clase de erori sigure și ID-uri de diagnostic.',
  ],
  hu: [
    'Biztonsági mentések', 'A telepítések előtt automatikusan készülnek.', 'Még nincs elérhető frissítési biztonsági mentés.', 'adatbázissal együtt',
    'Előzmények', 'Legutóbbi telepítések és visszaállítások.', 'Még nincs naplózott frissítési művelet.',
    'Befejezve', 'Visszaállítva', 'Sikertelen', 'Folyamatban',
    'Biztonsági koncepció',
    'Csomagokat csak rendszergazdák tölthetnek fel vagy telepíthetnek. A Docker-hozzáférést külön, nem nyilvános szolgáltatás kezeli. Az útvonal-bejárást, szimbolikus hivatkozásokat, érvénytelen termékazonosítót vagy eltérő ellenőrzőösszegeket tartalmazó archívumokat a rendszer elutasítja. A nyilvános hibaüzenetek csak biztonságos hibaosztályokat és diagnosztikai azonosítókat jelenítenek meg.',
  ],
  el: [
    'Αντίγραφα ασφαλείας', 'Δημιουργούνται αυτόματα πριν από τις εγκαταστάσεις.', 'Δεν υπάρχει ακόμη διαθέσιμο αντίγραφο ασφαλείας ενημέρωσης.', 'μαζί με τη βάση δεδομένων',
    'Ιστορικό', 'Πρόσφατες εγκαταστάσεις και επαναφορές.', 'Δεν έχουν καταγραφεί ακόμη λειτουργίες ενημέρωσης.',
    'Ολοκληρώθηκε', 'Επαναφέρθηκε', 'Απέτυχε', 'Σε εξέλιξη',
    'Σχεδιασμός ασφάλειας',
    'Μόνο οι διαχειριστές μπορούν να μεταφορτώνουν ή να εγκαθιστούν πακέτα. Η πρόσβαση στο Docker διαχειρίζεται από ξεχωριστή, μη δημόσια υπηρεσία. Αρχεία με παράκαμψη διαδρομών, συμβολικούς συνδέσμους, μη έγκυρο αναγνωριστικό προϊόντος ή ασύμφωνες τιμές ελέγχου απορρίπτονται. Τα δημόσια μηνύματα σφάλματος εμφανίζουν μόνο ασφαλείς κατηγορίες σφαλμάτων και αναγνωριστικά διαγνωστικών.',
  ],
  uk: [
    'Резервні копії', 'Створюються автоматично перед встановленням.', 'Резервна копія оновлення ще недоступна.', 'разом із базою даних',
    'Історія', 'Останні встановлення та відкочування.', 'Операції оновлення ще не журналювалися.',
    'Завершено', 'Відкочено', 'Помилка', 'Виконується',
    'Концепція безпеки',
    'Лише адміністратори можуть завантажувати або встановлювати пакети. Доступ до Docker обробляє окрема непублічна служба. Архіви з обходом шляхів, символічними посиланнями, недійсним ідентифікатором продукту або невідповідними контрольними сумами відхиляються. Публічні повідомлення про помилки містять лише безпечні класи помилок та ідентифікатори діагностики.',
  ],
  ru: [
    'Резервные копии', 'Создаются автоматически перед установкой.', 'Резервная копия обновления пока недоступна.', 'включая базу данных',
    'История', 'Последние установки и откаты.', 'Операции обновления пока не зарегистрированы.',
    'Завершено', 'Откат выполнен', 'Ошибка', 'Выполняется',
    'Концепция безопасности',
    'Только администраторы могут загружать или устанавливать пакеты. Доступ к Docker обрабатывается отдельной непубличной службой. Архивы с обходом путей, символическими ссылками, недействительным идентификатором продукта или несовпадающими контрольными суммами отклоняются. Публичные сообщения об ошибках содержат только безопасные классы ошибок и диагностические идентификаторы.',
  ],
  ar: [
    'النسخ الاحتياطية', 'تُنشأ تلقائيًا قبل عمليات التثبيت.', 'لا توجد نسخة احتياطية للتحديث حتى الآن.', 'بما في ذلك قاعدة البيانات',
    'السجل', 'عمليات التثبيت والتراجع الأخيرة.', 'لم يتم تسجيل أي عمليات تحديث حتى الآن.',
    'مكتمل', 'تم التراجع', 'فشل', 'قيد التنفيذ',
    'مفهوم الأمان',
    'يمكن للمسؤولين فقط رفع الحزم أو تثبيتها. تتم إدارة الوصول إلى Docker بواسطة خدمة منفصلة وغير عامة. يتم رفض الأرشيفات التي تحتوي على تجاوز للمسارات أو روابط رمزية أو معرّف منتج غير صالح أو قيم تحقق غير متطابقة. تعرض رسائل الخطأ العامة فقط فئات أخطاء آمنة ومعرّفات تشخيصية.',
  ],
  'zh-CN': [
    '备份', '在安装前自动创建。', '尚无可用的更新备份。', '包含数据库',
    '历史记录', '最近的安装和回滚。', '尚未记录更新操作。',
    '已完成', '已回滚', '失败', '运行中',
    '安全设计',
    '只有管理员可以上传或安装软件包。Docker 访问由独立且非公开的服务处理。包含路径穿越、符号链接、无效产品标识或校验和不匹配的归档会被拒绝。公开错误消息只显示安全的错误类别和诊断 ID。',
  ],
  'zh-TW': [
    '備份', '安裝前會自動建立。', '目前尚無可用的更新備份。', '包含資料庫',
    '歷程', '最近的安裝與回復。', '目前尚未記錄更新操作。',
    '已完成', '已回復', '失敗', '執行中',
    '安全設計',
    '只有管理員可以上傳或安裝套件。Docker 存取由獨立且非公開的服務處理。包含路徑穿越、符號連結、無效產品識別碼或校驗碼不相符的封存檔會被拒絕。公開錯誤訊息只顯示安全的錯誤類別與診斷 ID。',
  ],
  ja: [
    'バックアップ', 'インストール前に自動作成されます。', '更新用バックアップはまだありません。', 'データベースを含む',
    '履歴', '最近のインストールとロールバック。', '更新操作はまだ記録されていません。',
    '完了', 'ロールバック済み', '失敗', '実行中',
    'セキュリティ設計',
    'パッケージをアップロードまたはインストールできるのは管理者だけです。Docker へのアクセスは独立した非公開サービスが処理します。パストラバーサル、シンボリックリンク、無効な製品識別子、または一致しないチェックサムを含むアーカイブは拒否されます。公開エラーメッセージには安全なエラー分類と診断 ID のみが表示されます。',
  ],
  ko: [
    '백업', '설치 전에 자동으로 생성됩니다.', '아직 사용 가능한 업데이트 백업이 없습니다.', '데이터베이스 포함',
    '기록', '최근 설치 및 롤백.', '아직 기록된 업데이트 작업이 없습니다.',
    '완료', '롤백됨', '실패', '실행 중',
    '보안 설계',
    '관리자만 패키지를 업로드하거나 설치할 수 있습니다. Docker 액세스는 별도의 비공개 서비스가 처리합니다. 경로 탐색, 심볼릭 링크, 잘못된 제품 식별자 또는 일치하지 않는 체크섬이 포함된 아카이브는 거부됩니다. 공개 오류 메시지는 안전한 오류 클래스와 진단 ID만 표시합니다.',
  ],
};

const statusExtras = {
  en: ['Installed', 'Manual rollback', 'Rollback failed'], de: ['Installiert', 'Manueller Rollback', 'Rollback fehlgeschlagen'],
  fr: ['Installé', 'Restauration manuelle', 'Échec de la restauration'], es: ['Instalado', 'Reversión manual', 'Falló la reversión'],
  it: ['Installato', 'Rollback manuale', 'Rollback non riuscito'], nl: ['Geïnstalleerd', 'Handmatige rollback', 'Rollback mislukt'],
  pl: ['Zainstalowano', 'Ręczne wycofanie', 'Wycofanie nie powiodło się'], 'pt-BR': ['Instalado', 'Reversão manual', 'Falha na reversão'],
  tr: ['Kuruldu', 'Manuel geri alma', 'Geri alma başarısız'], cs: ['Nainstalováno', 'Ruční návrat', 'Návrat selhal'],
  da: ['Installeret', 'Manuel tilbagerulning', 'Tilbagerulning mislykkedes'], sv: ['Installerad', 'Manuell återställning', 'Återställning misslyckades'],
  nb: ['Installert', 'Manuell tilbakerulling', 'Tilbakerulling mislyktes'], fi: ['Asennettu', 'Manuaalinen palautus', 'Palautus epäonnistui'],
  ro: ['Instalat', 'Revenire manuală', 'Revenirea a eșuat'], hu: ['Telepítve', 'Kézi visszaállítás', 'Visszaállítás sikertelen'],
  el: ['Εγκαταστάθηκε', 'Χειροκίνητη επαναφορά', 'Η επαναφορά απέτυχε'], uk: ['Встановлено', 'Ручне відкочування', 'Відкочування не вдалося'],
  ru: ['Установлено', 'Ручной откат', 'Откат не удался'], ar: ['تم التثبيت', 'تراجع يدوي', 'فشل التراجع'],
  'zh-CN': ['已安装', '手动回滚', '回滚失败'], 'zh-TW': ['已安裝', '手動回復', '回復失敗'],
  ja: ['インストール済み', '手動ロールバック', 'ロールバック失敗'], ko: ['설치됨', '수동 롤백', '롤백 실패'],
};

const statusKeys = ['update.history.status.installed', 'update.history.status.manual_rollback', 'update.history.status.rollback_failed'];

const technicalKeys = [
  'update.action.install',
  'update.action.installTry',
  'update.service.unknown',
  'update.log.technical',
  'update.upload.title',
  'update.operation.completedNotice',
  'update.error.operationFailed',
  'update.phase.preparing',
  'update.issue.UPDATER_TOKEN_INVALID',
  'update.issue.PROJECT_MOUNT_INVALID',
  'update.issue.DOCKER_SOCKET_UNAVAILABLE',
  'update.issue.UPDATER_INITIALIZATION_FAILED',
  'update.issue.HEALTH_ENDPOINT_CONFIGURATION_INVALID',
  'update.service.warning.degraded',
  'update.service.warning.unreachable',
];

const technicalRows = {
  en: [
    'Install', 'Try installation', 'The status of the internal update service is unknown.', 'Technical installation log',
    'Upload update package', 'Update operation completed', 'Operation failed', 'preparing',
    'Internal authentication is not configured correctly', 'Project directory is unavailable', 'Docker control is unavailable',
    'Update service initialization failed', 'Internal health endpoint is configured incorrectly',
    'The update service is reachable but reports limited installation readiness. The installation attempt will provide a diagnostic ID if needed.',
    'The last status check could not reach a configured update service. Installation will still be retried so a temporary network error does not permanently block the operation.',
  ],
  de: [
    'Installieren', 'Installation versuchen', 'Status des internen Update-Dienstes ist unbekannt.', 'Technisches Installationsprotokoll',
    'Update-Paket hochladen', 'Update-Vorgang abgeschlossen', 'Vorgang fehlgeschlagen', 'vorbereiten',
    'Interne Authentifizierung nicht korrekt konfiguriert', 'Projektverzeichnis nicht verfügbar', 'Docker-Steuerung nicht verfügbar',
    'Initialisierung des Update-Dienstes fehlgeschlagen', 'Interner Health-Endpunkt ungültig konfiguriert',
    'Der Update-Dienst ist erreichbar, meldet jedoch eine eingeschränkte Installationsbereitschaft. Der Installationsversuch liefert bei Bedarf eine Diagnose-ID.',
    'Der letzte Statuscheck konnte keinen konfigurierten Update-Dienst erreichen. Die Installation wird trotzdem erneut versucht, damit ein kurzfristiger Netzwerkfehler den Vorgang nicht dauerhaft blockiert.',
  ],
};

export const updatePageMessages = Object.fromEntries(Object.entries(rows).map(([locale, values]) => {
  if (values.length !== keys.length) throw new Error(`Invalid update page translation row: ${locale}`);
  const extraValues = statusExtras[locale];
  if (!extraValues || extraValues.length !== statusKeys.length) throw new Error(`Invalid update page status translations: ${locale}`);
  const technicalValues = technicalRows[locale] || technicalRows.en;
  return [locale, {
    ...Object.fromEntries(keys.map((key, index) => [key, values[index]])),
    ...Object.fromEntries(statusKeys.map((key, index) => [key, extraValues[index]])),
    ...Object.fromEntries(technicalKeys.map((key, index) => [key, technicalValues[index]])),
  }];
}));
