/* ============================================================================
   ЯЗЫКИ ИНТЕРФЕЙСА — 30 языков

   Что переводится: меню, кнопки, подписи полей, служебные ссылки. Что не
   переводится: тексты материалов, документы и цитаты — это меняло бы смысл.
   Машинный перевод в юридических текстах недопустим, поэтому каждая строка
   здесь — словарная, а не автоматическая.

   Как добавить язык: допишите строку в LOCALES (код языка и 24 значения в
   порядке KEYS). Всё остальное подхватится само: переключатель, ?lang=,
   направление письма (dir) и запоминание выбора.

   Ключ — ровно тот русский текст, который стоит в разметке.
   ========================================================================== */
(function () {
  "use strict";

  var KEYS = [
    "Перейти к содержанию", "Лента", "Новости", "Медиашкола", "Регионы",
    "Документы", "О проекте", "Партнёры", "Войти", "Регистрация", "Кабинет",
    "Опубликовать материал", "Стать автором", "Все материалы", "Читать",
    "Поиск", "Отправить", "Сохранить", "Удалить", "Имя", "Почта", "Пароль",
    "Главная", "Светлая тема"
  ];

  /* [код, название, направление, 24 перевода] */
  var LOCALES = [
    ["ru", "Русский", "ltr", null],
    ["en", "English", "ltr", ["Skip to content", "Feed", "News", "Media school", "Regions",
      "Documents", "About", "Partners", "Log in", "Sign up", "Account",
      "Publish a story", "Become an author", "All stories", "Read",
      "Search", "Send", "Save", "Delete", "Name", "Email", "Password",
      "Home", "Light theme"]],
    ["de", "Deutsch", "ltr", ["Zum Inhalt springen", "Feed", "Nachrichten", "Medienschule", "Regionen",
      "Dokumente", "Über uns", "Partner", "Anmelden", "Registrieren", "Konto",
      "Beitrag veröffentlichen", "Autor werden", "Alle Beiträge", "Lesen",
      "Suche", "Senden", "Speichern", "Löschen", "Name", "E-Mail", "Passwort",
      "Startseite", "Helles Design"]],
    ["fr", "Français", "ltr", ["Aller au contenu", "Fil", "Actualités", "École média", "Régions",
      "Documents", "À propos", "Partenaires", "Connexion", "Inscription", "Compte",
      "Publier un article", "Devenir auteur", "Tous les articles", "Lire",
      "Rechercher", "Envoyer", "Enregistrer", "Supprimer", "Nom", "E-mail", "Mot de passe",
      "Accueil", "Thème clair"]],
    ["es", "Español", "ltr", ["Ir al contenido", "Novedades", "Noticias", "Escuela de medios", "Regiones",
      "Documentos", "Sobre el proyecto", "Socios", "Entrar", "Registro", "Cuenta",
      "Publicar un material", "Ser autor", "Todos los materiales", "Leer",
      "Buscar", "Enviar", "Guardar", "Eliminar", "Nombre", "Correo", "Contraseña",
      "Inicio", "Tema claro"]],
    ["it", "Italiano", "ltr", ["Vai al contenuto", "Feed", "Notizie", "Scuola media", "Regioni",
      "Documenti", "Il progetto", "Partner", "Accedi", "Registrati", "Account",
      "Pubblica un contenuto", "Diventa autore", "Tutti i contenuti", "Leggi",
      "Cerca", "Invia", "Salva", "Elimina", "Nome", "Email", "Password",
      "Home", "Tema chiaro"]],
    ["pt", "Português", "ltr", ["Ir para o conteúdo", "Feed", "Notícias", "Escola de mídia", "Regiões",
      "Documentos", "Sobre o projeto", "Parceiros", "Entrar", "Cadastro", "Conta",
      "Publicar material", "Ser autor", "Todos os materiais", "Ler",
      "Buscar", "Enviar", "Salvar", "Excluir", "Nome", "E-mail", "Senha",
      "Início", "Tema claro"]],
    ["tr", "Türkçe", "ltr", ["İçeriğe geç", "Akış", "Haberler", "Medya okulu", "Bölgeler",
      "Belgeler", "Proje hakkında", "Ortaklar", "Giriş", "Kayıt", "Hesap",
      "İçerik yayınla", "Yazar ol", "Tüm içerikler", "Oku",
      "Ara", "Gönder", "Kaydet", "Sil", "Ad", "E-posta", "Şifre",
      "Ana sayfa", "Açık tema"]],
    ["ar", "العربية", "rtl", ["تخطَّ إلى المحتوى", "التدفق", "الأخبار", "مدرسة الإعلام", "المناطق",
      "الوثائق", "عن المشروع", "الشركاء", "تسجيل الدخول", "إنشاء حساب", "الحساب",
      "نشر مادة", "كن كاتبًا", "كل المواد", "اقرأ",
      "بحث", "إرسال", "حفظ", "حذف", "الاسم", "البريد", "كلمة المرور",
      "الرئيسية", "الوضع الفاتح"]],
    ["zh", "中文", "ltr", ["跳到正文", "信息流", "新闻", "媒体学校", "地区",
      "文件", "关于项目", "合作伙伴", "登录", "注册", "个人中心",
      "发布稿件", "成为作者", "全部稿件", "阅读",
      "搜索", "发送", "保存", "删除", "姓名", "邮箱", "密码",
      "首页", "浅色主题"]],
    ["uk", "Українська", "ltr", ["Перейти до вмісту", "Стрічка", "Новини", "Медіашкола", "Регіони",
      "Документи", "Про проєкт", "Партнери", "Увійти", "Реєстрація", "Кабінет",
      "Опублікувати матеріал", "Стати автором", "Усі матеріали", "Читати",
      "Пошук", "Надіслати", "Зберегти", "Видалити", "Ім'я", "Пошта", "Пароль",
      "Головна", "Світла тема"]],
    ["kk", "Қазақша", "ltr", ["Мазмұнға өту", "Лента", "Жаңалықтар", "Медиамектеп", "Аймақтар",
      "Құжаттар", "Жоба туралы", "Серіктестер", "Кіру", "Тіркелу", "Кабинет",
      "Материал жариялау", "Автор болу", "Барлық материалдар", "Оқу",
      "Іздеу", "Жіберу", "Сақтау", "Жою", "Аты", "Пошта", "Құпиясөз",
      "Басты бет", "Ашық тақырып"]],
    ["uz", "O‘zbekcha", "ltr", ["Kontentga o‘tish", "Lenta", "Yangiliklar", "Media maktab", "Hududlar",
      "Hujjatlar", "Loyiha haqida", "Hamkorlar", "Kirish", "Ro‘yxatdan o‘tish", "Kabinet",
      "Material chop etish", "Muallif bo‘lish", "Barcha materiallar", "O‘qish",
      "Qidirish", "Yuborish", "Saqlash", "O‘chirish", "Ism", "Pochta", "Parol",
      "Bosh sahifa", "Yorug‘ mavzu"]],
    ["az", "Azərbaycanca", "ltr", ["Məzmuna keç", "Lent", "Xəbərlər", "Media məktəbi", "Regionlar",
      "Sənədlər", "Layihə haqqında", "Tərəfdaşlar", "Daxil ol", "Qeydiyyat", "Şəxsi kabinet",
      "Materialı dərc et", "Müəllif ol", "Bütün materiallar", "Oxu",
      "Axtarış", "Göndər", "Yadda saxla", "Sil", "Ad", "Poçt", "Şifrə",
      "Ana səhifə", "İşıqlı tema"]],
    ["hy", "Հայերեն", "ltr", ["Անցնել բովանդակությանը", "Հոսք", "Նորություններ", "Մեդիադպրոց", "Տարածաշրջաններ",
      "Փաստաթղթեր", "Նախագծի մասին", "Գործընկերներ", "Մուտք", "Գրանցում", "Անձնական էջ",
      "Հրապարակել նյութ", "Դառնալ հեղինակ", "Բոլոր նյութերը", "Կարդալ",
      "Որոնում", "Ուղարկել", "Պահել", "Ջնջել", "Անուն", "Փոստ", "Գաղտնաբառ",
      "Գլխավոր", "Բաց թեմա"]],
    ["he", "עברית", "rtl", ["דלג לתוכן", "פיד", "חדשות", "בית ספר לתקשורת", "אזורים",
      "מסמכים", "אודות הפרויקט", "שותפים", "כניסה", "הרשמה", "אזור אישי",
      "לפרסם חומר", "להיות מחבר", "כל החומרים", "לקרוא",
      "חיפוש", "לשלוח", "לשמור", "למחוק", "שם", "דוא\"ל", "סיסמה",
      "ראשי", "עיצוב בהיר"]],
    ["fa", "فارسی", "rtl", ["رفتن به محتوا", "خوراک", "اخبار", "مدرسه رسانه", "مناطق",
      "اسناد", "درباره پروژه", "همکاران", "ورود", "ثبت‌نام", "حساب",
      "انتشار مطلب", "نویسنده شوید", "همه مطالب", "خواندن",
      "جستجو", "ارسال", "ذخیره", "حذف", "نام", "ایمیل", "گذرواژه",
      "خانه", "پوسته روشن"]],
    ["hi", "हिन्दी", "ltr", ["सामग्री पर जाएँ", "फ़ीड", "समाचार", "मीडिया स्कूल", "क्षेत्र",
      "दस्तावेज़", "परियोजना के बारे में", "साझेदार", "लॉग इन", "पंजीकरण", "खाता",
      "सामग्री प्रकाशित करें", "लेखक बनें", "सभी सामग्री", "पढ़ें",
      "खोज", "भेजें", "सहेजें", "हटाएँ", "नाम", "ईमेल", "पासवर्ड",
      "मुख्य पृष्ठ", "हल्की थीम"]],
    ["bn", "বাংলা", "ltr", ["বিষয়বস্তুতে যান", "ফিড", "সংবাদ", "মিডিয়া স্কুল", "অঞ্চল",
      "নথি", "প্রকল্প সম্পর্কে", "অংশীদার", "লগ ইন", "নিবন্ধন", "অ্যাকাউন্ট",
      "লেখা প্রকাশ করুন", "লেখক হোন", "সব লেখা", "পড়ুন",
      "খুঁজুন", "পাঠান", "সংরক্ষণ", "মুছুন", "নাম", "ইমেল", "পাসওয়ার্ড",
      "প্রচ্ছদ", "হালকা থিম"]],
    ["vi", "Tiếng Việt", "ltr", ["Chuyển đến nội dung", "Bảng tin", "Tin tức", "Trường truyền thông", "Khu vực",
      "Tài liệu", "Về dự án", "Đối tác", "Đăng nhập", "Đăng ký", "Tài khoản",
      "Đăng bài", "Trở thành tác giả", "Tất cả bài", "Đọc",
      "Tìm kiếm", "Gửi", "Lưu", "Xóa", "Tên", "Email", "Mật khẩu",
      "Trang chủ", "Giao diện sáng"]],
    ["id", "Bahasa Indonesia", "ltr", ["Lewati ke konten", "Umpan", "Berita", "Sekolah media", "Wilayah",
      "Dokumen", "Tentang proyek", "Mitra", "Masuk", "Daftar", "Akun",
      "Terbitkan materi", "Menjadi penulis", "Semua materi", "Baca",
      "Cari", "Kirim", "Simpan", "Hapus", "Nama", "Email", "Kata sandi",
      "Beranda", "Tema terang"]],
    ["ms", "Bahasa Melayu", "ltr", ["Langkau ke kandungan", "Suapan", "Berita", "Sekolah media", "Wilayah",
      "Dokumen", "Tentang projek", "Rakan", "Masuk", "Daftar", "Akaun",
      "Terbitkan bahan", "Jadi penulis", "Semua bahan", "Baca",
      "Cari", "Hantar", "Simpan", "Padam", "Nama", "E-mel", "Kata laluan",
      "Laman utama", "Tema cerah"]],
    ["th", "ไทย", "ltr", ["ข้ามไปยังเนื้อหา", "ฟีด", "ข่าว", "โรงเรียนสื่อ", "ภูมิภาค",
      "เอกสาร", "เกี่ยวกับโครงการ", "พันธมิตร", "เข้าสู่ระบบ", "สมัคร", "บัญชี",
      "เผยแพร่เนื้อหา", "เป็นนักเขียน", "เนื้อหาทั้งหมด", "อ่าน",
      "ค้นหา", "ส่ง", "บันทึก", "ลบ", "ชื่อ", "อีเมล", "รหัสผ่าน",
      "หน้าแรก", "ธีมสว่าง"]],
    ["ko", "한국어", "ltr", ["본문으로 건너뛰기", "피드", "뉴스", "미디어 학교", "지역",
      "문서", "프로젝트 소개", "파트너", "로그인", "회원가입", "내 계정",
      "기사 발행", "작가 되기", "모든 기사", "읽기",
      "검색", "보내기", "저장", "삭제", "이름", "이메일", "비밀번호",
      "홈", "밝은 테마"]],
    ["ja", "日本語", "ltr", ["本文へスキップ", "フィード", "ニュース", "メディアスクール", "地域",
      "資料", "プロジェクトについて", "パートナー", "ログイン", "新規登録", "マイページ",
      "記事を公開", "著者になる", "すべての記事", "読む",
      "検索", "送信", "保存", "削除", "名前", "メール", "パスワード",
      "ホーム", "ライトテーマ"]],
    ["sr", "Српски", "ltr", ["Пређи на садржај", "Трака", "Вести", "Медијска школа", "Региони",
      "Документи", "О пројекту", "Партнери", "Пријава", "Регистрација", "Кабинет",
      "Објави материјал", "Постани аутор", "Сви материјали", "Читај",
      "Претрага", "Пошаљи", "Сачувај", "Обриши", "Име", "Пошта", "Лозинка",
      "Почетна", "Светла тема"]],
    ["pl", "Polski", "ltr", ["Przejdź do treści", "Kanał", "Wiadomości", "Szkoła medialna", "Regiony",
      "Dokumenty", "O projekcie", "Partnerzy", "Zaloguj", "Rejestracja", "Konto",
      "Opublikuj materiał", "Zostań autorem", "Wszystkie materiały", "Czytaj",
      "Szukaj", "Wyślij", "Zapisz", "Usuń", "Imię", "E-mail", "Hasło",
      "Strona główna", "Jasny motyw"]],
    ["cs", "Čeština", "ltr", ["Přejít na obsah", "Kanál", "Novinky", "Mediální škola", "Regiony",
      "Dokumenty", "O projektu", "Partneři", "Přihlásit", "Registrace", "Účet",
      "Publikovat materiál", "Stát se autorem", "Všechny materiály", "Číst",
      "Hledat", "Odeslat", "Uložit", "Smazat", "Jméno", "E-mail", "Heslo",
      "Domů", "Světlý motiv"]],
    ["nl", "Nederlands", "ltr", ["Naar inhoud", "Feed", "Nieuws", "Mediaschool", "Regio's",
      "Documenten", "Over het project", "Partners", "Inloggen", "Registreren", "Account",
      "Materiaal publiceren", "Auteur worden", "Alle materialen", "Lezen",
      "Zoeken", "Versturen", "Opslaan", "Verwijderen", "Naam", "E-mail", "Wachtwoord",
      "Home", "Licht thema"]],
    ["sv", "Svenska", "ltr", ["Gå till innehåll", "Flöde", "Nyheter", "Medieskola", "Regioner",
      "Dokument", "Om projektet", "Partner", "Logga in", "Registrera", "Konto",
      "Publicera material", "Bli författare", "Allt material", "Läs",
      "Sök", "Skicka", "Spara", "Ta bort", "Namn", "E-post", "Lösenord",
      "Hem", "Ljust tema"]],
    ["ro", "Română", "ltr", ["Sari la conținut", "Flux", "Știri", "Școală media", "Regiuni",
      "Documente", "Despre proiect", "Parteneri", "Autentificare", "Înregistrare", "Cont",
      "Publică material", "Devino autor", "Toate materialele", "Citește",
      "Căutare", "Trimite", "Salvează", "Șterge", "Nume", "E-mail", "Parolă",
      "Acasă", "Temă deschisă"]],
    ["el", "Ελληνικά", "ltr", ["Μετάβαση στο περιεχόμενο", "Ροή", "Νέα", "Σχολή μέσων", "Περιοχές",
      "Έγγραφα", "Σχετικά με το έργο", "Συνεργάτες", "Σύνδεση", "Εγγραφή", "Λογαριασμός",
      "Δημοσίευση υλικού", "Γίνε συγγραφέας", "Όλο το υλικό", "Ανάγνωση",
      "Αναζήτηση", "Αποστολή", "Αποθήκευση", "Διαγραφή", "Όνομα", "Email", "Κωδικός",
      "Αρχική", "Φωτεινό θέμα"]],
    ["hu", "Magyar", "ltr", ["Ugrás a tartalomra", "Hírfolyam", "Hírek", "Médiais kola", "Régiók",
      "Dokumentumok", "A projektről", "Partnerek", "Belépés", "Regisztráció", "Fiók",
      "Cikk közzététele", "Legyél szerző", "Összes cikk", "Olvasás",
      "Keresés", "Küldés", "Mentés", "Törlés", "Név", "E-mail", "Jelszó",
      "Főoldal", "Világos téma"]],
    ["fi", "Suomi", "ltr", ["Siirry sisältöön", "Syöte", "Uutiset", "Mediakoulu", "Alueet",
      "Asiakirjat", "Tietoa hankkeesta", "Kumppanit", "Kirjaudu", "Rekisteröidy", "Tili",
      "Julkaise juttu", "Ryhdy kirjoittajaksi", "Kaikki jutut", "Lue",
      "Haku", "Lähetä", "Tallenna", "Poista", "Nimi", "Sähköposti", "Salasana",
      "Etusivu", "Vaalea teema"]],
    ["no", "Norsk", "ltr", ["Gå til innhold", "Strøm", "Nyheter", "Medieskole", "Regioner",
      "Dokumenter", "Om prosjektet", "Partnere", "Logg inn", "Registrer", "Konto",
      "Publiser sak", "Bli skribent", "Alle saker", "Les",
      "Søk", "Send", "Lagre", "Slett", "Navn", "E-post", "Passord",
      "Hjem", "Lyst tema"]],
    ["da", "Dansk", "ltr", ["Gå til indhold", "Feed", "Nyheder", "Medieskole", "Regioner",
      "Dokumenter", "Om projektet", "Partnere", "Log ind", "Tilmeld", "Konto",
      "Udgiv artikel", "Bliv skribent", "Alle artikler", "Læs",
      "Søg", "Send", "Gem", "Slet", "Navn", "E-mail", "Adgangskode",
      "Forside", "Lyst tema"]],
    ["is", "Íslenska", "ltr", ["Fara í efni", "Straumar", "Fréttir", "Miðlaskóli", "Svæði",
      "Skjöl", "Um verkefnið", "Samstarfsaðilar", "Innskráning", "Nýskráning", "Reikningur",
      "Birta grein", "Verða höfundur", "Allar greinar", "Lesa",
      "Leita", "Senda", "Vista", "Eyða", "Nafn", "Netpóstur", "Lykilorð",
      "Heim", "Ljóst þema"]],
    ["lt", "Lietuvių", "ltr", ["Pereiti prie turinio", "Srautas", "Naujienos", "Medijos mokykla", "Regionai",
      "Dokumentai", "Apie projektą", "Partneriai", "Prisijungti", "Registracija", "Paskyra",
      "Paskelbti medžiagą", "Tapti autoriumi", "Visa medžiaga", "Skaityti",
      "Paieška", "Siųsti", "Išsaugoti", "Ištrinti", "Vardas", "El. paštas", "Slaptažodis",
      "Pradžia", "Šviesi tema"]],
    ["lv", "Latviešu", "ltr", ["Pāriet uz saturu", "Plūsma", "Jaunumi", "Mediju skola", "Reģioni",
      "Dokumenti", "Par projektu", "Partneri", "Pieteikties", "Reģistrēties", "Konts",
      "Publicēt materiālu", "Kļūt par autoru", "Visi materiāli", "Lasīt",
      "Meklēt", "Sūtīt", "Saglabāt", "Dzēst", "Vārds", "E-pasts", "Parole",
      "Sākums", "Gaišs motīvs"]],
    ["et", "Eesti", "ltr", ["Mine sisu juurde", "Voog", "Uudised", "Meediakool", "Piirkonnad",
      "Dokumendid", "Projektist", "Partnerid", "Logi sisse", "Registreeru", "Konto",
      "Avalda lugu", "Hakka autoriks", "Kõik lood", "Loe",
      "Otsi", "Saada", "Salvesta", "Kustuta", "Nimi", "E-post", "Parool",
      "Avaleht", "Hele teema"]],
    ["sk", "Slovenčina", "ltr", ["Prejsť na obsah", "Kanál", "Správy", "Mediálna škola", "Regióny",
      "Dokumenty", "O projekte", "Partneri", "Prihlásiť", "Registrácia", "Účet",
      "Publikovať materiál", "Stať sa autorom", "Všetky materiály", "Čítať",
      "Hľadať", "Odoslať", "Uložiť", "Odstrániť", "Meno", "E-mail", "Heslo",
      "Domov", "Svetlý vzhľad"]],
    ["sl", "Slovenščina", "ltr", ["Pojdi na vsebino", "Vir", "Novice", "Medijska šola", "Regije",
      "Dokumenti", "O projektu", "Partnerji", "Prijava", "Registracija", "Račun",
      "Objavi gradivo", "Postani avtor", "Vse gradivo", "Preberi",
      "Iskanje", "Pošlji", "Shrani", "Izbriši", "Ime", "E-pošta", "Geslo",
      "Domov", "Svetla tema"]],
    ["hr", "Hrvatski", "ltr", ["Prijeđi na sadržaj", "Kanal", "Vijesti", "Medijska škola", "Regije",
      "Dokumenti", "O projektu", "Partneri", "Prijava", "Registracija", "Račun",
      "Objavi materijal", "Postani autor", "Svi materijali", "Čitaj",
      "Pretraga", "Pošalji", "Spremi", "Izbriši", "Ime", "E-pošta", "Lozinka",
      "Početna", "Svijetla tema"]],
    ["bs", "Bosanski", "ltr", ["Pređi na sadržaj", "Kanal", "Vijesti", "Medijska škola", "Regije",
      "Dokumenti", "O projektu", "Partneri", "Prijava", "Registracija", "Račun",
      "Objavi materijal", "Postani autor", "Svi materijali", "Čitaj",
      "Pretraga", "Pošalji", "Sačuvaj", "Izbriši", "Ime", "E-pošta", "Lozinka",
      "Početna", "Svijetla tema"]],
    ["mk", "Македонски", "ltr", ["Прејди на содржината", "Канал", "Вести", "Медиумско училиште", "Региони",
      "Документи", "За проектот", "Партнери", "Најава", "Регистрација", "Профил",
      "Објави материјал", "Стани автор", "Сите материјали", "Читај",
      "Пребарување", "Испрати", "Зачувај", "Избриши", "Име", "Пошта", "Лозинка",
      "Почетна", "Светла тема"]],
    ["bg", "Български", "ltr", ["Към съдържанието", "Поток", "Новини", "Медийно училище", "Региони",
      "Документи", "За проекта", "Партньори", "Вход", "Регистрация", "Профил",
      "Публикувай материал", "Стани автор", "Всички материали", "Чети",
      "Търсене", "Изпрати", "Запази", "Изтрий", "Име", "Имейл", "Парола",
      "Начало", "Светла тема"]],
    ["sq", "Shqip", "ltr", ["Kalo te përmbajtja", "Rrjedha", "Lajme", "Shkolla e medias", "Rajone",
      "Dokumente", "Rreth projektit", "Partnerë", "Hyr", "Regjistrohu", "Llogaria",
      "Publiko material", "Bëhu autor", "Të gjitha materialet", "Lexo",
      "Kërko", "Dërgo", "Ruaj", "Fshi", "Emri", "Email", "Fjalëkalimi",
      "Faqja kryesore", "Temë e ndritshme"]],
    ["ky", "Кыргызча", "ltr", ["Мазмунга өтүү", "Лента", "Жаңылыктар", "Медиамектеп", "Аймактар",
      "Документтер", "Долбоор жөнүндө", "Өнөктөштөр", "Кирүү", "Каттоо", "Кабинет",
      "Материал жарыялоо", "Автор болуу", "Бардык материалдар", "Окуу",
      "Издөө", "Жөнөтүү", "Сактоо", "Жок кылуу", "Аты", "Почта", "Сырсөз",
      "Башкы бет", "Ачык тема"]],
    ["tg", "Тоҷикӣ", "ltr", ["Гузаштан ба мундариҷа", "Лента", "Хабарҳо", "Мактаби медиа", "Минтақаҳо",
      "Ҳуҷҷатҳо", "Дар бораи лоиҳа", "Шарикон", "Даромадан", "Бақайдгирӣ", "Кабинет",
      "Нашри мавод", "Муаллиф шудан", "Ҳамаи мавод", "Хондан",
      "Ҷустуҷӯ", "Ирсол", "Нигоҳ доштан", "Нест кардан", "Ном", "Почта", "Рамз",
      "Асосӣ", "Мавзӯи равшан"]],
    ["tk", "Türkmençe", "ltr", ["Mazmuna geç", "Lenta", "Täzelikler", "Media mekdebi", "Sebitler",
      "Resminamalar", "Taslama barada", "Hyzmatdaşlar", "Girmek", "Hasaba durmak", "Kabinet",
      "Material çap etmek", "Awtor bolmak", "Ähli materiallar", "Okamak",
      "Gözlemek", "Ibermek", "Saklamak", "Pozmak", "At", "Poçta", "Parol",
      "Baş sahypa", "Ýagty tema"]],
    ["mn", "Монгол", "ltr", ["Агуулга руу очих", "Лент", "Мэдээ", "Медиа сургууль", "Бүс нутаг",
      "Баримт бичиг", "Төслийн тухай", "Түншүүд", "Нэвтрэх", "Бүртгүүлэх", "Кабинет",
      "Материал нийтлэх", "Зохиолч болох", "Бүх материал", "Унших",
      "Хайлт", "Илгээх", "Хадгалах", "Устгах", "Нэр", "И-мэйл", "Нууц үг",
      "Нүүр", "Цайвар загвар"]],
    ["ka", "ქართული", "ltr", ["შინაარსზე გადასვლა", "არხი", "სიახლეები", "მედიასკოლა", "რეგიონები",
      "დოკუმენტები", "პროექტის შესახებ", "პარტნიორები", "შესვლა", "რეგისტრაცია", "ანგარიში",
      "მასალის გამოქვეყნება", "გახდი ავტორი", "ყველა მასალა", "კითხვა",
      "ძიება", "გაგზავნა", "შენახვა", "წაშლა", "სახელი", "ელფოსტა", "პაროლი",
      "მთავარი", "ღია თემა"]],
    ["ur", "اردو", "rtl", ["مواد پر جائیں", "فیڈ", "خبریں", "میڈیا اسکول", "علاقے",
      "دستاویزات", "منصوبے کے بارے میں", "شراکت دار", "لاگ ان", "رجسٹریشن", "اکاؤنٹ",
      "مواد شائع کریں", "مصنف بنیں", "تمام مواد", "پڑھیں",
      "تلاش", "بھیجیں", "محفوظ کریں", "حذف کریں", "نام", "ای میل", "پاس ورڈ",
      "ہوم", "روشن تھیم"]],
    ["sw", "Kiswahili", "ltr", ["Nenda kwenye maudhui", "Mkondo", "Habari", "Shule ya media", "Mikoa",
      "Nyaraka", "Kuhusu mradi", "Washirika", "Ingia", "Jisajili", "Akaunti",
      "Chapisha maudhui", "Kuwa mwandishi", "Maudhui yote", "Soma",
      "Tafuta", "Tuma", "Hifadhi", "Futa", "Jina", "Barua pepe", "Nenosiri",
      "Nyumbani", "Mandhari angavu"]],
    ["af", "Afrikaans", "ltr", ["Gaan na inhoud", "Stroom", "Nuus", "Mediaskool", "Streke",
      "Dokumente", "Oor die projek", "Vennote", "Teken in", "Registreer", "Rekening",
      "Publiseer artikel", "Word skrywer", "Alle artikels", "Lees",
      "Soek", "Stuur", "Stoor", "Verwyder", "Naam", "E-pos", "Wagwoord",
      "Tuis", "Ligte tema"]],
    ["fil", "Filipino", "ltr", ["Lumaktaw sa nilalaman", "Feed", "Balita", "Paaralan ng media", "Mga rehiyon",
      "Mga dokumento", "Tungkol sa proyekto", "Mga katuwang", "Mag-login", "Magrehistro", "Account",
      "I-publish ang akda", "Maging may-akda", "Lahat ng akda", "Basahin",
      "Maghanap", "Ipadala", "I-save", "Tanggalin", "Pangalan", "Email", "Password",
      "Home", "Maliwanag na tema"]],
  ];

  var STORAGE = "smena_lang";
  var current = "ru";
  var LIST = [];
  var DICT = {};   /* русский текст → перевод для текущего языка */

  LOCALES.forEach(function (row) {
    LIST.push({ code: row[0], name: row[1], dir: row[2] });
    if (row[3]) {
      var map = {};
      for (var i = 0; i < KEYS.length; i++) map[KEYS[i]] = row[3][i];
      DICT[row[0]] = map;
    }
  });

  function normalize(code) {
    code = String(code || "").toLowerCase().slice(0, 2);
    for (var i = 0; i < LIST.length; i++) if (LIST[i].code === code) return code;
    return "";
  }

  function readLang() {
    var fromUrl = "";
    try { fromUrl = normalize(new URLSearchParams(window.location.search).get("lang")); } catch (e) {}
    if (fromUrl) return fromUrl;
    try {
      var saved = normalize(window.localStorage.getItem(STORAGE));
      if (saved) return saved;
    } catch (e) {}
    return "ru";
  }

  function translateText(text, lang) {
    var dict = DICT[lang];
    if (!dict) return null;
    var key = text.trim();
    return key && dict[key] ? dict[key] : null;
  }

  function apply(root, lang) {
    lang = lang || current;
    if (lang === "ru") return 0;
    var changed = 0;
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var tag = parent.nodeName.toLowerCase();
        if (["script", "style", "textarea", "code", "pre"].indexOf(tag) >= 0) return NodeFilter.FILTER_REJECT;
        if (parent.closest && parent.closest("[data-no-i18n]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var translated = translateText(node.nodeValue, lang);
      if (translated !== null) {
        node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated);
        changed++;
      }
    }
    var attrs = ["placeholder", "aria-label", "title"];
    var all = (root || document.body).querySelectorAll("[placeholder],[aria-label],[title]");
    for (var i = 0; i < all.length; i++) {
      for (var a = 0; a < attrs.length; a++) {
        var value = all[i].getAttribute(attrs[a]);
        if (!value) continue;
        var t = translateText(value, lang);
        if (t !== null) { all[i].setAttribute(attrs[a], t); changed++; }
      }
    }
    return changed;
  }

  function setLang(code) {
    code = normalize(code) || "ru";
    current = code;
    try { window.localStorage.setItem(STORAGE, code); } catch (e) {}
    var meta = null;
    for (var i = 0; i < LIST.length; i++) if (LIST[i].code === code) meta = LIST[i];
    document.documentElement.setAttribute("lang", code);
    document.documentElement.setAttribute("dir", (meta && meta.dir) || "ltr");
    return code;
  }

  function refresh() {
    apply(document.body, current);
    /* интерфейс собирается скриптами: повторяем после отрисовки */
    setTimeout(function () { apply(document.body, current); }, 250);
    setTimeout(function () { apply(document.body, current); }, 900);
    setTimeout(function () { apply(document.body, current); }, 1800);
  }

  current = setLang(readLang());

  window.SmenaI18n = {
    langs: LIST,
    get lang() { return current; },
    setLang: setLang,
    t: function (ruText) { return translateText(ruText, current) || ruText; },
    apply: apply,
    refresh: refresh
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh);
  else refresh();
})();
