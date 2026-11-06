/* ============================================================================
   ЯЗЫКИ ИНТЕРФЕЙСА

   Честно о границах: «все языки мира» одним файлом не сделать — в мире больше
   семи тысяч языков, и каждый перевод должен делать человек, а не подстановка
   слов. Здесь работает другое: интерфейс (меню, кнопки, подписи полей, футер)
   переводится на восемь языков, а тексты материалов остаются на языке автора.

   Как добавить язык: скопируйте блок в DICT, переведите значения. Ключ — это
   ровно тот русский текст, который стоит в разметке. Ничего больше править не
   нужно: скрипт сам найдёт совпадения на странице.

   Язык хранится в localStorage (smena_lang) и в адресе (?lang=en), чтобы
   ссылку можно было передать другому человеку.
   ========================================================================== */
(function () {
  "use strict";

  var LANGS = [
    { code: "ru", name: "Русский", dir: "ltr" },
    { code: "en", name: "English", dir: "ltr" },
    { code: "de", name: "Deutsch", dir: "ltr" },
    { code: "fr", name: "Français", dir: "ltr" },
    { code: "es", name: "Español", dir: "ltr" },
    { code: "it", name: "Italiano", dir: "ltr" },
    { code: "pt", name: "Português", dir: "ltr" },
    { code: "tr", name: "Türkçe", dir: "ltr" },
    { code: "ar", name: "العربية", dir: "rtl" },
    { code: "zh", name: "中文", dir: "ltr" }
  ];

  /* русский текст → перевод. Отсутствующий ключ остаётся на русском:
     лучше показать оригинал, чем пустое место. */
  var DICT = {
    en: {
      "Перейти к содержанию": "Skip to content",
      "Лента": "Feed",
      "Новости": "News",
      "Медиашкола": "Media school",
      "Регионы": "Regions",
      "Документы": "Documents",
      "О проекте": "About",
      "Партнёры": "Partners",
      "Войти": "Log in",
      "Регистрация": "Sign up",
      "Выйти": "Log out",
      "Кабинет": "Account",
      "Настройки": "Settings",
      "Опубликовать материал": "Publish a story",
      "Стать автором": "Become an author",
      "Все материалы": "All stories",
      "Читать": "Read",
      "Поиск": "Search",
      "Отправить": "Send",
      "Сохранить": "Save",
      "Отмена": "Cancel",
      "Удалить": "Delete",
      "Имя": "Name",
      "Почта": "Email",
      "Пароль": "Password",
      "Город": "City",
      "Тема": "Subject",
      "Главная": "Home",
      "Наверх": "Back to top",
      "Светлая тема": "Light theme",
      "Цвет интерфейса": "Interface color",
      "Язык": "Language",
      "Материалы": "Stories",
      "Люди": "People",
      "Поддержка": "Support"
    },
    de: {
      "Перейти к содержанию": "Zum Inhalt springen",
      "Лента": "Feed",
      "Новости": "Nachrichten",
      "Медиашкола": "Medienschule",
      "Регионы": "Regionen",
      "Документы": "Dokumente",
      "О проекте": "Über uns",
      "Партнёры": "Partner",
      "Войти": "Anmelden",
      "Регистрация": "Registrieren",
      "Выйти": "Abmelden",
      "Кабинет": "Konto",
      "Настройки": "Einstellungen",
      "Опубликовать материал": "Beitrag veröffentlichen",
      "Стать автором": "Autor werden",
      "Все материалы": "Alle Beiträge",
      "Читать": "Lesen",
      "Поиск": "Suche",
      "Отправить": "Senden",
      "Сохранить": "Speichern",
      "Отмена": "Abbrechen",
      "Удалить": "Löschen",
      "Имя": "Name",
      "Почта": "E-Mail",
      "Пароль": "Passwort",
      "Город": "Stadt",
      "Тема": "Betreff",
      "Главная": "Startseite",
      "Наверх": "Nach oben",
      "Светлая тема": "Helles Design",
      "Цвет интерфейса": "Farbe der Oberfläche",
      "Язык": "Sprache",
      "Материалы": "Beiträge",
      "Люди": "Menschen",
      "Поддержка": "Hilfe"
    },
    fr: {
      "Перейти к содержанию": "Aller au contenu",
      "Лента": "Fil",
      "Новости": "Actualités",
      "Медиашкола": "École média",
      "Регионы": "Régions",
      "Документы": "Documents",
      "О проекте": "À propos",
      "Партнёры": "Partenaires",
      "Войти": "Connexion",
      "Регистрация": "Inscription",
      "Выйти": "Déconnexion",
      "Кабинет": "Compte",
      "Настройки": "Paramètres",
      "Опубликовать материал": "Publier un article",
      "Стать автором": "Devenir auteur",
      "Все материалы": "Tous les articles",
      "Читать": "Lire",
      "Поиск": "Rechercher",
      "Отправить": "Envoyer",
      "Сохранить": "Enregistrer",
      "Отмена": "Annuler",
      "Удалить": "Supprimer",
      "Имя": "Nom",
      "Почта": "E-mail",
      "Пароль": "Mot de passe",
      "Город": "Ville",
      "Тема": "Objet",
      "Главная": "Accueil",
      "Наверх": "En haut",
      "Светлая тема": "Thème clair",
      "Цвет интерфейса": "Couleur de l'interface",
      "Язык": "Langue",
      "Материалы": "Articles",
      "Люди": "Personnes",
      "Поддержка": "Assistance"
    },
    es: {
      "Перейти к содержанию": "Ir al contenido",
      "Лента": "Novedades",
      "Новости": "Noticias",
      "Медиашкола": "Escuela de medios",
      "Регионы": "Regiones",
      "Документы": "Documentos",
      "О проекте": "Sobre el proyecto",
      "Партнёры": "Socios",
      "Войти": "Entrar",
      "Регистрация": "Registro",
      "Выйти": "Salir",
      "Кабинет": "Cuenta",
      "Настройки": "Ajustes",
      "Опубликовать материал": "Publicar un material",
      "Стать автором": "Ser autor",
      "Все материалы": "Todos los materiales",
      "Читать": "Leer",
      "Поиск": "Buscar",
      "Отправить": "Enviar",
      "Сохранить": "Guardar",
      "Отмена": "Cancelar",
      "Удалить": "Eliminar",
      "Имя": "Nombre",
      "Почта": "Correo",
      "Пароль": "Contraseña",
      "Город": "Ciudad",
      "Тема": "Asunto",
      "Главная": "Inicio",
      "Наверх": "Arriba",
      "Светлая тема": "Tema claro",
      "Цвет интерфейса": "Color de la interfaz",
      "Язык": "Idioma",
      "Материалы": "Materiales",
      "Люди": "Personas",
      "Поддержка": "Soporte"
    },
    it: {
      "Перейти к содержанию": "Vai al contenuto",
      "Лента": "Feed",
      "Новости": "Notizie",
      "Медиашкола": "Scuola media",
      "Регионы": "Regioni",
      "Документы": "Documenti",
      "О проекте": "Il progetto",
      "Партнёры": "Partner",
      "Войти": "Accedi",
      "Регистрация": "Registrati",
      "Выйти": "Esci",
      "Кабинет": "Account",
      "Настройки": "Impostazioni",
      "Опубликовать материал": "Pubblica un contenuto",
      "Стать автором": "Diventa autore",
      "Все материалы": "Tutti i contenuti",
      "Читать": "Leggi",
      "Поиск": "Cerca",
      "Отправить": "Invia",
      "Сохранить": "Salva",
      "Отмена": "Annulla",
      "Удалить": "Elimina",
      "Имя": "Nome",
      "Почта": "Email",
      "Пароль": "Password",
      "Город": "Città",
      "Тема": "Oggetto",
      "Главная": "Home",
      "Наверх": "Su",
      "Светлая тема": "Tema chiaro",
      "Цвет интерфейса": "Colore dell'interfaccia",
      "Язык": "Lingua",
      "Материалы": "Contenuti",
      "Люди": "Persone",
      "Поддержка": "Assistenza"
    },
    pt: {
      "Перейти к содержанию": "Ir para o conteúdo",
      "Лента": "Feed",
      "Новости": "Notícias",
      "Медиашкола": "Escola de mídia",
      "Регионы": "Regiões",
      "Документы": "Documentos",
      "О проекте": "Sobre o projeto",
      "Партнёры": "Parceiros",
      "Войти": "Entrar",
      "Регистрация": "Cadastro",
      "Выйти": "Sair",
      "Кабинет": "Conta",
      "Настройки": "Configurações",
      "Опубликовать материал": "Publicar material",
      "Стать автором": "Ser autor",
      "Все материалы": "Todos os materiais",
      "Читать": "Ler",
      "Поиск": "Buscar",
      "Отправить": "Enviar",
      "Сохранить": "Salvar",
      "Отмена": "Cancelar",
      "Удалить": "Excluir",
      "Имя": "Nome",
      "Почта": "E-mail",
      "Пароль": "Senha",
      "Город": "Cidade",
      "Тема": "Assunto",
      "Главная": "Início",
      "Наверх": "Ao topo",
      "Светлая тема": "Tema claro",
      "Цвет интерфейса": "Cor da interface",
      "Язык": "Idioma",
      "Материалы": "Materiais",
      "Люди": "Pessoas",
      "Поддержка": "Suporte"
    },
    tr: {
      "Перейти к содержанию": "İçeriğe geç",
      "Лента": "Akış",
      "Новости": "Haberler",
      "Медиашкола": "Medya okulu",
      "Регионы": "Bölgeler",
      "Документы": "Belgeler",
      "О проекте": "Proje hakkında",
      "Партнёры": "Ortaklar",
      "Войти": "Giriş",
      "Регистрация": "Kayıt",
      "Выйти": "Çıkış",
      "Кабинет": "Hesap",
      "Настройки": "Ayarlar",
      "Опубликовать материал": "İçerik yayınla",
      "Стать автором": "Yazar ol",
      "Все материалы": "Tüm içerikler",
      "Читать": "Oku",
      "Поиск": "Ara",
      "Отправить": "Gönder",
      "Сохранить": "Kaydet",
      "Отмена": "İptal",
      "Удалить": "Sil",
      "Имя": "Ad",
      "Почта": "E-posta",
      "Пароль": "Şifre",
      "Город": "Şehir",
      "Тема": "Konu",
      "Главная": "Ana sayfa",
      "Наверх": "Yukarı",
      "Светлая тема": "Açık tema",
      "Цвет интерфейса": "Arayüz rengi",
      "Язык": "Dil",
      "Материалы": "İçerikler",
      "Люди": "Kişiler",
      "Поддержка": "Destek"
    },
    ar: {
      "Перейти к содержанию": "تخطَّ إلى المحتوى",
      "Лента": "التدفق",
      "Новости": "الأخبار",
      "Медиашкола": "مدرسة الإعلام",
      "Регионы": "المناطق",
      "Документы": "الوثائق",
      "О проекте": "عن المشروع",
      "Партнёры": "الشركاء",
      "Войти": "تسجيل الدخول",
      "Регистрация": "إنشاء حساب",
      "Выйти": "خروج",
      "Кабинет": "الحساب",
      "Настройки": "الإعدادات",
      "Опубликовать материал": "نشر مادة",
      "Стать автором": "كن كاتبًا",
      "Все материалы": "كل المواد",
      "Читать": "اقرأ",
      "Поиск": "بحث",
      "Отправить": "إرسال",
      "Сохранить": "حفظ",
      "Отмена": "إلغاء",
      "Удалить": "حذف",
      "Имя": "الاسم",
      "Почта": "البريد",
      "Пароль": "كلمة المرور",
      "Город": "المدينة",
      "Тема": "الموضوع",
      "Главная": "الرئيسية",
      "Наверх": "إلى الأعلى",
      "Светлая тема": "الوضع الفاتح",
      "Цвет интерфейса": "لون الواجهة",
      "Язык": "اللغة",
      "Материалы": "المواد",
      "Люди": "الأشخاص",
      "Поддержка": "الدعم"
    },
    zh: {
      "Перейти к содержанию": "跳到正文",
      "Лента": "信息流",
      "Новости": "新闻",
      "Медиашкола": "媒体学校",
      "Регионы": "地区",
      "Документы": "文件",
      "О проекте": "关于项目",
      "Партнёры": "合作伙伴",
      "Войти": "登录",
      "Регистрация": "注册",
      "Выйти": "退出",
      "Кабинет": "个人中心",
      "Настройки": "设置",
      "Опубликовать материал": "发布稿件",
      "Стать автором": "成为作者",
      "Все материалы": "全部稿件",
      "Читать": "阅读",
      "Поиск": "搜索",
      "Отправить": "发送",
      "Сохранить": "保存",
      "Отмена": "取消",
      "Удалить": "删除",
      "Имя": "姓名",
      "Почта": "邮箱",
      "Пароль": "密码",
      "Город": "城市",
      "Тема": "主题",
      "Главная": "首页",
      "Наверх": "回到顶部",
      "Светлая тема": "浅色主题",
      "Цвет интерфейса": "界面颜色",
      "Язык": "语言",
      "Материалы": "稿件",
      "Люди": "人员",
      "Поддержка": "支持"
    }
  };

  var STORAGE = "smena_lang";
  var current = "ru";

  function normalize(code) {
    code = String(code || "").toLowerCase().slice(0, 2);
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return code;
    return "";
  }

  function readLang() {
    var fromUrl = "";
    try {
      fromUrl = normalize(new URLSearchParams(window.location.search).get("lang"));
    } catch (e) {}
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
    if (!key || !dict[key]) return null;
    return dict[key];
  }

  /* Обходим текстовые узлы и атрибуты. Пропускаем скрипты, стили, поля ввода
     с уже введённым значением и всё, что помечено data-no-i18n. */
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
        if (t !== null) {
          all[i].setAttribute(attrs[a], t);
          changed++;
        }
      }
    }
    return changed;
  }

  function setLang(code) {
    code = normalize(code) || "ru";
    current = code;
    try { window.localStorage.setItem(STORAGE, code); } catch (e) {}
    var meta = null;
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) meta = LANGS[i];
    document.documentElement.setAttribute("lang", code);
    document.documentElement.setAttribute("dir", (meta && meta.dir) || "ltr");
    return code;
  }

  function refresh() {
    apply(document.body, current);
    /* интерфейс собирается скриптами, поэтому повторяем после отрисовки */
    setTimeout(function () { apply(document.body, current); }, 250);
    setTimeout(function () { apply(document.body, current); }, 900);
  }

  current = setLang(readLang());

  window.SmenaI18n = {
    langs: LANGS,
    get lang() { return current; },
    setLang: setLang,
    t: function (ruText) { return translateText(ruText, current) || ruText; },
    apply: apply,
    refresh: refresh
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
