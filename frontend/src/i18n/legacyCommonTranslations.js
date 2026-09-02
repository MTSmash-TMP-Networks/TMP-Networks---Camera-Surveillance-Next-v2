const phrases = [
  'Speichern','Abbrechen','Weiter','Zurück','Schließen','Löschen','Entfernen','Bearbeiten','Anlegen','Erneut versuchen',
  'Automatisch erkennen','Automatisch','Manuell','Aktiv','Inaktiv','Kamera','Kameras','Status','Quelle','Bereit',
  'Wird verbunden …','Streamfehler','Livebild nicht verfügbar','Keine Berechtigung',
];

const rows = {
  de: ['Speichern','Abbrechen','Weiter','Zurück','Schließen','Löschen','Entfernen','Bearbeiten','Anlegen','Erneut versuchen','Automatisch erkennen','Automatisch','Manuell','Aktiv','Inaktiv','Kamera','Kameras','Status','Quelle','Bereit','Wird verbunden …','Streamfehler','Livebild nicht verfügbar','Keine Berechtigung'],
  en: ['Save','Cancel','Continue','Back','Close','Delete','Remove','Edit','Create','Try again','Detect automatically','Automatic','Manual','Active','Inactive','Camera','Cameras','Status','Source','Ready','Connecting …','Stream error','Live video unavailable','Permission denied'],
  fr: ['Enregistrer','Annuler','Continuer','Retour','Fermer','Supprimer','Retirer','Modifier','Créer','Réessayer','Détecter automatiquement','Automatique','Manuel','Actif','Inactif','Caméra','Caméras','État','Source','Prêt','Connexion …','Erreur de flux','Vidéo en direct indisponible','Autorisation refusée'],
  es: ['Guardar','Cancelar','Continuar','Atrás','Cerrar','Eliminar','Quitar','Editar','Crear','Reintentar','Detectar automáticamente','Automático','Manual','Activo','Inactivo','Cámara','Cámaras','Estado','Fuente','Listo','Conectando …','Error de transmisión','Vídeo en directo no disponible','Permiso denegado'],
  it: ['Salva','Annulla','Continua','Indietro','Chiudi','Elimina','Rimuovi','Modifica','Crea','Riprova','Rileva automaticamente','Automatico','Manuale','Attivo','Inattivo','Telecamera','Telecamere','Stato','Origine','Pronto','Connessione …','Errore del flusso','Video live non disponibile','Autorizzazione negata'],
  nl: ['Opslaan','Annuleren','Doorgaan','Terug','Sluiten','Verwijderen','Verwijderen','Bewerken','Aanmaken','Opnieuw proberen','Automatisch detecteren','Automatisch','Handmatig','Actief','Inactief','Camera','Camera’s','Status','Bron','Gereed','Verbinden …','Streamfout','Livevideo niet beschikbaar','Toegang geweigerd'],
  pl: ['Zapisz','Anuluj','Dalej','Wstecz','Zamknij','Usuń','Usuń','Edytuj','Utwórz','Spróbuj ponownie','Wykryj automatycznie','Automatycznie','Ręcznie','Aktywna','Nieaktywna','Kamera','Kamery','Stan','Źródło','Gotowe','Łączenie …','Błąd strumienia','Podgląd na żywo niedostępny','Brak uprawnień'],
  'pt-BR': ['Salvar','Cancelar','Continuar','Voltar','Fechar','Excluir','Remover','Editar','Criar','Tentar novamente','Detectar automaticamente','Automático','Manual','Ativo','Inativo','Câmera','Câmeras','Status','Fonte','Pronto','Conectando …','Erro de transmissão','Vídeo ao vivo indisponível','Permissão negada'],
  tr: ['Kaydet','İptal','Devam','Geri','Kapat','Sil','Kaldır','Düzenle','Oluştur','Tekrar dene','Otomatik algıla','Otomatik','Manuel','Etkin','Devre dışı','Kamera','Kameralar','Durum','Kaynak','Hazır','Bağlanıyor …','Akış hatası','Canlı görüntü kullanılamıyor','İzin reddedildi'],
  cs: ['Uložit','Zrušit','Pokračovat','Zpět','Zavřít','Smazat','Odebrat','Upravit','Vytvořit','Zkusit znovu','Rozpoznat automaticky','Automaticky','Ručně','Aktivní','Neaktivní','Kamera','Kamery','Stav','Zdroj','Připraveno','Připojování …','Chyba streamu','Živý obraz není dostupný','Přístup odepřen'],
  da: ['Gem','Annuller','Fortsæt','Tilbage','Luk','Slet','Fjern','Rediger','Opret','Prøv igen','Registrer automatisk','Automatisk','Manuel','Aktiv','Inaktiv','Kamera','Kameraer','Status','Kilde','Klar','Opretter forbindelse …','Streamfejl','Livevideo er ikke tilgængelig','Adgang nægtet'],
  sv: ['Spara','Avbryt','Fortsätt','Tillbaka','Stäng','Ta bort','Ta bort','Redigera','Skapa','Försök igen','Identifiera automatiskt','Automatisk','Manuell','Aktiv','Inaktiv','Kamera','Kameror','Status','Källa','Klar','Ansluter …','Strömfel','Livevideo är inte tillgänglig','Åtkomst nekad'],
  nb: ['Lagre','Avbryt','Fortsett','Tilbake','Lukk','Slett','Fjern','Rediger','Opprett','Prøv igjen','Oppdag automatisk','Automatisk','Manuell','Aktiv','Inaktiv','Kamera','Kameraer','Status','Kilde','Klar','Kobler til …','Strømfeil','Direktevideo er ikke tilgjengelig','Ingen tilgang'],
  fi: ['Tallenna','Peruuta','Jatka','Takaisin','Sulje','Poista','Poista','Muokkaa','Luo','Yritä uudelleen','Tunnista automaattisesti','Automaattinen','Manuaalinen','Aktiivinen','Ei aktiivinen','Kamera','Kamerat','Tila','Lähde','Valmis','Yhdistetään …','Suoratoistovirhe','Suora video ei ole käytettävissä','Käyttö estetty'],
  ro: ['Salvează','Anulează','Continuă','Înapoi','Închide','Șterge','Elimină','Editează','Creează','Încearcă din nou','Detectează automat','Automat','Manual','Activ','Inactiv','Cameră','Camere','Stare','Sursă','Gata','Se conectează …','Eroare flux','Imaginea live nu este disponibilă','Acces refuzat'],
  hu: ['Mentés','Mégse','Tovább','Vissza','Bezárás','Törlés','Eltávolítás','Szerkesztés','Létrehozás','Újra','Automatikus felismerés','Automatikus','Kézi','Aktív','Inaktív','Kamera','Kamerák','Állapot','Forrás','Kész','Csatlakozás …','Streamhiba','Az élőkép nem érhető el','Hozzáférés megtagadva'],
  el: ['Αποθήκευση','Ακύρωση','Συνέχεια','Πίσω','Κλείσιμο','Διαγραφή','Αφαίρεση','Επεξεργασία','Δημιουργία','Δοκιμή ξανά','Αυτόματος εντοπισμός','Αυτόματο','Χειροκίνητο','Ενεργό','Ανενεργό','Κάμερα','Κάμερες','Κατάσταση','Πηγή','Έτοιμο','Σύνδεση …','Σφάλμα ροής','Η ζωντανή εικόνα δεν είναι διαθέσιμη','Δεν επιτρέπεται η πρόσβαση'],
  uk: ['Зберегти','Скасувати','Далі','Назад','Закрити','Видалити','Прибрати','Редагувати','Створити','Спробувати ще раз','Виявити автоматично','Автоматично','Вручну','Активна','Неактивна','Камера','Камери','Стан','Джерело','Готово','Підключення …','Помилка потоку','Пряме відео недоступне','Доступ заборонено'],
  ru: ['Сохранить','Отмена','Далее','Назад','Закрыть','Удалить','Убрать','Изменить','Создать','Повторить','Автоматическое обнаружение','Автоматически','Вручную','Активна','Неактивна','Камера','Камеры','Состояние','Источник','Готово','Подключение …','Ошибка потока','Прямое видео недоступно','Доступ запрещён'],
  ar: ['حفظ','إلغاء','متابعة','رجوع','إغلاق','حذف','إزالة','تعديل','إنشاء','إعادة المحاولة','اكتشاف تلقائي','تلقائي','يدوي','نشط','غير نشط','كاميرا','كاميرات','الحالة','المصدر','جاهز','جارٍ الاتصال …','خطأ في البث','الفيديو المباشر غير متاح','تم رفض الإذن'],
  'zh-CN': ['保存','取消','继续','返回','关闭','删除','移除','编辑','创建','重试','自动检测','自动','手动','已启用','已停用','摄像机','摄像机','状态','来源','就绪','正在连接 …','视频流错误','实时视频不可用','权限不足'],
  'zh-TW': ['儲存','取消','繼續','返回','關閉','刪除','移除','編輯','建立','重試','自動偵測','自動','手動','啟用','停用','攝影機','攝影機','狀態','來源','就緒','正在連線 …','串流錯誤','即時影像無法使用','權限不足'],
  ja: ['保存','キャンセル','続行','戻る','閉じる','削除','取り除く','編集','作成','再試行','自動検出','自動','手動','有効','無効','カメラ','カメラ','状態','ソース','準備完了','接続中 …','ストリームエラー','ライブ映像を利用できません','権限がありません'],
  ko: ['저장','취소','계속','뒤로','닫기','삭제','제거','편집','만들기','다시 시도','자동 감지','자동','수동','활성','비활성','카메라','카메라','상태','소스','준비됨','연결 중 …','스트림 오류','라이브 영상을 사용할 수 없음','권한이 거부됨'],
};

export const legacyCommonTranslations = Object.fromEntries(Object.entries(rows).map(([locale, values]) => {
  if (values.length !== phrases.length) throw new Error(`Invalid legacy translation row: ${locale}`);
  return [locale, Object.fromEntries(phrases.map((phrase, index) => [phrase, values[index]]))];
}));
