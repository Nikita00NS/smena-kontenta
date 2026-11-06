/* ============================================================================
   СМЕНА КОНТЕНТА — логика сайта
   ----------------------------------------------------------------------------
   Файл без сборки: подключён на каждой странице и сам решает, что отрисовать,
   глядя на атрибут <body data-page="...">.

   Блоки:
     1.  Утилиты
     2.  Шапка и подвал
     3.  Поиск по сайту
     4.  Карточки материалов
     5.  Карта регионов
     6.  Анимации и эффекты
     7.  Главная
     8.  Лента материалов
     9.  Страница материала
    10.  Страница региона
    11.  Регистрация и вход
    12.  Личный кабинет
    13.  Редактор материала
    14.  Прочее
   ========================================================================== */

(function () {
  "use strict";

  var SC = window.SC || { articles: [], authors: [], topics: [], formats: [] };
  var MAP = window.RU_MAP || { regions: [], viewBox: "0 0 1000 540" };
  var Store = window.Store || null;

  /* 1. Утилиты ============================================================= */

  var MONTHS = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Не удалось прочитать файл.")); };
      reader.readAsDataURL(file);
    });
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* **жирный** и *курсив* внутри абзаца */
  function inlineMd(text) {
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function fmtWhen(iso) {
    var d = new Date(iso);
    var now = new Date();
    var day = 86400000;
    var diff = Math.floor(
      (new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
        new Date(d.getFullYear(), d.getMonth(), d.getDate())) / day
    );
    if (diff === 0) return "сегодня, " + fmtTime(iso);
    if (diff === 1) return "вчера, " + fmtTime(iso);
    return fmtDate(iso);
  }

  function plural(n, forms) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function thumb(src) {
    if (!src) return "";
    if (src.indexOf("data:") === 0) return src;
    return src.replace("/img/", "/img/thumb/");
  }

  function author(id) {
    var list = SC.authors || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { name: "Редакция", role: "", initials: "СК" };
  }

  function authorOf(a) {
    if (a && a.author && typeof a.author === "object") return a.author;
    return author(a && a.author);
  }

  function regionBySlug(slug) {
    var list = MAP.regions || [];
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
    return null;
  }

  function regionName(slug) {
    var r = regionBySlug(slug);
    return r ? r.name : "";
  }

  /* материалы редакции + материалы, опубликованные авторами на сайте */
  function allArticles() {
    var base = (SC.articles || []).slice();
    var extra = [];
    if (Store) {
      try {
        extra = Store.publishedAsArticles();
        if (Store.remoteArticles) extra = extra.concat(Store.remoteArticles());
      } catch (e) {
        extra = extra || [];
      }
    }
    return base
      .concat(extra)
      .sort(function (a, b) {
        return new Date(b.date) - new Date(a.date);
      });
  }

  function sortedArticles() {
    return allArticles();
  }

  function countByRegion(slug) {
    return allArticles().filter(function (a) {
      return a.region === slug;
    }).length;
  }

  function articlesByRegion(slug) {
    return allArticles().filter(function (a) {
      return a.region === slug;
    });
  }

  function findArticle(id) {
    var list = allArticles();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function articleUrl(id) {
    return "/article?id=" + encodeURIComponent(id);
  }

  function regionUrl(slug) {
    return "/region?r=" + encodeURIComponent(slug);
  }

  function param(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function districts() {
    var out = [];
    (MAP.regions || []).forEach(function (r) {
      if (r.district && out.indexOf(r.district) === -1) out.push(r.district);
    });
    return out;
  }

  function regionOptions(selected) {
    return MAP.regions
      .slice()
      .sort(function (a, b) {
        return a.name.localeCompare(b.name, "ru");
      })
      .map(function (r) {
        return (
          '<option value="' + r.slug + '"' +
          (selected === r.slug ? " selected" : "") +
          ">" + esc(r.name) + "</option>"
        );
      })
      .join("");
  }

  var ICONS = {
    palette:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><circle cx="9" cy="9" r="2.4"/><circle cx="15" cy="9" ' +
      'r="2.4"/><circle cx="9" cy="15" r="2.4"/><circle cx="15" cy="15" r="2.4"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>',
    arrow:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    menu:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/></svg>',
    moon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 14.5A8.2 8.2 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  };

  /* 3. Тема оформления ===================================================== */

  var THEME_KEY = "smena_theme";

  function savedTheme() {
    try {
      return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
    } catch (e) {
      return "dark";
    }
  }

  function paintTheme(theme) {
    var root = document.documentElement;
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f7f5ef" : "#0a0a0a");
    $$("[data-theme-toggle]").forEach(function (btn) {
      var next = theme === "light" ? "Тёмная тема" : "Светлая тема";
      btn.setAttribute("aria-label", next);
      btn.setAttribute("title", next);
      btn.innerHTML = theme === "light" ? ICONS.moon : ICONS.sun;
    });
    $$("[data-theme-label]").forEach(function (el) {
      el.textContent = theme === "light" ? "Тёмная тема" : "Светлая тема";
    });
  }

  function toggleTheme() {
    var next = savedTheme() === "light" ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
    paintTheme(next);
  }

  function initTheme() {
    paintTheme(savedTheme());
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-theme-toggle]") : null;
      if (btn) {
        e.preventDefault();
        toggleTheme();
        return;
      }
      /* палитра и тема: кнопка в шапке на каждой странице */
      var trigger = e.target.closest ? e.target.closest("[data-appearance-open]") : null;
      var pop = $("[data-appearance-pop]");
      if (trigger && pop) {
        e.preventDefault();
        var willOpen = pop.hasAttribute("hidden");
        if (willOpen) pop.removeAttribute("hidden");
        else pop.setAttribute("hidden", "");
        trigger.setAttribute("aria-expanded", String(willOpen));
        return;
      }
      if (pop && !pop.hasAttribute("hidden")) {
        var inside = e.target.closest && e.target.closest(".appearance");
        if (!inside) {
          pop.setAttribute("hidden", "");
          var t = $("[data-appearance-open]");
          if (t) t.setAttribute("aria-expanded", "false");
        }
      }
    });
  }

  /* Акцентный цвет: палитра при первом заходе и в настройках профиля.
     Выбор запоминается в браузере, по умолчанию оранжевый. */
  var ACCENTS = [
    { id: "orange", label: "Оранжевый", css: "#ff3d14" },
    { id: "teal", label: "Бирюзовый", css: "#10b5a3" },
    { id: "blue", label: "Синий", css: "#3f7bff" },
    { id: "violet", label: "Фиолетовый", css: "#8b5cf6" },
    { id: "green", label: "Зелёный", css: "#1fa85c" },
    { id: "pink", label: "Розовый", css: "#ff3d8b" },
  ];
  var ACCENT_KEY = "smena_accent";
  var ONBOARD_KEY = "smena_onboard_v1";

  function accentList() {
    return ACCENTS;
  }

  function readAccent() {
    try {
      var v = localStorage.getItem(ACCENT_KEY);
      return ACCENTS.some(function (a) { return a.id === v; }) ? v : "orange";
    } catch (e) {
      return "orange";
    }
  }

  function paintAccent(id) {
    var ok = ACCENTS.some(function (a) { return a.id === id; });
    document.documentElement.setAttribute("data-accent", ok ? id : "orange");
  }

  function syncSwatches(id) {
    $$("[data-accent-pick]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-accent-pick") === id));
    });
  }

  function setAccent(id) {
    try {
      localStorage.setItem(ACCENT_KEY, id);
    } catch (e) {}
    paintAccent(id);
    syncSwatches(id);
  }

  function swatchesHtml() {
    return '<div class="onboard__swatches">' +
      ACCENTS.map(function (a) {
        return '<button class="onboard__swatch" type="button" data-accent-pick="' + a.id +
          '" aria-pressed="false" style="--sw:' + a.css + '" title="' + esc(a.label) + '">' +
          '<span>' + esc(a.label) + "</span></button>";
      }).join("") + "</div>";
  }

  function initAccent() {
    paintAccent(readAccent());
    syncSwatches(readAccent());
    document.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-accent-pick]") : null;
      if (!b) return;
      e.preventDefault();
      setAccent(b.getAttribute("data-accent-pick"));
    });
  }

  /* Первый заход: логотип, приветствие, выбор цвета, короткий гид.
     Пройденный онбординг больше не показывается. */
  function onboardSeen() {
    try {
      return !!localStorage.getItem(ONBOARD_KEY);
    } catch (e) {
      return true;
    }
  }

  function initOnboard() {
    if (onboardSeen()) return;

    var el = document.createElement("div");
    el.className = "onboard";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Знакомство со «Сменой контента»");
    el.innerHTML =
      '<div class="onboard__grid">' +
        '<div class="onboard__logo">' +
          '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
            '<path d="M6 12 L30 34 L6 56" fill="none" stroke="' + "currentColor" + '" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '<path d="M30 12 L54 34 L30 56" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"></path>' +
          "</svg>" +
          '<div class="onboard__logo-mark">Смена<span>контента</span></div>' +
          '<div class="onboard__dots" aria-hidden="true"><i class="is-on"></i><i></i><i></i></div>' +
        "</div>" +

        '<section class="onboard__step is-on" data-ob-step="0">' +
          "<h2>Привет. Это «Смена контента»</h2>" +
          "<p>Молодёжное медиа, медиашкола и сообщество авторов из регионов России. " +
          "Сначала выберите цвет интерфейса — его можно поменять в любой момент.</p>" +
          swatchesHtml() +
          '<div class="onboard__actions">' +
            '<button class="btn btn--accent" type="button" data-onboard-next>Дальше</button>' +
            '<button class="onboard__skip" type="button" data-onboard-skip>Пропустить, оставить оранжевый</button>' +
          "</div>" +
        "</section>" +

        '<section class="onboard__step" data-ob-step="1">' +
          "<h2>Коротко: что здесь есть</h2>" +
          '<ul class="onboard__tour">' +
            "<li><div><b>Материалы</b><span>Тексты, репортажи, фотоистории, видео и подкасты авторов. Ленту можно фильтровать по темам.</span></div></li>" +
            "<li><div><b>Карта регионов</b><span>" + MAP.regions.length +
            " регионов, у каждого — свои авторы и редакции. Где материалов пока нет, мы честно об этом пишем.</span></div></li>" +
            "<li><div><b>Медиашкола</b><span>Практика и разборы: как писать, снимать и монтировать так, чтобы это читали.</span></div></li>" +
            "<li><div><b>Личный кабинет</b><span>Здесь материалы проходят проверку редакции, копятся баллы и открывается пресс-карта.</span></div></li>" +
          "</ul>" +
          '<div class="onboard__actions">' +
            '<button class="btn btn--accent" type="button" data-onboard-next>Понятно</button>' +
            '<button class="onboard__skip" type="button" data-onboard-prev>Назад</button>' +
          "</div>" +
        "</section>" +

        '<section class="onboard__step" data-ob-step="2">' +
          "<h2>Добро пожаловать</h2>" +
          "<p>Публикует материалы редакция: всё, что вы пришлёте, сначала проходит проверку. " +
          "Зарегистрироваться можно без заявок, а пресс-карта выдаётся по заявке — после пяти " +
          "опубликованных материалов или трёх материалов от редакции.</p>" +
          '<div class="onboard__actions">' +
            '<a class="btn btn--accent" href="/join" data-onboard-done>Войти на сайт</a>' +
            '<button class="btn btn--ghost" type="button" data-onboard-done>Просто посмотреть</button>' +
          "</div>" +
        "</section>" +
      "</div>";

    document.body.appendChild(el);
    document.body.classList.add("is-locked");

    var steps = $$(".onboard__step", el);
    var dots = $$(".onboard__dots i", el);
    var current = 0;

    function show(i) {
      current = Math.max(0, Math.min(steps.length - 1, i));
      steps.forEach(function (st, n) {
        st.classList.toggle("is-on", n === current);
      });
      dots.forEach(function (d, n) {
        d.classList.toggle("is-on", n === current);
      });
      var focusBtn = el.querySelector(".onboard__step.is-on .btn");
      if (focusBtn) focusBtn.focus({ preventScroll: true });
    }

    function finish() {
      try {
        localStorage.setItem(ONBOARD_KEY, "1");
      } catch (e) {}
      el.classList.add("is-out");
      document.body.classList.remove("is-locked");
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 460);
    }

    el.addEventListener("click", function (e) {
      var t = e.target;
      if (!t.closest) return;
      if (t.closest("[data-onboard-skip]")) {
        e.preventDefault();
        finish();
        return;
      }
      if (t.closest("[data-onboard-done]")) {
        finish();
        return;
      }
      if (t.closest("[data-onboard-next]")) {
        e.preventDefault();
        show(current + 1);
        return;
      }
      if (t.closest("[data-onboard-prev]")) {
        e.preventDefault();
        show(current - 1);
      }
    });

    document.addEventListener("keydown", function (e) {
      if (!document.body.contains(el)) return;
      if (e.key === "Escape") finish();
    });

    show(0);
  }

  var LOGO =
    '<img class="logo__img" src="/assets/img/logo.png" alt="Смена контента" ' +
    'width="199" height="36" decoding="async">';

  /* 2. Шапка и подвал ====================================================== */

  var NAV = [
    { href: "/news", label: "Материалы", key: "news" },
    { href: "/#map", label: "Регионы", key: "region" },
    { href: "/media-school", label: "Медиашкола", key: "school" },
    { href: "/about", label: "О проекте", key: "about" },
    { href: "/founders", label: "Основатели", key: "founders" },
    { href: "/partners", label: "Партнёрам", key: "partners" },
  ];

  function mountHeader() {
    /* Языки интерфейса: переводятся меню, кнопки и подписи полей.
       Тексты материалов остаются на языке автора — машинный перевод
       выдумывал бы цитаты, а это недопустимо. */
    function langSwitcherHtml() {
      var i18n = window.SmenaI18n;
      if (!i18n) return "";
      var current = i18n.lang;
      var label = "Язык";
      var items = i18n.langs.map(function (l) {
        return '<option value="' + l.code + '"' + (l.code === current ? " selected" : "") + ">" + esc(l.name) + "</option>";
      }).join("");
      return '<label class="lang-switch" title="' + label + '"><span class="visually-hidden">' + label + "</span>" +
        '<select data-lang-select aria-label="' + label + '">' + items + "</select></label>";
    }

    var host = $("[data-header]");
    if (!host) return;
    var active = document.body.getAttribute("data-page") || "";
    var user = Store ? Store.currentUser() : null;
    var today = new Date();
    var dateLine = today.getDate() + " " + MONTHS[today.getMonth()] + " " + today.getFullYear();

    var navHtml = NAV.map(function (n) {
      var isActive = n.key === active || (active === "news" && n.key === "news");
      return (
        '<a class="nav__link" href="' + n.href + '"' +
        (isActive ? ' aria-current="page"' : "") + ">" + n.label + "</a>"
      );
    }).join("");

    var accountHtml = user
      ? '<a class="user-chip" href="/profile" aria-label="Личный кабинет">' +
        (user.avatar
          ? '<img class="user-chip__ava user-chip__ava--img" src="' + esc(user.avatar) + '" alt="">'
          : '<span class="user-chip__ava">' + esc(Store.initials(user.name)) + "</span>") +
        '<span class="user-chip__name">' + esc(user.name.split(" ")[0]) + "</span></a>"
      : '<a class="btn btn--sm btn--ghost login-link" href="/join#login">Войти</a>' +
        '<a class="btn btn--sm" href="/join">Регистрация</a>';

    host.className = "site-header";
    host.innerHTML =
      '<div class="topbar"><div class="wrap topbar__in">' +
      '<div class="topbar__left">' +
      '<a class="badge-live" href="/join">Набор авторов открыт</a>' +
      "<span>" + dateLine + "</span>" +
      "</div>" +
      '<div class="topbar__right">' +
      '<a href="/write">Опубликовать материал</a>' +
      '<a href="/docs">Документы</a>' +
      langSwitcherHtml() +
      "</div></div></div>" +
      '<div class="wrap"><div class="masthead">' +
      '<a class="logo" href="/" aria-label="Смена контента — на главную">' +
      LOGO + "</a>" +
      '<nav class="nav" aria-label="Основная навигация">' + navHtml + "</nav>" +
      '<div class="header-actions">' +
      '<div class="appearance">' +
      '<button class="icon-btn appearance__btn" type="button" data-appearance-open ' +
      'aria-label="Цвет и тема" aria-expanded="false">' + ICONS.palette + "</button>" +
      '<div class="appearance__pop" data-appearance-pop hidden>' +
      '<span class="appearance__label">Цвет интерфейса</span>' + swatchesHtml() +
      '<button class="appearance__theme" type="button" data-theme-toggle>' +
      ICONS.sun + "<span>Светлая тема</span></button>" +
      "</div></div>" +
      '<button class="icon-btn" type="button" data-search-open aria-label="Поиск по сайту">' +
      ICONS.search + "</button>" +
      accountHtml +
      '<button class="icon-btn burger" type="button" data-menu-open aria-label="Открыть меню">' +
      ICONS.menu + "</button>" +
      "</div></div></div>";

    var langSelect = $("[data-lang-select]", host);
    if (langSelect) {
      langSelect.addEventListener("change", function () {
        if (window.SmenaI18n) window.SmenaI18n.setLang(langSelect.value);
        window.location.reload();
      });
    }
    if (window.SmenaI18n) window.SmenaI18n.refresh();

    var menu = document.createElement("div");
    menu.className = "mobile-menu";
    menu.setAttribute("data-menu", "");
    menu.innerHTML =
      '<div class="mobile-menu__head">' +
      '<a class="logo" href="/">' + LOGO + "</a>" +
      '<button class="icon-btn" type="button" data-menu-close aria-label="Закрыть меню">' +
      ICONS.close + "</button></div>" +
      NAV.map(function (n, i) {
        return (
          '<a class="mobile-menu__link" href="' + n.href + '">' + n.label +
          "<span>0" + (i + 1) + "</span></a>"
        );
      }).join("") +
      (user
        ? '<a class="mobile-menu__link" href="/profile">Личный кабинет<span>' +
          esc(Store.initials(user.name)) + "</span></a>"
        : '<a class="mobile-menu__link" href="/join">Регистрация<span>+</span></a>') +
      '<button class="mobile-menu__theme" type="button" data-theme-toggle>' +
      '<b data-theme-label>Светлая тема</b><span>оформление</span></button>' +
      '<div class="mobile-menu__foot">' +
      '<a class="btn btn--block" href="/write">Опубликовать материал</a>' +
      '<button class="btn btn--block btn--ghost" type="button" data-search-open>Поиск по сайту</button>' +
      '<p class="mono" style="color:var(--muted);margin:0">' + esc(SC.brand.email) + "</p></div>";
    document.body.appendChild(menu);

    $("[data-menu-open]").addEventListener("click", function () {
      menu.classList.add("is-open");
      document.body.classList.add("is-locked");
    });
    $("[data-menu-close]").addEventListener("click", function () {
      menu.classList.remove("is-open");
      document.body.classList.remove("is-locked");
    });
    $$(".mobile-menu__link", menu).forEach(function (a) {
      a.addEventListener("click", function () {
        menu.classList.remove("is-open");
        document.body.classList.remove("is-locked");
      });
    });
  }

  function mountFooter() {
    var host = $("[data-footer]");
    if (!host) return;
    var user = Store ? Store.currentUser() : null;
    host.className = "site-footer";
    host.innerHTML =
      '<div class="wrap">' +
      '<div class="footer-top">' +
      '<div class="footer-brand">' +
      '<img class="logo__img" src="/assets/img/logo.png" alt="Смена контента" width="199" height="36" loading="lazy">' +
      "<p>" + esc(SC.brand.tagline) + ". Рассказываем истории из регионов и учим их делать.</p>" +
      '<p class="footer-status"><span class="dot"></span>Набор авторов открыт: собираем первые материалы из регионов.</p>' +
      "</div>" +
      '<div class="footer-col"><h3>Редакция</h3><ul>' +
      '<li><a href="/news">Все материалы</a></li>' +
      '<li><a href="/#map">Регионы</a></li>' +
      '<li><a href="/write">Опубликовать материал</a></li>' +
      '<li><a href="/media-school">Медиашкола</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h3>Проект</h3><ul>' +
      '<li><a href="/about">О проекте</a></li>' +
      '<li><a href="/docs">Документы и пресс-кит</a></li>' +
      '<li><a href="/partners">Партнёрам</a></li>' +
      '<li><a href="/about#roadmap">План развития</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h3>' + (user ? "Аккаунт" : "Участие") + "</h3><ul>" +
      (user
        ? '<li><a href="/profile">Личный кабинет</a></li>' +
          '<li><a href="/write">Новый материал</a></li>' +
          '<li><a href="/admin">Панель проекта</a></li>'
        : '<li><a href="/join">Регистрация</a></li>' +
          '<li><a href="/join#login">Вход</a></li>' +
          '<li><a href="/docs">Памятка автору</a></li>') +
      '<li><a href="/support">Поддержка</a></li>' +
      (contactEmail()
        ? '<li><a href="mailto:' + esc(contactEmail()) + '">' + esc(contactEmail()) + "</a></li>"
        : "") +
      "</ul></div></div>" +
      '<div class="footer-bottom">' +
      '<span>© ' + (SC.brand.year || new Date().getFullYear()) + " «Смена контента»</span>" +
      '<span class="footer-note">Медиа о молодёжи и регионах России. Участие авторов бесплатное.</span>' +
      '<span><a href="/assets/docs/politika-konfidencialnosti.pdf" target="_blank" rel="noopener">Конфиденциальность</a>' +
      ' · <a href="/assets/docs/polzovatelskoe-soglashenie.pdf" target="_blank" rel="noopener">Соглашение</a>' +
      ' · <a href="/docs">Документы</a></span>' +
      "</div></div>";
  }

  /* Если человек вошёл только в этом браузере (без серверного токена),
     говорим об этом прямо: иначе кажется, что всё работает, а на сервере
     аккаунта нет и другие устройства его не видят. */
  function warnLocalOnly() {
    if (!Store || (Store.hasToken && Store.hasToken())) return;
    var user = Store.currentUser ? Store.currentUser() : null;
    if (!user) return;
    var mainEl = document.getElementById("main");
    if (!mainEl || $("[data-local-warn]")) return;
    var bar = document.createElement("div");
    bar.className = "wrap";
    bar.setAttribute("data-local-warn", "");
    bar.innerHTML = '<div class="auth-notice" style="margin-top:16px">' +
      "<b>Вы вошли только в этом браузере.</b> Аккаунта на сервере нет — поэтому данные " +
      "не сохраняются и с другого устройства вход не работает. Откройте " +
      '<a class="link-accent" href="/join#login">вход</a> и введите ту же почту и пароль: ' +
      "мы перенесём аккаунт на сервер.</div>";
    mainEl.insertBefore(bar, mainEl.firstChild);
  }

  /* Объявление в шапке и режим технических работ. */
  function applySiteState() {
    if (!Store || !Store.siteStatus) return;
    Store.siteStatus().then(function (site) {
      if (!site) return;
      var user = Store.currentUser();
      var isAdmin = user && (user.access === "Директор" || user.access === "Администрация");

      if (site.noticeOn && site.notice) {
        var bar = document.createElement("div");
        bar.className = "site-notice";
        bar.innerHTML = '<div class="wrap site-notice__inner"><span>' + esc(site.notice) +
          "</span></div>";
        var mainEl = document.getElementById("main");
        if (mainEl && mainEl.parentNode) mainEl.parentNode.insertBefore(bar, mainEl);
      }

      if (!site.maintenance || isAdmin) return;
      var page = document.body.getAttribute("data-page");
      if (page === "admin") return;

      var host = document.getElementById("main");
      if (!host) return;
      host.innerHTML =
        '<section class="section wrap"><div class="panel maint">' +
        '<span class="kicker">Технические работы</span>' +
        "<h1>Сайт обновляется</h1>" +
        "<p>Мы ненадолго закрыли доступ, чтобы всё работало как надо. " +
        "Материалы и аккаунты в порядке — вернитесь через несколько минут.</p>" +
        (site.notice ? '<p class="maint__note">' + esc(site.notice) + "</p>" : "") +
        '<div class="row"><a class="btn btn--ghost btn--sm" href="/join#login">Войти в кабинет</a></div>' +
        "</div></section>";
    }, function () {});
  }

  /* Поддержка: одно обращение — один разговор. Автор пишет, редакция
     отвечает письмом и закрывает обращение в панели. */
  function initSupport() {
    var form = $("[data-support-form]");
    if (!form) return;

    var user = Store ? Store.currentUser() : null;
    if (user) {
      var nameEl = form.querySelector('[name="name"]');
      var mailEl = form.querySelector('[name="email"]');
      if (nameEl && !nameEl.value) nameEl.value = user.name || "";
      if (mailEl && !mailEl.value) mailEl.value = user.email || "";
    }

    var topics = [
      "Вход и пароль",
      "Публикация материала",
      "Пресс-карта",
      "Редакция региона",
      "Портфолио и баллы",
      "Сотрудничество",
      "Другое",
    ];
    var topicSelect = form.querySelector('[name="topic"]');
    if (topicSelect) {
      topicSelect.innerHTML = topics
        .map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; })
        .join("");
    }

    var note = $("[data-support-note]");
    var submit = form.querySelector("button[type=submit]");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = new FormData(form);
      var name = String(d.get("name") || "").trim();
      var email = String(d.get("email") || "").trim();
      var topic = String(d.get("topic") || "").trim();
      var message = String(d.get("message") || "").trim();

      if (name.length < 2) { note.textContent = "Напишите, как к вам обращаться."; note.className = "support-note is-error"; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { note.textContent = "Проверьте адрес почты — на него придёт ответ."; note.className = "support-note is-error"; return; }
      if (message.length < 15) { note.textContent = "Опишите вопрос подробнее: минимум 15 символов."; note.className = "support-note is-error"; return; }

      if (submit) submit.disabled = true;
      note.className = "support-note";
      note.textContent = "Отправляем…";

      Store.supportSend({ name: name, email: email, topic: topic, message: message }).then(function (ticket) {
        if (submit) submit.disabled = false;
        form.reset();
        if (user) {
          var n2 = form.querySelector('[name="name"]');
          var m2 = form.querySelector('[name="email"]');
          if (n2) n2.value = user.name || "";
          if (m2) m2.value = user.email || "";
        }
        note.className = "support-note is-ok";
        note.innerHTML = "Обращение № " + esc(ticket.id.replace("sp_", "").toUpperCase()) +
          " принято. Ответим на " + esc(email) + " в течение суток." +
          (ticket.mailed ? " Копия ушла редакции." : "") +
          " Сохраните номер — по нему быстрее найдём разговор.";
      }, function (err) {
        if (submit) submit.disabled = false;
        note.className = "support-note is-error";
        note.textContent = (err && err.message) || "Не удалось отправить обращение.";
      });
    });
  }

  /* 3. Поиск по сайту ====================================================== */

  function mountSearch() {
    var overlay = document.createElement("div");
    overlay.className = "search-overlay";
    overlay.innerHTML =
      '<div class="search-box" role="dialog" aria-modal="true" aria-label="Поиск по сайту">' +
      '<div class="search-box__field">' + ICONS.search.replace("<svg", '<svg width="18" height="18"') +
      '<input type="search" placeholder="Материал, тема или регион" aria-label="Поиск">' +
      '<span class="search-box__hint">ESC</span></div>' +
      '<div class="search-results" data-search-results></div></div>';
    document.body.appendChild(overlay);

    var input = $("input", overlay);
    var results = $("[data-search-results]", overlay);
    var activeIndex = -1;
    var hits = [];

    function renderItems() {
      if (!hits.length) {
        results.innerHTML = '<div class="search-empty">Ничего не нашлось. Попробуйте другое слово.</div>';
        return;
      }
      results.innerHTML = hits
        .map(function (h, i) {
          var sub = h.kind === "region"
            ? (h.region.district || "Регион") + " · " + h.count + " " + plural(h.count, ["материал", "материала", "материалов"])
            : h.kind === "page"
              ? h.note
              : h.article.topic + " · " + (regionName(h.article.region) || "Регион");
          return (
            '<a class="search-hit' + (i === activeIndex ? " is-active" : "") +
            '" href="' + h.url + '"><div><div class="search-hit__t">' + esc(h.title) +
            '</div><div class="search-hit__s">' + esc(sub) + "</div></div></a>"
          );
        })
        .join("");
    }

    // постоянные страницы сайта: без них поиск по «медиашкола» или «документы»
    // отвечал «ничего не нашлось», хотя страницы есть
    var PAGES = [
      { title: "Все материалы", url: "/news", note: "Лента редакции", keys: "материалы лента новости публикации статьи" },
      { title: "Карта регионов", url: "/#map", note: "Главная страница", keys: "карта регионы регион география" },
      { title: "Медиашкола", url: "/media-school", note: "Программа обучения", keys: "медиашкола школа обучение практика программа курсы" },
      { title: "Документы и пресс-кит", url: "/docs", note: "Файлы проекта", keys: "документы пресс-кит pdf политика соглашение памятка редакция" },
      { title: "О проекте", url: "/about", note: "Миссия и принципы", keys: "о проекте миссия принципы план развитие идея" },
      { title: "Основатели", url: "/founders", note: "Кто делает проект", keys: "основатели основатель команда авторы проекта кто делает" },
      { title: "Партнёрам", url: "/partners", note: "Сотрудничество", keys: "партнёры партнерам сотрудничество вузы колледжи центры сми" },
      { title: "Регистрация автора", url: "/join", note: "Создать аккаунт", keys: "регистрация аккаунт войти вход автор участвовать" },
      { title: "Написать материал", url: "/write", note: "Редактор", keys: "написать материал редактор черновик публикация" },
      { title: "Пресс-карта автора", url: "/profile", note: "Личный кабинет", keys: "пресс-карта карта кабинет профиль портфолио" },
    ];

    function search(q) {
      q = q.trim().toLowerCase();
      var list = sortedArticles();
      if (q.length < 2) {
        hits = list.slice(0, 5).map(function (a) {
          return { kind: "article", article: a, title: a.title, url: articleUrl(a.id) };
        });
        activeIndex = -1;
        renderItems();
        return;
      }
      var found = [];
      list.forEach(function (a) {
        var hay = (a.title + " " + a.excerpt + " " + a.topic + " " + a.format + " " +
          (regionName(a.region) || "")).toLowerCase();
        if (hay.indexOf(q) !== -1) {
          found.push({ kind: "article", article: a, title: a.title, url: articleUrl(a.id) });
        }
      });
      PAGES.forEach(function (pg) {
        if ((pg.title + " " + pg.note + " " + pg.keys).toLowerCase().indexOf(q) !== -1) {
          found.push({ kind: "page", page: pg, title: pg.title, note: pg.note, url: pg.url });
        }
      });
      (SC.docs || []).forEach(function (doc) {
        if ((doc.title + " " + (doc.desc || "")).toLowerCase().indexOf(q) !== -1) {
          found.push({ kind: "page", page: doc, title: doc.title, note: "Документ PDF", url: doc.file });
        }
      });
      (MAP.regions || []).forEach(function (r) {
        if ((r.name + " " + r.district).toLowerCase().indexOf(q) !== -1) {
          found.push({
            kind: "region", region: r, title: r.name,
            count: countByRegion(r.slug), url: regionUrl(r.slug),
          });
        }
      });
      hits = found.slice(0, 9);
      activeIndex = -1;
      renderItems();
    }

    function open() {
      overlay.classList.add("is-open");
      document.body.classList.add("is-locked");
      input.value = "";
      search("");
      setTimeout(function () { input.focus(); }, 60);
    }

    function close() {
      overlay.classList.remove("is-open");
      document.body.classList.remove("is-locked");
    }

    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-search-open]") : null;
      if (t) {
        e.preventDefault();
        open();
      }
    });

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });

    input.addEventListener("input", function () { search(input.value); });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, hits.length - 1);
        renderItems();
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        renderItems();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && hits[activeIndex]) {
          window.location.href = hits[activeIndex].url;
        } else if (input.value.trim().length > 1) {
          window.location.href = "/news?q=" + encodeURIComponent(input.value.trim());
        }
      }
    });

    document.addEventListener("keydown", function (e) {
      var el = document.activeElement || {};
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || "");
      if (e.key === "Escape" && overlay.classList.contains("is-open")) close();
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        open();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        open();
      }
    });
  }

  /* 4. Карточки ============================================================ */

  function card(a, variant, extra) {
    var v = variant || "default";
    var img = a.image
      ? '<div class="card__media"><img src="' + thumb(a.image) + '" alt="' +
        esc(a.imageAlt || a.title) + '" loading="lazy" decoding="async">' +
        '<span class="card__tag">' + esc(a.format) + "</span>" +
        (a.isUserPost ? '<span class="card__author-flag">автор проекта</span>' : "") +
        "</div>"
      : "";
    var kicker = a.image
      ? ""
      : '<span class="kicker">' + esc(a.format) + " · " + esc(a.topic) + "</span>";

    return (
      '<a class="card card--' + v + (a.image ? "" : " card--text") + '" href="' +
      articleUrl(a.id) + '"' + (extra || "") + ">" + img +
      '<div class="card__body">' + kicker +
      '<h3 class="card__title">' + esc(a.title) + "</h3>" +
      (v === "feature" ? '<p class="card__excerpt">' + esc(a.excerpt) + "</p>" : "") +
      '<div class="card__by">' + esc(authorOf(a).name || "Редакция") + "</div>" +
      '<div class="card__foot"><div class="meta"><span>' +
      esc(regionName(a.region) || "Россия") + '</span><span class="meta__dot"></span><span>' +
      fmtDate(a.date) + '</span></div><span class="mono" style="color:var(--muted)">' +
      (a.read || 4) + " мин</span></div></div></a>"
    );
  }

  function cardRow(a) {
    var img = a.image
      ? '<div class="card__media"><img src="' + thumb(a.image) + '" alt="' +
        esc(a.imageAlt || a.title) + '" loading="lazy" decoding="async"></div>'
      : '<div class="card__media card__media--empty"><span class="mono">' +
        esc(a.format) + "</span></div>";
    return (
      '<a class="card card--row" href="' + articleUrl(a.id) + '">' + img +
      '<div class="card__body"><span class="kicker">' + esc(a.topic) + "</span>" +
      '<h3 class="card__title">' + esc(a.title) + "</h3>" +
      '<div class="card__by">' + esc(authorOf(a).name || "Редакция") + "</div>" +
      '<div class="meta"><span>' + esc(regionName(a.region) || "Россия") +
      '</span><span class="meta__dot"></span><span>' + fmtDate(a.date) + "</span></div>" +
      "</div></a>"
    );
  }

  /* 5. Карта регионов ====================================================== */

  function mountMap(host, options) {
    if (!host || !MAP.regions.length) return null;
    var opts = options || {};
    var regions = MAP.regions;
    var vb = MAP.viewBox.split(" ").map(Number);
    var vbW = vb[2], vbH = vb[3];

    host.innerHTML =
      '<div class="map-stage" data-stage>' +
      '<svg class="map-svg" viewBox="' + MAP.viewBox + '" role="group" ' +
      'aria-label="Карта регионов России. Выберите регион, чтобы увидеть его материалы." ' +
      'data-svg><g data-layer>' +
      regions.filter(function (r) { return r.d; }).map(function (r, i) {
        var n = countByRegion(r.slug);
        return (
          '<path class="map-region' + (n > 0 ? " has-content" : "") + '" d="' + r.d +
          '" data-slug="' + r.slug + '" tabindex="0" role="button" style="--i:' + i + '" ' +
          'aria-label="' + esc(r.name) + (n ? ", материалов: " + n : ", публикаций пока нет") +
          '"></path>'
        );
      }).join("") +
      "</g></svg>" +
      '<div class="map-tooltip" data-tip aria-hidden="true"></div>' +
      (opts.zoom === false ? "" :
        '<div class="map-zoom">' +
        '<button type="button" data-zoom="in" aria-label="Приблизить">+</button>' +
        '<button type="button" data-zoom="out" aria-label="Отдалить">−</button>' +
        '<button type="button" data-zoom="reset" aria-label="Сбросить масштаб">·</button>' +
        "</div>") +
      (opts.hint === false ? "" :
        '<div class="map-hint"><span>Клик по региону — открыть</span>' +
        "<span>Кнопки +/− — масштаб</span><span>Перетаскивание — сдвиг</span></div>") +
      "</div>";

    var svg = $("[data-svg]", host);
    var layer = $("[data-layer]", host);
    var tip = $("[data-tip]", host);
    var stage = $("[data-stage]", host);
    var paths = $$(".map-region", host);
    var state = { s: 1, tx: 0, ty: 0 };

    function apply() {
      layer.setAttribute(
        "transform",
        "translate(" + state.tx + " " + state.ty + ") scale(" + state.s + ")"
      );
    }

    function zoom(factor, cx, cy) {
      var s2 = Math.min(6, Math.max(1, state.s * factor));
      if (s2 === state.s) return;
      var px = typeof cx === "number" ? cx : vbW / 2;
      var py = typeof cy === "number" ? cy : vbH / 2;
      state.tx = px - (s2 * (px - state.tx)) / state.s;
      state.ty = py - (s2 * (py - state.ty)) / state.s;
      state.s = s2;
      if (state.s === 1) { state.tx = 0; state.ty = 0; }
      apply();
    }

    var drag = null, moved = false;
    var canPan = !window.matchMedia || window.matchMedia("(min-width: 721px)").matches;

    function hideTip() {
      tip.classList.remove("is-on");
    }

    function showTip(r, clientX, clientY) {
      if (!tip) return;
      var n = countByRegion(r.slug);
      tip.innerHTML = "<b>" + esc(r.name) + "</b><span>" + esc(r.district || "") +
        (n ? " · " + n + " " + plural(n, ["материал", "материала", "материалов"]) : " · публикаций пока нет") + "</span>";
      var box = stage.getBoundingClientRect();
      tip.style.left = clientX - box.left + "px";
      tip.style.top = clientY - box.top + "px";
      tip.classList.add("is-on");
    }

    function pick(r) {
      $$(".map-region", host).forEach(function (p) {
        p.classList.toggle("is-selected", p.getAttribute("data-slug") === r.slug);
      });
      if (opts.onHover) opts.onHover(r);
    }

    if (opts.zoom !== false && canPan) {
      svg.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, tx: state.tx, ty: state.ty };
        moved = false;
        svg.classList.add("is-panning");
      });
      window.addEventListener("pointermove", function (e) {
        if (!drag) return;
        var box = svg.getBoundingClientRect();
        var k = vbW / box.width;
        var dx = (e.clientX - drag.x) * k;
        var dy = (e.clientY - drag.y) * k;
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) moved = true;
        if (!moved) return;
        state.tx = drag.tx + dx;
        state.ty = drag.ty + dy;
        apply();
        hideTip();
      });
    }
    if (opts.zoom !== false) {
      $$("[data-zoom]", host).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var k = btn.getAttribute("data-zoom");
          if (k === "in") zoom(1.6);
          else if (k === "out") zoom(1 / 1.6);
          else { state = { s: 1, tx: 0, ty: 0 }; apply(); }
        });
      });
      window.addEventListener("pointerup", function () {
        if (!drag) return;
        drag = null;
        svg.classList.remove("is-panning");
        setTimeout(function () { moved = false; }, 10);
      });
    }

    paths.forEach(function (p) {
      var r = regionBySlug(p.getAttribute("data-slug"));
      if (!r) return;
      p.addEventListener("mouseenter", function (e) { showTip(r, e.clientX, e.clientY); });
      p.addEventListener("mousemove", function (e) { showTip(r, e.clientX, e.clientY); });
      p.addEventListener("mouseleave", hideTip);
      p.addEventListener("focus", function () { if (opts.onHover) opts.onHover(r); });
      p.addEventListener("blur", hideTip);
      p.addEventListener("click", function () {
        if (moved) return;
        pick(r);
        if (opts.onSelect) opts.onSelect(r);
        else window.location.href = regionUrl(r.slug);
      });
      p.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick(r);
          if (opts.onSelect) opts.onSelect(r);
          else window.location.href = regionUrl(r.slug);
        }
      });
    });

    function dimDistrict(district) {
      paths.forEach(function (p) {
        var r = regionBySlug(p.getAttribute("data-slug"));
        if (!r) return;
        p.classList.toggle("is-dim", !!district && r.district !== district);
      });
    }

    return {
      node: host,
      dimDistrict: dimDistrict,
      highlight: function (slug) {
        paths.forEach(function (p) {
          p.classList.toggle("is-selected", p.getAttribute("data-slug") === slug);
        });
      },
      reset: function () { state = { s: 1, tx: 0, ty: 0 }; apply(); },
    };
  }

  function mountMapSection() {
    var section = $("[data-map-section]");
    if (!section) return;

    var totalRegions = MAP.regions.length;
    var all = allArticles();
    var totalArticles = all.length;
    var regionsWithContent = all.reduce(function (acc, a) {
      if (acc.indexOf(a.region) === -1) acc.push(a.region);
      return acc;
    }, []).length;

    section.innerHTML =
      '<div class="wrap">' +
      '<div class="map-head">' +
      '<div><span class="kicker">02 — Главная особенность</span>' +
      '<h2>Выберите <em>свой регион</em> на карте</h2></div>' +
      '<div><p class="map-head__sub">Нажмите на регион, чтобы открыть его страницу: ' +
      "там материалы местных авторов. Если публикаций пока нет — мы так и скажем " +
      "и предложим опубликовать первую." +
      "</p>" +
      '<div class="map-counter">' +
      "<div><b data-count=\"" + totalRegions + "\">" + totalRegions + "</b><span>регионов на карте</span></div>" +
      "<div><b data-count=\"" + regionsWithContent + "\">" + regionsWithContent + "</b><span>уже с материалами</span></div>" +
      "<div><b data-count=\"" + totalArticles + "\">" + totalArticles + "</b><span>публикаций</span></div>" +
      "</div></div></div>" +
      '<div class="map-layout">' +
      '<div data-map-host></div>' +
      '<aside class="map-panel">' +
      '<div class="map-search">' + ICONS.search +
      '<input type="search" placeholder="Найти регион" aria-label="Найти регион на карте" data-region-search>' +
      '<div class="map-suggest" data-suggest></div></div>' +
      '<div class="district-chips" data-district-chips></div>' +
      '<div class="map-legend">' +
      '<span><i class="sw sw--has"></i>есть материалы</span>' +
      '<span><i class="sw sw--none"></i>публикаций пока нет</span>' +
      "</div>" +
      '<div class="map-pick" data-pick>' +
      '<div class="map-pick__meta">Регион не выбран</div>' +
      '<div class="map-pick__name">Наведите на карту</div>' +
      '<div class="map-pick__status">Покажем, сколько материалов вышло из этого региона ' +
      "и что делать, если их пока нет.</div>" +
      "</div>" +
      '<button class="map-regions-toggle" type="button" data-regions-toggle>' +
      'Показать список регионов<span data-toggle-mark>+</span></button>' +
      "</aside></div>" +
      '<div class="region-list" data-region-list></div>' +
      '<div class="region-noshape" data-region-noshape></div>' +
      "</div>";

    var pick = $("[data-pick]", section);

    function renderPick(r) {
      var n = countByRegion(r.slug);
      pick.innerHTML =
        '<div class="map-pick__meta">' + esc(r.district || "Регион") + "</div>" +
        '<div class="map-pick__name">' + esc(r.name) + "</div>" +
        '<div class="map-pick__status">' +
        (n
          ? "Материалов из региона: " + n + ". Загляните — там есть местные авторы."
          : "Публикаций из этого региона пока нет. Вы можете стать первым автором оттуда.") +
        "</div>" +
        '<a class="btn btn--sm ' + (n ? "btn--paper" : "btn--accent") + '" href="' +
        regionUrl(r.slug) + '">Открыть регион <span class="btn__arrow">' + ICONS.arrow +
        "</span></a>";
    }

    var map = mountMap($("[data-map-host]", section), {
      onHover: renderPick,
      onSelect: function (r) { window.location.href = regionUrl(r.slug); },
    });

    var list = $("[data-region-list]", section);
    list.innerHTML = districts().map(function (d) {
      var inD = MAP.regions.filter(function (r) { return r.district === d; });
      return (
        '<div class="region-list__group"><h3>' + esc(d) + "</h3><ul>" +
        inD.map(function (r) {
          var n = countByRegion(r.slug);
          return '<li><a href="' + regionUrl(r.slug) + '">' + esc(r.name) +
            "<span>" + (n ? n : "—") + "</span></a></li>";
        }).join("") + "</ul></div>"
      );
    }).join("");

    /* Регионы, которых нет в геоданных 2021 года: контуров нет, страницы есть.
       Честно говорим об этом, а не выкидываем их с карты. */
    var noShape = MAP.regions.filter(function (r) { return !r.d; });
    var noShapeHost = $("[data-region-noshape]", section);
    if (noShapeHost) {
      noShapeHost.innerHTML = noShape.length
        ? '<h3 class="region-noshape__title">Ещё ' + noShape.length + " " +
          plural(noShape.length, ["регион", "региона", "регионов"]) +
          " — страницы работают, контуров на карте пока нет</h3>" +
          '<div class="region-noshape__chips">' +
          noShape.map(function (r) {
            var n = countByRegion(r.slug);
            return '<a class="chip-sm" href="' + regionUrl(r.slug) + '">' + esc(r.name) +
              "<span>" + (n ? n : "—") + "</span></a>";
          }).join("") + "</div>"
        : "";
    }

    $("[data-regions-toggle]", section).addEventListener("click", function () {
      var open = list.classList.toggle("is-open");
      this.querySelector("[data-toggle-mark]").textContent = open ? "−" : "+";
      this.firstChild.textContent = open ? "Скрыть список регионов" : "Показать список регионов";
    });

    var chipsHost = $("[data-district-chips]", section);
    chipsHost.innerHTML =
      '<button class="chip-sm is-on" type="button" data-district="">Все</button>' +
      districts().map(function (d) {
        return '<button class="chip-sm" type="button" data-district="' + esc(d) + '">' +
          esc(d.replace(" ФО", "")) + "</button>";
      }).join("");

    chipsHost.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-district]");
      if (!btn) return;
      $$(".chip-sm", chipsHost).forEach(function (b) { b.classList.remove("is-on"); });
      btn.classList.add("is-on");
      map.dimDistrict(btn.getAttribute("data-district"));
    });

    var input = $("[data-region-search]", section);
    var sugg = $("[data-suggest]", section);
    var activeIdx = -1;
    var matches = [];

    function renderSugg() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) {
        sugg.classList.remove("is-open");
        return;
      }
      matches = MAP.regions.filter(function (r) {
        return r.name.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      if (!matches.length) {
        sugg.innerHTML = '<div class="search-empty" style="padding:12px">Регион не найден</div>';
      } else {
        sugg.innerHTML = matches.map(function (r, i) {
          var n = countByRegion(r.slug);
          return '<button type="button" data-slug="' + r.slug + '"' +
            (i === activeIdx ? ' class="is-active"' : "") + "><span>" + esc(r.name) +
            "</span><small>" + (n ? n + " мат." : "нет мат.") + "</small></button>";
        }).join("");
      }
      sugg.classList.add("is-open");
    }

    input.addEventListener("input", function () { activeIdx = -1; renderSugg(); });
    input.addEventListener("focus", renderSugg);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { sugg.classList.remove("is-open"); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, matches.length - 1); renderSugg(); }
      if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderSugg(); }
      if (e.key === "Enter") {
        e.preventDefault();
        var target = matches[activeIdx >= 0 ? activeIdx : 0];
        if (target) window.location.href = regionUrl(target.slug);
      }
    });
    document.addEventListener("click", function (e) {
      if (!section.contains(e.target)) return;
      var b = e.target.closest("[data-slug]");
      if (b && sugg.contains(b)) window.location.href = regionUrl(b.getAttribute("data-slug"));
    });
  }

  /* 6. Анимации ============================================================ */

  function initAnimations() {
    document.body.classList.add("has-anim");

    // автоматически помечаем блоки, которые появляются при прокрутке
    $$(".sec-head, .panel, .role, .doc-card, .roadmap__item, .step, .faq details, .kpi, .format, .region-chip, .author-card, .school-media, .presscard")
      .forEach(function (el) {
        if (!el.hasAttribute("data-reveal")) el.setAttribute("data-reveal", "");
      });
    $$(".cards, .roles, .doc-grid, .formats, .roadmap, .steps, .cols-2, .cols-3, .kpi").forEach(function (group) {
      Array.prototype.forEach.call(group.children, function (el, i) {
        if (!el.hasAttribute("data-delay")) el.setAttribute("data-delay", String(i % 4));
      });
    });

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      $$("[data-reveal]").forEach(function (el) { el.classList.add("is-in"); });
      $$("[data-count]").forEach(function (el) { el.textContent = el.getAttribute("data-count"); });
      return;
    }

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          if (entry.target.hasAttribute("data-count")) countUp(entry.target);
          $$("[data-count]", entry.target).forEach(countUp);
          io.unobserve(entry.target);
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

      $$("[data-reveal], [data-count]").forEach(function (el) { io.observe(el); });
    } else {
      $$("[data-reveal]").forEach(function (el) { el.classList.add("is-in"); });
      $$("[data-count]").forEach(function (el) { el.textContent = el.getAttribute("data-count"); });
    }
  }

  function countUp(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = "1";
    var target = parseInt(el.getAttribute("data-count"), 10) || 0;
    if (!target) {
      el.textContent = "0";
      return;
    }
    // считаем время по Date.now(), а не по метке кадра: в части браузеров
    // и встроенных просмотрщиков метка кадра идёт из другого нуля отсчёта,
    // из-за чего прогресс уходил в минус и на экране были отрицательные числа
    var start = Date.now();
    var dur = 900;
    var done = false;
    el.textContent = "0";
    function finish() {
      if (done) return;
      done = true;
      el.textContent = String(target);
    }
    function step() {
      if (done) return;
      var p = (Date.now() - start) / dur;
      if (!(p >= 1)) {
        p = Math.max(0, p);
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
        requestAnimationFrame(step);
      } else {
        finish();
      }
    }
    requestAnimationFrame(step);
    // страховка: если кадры не приходят совсем, число всё равно появится
    setTimeout(finish, dur + 300);
  }

  function initReadingProgress() {
    var bar = $("[data-progress]");
    if (!bar) return;
    function update() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var p = max > 0 ? (h.scrollTop || document.body.scrollTop) / max : 0;
      bar.style.transform = "scaleX(" + Math.min(1, Math.max(0, p)) + ")";
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  function initHeroParallax() {
    var media = $(".hero__media img");
    if (!media) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || window.innerWidth < 900) return;
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = Math.min(window.scrollY, 700);
        media.style.transform = "translate3d(0," + y * 0.06 + "px,0) scale(1.06)";
        ticking = false;
      });
    }, { passive: true });
  }

  /* 8. Документы ========================================================== */

  function initDocs() {
    var host = $("[data-docs]");
    if (!host) return;
    var docs = SC.docs || [];
    host.innerHTML = docs
      .map(function (d) {
        return (
          '<a class="doc-card" href="' + d.file + '" target="_blank" rel="noopener">' +
          '<span class="doc-card__type doc-card__type--pdf">PDF · ' + d.pages + " " +
          pageWord(d.pages) + "</span>" +
          "<h3>" + esc(d.title) + "</h3>" +
          "<p>" + esc(d.desc) + "</p>" +
          '<span class="doc-card__foot"><span>' + esc(d.tag) +
          "</span><span>Открыть →</span></span></a>"
        );
      })
      .join("");
  }

  function plural(n, forms) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function pageWord(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "страница";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "страницы";
    return "страниц";
  }

  /* 9. Панель проекта ===================================================== */

  function adminField(label, id, value, placeholder, type) {
    return (
      '<div class="field"><label for="' + id + '">' + esc(label) + "</label>" +
      '<input id="' + id + '" name="' + id + '" type="' + (type || "text") + '" value="' +
      esc(value == null ? "" : String(value)) + '" placeholder="' + esc(placeholder || "") + '"></div>'
    );
  }

  function foundersFields(list) {
    var rows = (list && list.length ? list : [{}, {}]).slice(0, 2);
    while (rows.length < 2) rows.push({});
    return rows
      .map(function (f, i) {
        var n = i + 1;
        return (
          '<div class="admin-person"><span class="admin-person__n">0' + n + "</span>" +
          adminField("ФИО", "f" + n + "-name", f.name || "", "Фамилия Имя Отчество") +
          adminField("ИНН", "f" + n + "-inn", f.inn || "", "12 цифр", "text") +
          adminField("Роль", "f" + n + "-role", f.role || "Директор", "Директор") +
          "</div>"
        );
      })
      .join("");
  }

  function initAdmin() {
    var host = $("[data-admin]");
    if (!host) return;
    bindConfirmDelegation();
    var user = Store ? Store.currentUser() : null;
    if (!user) {
      window.location.replace("/join?next=admin");
      return;
    }

    var settings = Store.getSettings();
    var isOwner = Store.can(user, "manage") || user.number === 101;

    if (!isOwner) {
      /* Понятный экран вместо «доступ только редакции»: кто вы для сервера,
         есть ли директор и что нажать, чтобы получить права. */
      host.innerHTML =
        '<section class="page-hero"><div class="wrap page-hero__grid"><div>' +
        '<span class="kicker">Служебное</span><h1>Нужны права<br>директора</h1></div>' +
        '<div class="page-hero__aside"><p class="lead">Вы вошли как «' + esc(user.name) +
        "», роль: <b>" + esc(user.access || "Пользователь") + "</b>. Панель открывается роли " +
        "«Директор» — её выдаёт владелец проекта паролем редакции.</p></div></div></section>" +
        '<section class="section wrap"><div class="panel" style="padding:24px">' +
        '<div class="diag" data-gate-list><p class="form__note">Проверяем сервер…</p></div>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:16px">' +
        '<button class="btn btn--accent btn--sm" type="button" data-gate-claim hidden>Получить права директора</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-gate-refresh>Обновить права</button>' +
        '<a class="btn btn--ghost btn--sm" href="/profile">В кабинет</a>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-gate-logout>Выйти</button>' +
        "</div>" +
        '<div data-gate-confirm style="margin:12px 0 0"></div>' +
        '<p class="form__note" data-gate-status></p>' +
        '<p class="form__note">Версия интерфейса: ' + esc((SC && SC.build) || "—") + "</p>" +
        "</div></section>";

      var gateList = $("[data-gate-list]", host);
      var gateStatus = $("[data-gate-status]", host);
      var claimBtn = $("[data-gate-claim]", host);

      function drawGate(info) {
        if (!info) {
          gateList.innerHTML = '<p class="form__note">Сервер не отвечает. Проверьте связь и обновите страницу.</p>';
          return;
        }
        gateList.innerHTML =
          '<div class="diag__row"><span>Вы вошли как</span><b>' + esc((info.user && info.user.name) || user.name) + "</b></div>" +
          '<div class="diag__row"><span>Ваша роль на сервере</span><b>' +
          esc((info.user && info.user.access) || "нет данных") + "</b></div>" +
          '<div class="diag__row"><span>Аккаунтов на сервере</span><b>' + (info.accounts || 0) + "</b></div>" +
          '<div class="diag__row"><span>Директор</span><b>' +
          (info.directorExists ? esc(info.directorName || "назначен") : "не назначен") + "</b></div>";
        if (claimBtn && info.canClaimDirector) {
          claimBtn.hidden = false;
          var holder = $("[data-gate-confirm]", host);
          if (holder && !holder.firstChild) {
            holder.innerHTML = confirmRowHtml();
            bindConfirmDelegation();
          }
        }
      }

      Store.whoami().then(drawGate, function () { drawGate(null); });

      if (claimBtn) {
        claimBtn.addEventListener("click", function () {
          if (!confirmReady(gateStatus)) return;
          claimBtn.disabled = true;
          Store.claimDirector().then(function () {
            gateStatus.textContent = "Права директора выданы. Перезагружаем панель…";
            window.location.reload();
          }, function (err) {
            claimBtn.disabled = false;
            gateStatus.textContent = (err && err.message) || "Не получилось.";
          });
        });
      }

      var refreshBtn = $("[data-gate-refresh]", host);
      if (refreshBtn) {
        refreshBtn.addEventListener("click", function () {
          gateStatus.textContent = "Обновляем…";
          Promise.resolve(Store.refreshMe ? Store.refreshMe() : null).then(function () {
            Store.whoami().then(function (info) {
              drawGate(info);
              if (info && info.user && info.user.access !== user.access) {
                window.location.reload();
                return;
              }
              gateStatus.textContent = "Права не изменились: роль на сервере — " +
                ((info && info.user && info.user.access) || "неизвестна") + ".";
            });
          });
        });
      }

      var logoutBtn = $("[data-gate-logout]", host);
      if (logoutBtn) {
        logoutBtn.addEventListener("click", function () {
          if (Store.logout) Store.logout();
          window.location.replace("/join#login");
        });
      }
      return;
    }

    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : "";
    }

    function authorRow(a) {
      var hasCard = a.posts >= settings.card.minPosts;
      return (
        '<div class="admin-table__row">' +
        "<div><b>" + esc(a.name) + "</b><small>" + esc(a.email) + "</small></div>" +
        "<div>" + esc(a.role || "—") + "</div>" +
        "<div>" + esc(a.team || "индивидуально") + "</div>" +
        "<div>" + a.posts + " публ.</div>" +
        '<div><span class="status ' + (hasCard ? "status--pub" : "status--draft") + '">' +
        (hasCard ? "карта выдана" : "нет карты") + "</span></div>" +
        '<div><select class="admin-access" data-access="' + a.id + '">' +
        Store.ACCESS.map(function (r) {
          return '<option' + (r === (a.access || "Пользователь") ? " selected" : "") + ">" + esc(r) + "</option>";
        }).join("") +
        "</select></div>" +
        "</div>"
      );
    }

    function pendingRow(p) {
      return (
        '<div class="admin-review" data-review-row="' + p.id + '">' +
        '<div class="admin-review__top"><b>' + esc(p.title) + "</b>" +
        '<span class="status status--pending">на проверке</span></div>' +
        '<div class="admin-review__meta">' + esc(p.authorName) + " · " + esc(p.format || "") +
        " · " + esc(regionName(p.region) || "регион не выбран") + " · " + esc(String(p.read || 0)) + " мин</div>" +
        '<p class="admin-review__excerpt">' + esc(p.excerpt || "") + "</p>" +
        '<div class="admin-review__actions">' +
        '<a class="btn btn--sm btn--ghost" href="/write?id=' + p.id + '">Открыть текст</a>' +
        '<input class="admin-review__note" type="text" placeholder="Замечание автору (если правки)" data-note="' + p.id + '">' +
        '<button class="btn btn--sm" type="button" data-approve="' + p.id + '">Опубликовать</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-reject="' + p.id + '">Вернуть на правки</button>' +
        "</div></div>"
      );
    }

    function render() {
      settings = Store.getSettings();
      var authors = Store.listUsers();
      var pending = Store.pendingPosts();
      var teams = Store.listTeams();
      host.innerHTML =
        '<section class="page-hero"><div class="wrap page-hero__grid"><div>' +
        '<span class="kicker">Служебное</span><h1>Панель<br>проекта</h1></div>' +
        '<div class="page-hero__aside"><p class="lead">Люди, материалы, редакции, карты, ' +
        'почта и состояние сайта — по разделам, без длинной простыни.</p>' +
        '<p class="admin-note">Вы: «' + esc(user.name) + '» · ' + esc(user.access || "Пользователь") +
        ' · версия интерфейса ' + esc((SC && SC.build) || "—") + "</p></div></div></section>" +
        '<nav class="admin-tabs" data-admin-tabs></nav>' +
        '<div class="admin-panels" data-admin-panels></div>';

      var panels = $("[data-admin-panels]", host);
      var TABS = [
        ["overview", "Обзор"],
        ["people", "Люди"],
        ["content", "Материалы"],
        ["editorials", "Редакции"],
        ["cards", "Карты"],
        ["support", "Поддержка"],
        ["mail", "Почта"],
        ["site", "Сайт"],
        ["server", "Сервер"],
      ];

      TABS.forEach(function (t) {
        var div = document.createElement("div");
        div.className = "admin-panel";
        div.setAttribute("data-panel", t[0]);
        div.hidden = true;
        panels.appendChild(div);
      });

      function panel(name) {
        return panels.querySelector('[data-panel="' + name + '"]');
      }

      warnLocalOnly();
      mountOverview(panel("overview"));
      mountPeople(panel("people"));
      mountRecoveryQueue(panel("people"));
      mountContent(panel("content"));
      mountEditorialQueue(panel("editorials"));
      mountCardQueue(panel("cards"));
      mountSupportQueue(panel("support"));
      mountMailClient(panel("mail"));
      mountMailSettings(panel("mail"));
      mountHiringAdmin(panel("people"));
      mountTasksAdmin(panel("people"));
      mountGrantAccess(panel("server"));
      mountSite(panel("site"));
      mountFoundersEditor(panel("site"));
      mountDiag(panel("server"));

      buildAdminTabs(host, TABS);
    }

    /* --- заявки на пресс-карту ---------------------------------------------- */
    /* --- портфолио авторов: работы вне сайта -------------------------------- */
    function mountPortfolioQueue(host) {
      var old = $("[data-portfolio-queue]");
      if (old) old.remove();
      if (!Store.portfolioQueue) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-portfolio-queue", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Портфолио</span>' +
        "<h2>Работы авторов вне сайта</h2>" +
        '<p class="sec-head__text">Автор присылает свои материалы — фото, видео, аудио. ' +
        "Комиссия решает, интересна ли работа, сколько баллов дать и показывать ли её на " +
        "странице аккаунта.</p></div></div>" +
        '<div class="panel"><div class="row" style="align-items:flex-end">' +
        confirmRowHtml() +
        '<button class="btn btn--sm" type="button" data-pf-load>Показать работы</button></div>' +
        '<p class="form__note" data-pf-status></p></div><div data-pf-list></div>';
      host.appendChild(section);

            var statusEl = $("[data-pf-status]", section);
      var listEl = $("[data-pf-list]", section);

      function row(item) {
        var badge =
          item.status === "approved"
            ? '<span class="status status--pub">одобрено · +' + (item.points || 0) + "</span>"
            : item.status === "rejected"
              ? '<span class="status status--rejected">не принято</span>'
              : '<span class="status status--pending">на рассмотрении</span>';
        var files = (item.files || [])
          .map(function (u) {
            var isImage = /\.(jpg|jpeg|png|webp)$/i.test(u);
            return isImage
              ? '<a class="portfolio-thumb" href="' + esc(u) + '" target="_blank" rel="noopener">' +
                '<img src="' + esc(u) + '" alt=""></a>'
              : '<a class="btn btn--sm btn--ghost" href="' + esc(u) + '" target="_blank" rel="noopener">' +
                "Открыть файл</a>";
          })
          .join("");
        return (
          '<div class="admin-review"><div class="admin-review__top"><b>' + esc(item.title || "Работа") +
          "</b>" + badge + "</div>" +
          '<div class="admin-review__meta">' + esc(item.name || "Автор") + " · " +
          esc(fmtDate(item.createdAt)) + " · " +
          (item.publish ? "хочет на страницу аккаунта" : "только для баллов") + "</div>" +
          '<p class="admin-review__excerpt">' + esc(item.about || "") + "</p>" +
          '<div class="portfolio-row__files" style="margin:10px 0">' + files + "</div>" +
          (item.status === "pending"
            ? '<div class="admin-review__actions">' +
              '<input class="admin-review__note" type="text" placeholder="Основание (обязательно для отказа)" ' +
              'data-pf-note="' + esc(item.id) + '">' +
              '<input class="admin-review__points" type="number" min="0" max="50" value="5" ' +
              'data-pf-points="' + esc(item.id) + '" aria-label="Баллы">' +
              '<button class="btn btn--sm" type="button" data-pf-approve="' + esc(item.id) + '">Одобрить</button>' +
              '<button class="btn btn--sm btn--ghost" type="button" data-pf-reject="' + esc(item.id) + '">Отклонить</button>' +
              "</div>"
            : item.note
              ? '<p class="admin-review__excerpt">Основание: ' + esc(item.note) + "</p>"
              : "") +
          "</div>"
        );
      }

      function load() {
        if (!confirmReady(statusEl)) return;
        statusEl.textContent = "Загружаем…";
        Store.portfolioQueue().then(function (res) {
          if (!res || !res.ok) {
            statusEl.textContent = (res && res.error) || "Сервер не ответил.";
            return;
          }
          var list = res.items || [];
          var waiting = list.filter(function (i) { return i.status === "pending"; }).length;
          statusEl.textContent = "Работ всего: " + list.length + ", ждут решения: " + waiting + ".";
          listEl.innerHTML = list.length
            ? list.map(row).join("")
            : '<div class="empty"><h3>Работ пока нет</h3><p>Автор добавляет их в кабинете кнопкой ' +
              "«Добавить свои материалы».</p></div>";

          $$("[data-pf-approve], [data-pf-reject]", listEl).forEach(function (btn) {
            btn.addEventListener("click", function () {
              var approve = btn.hasAttribute("data-pf-approve");
              var id = btn.getAttribute("data-pf-approve") || btn.getAttribute("data-pf-reject");
              var noteEl = $('[data-pf-note="' + id + '"]', listEl);
              var pointsEl = $('[data-pf-points="' + id + '"]', listEl);
              var note = noteEl ? noteEl.value.trim() : "";
              if (!approve && note.length < 5) {
                statusEl.textContent = "Чтобы отклонить, напишите основание.";
                return;
              }
              btn.disabled = true;
              Store.portfolioReview(id, approve ? "approved" : "rejected", note,
                pointsEl ? Number(pointsEl.value) || 0 : 5
              ).then(function (r) {
                btn.disabled = false;
                if (!r || !r.ok) {
                  statusEl.textContent = (r && r.error) || "Не удалось сохранить решение.";
                  return;
                }
                load();
              });
            });
          });
        });
      }

      $("[data-pf-load]", section).addEventListener("click", load);
      if (Store.hasConfirm && Store.hasConfirm()) load();
    }

    /* --- согласия на обработку ПД: проверка сканов ------------------------- */
    /* Обзор: одна цифра на каждый раздел и быстрые переходы. */
    function mountOverview(host) {
      var old = $("[data-admin-overview]");
      if (old) old.remove();

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-admin-overview", "");
      section.setAttribute("data-admin-block", "overview");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Сводка</span>' +
        "<h2>Что происходит сейчас</h2></div></div>" +
        '<div class="overview" data-overview-cards>' +
        '<p class="form__note">Считаем…</p></div>';
      host.appendChild(section);

      var cards = $("[data-overview-cards]", section);

      function tile(tab, label, value, hint) {
        return '<button class="overview__tile" type="button" data-go-tab="' + tab + '">' +
          '<b>' + esc(String(value)) + "</b><span>" + esc(label) + "</span>" +
          (hint ? "<small>" + esc(hint) + "</small>" : "") + "</button>";
      }

      Store.diag().then(function (d) {
        if (!d) {
          cards.innerHTML = '<p class="form__note">Сервер не отвечает — проверьте блок «Сервер».</p>';
          return;
        }
        Store.usersList().then(function (res) {
          var people = res.users || [];
          var staff = people.filter(function (u) {
            return u.access && u.access !== "Пользователь";
          }).length;
          cards.innerHTML =
            tile("people", "участников", people.length, staff + " со служебной ролью") +
            tile("editorials", "редакций", d.editorials || 0, "в регионах") +
            tile("cards", "заявок на карту", d.cards_pending || 0, "ждут решения") +
            tile("support", "обращений", d.support_open || 0, "открыты") +
            tile("mail", "почта", d.mail_configured ? "есть" : "нет",
              d.mail_configured ? d.mail_from : "настройте отправку") +
            tile("site", "сайт", d.maintenance ? "на работах" : "открыт",
              d.maintenance ? "включён режим работ" : "люди видят сайт") +
            tile("server", "аккаунтов на сервере", d.accounts || 0, "PHP " + d.php);

          $$("[data-go-tab]", cards).forEach(function (b) {
            b.addEventListener("click", function () {
              var target = b.getAttribute("data-go-tab");
              var navBtn = $('[data-admin-tab="' + target + '"]');
              if (navBtn) navBtn.click();
            });
          });
        });
      }, function () {
        cards.innerHTML = '<p class="form__note">Не удалось получить сводку.</p>';
      });
    }

    /* Материалы: что ждёт проверки на сервере. */
    function mountContent(host) {
      var old = $("[data-admin-content]");
      if (old) old.remove();
      if (!Store.apiPendingQueue) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-admin-content", "");
      section.setAttribute("data-admin-block", "content");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Материалы</span>' +
        "<h2>Очередь публикаций</h2>" +
        '<p class="sec-head__text">Материалы приходят с сервера: их видно с любого устройства. ' +
        "Публикация, правки и отказ — здесь же.</p></div></div>" +
        '<div data-admin-content-list><p class="form__note">Загружаем очередь…</p></div>';
      host.appendChild(section);

      var listEl = $("[data-admin-content-list]", section);

      function draw(items) {
        if (!items.length) {
          listEl.innerHTML = '<div class="fill-note fill-note--flat"><b>Очередь пуста</b>' +
            "<p>Новые материалы появятся здесь сразу после отправки из редактора.</p></div>";
          return;
        }
        listEl.innerHTML = '<div class="editorial-queue">' + items.map(function (p) {
          return '<div class="editorial-card"><div class="editorial-card__top"><b>' +
            esc(p.title) + "</b><span>" + esc(p.authorName || "") + "</span></div>" +
            '<div class="editorial-card__meta">' + esc(p.format || "") + " · " +
            esc(fmtDate(p.date)) + " · " + esc(regionName(p.region) || "регион не выбран") +
            "</div><p>" + esc(p.excerpt || "") + "</p></div>";
        }).join("") + "</div>";
      }

      Store.apiPendingQueue().then(draw, function () { draw([]); });
    }

    /* Сайт: открыт или на работах, объявление в шапке. */
    function mountSite(host) {
      var old = $("[data-admin-site]");
      if (old) old.remove();
      if (!Store.siteSave) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-admin-site", "");
      section.setAttribute("data-admin-block", "site");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Сайт</span>' +
        "<h2>Доступ и объявления</h2>" +
        '<p class="sec-head__text">Режим работ закрывает сайт для посетителей: они увидят ' +
        "спокойную заглушку, а редакция продолжит работать в панели. Объявление показывается " +
        "полосой над шапкой на всех страницах.</p></div></div>" +
        '<div class="panel" style="padding:22px">' +
        '<label class="switch"><input type="checkbox" data-site-maint>' +
        "<span><b>Технические работы</b><small>Сайт закрыт для посетителей, панель работает</small></span></label>" +
        '<label class="switch"><input type="checkbox" data-site-notice-on>' +
        "<span><b>Объявление в шапке</b><small>Короткая строка для всех страниц</small></span></label>" +
        '<div class="field"><label for="site-notice">Текст объявления</label>' +
        '<input id="site-notice" data-site-notice type="text" maxlength="240" ' +
        'placeholder="Например: набор авторов открыт до 1 декабря"></div>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn--accent btn--sm" type="button" data-site-save>Сохранить</button>' +
        '<span class="form__note" data-site-status></span></div></div>';
      host.appendChild(section);

      var maint = $("[data-site-maint]", section);
      var noticeOn = $("[data-site-notice-on]", section);
      var notice = $("[data-site-notice]", section);
      var status = $("[data-site-status]", section);

      function fill(site) {
        if (!site) return;
        maint.checked = !!site.maintenance;
        noticeOn.checked = !!site.noticeOn;
        notice.value = site.notice || "";
        status.textContent = site.updatedAt
          ? "Последнее изменение: " + fmtDate(site.updatedAt) +
            (site.updatedBy ? " · " + site.updatedBy : "")
          : "Ещё не менялось.";
      }

      Store.siteStatus().then(fill, function () {});

      $("[data-site-save]", section).addEventListener("click", function () {
        if (maint.checked) {
          var ok = window.confirm("Закрыть сайт для посетителей? Редакция продолжит работать.");
          if (!ok) return;
        }
        status.textContent = "Сохраняем…";
        Store.siteSave({
          maintenance: maint.checked,
          noticeOn: noticeOn.checked,
          notice: notice.value.trim(),
        }).then(function (site) {
          fill(site);
          status.textContent = "Сохранено. Обновите страницу, чтобы увидеть.";
        }, function (err) {
          status.textContent = (err && err.message) || "Не сохранилось.";
        });
      });
    }

    /* Вкладки: каждая показывает ровно одну панель и поднимает страницу к её началу. */
    function buildAdminTabs(host, TABS) {
      var nav = $("[data-admin-tabs]", host);
      if (!nav) return;
      nav.innerHTML = TABS.map(function (t) {
        return '<button class="admin-tabs__btn" type="button" data-admin-tab="' + t[0] + '">' +
          esc(t[1]) + "</button>";
      }).join("");

      var panels = $("[data-admin-panels]", host);

      function show(id) {
        $$("[data-panel]", panels).forEach(function (p) {
          p.hidden = p.getAttribute("data-panel") !== id;
        });
        $$("[data-admin-tab]", nav).forEach(function (b) {
          b.classList.toggle("is-on", b.getAttribute("data-admin-tab") === id);
        });
        try { window.localStorage.setItem("smena_admin_tab", id); } catch (e) {}
      }

      $$("[data-admin-tab]", nav).forEach(function (b) {
        b.addEventListener("click", function () {
          show(b.getAttribute("data-admin-tab"));
          var top = nav.getBoundingClientRect().top + window.pageYOffset - 8;
          window.scrollTo(0, top);
        });
      });

      var saved = "";
      try { saved = window.localStorage.getItem("smena_admin_tab") || ""; } catch (e) {}
      var exists = TABS.some(function (t) { return t[0] === saved; });
      show(exists ? saved : "overview");
    }

    /* Люди: список с поиском, по клику — карточка человека со всеми решениями. */
    function mountPeople(host) {
      if (!Store.usersList) return;

      host.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Люди</span>' +
        "<h2>Участники проекта</h2>" +
        '<p class="sec-head__text">Нажмите на человека — откроется карточка: профиль, материалы, ' +
        "заявления, пресс-карта и переписка. Всё решается на одном экране.</p></div>" +
        '<div class="people-search"><input type="search" placeholder="Поиск: имя или почта" ' +
        'data-people-search aria-label="Поиск участника"></div></div>' +
        '<div data-people-list><p class="form__note">Загружаем участников…</p></div>' +
        '<div data-person-card></div>';

      var listEl = $("[data-people-list]", host);
      var cardEl = $("[data-person-card]", host);
      var searchEl = $("[data-people-search]", host);
      var all = [];
      var roles = Store.ACCESS || [];
      var openedId = "";
      var needScroll = false;

      function chip(access) {
        var cls = access === "Директор" ? "status--pub"
          : access === "Пользователь" ? "status--draft" : "status--pending";
        return '<span class="status ' + cls + '">' + esc(access || "Пользователь") + "</span>";
      }

      function draw() {
        var q = ((searchEl && searchEl.value) || "").trim().toLowerCase();
        var list = all.filter(function (u) {
          if (!q) return true;
          return (u.name || "").toLowerCase().indexOf(q) !== -1 ||
            (u.email || "").toLowerCase().indexOf(q) !== -1;
        });

        if (!all.length) {
          listEl.innerHTML = '<div class="fill-note fill-note--flat"><b>Пока никого нет</b>' +
            "Права выдаёт владелец проекта: первый аккаунт больше не получает роль сам. " +
            'После регистрации здесь появятся люди и их карточки.</p>' +
            '<p><a class="link-accent" href="/join">Открыть регистрацию</a></p></div>';
          return;
        }
        if (!list.length) {
          listEl.innerHTML = '<p class="form__note">По запросу «' + esc(q) + '» никого нет.</p>';
          return;
        }

        listEl.innerHTML = '<div class="people">' + list.map(function (u) {
          return '<div class="people__row' + (u.id === openedId ? " is-open" : "") + '">' +
            '<button class="people__open" type="button" data-open="' + esc(u.id) + '">' +
            "<b>" + esc(u.name) + "</b><small>" + esc(u.email) + "</small></button>" +
            '<div class="people__meta">' + esc(regionName(u.region) || "регион не указан") + " · " +
            chip(u.access) + "</div>" +
            '<button class="btn btn--ghost btn--sm" type="button" data-open="' + esc(u.id) + '">' +
            (u.id === openedId ? "Свернуть" : "Открыть") + "</button></div>";
        }).join("") + "</div>";

        $$("[data-open]", listEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var id = b.getAttribute("data-open");
            if (id === openedId) {
              openedId = "";
              cardEl.innerHTML = "";
              draw();
              return;
            }
            openedId = id;
            needScroll = true;
            draw();
            openCard(id);
          });
        });
      }

      function openCard(id) {
        cardEl.innerHTML = '<p class="form__note" style="margin-top:16px">Открываем карточку…</p>';
        Store.userCard(id).then(renderCard, function (err) {
          cardEl.innerHTML = '<p class="form__note is-error" style="margin-top:16px">' +
            esc((err && err.message) || "Карточка не открылась.") + "</p>";
        });
      }

      function appsList(d) {
        var rows = [];
        var ED = { pending: "ждёт решения", approved: "принято", rejected: "отказ" };

        (d.editorialApps || []).forEach(function (a) {
          rows.push('<div class="pcard__line"><span>Заявление в редакцию</span><small>' +
            esc(ED[a.status] || a.status) + (a.escalated ? " · в комиссии" : "") + "</small>" +
            (a.status === "pending"
              ? '<span class="pcard__actions"><button class="btn btn--sm" type="button" data-ed-ok="' +
                esc(a.id) + '">Принять</button><button class="btn btn--ghost btn--sm" type="button" ' +
                'data-ed-no="' + esc(a.id) + '">Отклонить</button></span>'
              : "<span></span>") + "</div>");
        });

        (d.consents || []).forEach(function (c) {
          rows.push('<div class="pcard__line"><span>Согласие на обработку ПД</span><small>' +
            esc(ED[c.status] || "ждёт решения") + "</small>" +
            (c.status !== "approved"
              ? '<span class="pcard__actions"><button class="btn btn--sm" type="button" data-consent-ok>' +
                'Принять</button><button class="btn btn--ghost btn--sm" type="button" data-consent-no>' +
                "Отклонить</button></span>"
              : "<span></span>") + "</div>");
        });

        (d.cards || []).forEach(function (c) {
          rows.push('<div class="pcard__line"><span>Пресс-карта</span><small>' +
            esc(c.status === "issued" ? "выдана " + (c.number || "")
              : c.status === "pending" ? "заявка ждёт решения"
                : c.status === "annulled" ? "аннулирована" : "возвращена") +
            "</small><span></span></div>");
        });

        (d.portfolio || []).forEach(function (item) {
          rows.push('<div class="pcard__line"><span>Портфолио: ' + esc(item.title || "работа") +
            "</span><small>" + esc(item.status === "approved" ? "принято · " + (item.points || 0) + " б."
              : item.status === "rejected" ? "отказ" : "ждёт решения") + "</small>" +
            (item.status === "pending"
              ? '<span class="pcard__actions"><button class="btn btn--sm" type="button" ' +
                'data-pf-item-ok="' + esc(item.id) + '">Принять</button><button class="btn btn--ghost ' +
                'btn--sm" type="button" data-pf-item-no="' + esc(item.id) + '">Отклонить</button></span>'
              : "<span></span>") + "</div>");
        });

        (d.recovery || []).forEach(function (r) {
          if (r.status !== "open") return;
          rows.push('<div class="pcard__line"><span>Просьба о коде доступа</span><small>ждёт</small>' +
            '<span class="pcard__actions"><button class="btn btn--sm" type="button" data-rc-issue="' +
            esc(r.id) + '">Выдать код</button></span></div>');
        });

        return rows.length ? '<div class="pcard__list">' + rows.join("") + "</div>"
          : '<p class="form__note">Заявлений нет.</p>';
      }

      function renderCard(d) {
        var u = d.user;
        var issued = (d.cards || []).filter(function (c) { return c.status === "issued"; })[0];
        var founded = (d.editorialsFounded || [])[0];

        cardEl.innerHTML =
          '<div class="pcard">' +
          '<div class="pcard__head"><div><h3>' + esc(u.name) + "</h3>" +
          '<p class="pcard__sub">' + esc(u.email) + " · " + esc(regionName(u.region) || "регион не указан") +
          " · с " + esc(fmtDate(u.createdAt)) + "</p></div>" +
          '<div class="pcard__badges">' + chip(u.access) +
          (u.emailVerified ? '<span class="status status--pub">почта подтверждена</span>'
            : '<span class="status status--draft">почта не подтверждена</span>') + "</div></div>" +

          '<div class="pcard__grid">' +
          '<div class="pcard__col"><span class="kicker">Профиль</span>' +
          '<div class="field"><label>Имя и фамилия</label><input type="text" data-pf-name value="' +
          esc(u.name) + '"></div>' +
          '<div class="field"><label>Регион</label><select data-pf-region>' +
          regionOptions(u.region) + "</select></div>" +
          '<div class="field"><label>Роль (права)</label><select data-pf-access>' +
          roles.map(function (r) {
            return '<option' + (r === u.access ? " selected" : "") + ">" + esc(r) + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Чем занимается</label><input type="text" data-pf-role value="' +
          esc(u.role || "") + '"></div>' +
          '<div class="field"><label>О себе</label><textarea rows="2" data-pf-bio>' +
          esc(u.bio || "") + "</textarea></div>" +
          '<button class="btn btn--accent btn--sm" type="button" data-pf-save>Сохранить</button>' +
          "</div>" +

          '<div class="pcard__col"><span class="kicker">Итоги</span><div class="diag">' +
          '<div class="diag__row"><span>Опубликовано</span><b>' + (d.published || 0) + "</b></div>" +
          '<div class="diag__row"><span>Всего материалов</span><b>' + (d.posts || []).length + "</b></div>" +
          '<div class="diag__row"><span>Пресс-карта</span><b>' + (issued ? esc(issued.number) : "нет") + "</b></div>" +
          '<div class="diag__row"><span>Редакция</span><b>' + (founded ? esc(founded.name) : "нет") + "</b></div>" +
          "</div>" +
          (issued ? "" : '<button class="btn btn--sm" type="button" data-card-grant style="margin-top:10px">' +
            "Выдать пресс-карту · " + esc(d.cardNumberNext || "") + "</button>") +
          '<p class="form__note" data-card-note></p></div></div>' +

          '<div class="pcard__section"><span class="kicker">Заявления</span>' + appsList(d) + "</div>" +

          '<div class="pcard__section"><span class="kicker">Материалы</span>' +
          ((d.posts || []).length
            ? '<div class="pcard__list">' + d.posts.slice(0, 6).map(function (post) {
              var st = post.status === "published" ? "выложен"
                : post.status === "pending" ? "на проверке"
                  : post.status === "rejected" ? "нужны правки" : "черновик";
              return '<div class="pcard__line"><span>' + esc(post.title) + "</span><small>" + esc(st) +
                "</small><span></span></div>";
            }).join("") + "</div>"
            : '<p class="form__note">Материалов нет.</p>') + "</div>" +

          '<div class="pcard__section"><span class="kicker">Написать участнику</span>' +
          '<div class="pcard__compose"><textarea rows="2" data-msg-text ' +
          'placeholder="Уйдёт письмом и появится в кабинете участника"></textarea>' +
          '<button class="btn btn--sm" type="button" data-msg-send>Отправить</button></div>' +
          '<p class="form__note" data-msg-note></p>' +
          ((d.messages || []).length
            ? '<div class="pcard__list">' + d.messages.slice(-4).reverse().map(function (m) {
              return '<div class="pcard__line"><span>' + esc(m.text) + "</span><small>" +
                esc(m.from || "редакция") + " · " + esc(fmtDate(m.createdAt)) + "</small><span></span></div>";
            }).join("") + "</div>"
            : "") + "</div></div>";

        if (needScroll) {
          needScroll = false;
          if (cardEl.scrollIntoView) cardEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }

        $("[data-pf-save]", cardEl).addEventListener("click", function () {
          var payload = {
            name: $("[data-pf-name]", cardEl).value.trim(),
            region: $("[data-pf-region]", cardEl).value,
            access: $("[data-pf-access]", cardEl).value,
            role: $("[data-pf-role]", cardEl).value.trim(),
            bio: $("[data-pf-bio]", cardEl).value.trim(),
          };
          Store.userUpdate(u.id, payload).then(function () {
            return Store.usersList();
          }).then(function (fresh) {
            all = fresh.users || [];
            roles = fresh.roles || roles;
            draw();
            openCard(u.id);
          }, function (err) {
            window.alert((err && err.message) || "Профиль не сохранился.");
          });
        });

        var grantBtn = $("[data-card-grant]", cardEl);
        if (grantBtn) {
          grantBtn.addEventListener("click", function () {
            grantBtn.disabled = true;
            Store.cardGrant(u.id).then(function (res) {
              window.alert("Карта выдана: " + res.number);
              openCard(u.id);
            }, function (err) {
              grantBtn.disabled = false;
              window.alert((err && err.message) || "Карта не выдалась.");
            });
          });
        }

        var sendBtn = $("[data-msg-send]", cardEl);
        if (sendBtn) {
          sendBtn.addEventListener("click", function () {
            var field = $("[data-msg-text]", cardEl);
            var text = (field.value || "").trim();
            var note = $("[data-msg-note]", cardEl);
            if (text.length < 3) {
              note.textContent = "Напишите сообщение.";
              return;
            }
            sendBtn.disabled = true;
            Store.userMessage(u.id, text).then(function (msg) {
              sendBtn.disabled = false;
              note.textContent = msg.mailed ? "Отправлено письмом на " + u.email + "."
                : "Сохранено в кабинете: почта не настроена, письмо не ушло.";
              openCard(u.id);
            }, function (err) {
              sendBtn.disabled = false;
              note.textContent = (err && err.message) || "Не отправилось.";
            });
          });
        }

        function after() { openCard(u.id); }

        $$("[data-ed-ok]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            Store.editorialReview(b.getAttribute("data-ed-ok"), "approved", "").then(after,
              function (e) { window.alert(e.message); });
          });
        });
        $$("[data-ed-no]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var note = window.prompt("Основание отказа:", "");
            if (note === null) return;
            if (note.trim().length < 5) { window.alert("Нужно основание."); return; }
            Store.editorialReview(b.getAttribute("data-ed-no"), "rejected", note.trim()).then(after,
              function (e) { window.alert(e.message); });
          });
        });
        $$("[data-consent-ok]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            Store.consentDecide(u.id, "approved", "").then(after, function (e) { window.alert(e.message); });
          });
        });
        $$("[data-consent-no]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var note = window.prompt("Почему не принято:", "");
            if (note === null) return;
            Store.consentDecide(u.id, "rejected", note.trim()).then(after, function (e) { window.alert(e.message); });
          });
        });
        $$("[data-pf-item-ok]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var points = window.prompt("Баллы за работу (0–50):", "5");
            if (points === null) return;
            Store.portfolioDecide(b.getAttribute("data-pf-item-ok"), "approved", "", Number(points) || 0)
              .then(after, function (e) { window.alert(e.message); });
          });
        });
        $$("[data-pf-item-no]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var note = window.prompt("Основание отказа:", "");
            if (note === null) return;
            Store.portfolioDecide(b.getAttribute("data-pf-item-no"), "rejected", note.trim(), 0)
              .then(after, function (e) { window.alert(e.message); });
          });
        });
        $$("[data-rc-issue]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            Store.recoveryIssue(b.getAttribute("data-rc-issue")).then(function (res) {
              window.alert(res.code ? "Код для " + u.name + ": " + res.code : "Код отправлен на " + u.email + ".");
              after();
            }, function (e) { window.alert(e.message); });
          });
        });
      }

      if (searchEl) searchEl.addEventListener("input", draw);

      Store.usersList().then(function (res) {
        all = res.users || [];
        roles = res.roles || roles;
        draw();
      }, function () {
        all = [];
        draw();
      });
    }

    /* Основатели: список на странице /founders берётся отсюда. */
    function mountFoundersEditor(host) {
      var old = $("[data-founders-admin]");
      if (old) old.remove();
      if (!Store.foundersSave) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-founders-admin", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Основатели</span>' +
        "<h2>Кто основал проект</h2>" +
        '<p class="sec-head__text">Эти карточки видит страница «Основатели». До четырёх человек: ' +
        "имя, роль, город, год и пара строк о себе. Фото загружается с устройства.</p></div></div>" +
        '<div data-founders-list></div>' +
        '<div class="row" style="gap:10px;margin-top:14px;flex-wrap:wrap">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-founder-add>Добавить человека</button>' +
        '<button class="btn btn--accent btn--sm" type="button" data-founders-save>Сохранить список</button>' +
        '<span class="form__note" data-founders-status></span></div>';
      host.appendChild(section);

      var listEl = $("[data-founders-list]", section);
      var statusEl = $("[data-founders-status]", section);
      var state = [];

      function draw() {
        listEl.innerHTML = '<div class="people">' + state.map(function (f, i) {
          return '<div class="founder-edit">' +
            '<div class="founder-edit__head"><b>' + esc(f.name || "Новый человек") + "</b>" +
            (state.length > 1
              ? '<button class="btn btn--ghost btn--sm" type="button" data-founder-del="' + i + '">Убрать</button>'
              : "") + "</div>" +
            '<div class="mail-grid">' +
            '<div class="field"><label>Имя и фамилия</label>' +
            '<input type="text" data-f="name" data-i="' + i + '" value="' + esc(f.name || "") + '"></div>' +
            '<div class="field"><label>Роль</label>' +
            '<input type="text" data-f="role" data-i="' + i + '" value="' + esc(f.role || "") + '" placeholder="Основатель, главный редактор"></div>' +
            '<div class="field"><label>Город</label>' +
            '<input type="text" data-f="city" data-i="' + i + '" value="' + esc(f.city || "") + '"></div>' +
            '<div class="field"><label>На проекте с</label>' +
            '<input type="text" data-f="since" data-i="' + i + '" value="' + esc(f.since || "") + '" placeholder="2026"></div>' +
            "</div>" +
            '<div class="field"><label>О себе</label>' +
            '<textarea rows="3" data-f="bio" data-i="' + i + '">' + esc(f.bio || "") + "</textarea></div>" +
            '<div class="row" style="gap:10px;flex-wrap:wrap">' +
            '<input type="file" accept="image/*" data-founder-photo="' + i + '">' +
            (f.photo ? '<span class="form__note">фото загружено</span>' : "") +
            "</div></div>";
        }).join("") + "</div>";

        $$("[data-f]", listEl).forEach(function (el) {
          el.addEventListener("input", function () {
            state[Number(el.getAttribute("data-i"))][el.getAttribute("data-f")] = el.value;
          });
        });
        $$("[data-founder-del]", listEl).forEach(function (b) {
          b.addEventListener("click", function () {
            state.splice(Number(b.getAttribute("data-founder-del")), 1);
            draw();
          });
        });
        $$("[data-founder-photo]", listEl).forEach(function (input) {
          input.addEventListener("change", function () {
            var file = input.files && input.files[0];
            if (!file) return;
            var i = Number(input.getAttribute("data-founder-photo"));
            statusEl.textContent = "Загружаем фото…";
            Store.uploadMedia(file).then(function (url) {
              state[i].photo = url;
              statusEl.textContent = "Фото загружено: " + state[i].name;
              draw();
            }, function () {
              fileToDataUrl(file).then(function (url) {
                state[i].photo = url;
                statusEl.textContent = "Фото добавлено.";
                draw();
              });
            });
          });
        });
      }

      Store.founders().then(function (list) {
        state = list && list.length ? list : [];
        if (!state.length) {
          state = (SC.founders || []).map(function (f) {
            return { name: f.name, role: f.role, city: f.city, since: f.since, bio: f.bio, photo: f.photo };
          });
        }
        draw();
      }, function () {
        state = (SC.founders || []).slice();
        draw();
      });

      var addBtn = $("[data-founder-add]", section);
      if (addBtn) {
        addBtn.addEventListener("click", function () {
          if (state.length >= 4) {
            statusEl.textContent = "Основателей не больше четырёх.";
            return;
          }
          state.push({ name: "", role: "", city: "", since: "2026", bio: "", photo: "" });
          draw();
        });
      }

      var saveBtn = $("[data-founders-save]", section);
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var filled = state.filter(function (f) { return (f.name || "").trim().length >= 3; });
          if (!filled.length) {
            statusEl.textContent = "Нужно хотя бы одно имя: минимум три символа.";
            return;
          }
          saveBtn.disabled = true;
          statusEl.textContent = "Сохраняем…";
          Store.foundersSave(filled).then(function (saved) {
            saveBtn.disabled = false;
            state = saved;
            draw();
            statusEl.textContent = "Сохранено. Страница «Основатели» уже обновилась.";
          }, function (err) {
            saveBtn.disabled = false;
            statusEl.textContent = (err && err.message) || "Не сохранилось.";
          });
        });
      }
    }

    /* Диагностика: почему не пускает и что с сервером. */
    function mountDiag(host) {
      var old = $("[data-diag-admin]");
      if (old) old.remove();
      if (!Store.diag) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-diag-admin", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Сервер</span>' +
        "<h2>Состояние проекта</h2>" +
        '<p class="sec-head__text">Проверка без паролей и личных данных: сколько аккаунтов, ' +
        "можно ли писать файлы, настроена ли почта.</p></div></div>" +
        '<div class="panel" style="padding:20px"><div class="diag" data-diag-list>' +
        '<p class="form__note">Проверяем…</p></div>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-diag-refresh ' +
        'style="margin-top:12px">Проверить снова</button>' +
        '<div class="audit" style="margin-top:22px"><span class="kicker">Журнал действий</span>' +
        '<p class="form__note">Кто и когда менял роли, карты, почту и состояние сайта. ' +
        "Последние 120 записей.</p>" +
        '<div class="diag" data-audit-list><p class="form__note">Загружаем…</p></div></div></div>';
      host.appendChild(section);

      var listEl = $("[data-diag-list]", section);

      function row(label, value, good) {
        return '<div class="diag__row"><span>' + esc(label) + '</span><b class="' +
          (good === false ? "is-bad" : good === true ? "is-good" : "") + '">' + esc(String(value)) + "</b></div>";
      }

      function load() {
        listEl.innerHTML = '<p class="form__note">Проверяем…</p>';
        Store.diag().then(function (d) {
          if (!d) {
            listEl.innerHTML = '<p class="form__note">Сервер не отвечает.</p>';
            return;
          }
          listEl.innerHTML =
            row("PHP", d.php) +
            row("Аккаунтов на сервере", d.accounts, d.accounts > 0) +
            row("Подтверждение действий", "код на почту") +
            row("Материалов", d.posts) +
            row("Запись данных", d.data_writable ? "разрешена" : "запрещена", !!d.data_writable) +
            row("Загрузка медиа", d.uploads_writable ? "разрешена" : "запрещена", !!d.uploads_writable) +
            row("Почта", d.mail_configured ? "настроена" : "не настроена", !!d.mail_configured) +
            row("Отправитель", d.mail_from || "—") +
            row("Попыток входа за час", d.rate_entries) +
            row("Время сервера", fmtDate(d.server_time));
        });
      }

      var auditEl = $("[data-audit-list]", section);

      function loadAudit() {
        if (!auditEl || !Store.adminLog) return;
        auditEl.innerHTML = '<p class="form__note">Загружаем…</p>';
        Store.adminLog().then(function (res) {
          var rows = (res && res.entries) || [];
          if (!rows.length) {
            auditEl.innerHTML = '<p class="form__note">Пока пусто: действий ещё не было.</p>';
            return;
          }
          auditEl.innerHTML = rows
            .map(function (e) {
              return '<div class="diag__row"><span>' + esc(fmtWhen(e.at)) + " · " + esc(e.who) +
                "</span><b>" + esc(e.action) + (e.details ? " — " + esc(e.details) : "") + "</b></div>";
            })
            .join("");
        });
      }

      var btn = $("[data-diag-refresh]", section);
      if (btn) {
        btn.addEventListener("click", function () {
          load();
          loadAudit();
        });
      }
      loadAudit();

      load();
    }

    /* Почта: настройки SMTP и проверка письмом. Пароль наружу не отдаём. */
    /* --- Задачи команды: у сотрудника — свои, у редакции — все --------- */
    function taskBadge(t) {
      var cls = t.priority === "urgent" ? " task-badge--urgent" : t.priority === "high" ? " task-badge--high" : "";
      return '<span class="task-badge' + cls + '">' + esc(t.priorityLabel || "Обычная") + "</span>";
    }

    function taskCard(t, statuses) {
      var who = t.assignee ? esc(t.assignee.name) : esc(t.groupLabel || "—");
      var due = t.due ? "срок " + esc(t.due) : "без срока";
      var options = Object.keys(statuses || {}).map(function (k) {
        return '<option value="' + esc(k) + '"' + (k === t.status ? " selected" : "") + ">" + esc(statuses[k]) + "</option>";
      }).join("");
      return '<div class="task-card' + (t.status === "done" ? " is-done" : "") + '" data-task="' + esc(t.id) + '">' +
        '<div class="task-card__head"><b>' + esc(t.title) + "</b>" + taskBadge(t) + "</div>" +
        '<div class="task-card__meta"><span>' + who + "</span><span>" + due + "</span>" +
        "<span>" + esc(t.statusLabel || "") + "</span></div>" +
        (t.description ? '<div class="task-card__text">' + esc(t.description) + "</div>" : "") +
        (t.comments && t.comments.length
          ? '<div class="task-comments">' + t.comments.map(function (c) {
              return "<div><b>" + esc(c.by) + ":</b> " + esc(c.text) + "</div>";
            }).join("") + "</div>"
          : "") +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px">' +
        '<select data-task-status style="max-width:170px">' + options + "</select>" +
        '<input type="text" data-task-comment placeholder="комментарий" style="max-width:220px">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-task-send>Добавить</button>' +
        "</div></div>";
    }

    function bindTaskCards(host, statuses, reload) {
      $$("[data-task]", host).forEach(function (card) {
        var id = card.getAttribute("data-task");
        var select = $("[data-task-status]", card);
        if (select) {
          select.addEventListener("change", function () {
            select.disabled = true;
            Store.tasksUpdate({ id: id, status: select.value }).then(reload, function (err) {
              select.disabled = false;
              alert(err.message);
            });
          });
        }
        var btn = $("[data-task-send]", card);
        if (btn) btn.addEventListener("click", function () {
          var text = ($("[data-task-comment]", card) || {}).value || "";
          if (text.trim().length < 2) return;
          btn.disabled = true;
          Store.tasksComment(id, text).then(reload, function (err) { btn.disabled = false; alert(err.message); });
        });
      });
    }

    function mountTasksCabinet(user) {
      var host = $("[data-tasks-cabinet]");
      if (!host || !Store.tasksMine || !user) return;
      function draw() {
        Store.tasksMine().then(function (res) {
          if (!res.tasks.length) {
            host.innerHTML = '<div class="panel" style="padding:22px"><span class="kicker">Работа</span>' +
              '<h3 style="margin:6px 0 8px">Задачи</h3><p class="form__note">Задач пока нет. ' +
              "Когда редакция поставит задачу, она появится здесь.</p></div>";
            return;
          }
          host.innerHTML = '<div class="panel" style="padding:22px"><span class="kicker">Работа</span>' +
            '<h3 style="margin:6px 0 10px">Задачи</h3>' +
            res.tasks.map(function (t) { return taskCard(t, res.statuses); }).join("") +
            "</div>";
          bindTaskCards(host, res.statuses, draw);
        }, function () {});
      }
      draw();
    }

    function mountTasksAdmin(host) {
      if (!Store.tasksList) return;
      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:8px");
      section.setAttribute("data-tasks-admin", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Работа</span>' +
        "<h2>Задачи команды</h2>" +
        '<p class="sec-head__text">Задачи для сотрудников, редакции и основателей: кому, к какому ' +
        "сроку и на каком этапе.</p></div></div>" +
        '<div class="panel" style="padding:20px">' +
        '<div class="mail-grid">' +
        '<div class="field"><label>Задача</label><input type="text" data-t-title placeholder="Что нужно сделать"></div>' +
        '<div class="field"><label>Кому</label><select data-t-assignee><option value="">— выберите —</option></select></div>' +
        '<div class="field"><label>Группа</label><select data-t-group><option value="">— или группа —</option>' +
        '<option value="founders">Основатели</option><option value="editorial">Редакция</option>' +
        '<option value="staff">Сотрудники</option></select></div>' +
        '<div class="field"><label>Срок</label><input type="date" data-t-due></div>' +
        '<div class="field"><label>Приоритет</label><select data-t-priority><option value="low">Обычная</option>' +
        '<option value="high">Важная</option><option value="urgent">Срочная</option></select></div>' +
        "</div>" +
        '<div class="field" style="margin-top:10px"><label>Описание</label>' +
        '<textarea data-t-desc rows="3" placeholder="Подробности, ссылки, критерии готовности"></textarea></div>' +
        '<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn btn--accent btn--sm" type="button" data-t-create>Поставить задачу</button>' +
        '<span class="form__note" data-t-note style="align-self:center"></span></div>' +
        '<div data-t-list style="margin-top:16px"></div></div>';
      host.appendChild(section);

      var noteEl = $("[data-t-note]", section);
      var listEl = $("[data-t-list]", section);
      var assigneeEl = $("[data-t-assignee]", section);

      function loadPeople() {
        if (!Store.usersList) return;
        Store.usersList().then(function (res) {
          var users = (res && res.users) || [];
          assigneeEl.innerHTML = '<option value="">— выберите —</option>' + users.map(function (u) {
            return '<option value="' + esc(u.id) + '">' + esc(u.name) + " · " + esc(u.access || "") + "</option>";
          }).join("");
        }, function () {});
      }

      function refresh() {
        Store.tasksList().then(function (res) {
          listEl.innerHTML = res.tasks.length
            ? res.tasks.map(function (t) { return taskCard(t, res.statuses); }).join("")
            : '<p class="form__note">Задач нет.</p>';
          bindTaskCards(listEl, res.statuses, refresh);
        }, function (err) {
          listEl.innerHTML = '<p class="form__note">' + esc(err.message) + "</p>";
        });
      }

      $("[data-t-create]", section).addEventListener("click", function () {
        var group = $("[data-t-group]", section).value;
        var assignee = assigneeEl.value;
        if (!assignee) group = group || "staff";
        noteEl.textContent = "Сохраняем…";
        Store.tasksCreate({
          title: $("[data-t-title]", section).value,
          description: $("[data-t-desc]", section).value,
          assignee: assignee,
          group: assignee ? "" : group,
          due: $("[data-t-due]", section).value,
          priority: $("[data-t-priority]", section).value,
        }).then(function () {
          noteEl.textContent = "Задача поставлена.";
          $("[data-t-title]", section).value = "";
          $("[data-t-desc]", section).value = "";
          refresh();
        }, function (err) { noteEl.textContent = err.message; });
      });

      loadPeople();
      refresh();
    }

    /* --- Двухфакторный вход: код на почту вместо «пароля редакции» ------ */
    function mountTwofaCard(user) {
      var host = $("[data-twofa-card]");
      if (!host || !Store.twofaEnable || !user) return;
      function draw() {
        var fresh = Store.currentUser() || user;
        var on = !!fresh.twofa;
        host.innerHTML = '<div class="panel" style="padding:22px"><span class="kicker">Безопасность</span>' +
          '<h3 style="margin:6px 0 8px">Вход по коду</h3>' +
          "<p class=\"form__note\">" + (on
            ? "Включено: при входе после пароля мы спросим код из письма. Так украденный пароль сам по себе бесполезен."
            : "Можно включить вход по коду на почту: после пароля сайт попросит шесть цифр из письма.") + "</p>" +
          '<div class="row" style="gap:8px;flex-wrap:wrap">' +
          '<input type="password" data-2fa-pass placeholder="Пароль аккаунта" autocomplete="current-password" style="max-width:220px">' +
          '<button class="btn btn--sm ' + (on ? "btn--ghost" : "") + '" type="button" data-2fa-toggle>' +
          (on ? "Выключить" : "Включить") + "</button>" +
          '<span class="form__note" data-2fa-note style="align-self:center"></span></div></div>';
        var note = $("[data-2fa-note]", host);
        $("[data-2fa-toggle]", host).addEventListener("click", function () {
          var pass = ($("[data-2fa-pass]", host) || {}).value || "";
          if (!pass) { note.textContent = "Введите пароль."; return; }
          var call = on ? Store.twofaDisable(pass) : Store.twofaEnable(pass);
          call.then(function () {
            var cached = Store.currentUser() || {};
            cached.twofa = !on;
            try { window.localStorage.setItem("smena_user", JSON.stringify(cached)); } catch (e) {}
            draw();
          }, function (err) { note.textContent = (err && err.message) || "Не получилось."; });
        });
      }
      draw();
    }

    /* --- Удаление аккаунта из кабинета ---------------------------------- */
    function mountDangerZone(user) {
      var host = $("[data-danger-zone]");
      if (!host || !Store.accountDelete || !user) return;
      host.innerHTML =
        '<div class="danger-zone"><h3>Удаление аккаунта</h3>' +
        "<p>Аккаунт и личные данные удаляются навсегда: имя, почта, пароль и черновики. " +
        "Опубликованные материалы остаются в проекте, но без вашего имени. " +
        "Восстановить аккаунт после удаления нельзя.</p>" +
        '<div class="row"><input type="password" data-del-pass placeholder="Пароль" autocomplete="current-password" style="max-width:220px">' +
        '<input type="text" data-del-word placeholder="Напишите УДАЛИТЬ" style="max-width:200px">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-del-do>Удалить аккаунт</button></div>' +
        '<p class="form__note" data-del-note></p></div>';

      var noteEl = $("[data-del-note]", host);
      var btn = $("[data-del-do]", host);
      btn.addEventListener("click", function () {
        var pass = ($("[data-del-pass]", host) || {}).value || "";
        var word = ($("[data-del-word]", host) || {}).value || "";
        if (!pass) { noteEl.textContent = "Введите пароль."; return; }
        if (word.trim().toUpperCase() !== "УДАЛИТЬ") { noteEl.textContent = "Напишите слово УДАЛИТЬ."; return; }
        if (!window.confirm("Удалить аккаунт навсегда? Восстановить его будет нельзя.")) return;
        btn.disabled = true;
        noteEl.textContent = "Удаляем…";
        Store.accountDelete(pass, word.trim()).then(function () {
          noteEl.textContent = "Аккаунт удалён. Возвращаем на главную.";
          setTimeout(function () { window.location.href = "/"; }, 1200);
        }, function (err) {
          btn.disabled = false;
          noteEl.textContent = (err && err.message) || "Не получилось удалить аккаунт.";
        });
      });
    }

    /* --- Почта: ящики домена, чтение, отправка, шаблоны --------------------- */
    function mountMailClient(host) {
      if (!Store.mailBoxes) return;
      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:8px");
      section.setAttribute("data-mail-client", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Почта проекта</span>' +
        "<h2>Ящики и письма</h2>" +
        '<p class="sec-head__text">Четыре ящика на домене: редакция, общие вопросы, системные письма и ' +
        "поддержка. Здесь можно читать входящие, отвечать, пересылать и отправлять письма от имени ящика. " +
        "Пароли ящиков хранятся на сервере и в браузер не возвращаются.</p></div></div>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px" data-mailboxes></div>' +
        '<div class="panel" style="padding:16px;margin-bottom:14px">' +
        '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
        '<select data-mail-folder style="max-width:200px">' +
        '<option value="INBOX">Входящие</option><option value="Sent">Отправленные</option>' +
        '<option value="Drafts">Черновики</option><option value="Archive">Архив</option>' +
        '<option value="Junk">Спам</option><option value="Trash">Корзина</option></select>' +
        '<input type="search" data-mail-q placeholder="Поиск: отправитель, тема, текст" style="flex:1;min-width:180px">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-mail-refresh>Обновить</button>' +
        '<button class="btn btn--accent btn--sm" type="button" data-mail-write>Написать</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-mail-drafts>Черновики</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-mail-templates>Шаблоны писем</button>' +
        "</div>" +
        '<p class="form__note" data-mail-state style="margin:10px 0 0"></p></div>' +
        '<div data-mail-compose></div>' +
        '<div class="mail-split">' +
        '<div class="panel" style="padding:0;overflow:hidden" data-mail-list>' +
        '<p class="form__note" style="padding:18px">Загружаем письма…</p></div>' +
        '<div class="panel" style="padding:18px" data-mail-read>' +
        '<p class="form__note">Выберите письмо слева — здесь появится текст, вложения и ответ.</p></div>' +
        "</div>" +
        '<div data-mail-templates-box style="margin-top:14px"></div>';
      host.appendChild(section);

      var boxesEl = $("[data-mailboxes]", section);
      var listEl = $("[data-mail-list]", section);
      var readEl = $("[data-mail-read]", section);
      var composeEl = $("[data-mail-compose]", section);
      var stateEl = $("[data-mail-state]", section);
      var folderEl = $("[data-mail-folder]", section);
      var qEl = $("[data-mail-q]", section);
      var templatesEl = $("[data-mail-templates-box]", section);
      var state = { box: "editorial", boxes: [], letters: [], msg: null, folder: "INBOX", search: "", offline: false };

      function note(text, isError) {
        if (!stateEl) return;
        stateEl.textContent = text || "";
        stateEl.style.color = isError ? "#a11" : "";
      }

      function boxLabel(key) {
        var found = state.boxes.filter(function (b) { return b.key === key; })[0];
        return found ? found.label + " · " + found.address : key;
      }

      function drawBoxes() {
        boxesEl.innerHTML = state.boxes.map(function (b) {
          var on = b.key === state.box ? " btn--accent" : " btn--ghost";
          return '<button class="btn btn--sm' + on + '" type="button" data-box="' + esc(b.key) + '">' +
            esc(b.label) + (b.ready ? "" : " · не подключён") + "</button>";
        }).join("") +
          '<span class="form__note" style="align-self:center;margin-left:auto">' +
          esc(boxLabel(state.box)) + "</span>";
        $$("[data-box]", boxesEl).forEach(function (b) {
          b.addEventListener("click", function () {
            state.box = b.getAttribute("data-box");
            state.msg = null;
            readEl.innerHTML = '<p class="form__note">Выберите письмо слева.</p>';
            drawBoxes();
            load();
          });
        });
      }

      function fmtMailDate(value) {
        if (!value) return "";
        var d = new Date(value);
        if (isNaN(d.getTime())) return value;
        return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) + " " +
          d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      }

      function drawLetters() {
        if (!state.letters.length) {
          listEl.innerHTML = '<p class="form__note" style="padding:18px">' +
            (state.search ? "По запросу ничего не нашлось." : "В этой папке писем нет.") + "</p>";
          return;
        }
        listEl.innerHTML = state.letters.map(function (m) {
          return '<button type="button" class="mail-row' + (m.seen ? "" : " is-unread") + '" data-uid="' + m.uid + '">' +
            '<span class="mail-row__from">' + esc(m.from || "неизвестный") + "</span>" +
            '<span class="mail-row__subj">' + esc(m.subject || "(без темы)") + "</span>" +
            '<span class="mail-row__date">' + esc(fmtMailDate(m.date)) + "</span></button>";
        }).join("");
        $$("[data-uid]", listEl).forEach(function (btn) {
          btn.addEventListener("click", function () { openLetter(Number(btn.getAttribute("data-uid"))); });
        });
      }

      function load() {
        note("Читаем ящик…");
        Store.mailList({ key: state.box, folder: state.folder, q: state.search, limit: 30 })
          .then(function (res) {
            state.letters = res.messages || [];
            drawLetters();
            note("Писем в папке: " + (res.total || 0) + (state.search ? ", найдено: " + (res.matched || 0) : ""));
          }, function (err) {
            state.letters = [];
            listEl.innerHTML = '<p class="form__note" style="padding:18px">Ящик не открылся.</p>';
            note((err && err.message) || "Ящик не открылся.", true);
          });
      }

      function attachList(msg) {
        if (!msg.attachments || !msg.attachments.length) return "";
        return '<div style="margin-top:14px"><b>Вложения</b><div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px">' +
          msg.attachments.map(function (a) {
            return '<button class="btn btn--ghost btn--sm" type="button" data-attach="' + a.index + '">' +
              esc(a.name) + " · " + Math.max(1, Math.round((a.size || 0) / 1024)) + " КБ</button>";
          }).join("") + "</div></div>";
      }

      function openLetter(uid) {
        note("Открываем письмо…");
        Store.mailGet({ key: state.box, folder: state.folder, uid: uid }).then(function (msg) {
          state.msg = msg;
          note("");
          readEl.innerHTML =
            "<h3 style=\"margin:0 0 6px\">" + esc(msg.subject || "(без темы)") + "</h3>" +
            '<p class="form__note" style="margin:0 0 12px">От: ' + esc(msg.from) + " · Кому: " + esc(msg.to) +
            " · " + esc(fmtMailDate(msg.date)) + "</p>" +
            '<div class="mail-body">' +
            (msg.html
              ? '<iframe class="mail-frame" sandbox="" referrerpolicy="no-referrer" title="Письмо" ' +
                'srcdoc="' + String(msg.html).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"></iframe>'
              : "<p>" + esc(msg.text || "(пустое письмо)").replace(/\n/g, "</p><p>") + "</p>") +
            "</div>" + attachList(msg) +
            '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:16px">' +
            '<button class="btn btn--accent btn--sm" type="button" data-mail-reply>Ответить</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-mail-forward>Переслать</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-mail-fav>В избранное</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-mail-archive>В архив</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-mail-trash>В корзину</button>' +
            "</div>";
          $$("[data-attach]", readEl).forEach(function (b) {
            b.addEventListener("click", function () {
              var idx = Number(b.getAttribute("data-attach"));
              b.disabled = true;
              Store.mailAttachment({ key: state.box, folder: state.folder, uid: msg.uid, index: idx })
                .then(function (file) {
                  b.disabled = false;
                  var a = document.createElement("a");
                  a.href = file.data;
                  a.download = file.name || "файл";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }, function (err) { b.disabled = false; note((err && err.message) || "Вложение не скачалось.", true); });
            });
          });
          var reply = $("[data-mail-reply]", readEl);
          if (reply) reply.addEventListener("click", function () {
            var addr = (String(msg.from).match(/[^\s<>"]+@[^\s<>"]+/) || [""])[0];
            openCompose({ to: addr, subject: /^re:/i.test(msg.subject) ? msg.subject : "Re: " + msg.subject, inReplyTo: msg.messageId });
          });
          var fwd = $("[data-mail-forward]", readEl);
          if (fwd) fwd.addEventListener("click", function () {
            openCompose({ subject: "Fwd: " + msg.subject, text: "\n\n--- Пересланное письмо ---\nОт: " + msg.from + "\n" + (msg.text || "") });
          });
          var fav = $("[data-mail-fav]", readEl);
          if (fav) fav.addEventListener("click", function () {
            Store.mailFlag({ key: state.box, folder: state.folder, uid: msg.uid, flag: "\\Flagged", value: true })
              .then(function () { note("Письмо в избранном."); }, function (e) { note(e.message, true); });
          });
          var arch = $("[data-mail-archive]", readEl);
          if (arch) arch.addEventListener("click", function () {
            Store.mailMove({ key: state.box, folder: state.folder, uid: msg.uid, to: "Archive" })
              .then(function () { note("Письмо в архиве."); load(); readEl.innerHTML = ""; }, function (e) { note(e.message, true); });
          });
          var trash = $("[data-mail-trash]", readEl);
          if (trash) trash.addEventListener("click", function () {
            Store.mailMove({ key: state.box, folder: state.folder, uid: msg.uid, to: "Trash" })
              .then(function () { note("Письмо в корзине."); load(); readEl.innerHTML = ""; }, function (e) { note(e.message, true); });
          });
        }, function (err) { note((err && err.message) || "Письмо не открылось.", true); });
      }

      function openCompose(prefill) {
        prefill = prefill || {};
        var currentBox = state.box;
        composeEl.innerHTML =
          '<div class="panel" style="padding:20px;margin-bottom:14px">' +
          '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">' +
          "<h3 style=\"margin:0\">Новое письмо</h3>" +
          '<span class="form__note">Отправитель: <b>' + esc(boxLabel(currentBox)) + "</b></span>" +
          '<button class="btn btn--ghost btn--sm" type="button" data-c-close>Закрыть</button></div>' +
          '<div class="mail-grid">' +
          '<div class="field"><label>Кому</label><input type="text" data-c-to placeholder="author@example.ru"></div>' +
          '<div class="field"><label>Копия</label><input type="text" data-c-cc placeholder="необязательно"></div>' +
          '<div class="field"><label>Скрытая копия</label><input type="text" data-c-bcc placeholder="необязательно"></div>' +
          '<div class="field"><label>Тема</label><input type="text" data-c-subject placeholder="О чём письмо"></div>' +
          "</div>" +
          '<div class="field" style="margin-top:10px"><label>Текст</label>' +
          '<textarea data-c-text rows="8" placeholder="Текст письма. Пробелы и абзацы сохраняются."></textarea></div>' +
          '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">' +
          '<select data-c-ai-task style="max-width:240px">' +
          '<option value="improve">Улучшить текст</option>' +
          '<option value="compose">Создать с помощью ИИ</option>' +
          '<option value="spelling">Орфография и пунктуация</option>' +
          '<option value="official">Официальный тон</option>' +
          '<option value="friendly">Дружелюбный тон</option>' +
          '<option value="shorten">Сократить</option>' +
          '<option value="subject">Придумать тему</option>' +
          '<option value="reply">Ответить на обращение</option>' +
          '<option value="business">Деловая переписка</option>' +
          '<option value="translate_en">Перевести на английский</option>' +
          '<option value="translate_ru">Перевести на русский</option>' +
          '<option value="adapt">Подогнать под адресата</option></select>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-c-ai-go>ИИ-помощник</button>' +
          '<span class="form__note" data-c-ai-note style="align-self:center"></span></div>' +
          '<div data-c-ai-box></div>' +
          '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px">' +
          '<label class="btn btn--ghost btn--sm" style="cursor:pointer">Приложить файл' +
          '<input type="file" data-c-file multiple style="display:none"></label>' +
          '<span class="form__note" data-c-files style="align-self:center">до 6 файлов, 8 МБ вместе</span>' +
          "</div>" +
          '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">' +
          '<button class="btn btn--accent btn--sm" type="button" data-c-send>Отправить</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-c-preview>Предпросмотр</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-c-draft>Сохранить черновик</button>' +
          "</div>" +
          '<p class="form__note" data-c-note style="margin-top:10px"></p>' +
          '<div data-c-preview-box></div></div>';

        var toEl = $("[data-c-to]", composeEl);
        var ccEl = $("[data-c-cc]", composeEl);
        var bccEl = $("[data-c-bcc]", composeEl);
        var subjEl = $("[data-c-subject]", composeEl);
        var textEl = $("[data-c-text]", composeEl);
        var noteEl = $("[data-c-note]", composeEl);
        var filesEl = $("[data-c-files]", composeEl);
        var attachments = [];
        var draftId = prefill.draftId || "";

        if (prefill.to) toEl.value = prefill.to;
        if (prefill.subject) subjEl.value = prefill.subject;
        if (prefill.text) textEl.value = prefill.text;

        $("[data-c-close]", composeEl).addEventListener("click", function () { composeEl.innerHTML = ""; });

        $("[data-c-file]", composeEl).addEventListener("change", function (e) {
          var files = Array.prototype.slice.call(e.target.files || []);
          var total = attachments.reduce(function (n, f) { return n + f.size; }, 0);
          files.forEach(function (f) {
            if (attachments.length >= 6) return;
            if (f.size > 5 * 1024 * 1024) { noteEl.textContent = "Файл «" + f.name + "» больше 5 МБ."; return; }
            total += f.size;
            if (total > 8 * 1024 * 1024) { noteEl.textContent = "Вложения весят больше 8 МБ."; return; }
            var reader = new FileReader();
            reader.onload = function () {
              attachments.push({ name: f.name, size: f.size, data: String(reader.result) });
              filesEl.textContent = attachments.map(function (a) { return a.name; }).join(", ");
            };
            reader.readAsDataURL(f);
          });
          e.target.value = "";
        });

        function localPreview() {
          var box = $("[data-c-preview-box]", composeEl);
          box.innerHTML = '<div class="mail-preview"><div class="mail-preview__head">Смена контента</div>' +
            "<b>" + esc(subjEl.value || "(без темы)") + "</b>" +
            "<p>" + esc(textEl.value || "").replace(/\n/g, "<br>") + "</p>" +
            '<div class="mail-preview__foot">Письмо от ' + esc(boxLabel(currentBox)) + "</div></div>";
        }

        $("[data-c-preview]", composeEl).addEventListener("click", localPreview);

        /* ИИ: только предлагает текст, вставка — по кнопке, отправка — вручную */
        var aiGo = $("[data-c-ai-go]", composeEl);
        if (aiGo) aiGo.addEventListener("click", function () {
          var note = $("[data-c-ai-note]", composeEl);
          var box2 = $("[data-c-ai-box]", composeEl);
          aiGo.disabled = true;
          note.textContent = "Помощник думает…";
          Store.aiAssist({
            task: $("[data-c-ai-task]", composeEl).value,
            subject: subjEl.value,
            text: textEl.value,
            to: toEl.value,
          }).then(function (res) {
            aiGo.disabled = false;
            note.textContent = res.note || "";
            box2.innerHTML = '<div class="mail-preview"><b>Предложение помощника</b>' +
              '<p style="white-space:pre-wrap;margin:8px 0 12px">' + esc(res.text) + "</p>" +
              '<div class="row" style="gap:8px;flex-wrap:wrap">' +
              '<button class="btn btn--sm" type="button" data-ai-insert>Вставить в текст</button>' +
              '<button class="btn btn--ghost btn--sm" type="button" data-ai-drop>Убрать</button></div></div>';
            $("[data-ai-insert]", box2).addEventListener("click", function () {
              textEl.value = res.text;
              box2.innerHTML = "";
              note.textContent = "Текст вставлен. Проверьте и отправьте сами.";
            });
            $("[data-ai-drop]", box2).addEventListener("click", function () { box2.innerHTML = ""; });
          }, function (err) {
            aiGo.disabled = false;
            note.textContent = (err && err.message) || "Помощник недоступен.";
          });
        });

        $("[data-c-draft]", composeEl).addEventListener("click", function () {
          Store.mailDraftSave({
            id: draftId, box: currentBox, to: toEl.value, cc: ccEl.value, bcc: bccEl.value,
            subject: subjEl.value, text: textEl.value,
          }).then(function (res) {
            draftId = res.draft.id;
            noteEl.textContent = "Черновик сохранён.";
          }, function (err) { noteEl.textContent = err.message; });
        });

        var sendBtn = $("[data-c-send]", composeEl);
        sendBtn.addEventListener("click", function () {
          if (sendBtn.disabled) return;
          if (!toEl.value.trim()) { noteEl.textContent = "Укажите почту получателя."; return; }
          sendBtn.disabled = true;
          noteEl.textContent = "Отправляем…";
          var check = [currentBox, toEl.value.trim(), subjEl.value.trim(), textEl.value.slice(0, 200)].join("|");
          Store.mailSend({
            key: currentBox, to: toEl.value, cc: ccEl.value, bcc: bccEl.value,
            subject: subjEl.value, text: textEl.value, html: "",
            inReplyTo: prefill.inReplyTo || "", confirm: true, check: check,
            attachments: attachments.map(function (a) { return { name: a.name, data: a.data }; }),
            draftId: draftId,
          }).then(function (res) {
            sendBtn.disabled = false;
            noteEl.innerHTML = "<b>Письмо ушло.</b> Отправитель: " + esc(res.from) +
              (res.savedToSent ? ". Копия в «Отправленных»." : ". Копию в «Отправленных» сохранить не удалось — проверьте папку.");
            composeEl.innerHTML = "";
            readEl.innerHTML = '<p class="form__note">Письмо отправлено. Оно в папке «Отправленные».</p>';
            load();
          }, function (err) {
            sendBtn.disabled = false;
            noteEl.textContent = (err && err.message) || "Письмо не ушло.";
          });
        });
      }

      function openTemplates() {
        templatesEl.innerHTML = '<p class="form__note">Загружаем шаблоны…</p>';
        Store.mailTemplates().then(function (res) {
          templatesEl.innerHTML =
            '<div class="panel" style="padding:20px"><span class="kicker">Письма проекта</span>' +
            '<h3 style="margin:6px 0 10px">Шаблоны</h3>' +
            '<p class="form__note">Фирменный макет один для всех писем: логотип, заголовок, кнопка, ' +
            "колонтитул и причина получения. Текст можно поправить без правки кода.</p>" +
            '<div class="mail-template-list">' + res.templates.map(function (t) {
              return '<div class="mail-template-row" data-tpl="' + esc(t.key) + '"><div>' +
                "<b>" + esc(t.name) + "</b><br><span class=\"form__note\">" + esc(t.subject) + "</span></div>" +
                '<div class="row" style="gap:6px"><button class="btn btn--ghost btn--sm" type="button" data-tpl-preview="' +
                esc(t.key) + '">Предпросмотр</button>' +
                '<button class="btn btn--ghost btn--sm" type="button" data-tpl-test="' + esc(t.key) + '">Прислать себе</button>' +
                "</div></div>";
            }).join("") + "</div>" +
            '<div data-tpl-preview-box style="margin-top:14px"></div>' +
            '<div data-tpl-log style="margin-top:18px"></div></div>';
          $$("[data-tpl-preview]", templatesEl).forEach(function (b) {
            b.addEventListener("click", function () {
              Store.mailTemplatePreview(b.getAttribute("data-tpl-preview")).then(function (res) {
                $("[data-tpl-preview-box]", templatesEl).innerHTML =
                  '<p class="form__note">Тема: ' + esc(res.subject) + "</p>" +
                  '<iframe sandbox="" title="Предпросмотр письма" style="width:100%;height:560px;border:1px solid #ddd;border-radius:10px;background:#fff" ' +
                  "srcdoc=\"" + String(res.html).replace(/"/g, "&quot;") + "\"></iframe>";
              }, function (err) { note(err.message, true); });
            });
          });
          $$("[data-tpl-test]", templatesEl).forEach(function (b) {
            b.addEventListener("click", function () {
              b.disabled = true;
              Store.mailTemplateTest(b.getAttribute("data-tpl-test")).then(function (res) {
                b.disabled = false;
                note("Тестовое письмо ушло на " + res.to + ".");
              }, function (err) { b.disabled = false; note(err.message, true); });
            });
          });
        }, function (err) { templatesEl.innerHTML = '<p class="form__note">' + esc(err.message) + "</p>"; });
      }

      function openDrafts() {
        Store.mailDrafts().then(function (res) {
          templatesEl.innerHTML = '<div class="panel" style="padding:20px"><h3 style="margin:0 0 10px">Черновики</h3>' +
            (res.drafts.length ? res.drafts.map(function (d) {
              return '<div class="mail-template-row"><div><b>' + esc(d.subject || "(без темы)") + "</b><br>" +
                '<span class="form__note">' + esc(d.to || "получатель не указан") + " · " + esc(fmtMailDate(d.updatedAt)) +
                "</span></div><div class=\"row\" style=\"gap:6px\">" +
                '<button class="btn btn--ghost btn--sm" type="button" data-draft-open="' + esc(d.id) + '">Открыть</button>' +
                '<button class="btn btn--ghost btn--sm" type="button" data-draft-del="' + esc(d.id) + '">Удалить</button>' +
                "</div></div>";
            }).join("") : '<p class="form__note">Черновиков нет.</p>') + "</div>";
          $$("[data-draft-open]", templatesEl).forEach(function (b) {
            b.addEventListener("click", function () {
              var id = b.getAttribute("data-draft-open");
              var d = res.drafts.filter(function (x) { return x.id === id; })[0];
              if (d) openCompose({ to: d.to, subject: d.subject, text: d.text, draftId: d.id });
            });
          });
          $$("[data-draft-del]", templatesEl).forEach(function (b) {
            b.addEventListener("click", function () {
              Store.mailDraftDelete(b.getAttribute("data-draft-del")).then(function () { openDrafts(); }, function (e) { note(e.message, true); });
            });
          });
        }, function (err) { note(err.message, true); });
      }

      $("[data-mail-refresh]", section).addEventListener("click", load);
      $("[data-mail-write]", section).addEventListener("click", function () { openCompose({}); });
      $("[data-mail-drafts]", section).addEventListener("click", openDrafts);
      $("[data-mail-templates]", section).addEventListener("click", openTemplates);
      folderEl.addEventListener("change", function () { state.folder = folderEl.value; load(); });
      var searchTimer = null;
      qEl.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { state.search = qEl.value.trim(); load(); }, 450);
      });

      Store.mailBoxes().then(function (res) {
        state.boxes = res.mailboxes || [];
        var firstReady = state.boxes.filter(function (b) { return b.ready; })[0];
        if (firstReady) state.box = firstReady.key;
        drawBoxes();
        if (!firstReady) {
          note("Ящики ещё не подключены: впишите пароли в блоке «Отправка писем» ниже. " +
            "Пока пароля нет, письма читать и отправлять нельзя.", true);
          listEl.innerHTML = '<p class="form__note" style="padding:18px">Нет ни одного подключённого ящика.</p>';
          return;
        }
        load();
      }, function (err) {
        note((err && err.message) || "Почта недоступна.", true);
        listEl.innerHTML = '<p class="form__note" style="padding:18px">Почта не открылась.</p>';
      });
    }

    /* --- Приём в команду: заявки, тест, чек-лист, решение ---------------- */
    function mountHiringAdmin(host) {
      if (!Store.hiringList) return;
      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:8px");
      section.setAttribute("data-hiring-admin", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Команда</span>' +
        "<h2>Приём на работу</h2>" +
        '<p class="sec-head__text">Заявка → тест знаний → чек-лист документов → согласование. ' +
        "Роль «Сотрудник» выдаёт сервер и только после всех этапов.</p></div></div>" +
        '<div class="panel" style="padding:20px"><div data-hiring-banner class="fill-note fill-note--flat">' +
        "Загружаем заявки…</div><div data-hiring-list></div></div>";
      host.appendChild(section);
      var banner = $("[data-hiring-banner]", section);
      var listEl = $("[data-hiring-list]", section);

      function draw(apps, canDecide) {
        if (!apps.length) {
          banner.textContent = "Заявок пока нет. Как только кто-то подаст заявку, она появится здесь.";
          listEl.innerHTML = "";
          return;
        }
        banner.textContent = "Заявок: " + apps.length + ". Тест проверяется автоматически, чек-лист — вручную.";
        listEl.innerHTML = apps.map(function (a) {
          var done = a.checklist.filter(function (c) { return c.ok; }).length;
          var stageName = { test: "тест", checklist: "чек-лист", review: "согласование", approved: "принят", rejected: "отказ" }[a.stage] || a.stage;
          return '<div class="hiring-row" data-app="' + esc(a.id) + '">' +
            '<div class="hiring-row__main"><b>' + esc(a.name) + "</b> · " + esc(a.position) +
            '<br><span class="form__note">' + esc(a.email) + " · этап: " + esc(stageName) +
            " · тест: " + a.testPercent + "% · чек-лист: " + done + " из " + a.checklist.length + "</span>" +
            (a.motivation ? '<p class="form__note" style="margin:8px 0 0">' + esc(a.motivation) + "</p>" : "") +
            (a.note ? '<p class="form__note" style="margin:6px 0 0">Решение: ' + esc(a.note) + "</p>" : "") +
            "</div>" +
            '<div class="hiring-row__side">' +
            (canDecide && a.stage !== "approved" && a.stage !== "rejected"
              ? '<div class="hiring-checks">' + a.checklist.map(function (c) {
                  return '<label class="hiring-check"><input type="checkbox" data-check="' + esc(c.key) + '"' +
                    (c.ok ? " checked" : "") + "> " + esc(c.label) + "</label>";
                }).join("") + "</div>" +
                '<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">' +
                '<button class="btn btn--accent btn--sm" type="button" data-approve>Принять в команду</button>' +
                '<input type="text" data-reason placeholder="причина отказа" style="max-width:180px">' +
                '<button class="btn btn--ghost btn--sm" type="button" data-reject>Отказать</button>' +
                "</div>"
              : "") +
            "</div></div>";
        }).join("");

        $$("[data-app]", listEl).forEach(function (row) {
          var id = row.getAttribute("data-app");
          $$("[data-check]", row).forEach(function (box) {
            box.addEventListener("change", function () {
              Store.hiringCheck(id, box.getAttribute("data-check"), box.checked).then(refresh, function (err) {
                box.checked = !box.checked;
                banner.textContent = err.message;
              });
            });
          });
          var appr = $("[data-approve]", row);
          if (appr) appr.addEventListener("click", function () {
            if (!window.confirm("Принять человека в команду и выдать роль «Сотрудник»?")) return;
            appr.disabled = true;
            Store.hiringDecide(id, "approve", "").then(refresh, function (err) {
              appr.disabled = false;
              banner.textContent = err.message;
            });
          });
          var rej = $("[data-reject]", row);
          if (rej) rej.addEventListener("click", function () {
            var reason = ($("[data-reason]", row) || {}).value || "";
            if (reason.trim().length < 5) { banner.textContent = "Напишите причину отказа — человек должен её увидеть."; return; }
            rej.disabled = true;
            Store.hiringDecide(id, "reject", reason).then(refresh, function (err) {
              rej.disabled = false;
              banner.textContent = err.message;
            });
          });
        });
      }

      function refresh() {
        Store.hiringList().then(function (res) {
          draw(res.applications || [], res.canDecide);
        }, function (err) {
          section.remove();
        });
      }
      refresh();
    }

    /* --- Выдача доступа по почте (для владельца проекта) ------------------ */

    /* ------------------------------------------------------------------
       ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЙ КОДОМ ИЗ ПИСЬМА
       Пароля редакции больше нет. Чувствительное действие (публикация,
       удаление, баллы, согласия, выдача прав) подтверждается кодом на
       почту вошедшего администратора. Подтвердил один раз — 30 минут
       работает, дальше код не спрашивается.
       ------------------------------------------------------------------ */
    function confirmRowHtml() {
      if (Store.hasConfirm && Store.hasConfirm()) {
        return '<div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 10px" data-confirm-row>' +
          '<span class="status status--pub">действие подтверждено · ещё 30 минут</span>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-confirm-reset>Сбросить</button></div>';
      }
      return '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px" data-confirm-row>' +
        '<button class="btn btn--sm" type="button" data-confirm-send>Получить код на почту</button>' +
        '<input class="admin-review__note" type="text" inputmode="numeric" maxlength="6" ' +
        'placeholder="Код из письма" data-confirm-code style="max-width:150px" aria-label="Код из письма">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-confirm-go>Подтвердить</button>' +
        '<span class="form__note" data-confirm-note></span></div>';
    }

    function confirmReady(noteEl) {
      if (Store.hasConfirm && Store.hasConfirm()) return true;
      if (noteEl) {
        noteEl.textContent = "Сначала подтвердите действие: «Получить код на почту» и шесть цифр из письма.";
      }
      return false;
    }

    /* Один обработчик на всю панель: кнопки подтверждения встречаются в
       нескольких разделах, дублировать код незачем. */
    function bindConfirmDelegation() {
      if (bindConfirmDelegation.done) return;
      bindConfirmDelegation.done = true;
      document.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var row = t.closest("[data-confirm-row]");
        if (!row) return;
        var note = $("[data-confirm-note]", row);
        if (t.closest("[data-confirm-send]")) {
          var btn = t.closest("[data-confirm-send]");
          btn.disabled = true;
          if (note) note.textContent = "Отправляем код…";
          Store.actionCode().then(function (res) {
            btn.disabled = false;
            if (note) note.textContent = "Код отправлен на " + (res.email || "вашу почту") + ". Введите шесть цифр.";
          }, function (err) {
            btn.disabled = false;
            if (note) note.textContent = (err && err.message) || "Код не отправился.";
          });
          return;
        }
        if (t.closest("[data-confirm-go]")) {
          var input = $("[data-confirm-code]", row);
          var code = input ? (input.value || "").replace(/\D/g, "") : "";
          if (code.length !== 6) { if (note) note.textContent = "Код — шесть цифр."; return; }
          Store.actionConfirm(code).then(function () {
            var fresh = document.createElement("div");
            fresh.innerHTML = confirmRowHtml();
            row.parentNode.replaceChild($("[data-confirm-row]", fresh), row);
            $$("[data-confirm-row]:not([data-bound-note])", document).forEach(function (r) {
              r.setAttribute("data-bound-note", "1");
              var n = $("[data-confirm-note]", r);
              if (n) n.textContent = "Подтверждено. Действуйте — код больше не спросим 30 минут.";
            });
          }, function (err) {
            if (note) note.textContent = (err && err.message) || "Код не подошёл.";
          });
          return;
        }
        if (t.closest("[data-confirm-reset]")) {
          Store.clearConfirm();
          var box = document.createElement("div");
          box.innerHTML = confirmRowHtml();
          row.parentNode.replaceChild($("[data-confirm-row]", box), row);
        }
      });
    }

    /* Выдача админки по почте. Доступно директору и администрации; пароль
       редакции больше не нужен — решение принимает сервер по правам. */
    function mountGrantAccess(host) {
      bindConfirmDelegation();
      if (!Store.bossGrant) return;
      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:8px");
      section.setAttribute("data-grant-access", "");
      section.innerHTML =
        '<div class="panel" style="padding:20px"><span class="kicker">Доступы</span>' +
        '<h3 style="margin:6px 0 8px">Выдать админку по почте</h3>' +
        '<p class="form__note">Если аккаунта с такой почтой ещё нет, он будет создан, а на почту ' +
        "уйдёт временный пароль — человек сменит его при первом входе.</p>" +
        '<div class="mail-grid" style="margin-top:10px">' +
        '<div class="field"><label>Почта</label><input type="email" data-g-email value="6804979@mail.ru"></div>' +
        '<div class="field"><label>Роль</label><select data-g-access>' +
        '<option>Главный администратор</option><option>Администрация</option>' +
        '<option>Технический администратор</option><option>Главный редактор</option>' +
        '<option>Модератор</option><option>Сотрудник</option></select></div>' +
        "</div>" +
        '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">' +
        '<button class="btn btn--accent btn--sm" type="button" data-g-send>Выдать доступ</button>' +
        '<span class="form__note" data-g-note style="align-self:center"></span></div></div>';
      host.appendChild(section);

      var noteEl = $("[data-g-note]", section);
      $("[data-g-send]", section).addEventListener("click", function () {
        var email = ($("[data-g-email]", section).value || "").trim();
        var access = $("[data-g-access]", section).value;
        if (!email) { noteEl.textContent = "Нужна почта."; return; }
        if (!window.confirm("Выдать доступ «" + access + "» для " + email + "?")) return;
        noteEl.textContent = "Выдаём…";
        Store.bossGrant(email, access).then(function (res) {
          noteEl.textContent = res.note || "Готово.";
        }, function (err) { noteEl.textContent = (err && err.message) || "Не получилось."; });
      });
    }

    /* --- Кабинет: работа в команде --------------------------------------- */
    function mountHiringCabinet(user) {
      var host = $("[data-hiring-cabinet]");
      if (!host || !Store.hiringMine || !user) return;

      function draw() {
        Store.hiringMine().then(function (res) {
          var app = res.application;
          if (!app) {
            host.innerHTML = '<div class="panel" style="padding:22px"><span class="kicker">Команда</span>' +
              '<h3 style="margin:6px 0 10px">Хотите работать в проекте?</h3>' +
              '<p class="form__note">Заявка проходит четыре шага: тест знаний, проверка документов, ' +
              "согласование редакции и только потом роль «Сотрудник». Почта должна быть подтверждена.</p>" +
              '<div class="mail-grid" style="margin-top:12px">' +
              '<div class="field"><label>Направление</label><select data-h-position>' +
              res.positions.map(function (p) { return "<option>" + esc(p) + "</option>"; }).join("") +
              "</select></div>" +
              '<div class="field"><label>Город или регион</label><input type="text" data-h-region placeholder="Москва"></div>' +
              "</div>" +
              '<div class="field" style="margin-top:10px"><label>Почему именно вы</label>' +
              '<textarea data-h-motivation rows="4" placeholder="Опыт, ссылки на работы, чем хотите заниматься"></textarea></div>' +
              '<div class="row" style="gap:8px;margin-top:10px"><button class="btn btn--accent btn--sm" type="button" data-h-apply>Подать заявку</button>' +
              '<span class="form__note" data-h-note style="align-self:center"></span></div></div>';
            var noteEl = $("[data-h-note]", host);
            $("[data-h-apply]", host).addEventListener("click", function () {
              noteEl.textContent = "Отправляем…";
              Store.hiringApply({
                position: $("[data-h-position]", host).value,
                region: $("[data-h-region]", host).value,
                motivation: $("[data-h-motivation]", host).value,
              }).then(draw, function (err) { noteEl.textContent = err.message; });
            });
            return;
          }

          var stageName = res.stages[app.stage] || app.stage;
          var head = '<div class="panel" style="padding:22px"><span class="kicker">Команда</span>' +
            '<h3 style="margin:6px 0 8px">' + esc(app.position) + "</h3>" +
            '<p class="form__note">Этап: <b>' + esc(stageName) + "</b>. Тест: " + app.testPercent +
            "% (нужно " + res.passPercent + "%).</p>";
          var body = "";

          if (app.stage === "test" && res.questionsCount) {
            body = '<div data-h-test><p class="form__note">Тест короткий: ' + res.questionsCount +
              " вопросов, по одному ответу. Правильные ответы проверяет сервер.</p>" +
              '<button class="btn btn--accent btn--sm" type="button" data-h-start>Начать тест</button></div>';
          } else if (app.stage === "checklist") {
            body = '<p class="form__note">Тест пройден. Дальше редакция проверит документы и портфолио. ' +
              "Мы напишем на почту, когда решение будет готово.</p>";
          } else if (app.stage === "review") {
            body = '<p class="form__note">Заявка на согласовании у редакции.</p>';
          } else if (app.stage === "approved") {
            body = '<p class="form__note"><b>Вы в команде.</b> Роль «Сотрудник» уже выдана: зайдите заново, чтобы обновились права.</p>';
          } else if (app.stage === "rejected") {
            body = '<p class="form__note">Заявку не приняли' + (app.note ? ": " + esc(app.note) : "") +
              ". Можно подать снова, когда будете готовы.</p>" +
              '<button class="btn btn--ghost btn--sm" type="button" data-h-again>Подать заново</button>';
          }

          var checks = app.checklist.map(function (c) {
            return '<div class="pcard__line"><span>' + esc(c.label) + "</span><small>" +
              (c.ok ? "готово" : "ждёт") + "</small></div>";
          }).join("");

          host.innerHTML = head + body + '<div class="pcard__list" style="margin-top:12px">' + checks + "</div></div>" +
            '<div data-h-test-box style="margin-top:14px"></div>';

          var start = $("[data-h-start]", host);
          if (start) start.addEventListener("click", function () {
            start.disabled = true;
            Store.hiringTest().then(function (t) {
              $("[data-h-test-box]", host).innerHTML = '<div class="panel" style="padding:22px">' +
                t.questions.map(function (q) {
                  return '<div class="field" style="margin-bottom:14px"><b>' + esc(q.text) + "</b>" +
                    q.options.map(function (o, i) {
                      return '<label class="hiring-check"><input type="radio" name="' + esc(q.id) + '" value="' + i + '"> ' + esc(o) + "</label>";
                    }).join("") + "</div>";
                }).join("") +
                '<button class="btn btn--accent btn--sm" type="button" data-h-submit>Отправить ответы</button>' +
                '<span class="form__note" data-h-result style="margin-left:10px"></span></div>';
              $("[data-h-submit]", host).addEventListener("click", function () {
                var answers = {};
                t.questions.forEach(function (q) {
                  var chosen = document.querySelector('input[name="' + q.id + '"]:checked');
                  if (chosen) answers[q.id] = Number(chosen.value);
                });
                $("[data-h-submit]", host).disabled = true;
                Store.hiringTestSubmit(answers).then(function (r) {
                  $("[data-h-result]", host).textContent = r.passed
                    ? "Тест сдан: " + r.right + " из " + r.total + ". Дальше — документы и портфолио."
                    : "Пока " + r.percent + "%. Нужно " + res.passPercent + "%. Можно попробовать снова.";
                  if (r.passed) setTimeout(draw, 1200);
                }, function (err) {
                  $("[data-h-submit]", host).disabled = false;
                  $("[data-h-result]", host).textContent = err.message;
                });
              });
            }, function (err) { start.disabled = false; });
          });

          var again = $("[data-h-again]", host);
          if (again) again.addEventListener("click", function () {
            again.disabled = true;
            Store.hiringApply({ position: app.position, region: app.region, motivation: app.motivation })
              .then(draw, function (err) { again.disabled = false; alert(err.message); });
          });
        }, function () {});
      }
      draw();
    }

    function stepsHtml(steps) {
      if (!steps || !steps.length) return "";
      return steps.map(function (st) {
        return '<div class="diag__row"><span>' + esc(st.name) + '</span><b class="' +
          (st.ok ? "is-good" : "is-bad") + '">' + esc(st.ok ? (st.details || "ок") : (st.details || "ошибка")) +
          "</b></div>";
      }).join("");
    }

    /* ------------------------------------------------------------------
       ПОЧТА: состояние четырёх ящиков и помощник DeepSeek.
       Никаких паролей и адресов серверов на экране: всё уже настроено
       на сервере. Здесь только статус, проверка и переход в письма.
       ------------------------------------------------------------------ */
    function mountMailSettings(host) {
      if (!Store.mailBoxes) return;
      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:8px");
      section.setAttribute("data-mail-admin", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Почта</span>' +
        "<h2>Ящики проекта</h2>" +
        '<p class="sec-head__text">Четыре ящика на домене smenakontenta.ru: редакция, общие вопросы, ' +
        "системные письма и поддержка. Всё подключено на сервере — пароли вводить не нужно. " +
        "Проверьте чтение и отправку, дальше работайте во вкладке писем.</p></div></div>" +
        '<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
        '<button class="btn btn--accent btn--sm" type="button" data-mail-check-all>Проверить все ящики</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-mail-refresh-boxes>Обновить</button>' +
        '<span class="form__note" data-mail-all-note style="align-self:center"></span></div>' +
        '<div class="mail-boxes" data-box-editor></div>' +
        '<div class="panel" style="padding:22px;margin-top:18px" data-ai-panel>' +
        '<span class="kicker">Помощник писем</span>' +
        '<h3 style="margin:6px 0 8px">DeepSeek</h3>' +
        '<p class="form__note">Помощник предлагает текст письма: составить, улучшить, сократить, ' +
        "поправить орфографию, ответить на обращение, перевести. Ничего не отправляет сам — " +
        "только готовит текст. Ключ хранится на сервере и в браузер не возвращается.</p>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">' +
        '<input type="password" data-ai-key placeholder="Ключ DeepSeek, начинается на sk-" ' +
        'autocomplete="new-password" style="flex:1;min-width:240px;max-width:420px">' +
        '<button class="btn btn--accent btn--sm" type="button" data-ai-save>Сохранить ключ</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-ai-test>Проверить связь</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-ai-clear>Удалить ключ</button></div>' +
        '<p class="form__note" data-ai-note style="margin-top:10px"></p></div>';
      host.appendChild(section);

      var editor = $("[data-box-editor]", section);
      var allNote = $("[data-mail-all-note]", section);
      var aiNote = $("[data-ai-note]", section);

      function boxCard(b) {
        var ready = !!b.ready;
        var folders = b.lastTest && b.lastTest.ok ? (b.folders || []).length : 0;
        var readState = b.lastTest
          ? (b.lastTest.ok ? "работает" + (folders ? " · папок " + folders : "") : "ошибка — " + b.lastTest.error)
          : "не проверялось";
        var sendState = b.lastSmtp
          ? (b.lastSmtp.ok ? "проверена" + (b.lastSmtp.host ? " · " + b.lastSmtp.host : "") : "не проходит — " + b.lastSmtp.error)
          : "не проверялась";
        return '<div class="mail-box-card' + (ready ? "" : " mail-box-card--off") + '" data-box-card="' + esc(b.key) + '">' +
          '<div class="mail-box-card__top">' +
          "<div><b>" + esc(b.label || b.key) + "</b>" +
          '<div class="form__note">' + esc(b.address) + (b.note ? " · " + esc(b.note) : "") + "</div></div>" +
          (ready ? '<span class="status status--pub">подключён</span>'
            : '<span class="status status--pending">нужна настройка</span>') +
          "</div>" +
          '<div class="diag" style="margin-top:12px">' +
          '<div class="diag__row"><span>Чтение писем</span><b class="' +
          (b.lastTest ? (b.lastTest.ok ? "is-good" : "is-bad") : "") + '">' + esc(readState) + "</b></div>" +
          '<div class="diag__row"><span>Отправка</span><b class="' +
          (b.lastSmtp ? (b.lastSmtp.ok ? "is-good" : "is-bad") : "") + '">' + esc(sendState) + "</b></div>" +
          "</div>" +
          '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:14px">' +
          '<button class="btn btn--sm" type="button" data-open>Открыть ящик</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-check>Проверить чтение</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-send-test>Проверить отправку</button>' +
          "</div>" +
          '<p class="form__note" data-note style="margin-top:8px"></p>' +
          "</div>";
      }

      function draw(boxes) {
        editor.innerHTML = boxes.map(boxCard).join("");
        bindCards();
      }

      function refresh() {
        return Store.mailBoxes().then(function (res) {
          draw(res.mailboxes || []);
          return res.mailboxes || [];
        }, function (err) {
          editor.innerHTML = '<p class="form__note">' + esc(err.message) + "</p>";
          return [];
        });
      }

      function bindCards() {
        $$("[data-box-card]", editor).forEach(function (card) {
          var key = card.getAttribute("data-box-card");
          var noteEl = $("[data-note]", card);

          $("[data-open]", card).addEventListener("click", function () {
            var client = $("[data-mail-client]");
            var btn = client ? $('[data-box="' + key + '"]', client) : null;
            if (btn) btn.click();
            if (client) client.scrollIntoView({ behavior: "smooth", block: "start" });
          });

          $("[data-check]", card).addEventListener("click", function () {
            var btn = $("[data-check]", card);
            btn.disabled = true;
            noteEl.textContent = "Проверяем вход и папки…";
            Store.mailBoxTest(key).then(function (res) {
              btn.disabled = false;
              noteEl.textContent = res.ok
                ? "Чтение работает. Папок: " + (res.folders || []).length +
                  ((res.created || []).length ? ". Создано: " + res.created.join(", ") : "")
                : (res.error || "Не подключилось.");
              refresh();
            }, function (err) {
              btn.disabled = false;
              noteEl.textContent = (err && err.message) || "Не подключилось.";
            });
          });

          $("[data-send-test]", card).addEventListener("click", function () {
            var btn = $("[data-send-test]", card);
            btn.disabled = true;
            noteEl.textContent = "Отправляем проверочное письмо на адрес ящика…";
            Store.mailBoxSmtpTest(key).then(function (res) {
              btn.disabled = false;
              noteEl.textContent = res.ok
                ? "Письмо ушло через " + (res.host || "SMTP") + " на " + res.to + ". Проверьте ящик."
                : (res.error || "Отправка не получилась.");
              refresh();
            }, function (err) {
              btn.disabled = false;
              noteEl.textContent = (err && err.message) || "Отправка не получилась.";
            });
          });
        });
      }

      var checkAll = $("[data-mail-check-all]", section);
      if (checkAll) checkAll.addEventListener("click", function () {
        checkAll.disabled = true;
        allNote.textContent = "Проверяем четыре ящика…";
        var keys = [];
        $$("[data-box-card]", editor).forEach(function (c) { keys.push(c.getAttribute("data-box-card")); });
        var done = 0, good = 0, bad = [];
        function step(i) {
          if (i >= keys.length) {
            checkAll.disabled = false;
            allNote.textContent = "Готово: работают " + good + " из " + keys.length +
              (bad.length ? ". Не отвечают: " + bad.join(", ") : ".");
            refresh();
            return;
          }
          Store.mailBoxTest(keys[i]).then(function (res) {
            if (res && res.ok) good++; else bad.push(keys[i]);
          }, function () { bad.push(keys[i]); }).then(function () {
            done++;
            allNote.textContent = "Проверено " + done + " из " + keys.length + "…";
            step(i + 1);
          });
        }
        step(0);
      });

      var refreshBtn = $("[data-refresh-boxes]", section);
      if (refreshBtn) refreshBtn.addEventListener("click", refresh);

      refresh();

      /* --- DeepSeek: один ключ, без выбора сервисов --- */
      function fillAi(ai) {
        if (!aiNote) return;
        aiNote.textContent = ai && ai.ready
          ? "Ключ задан. Модель: " + ai.model +
            (ai.lastTest ? " · проверка: " + (ai.lastTest.ok ? "работает" : ai.lastTest.error) : "")
          : "Ключ не задан — помощник в письмах будет выключен.";
      }

      Store.aiStatus().then(function (res) { fillAi(res.ai); }, function () {});

      var saveAi = $("[data-ai-save]", section);
      if (saveAi) saveAi.addEventListener("click", function () {
        var keyEl = $("[data-ai-key]", section);
        var key = (keyEl && keyEl.value || "").trim();
        if (!key) { aiNote.textContent = "Вставьте ключ DeepSeek."; return; }
        saveAi.disabled = true;
        Store.aiSave({ key: key }).then(function (res) {
          saveAi.disabled = false;
          if (keyEl) keyEl.value = "";
          fillAi(res.ai);
          aiNote.textContent = (res.note ? res.note + " " : "") + "Ключ сохранён. Нажмите «Проверить связь».";
        }, function (err) { saveAi.disabled = false; aiNote.textContent = err.message; });
      });

      var testAi = $("[data-ai-test]", section);
      if (testAi) testAi.addEventListener("click", function () {
        testAi.disabled = true;
        aiNote.textContent = "Спрашиваем DeepSeek…";
        Store.aiTest().then(function (res) {
          testAi.disabled = false;
          aiNote.textContent = "DeepSeek ответил: «" + res.answer + "». Модель: " + (res.ai && res.ai.model);
        }, function (err) { testAi.disabled = false; aiNote.textContent = err.message; });
      });

      var clearAi = $("[data-ai-clear]", section);
      if (clearAi) clearAi.addEventListener("click", function () {
        if (!window.confirm("Удалить ключ помощника?")) return;
        Store.aiSave({ clearKey: true }).then(function (res) { fillAi(res.ai); }, function (err) {
          aiNote.textContent = err.message;
        });
      });
    }

    /* --- заявка на пресс-карту: карта выдаётся не сама, а по заявке --------- */
    function mountCardApplication() {
      var old = $("[data-card-app]");
      if (old) old.remove();
      if (!Store.apiCardStatus) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("data-card-app", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Пресс-карта</span>' +
        "<h2>Заявка на карту автора</h2>" +
        '<p class="sec-head__text">Карта не выдаётся автоматически: нужно подать заявку и приложить ' +
        "все свои опубликованные материалы — у каждого есть номер. Решение принимает редакция.</p>" +
        '</div></div><div data-card-body><p class="no-data">Проверяем заявку…</p></div>';
      host.appendChild(section);

      var body = $("[data-card-body]", section);

      Promise.all([Store.apiMyPosts(), Store.apiCardStatus()]).then(function (res) {
        var posts = (res[0] || []).filter(function (p) {
          return p.status === "published";
        });
        var status = res[1] || { requests: [], minPosts: 5 };
        var last = (status.requests || [])[0];
        var need = status.minPosts || 5;

        if (last && last.status === "pending") {
          body.innerHTML =
            '<div class="panel"><h3>Заявка отправлена</h3>' +
            "<p>Материалов в заявке: " + (last.posts || []).length +
            ". Редакция рассмотрит её и выдаст карту с номером — статус появится здесь.</p>" +
            '<p class="form__note">Отправлено: ' + esc(fmtDate(last.createdAt)) + "</p></div>";
          return;
        }
        if (last && last.status === "issued") {
          body.innerHTML =
            '<div class="panel"><h3>Пресс-карта выдана</h3>' +
            '<p class="presscard__code" style="font-size:1.1rem">' + esc(last.number || "") + "</p>" +
            "<p>Номер действует один год. Карту можно показать на месте съёмки или встречи — " +
            "она подтверждает, что вы пишете для «Смены контента».</p>" +
            '<p class="form__note">Материалов в заявке: ' + (last.posts || []).length + "</p>" +
            (last.issuePlace ? '<p class="form__note">Где получить: ' + esc(last.issuePlace) + "</p>" : "") +
            '<p class="form__note"><a class="link-accent" href="/assets/docs/blank-press-karty.pdf" ' +
            'target="_blank" rel="noopener">Бланк карты для печати</a> — если нужно показать карту до того, ' +
            "как она придёт.</p></div>";
          return;
        }

        var head =
          (last && last.status === "rejected"
            ? '<div class="panel" style="margin-bottom:18px"><h3>Заявку вернули на доработку</h3><p>' +
              esc(last.note || "Редакция не указала причину.") + "</p></div>"
            : "") +
          "<p>Опубликовано материалов: <b>" + posts.length + "</b>. Для заявки нужно не меньше " +
          need + ".</p>";

        if (!posts.length) {
          body.innerHTML =
            head +
            '<div class="empty"><h3>Пока нечего приложить</h3>' +
            "<p>Сначала опубликуйте материал: после проверки редакцией у него появится номер, " +
            "и он войдёт в заявку.</p>" +
            '<div class="empty__actions"><a class="btn btn--sm" href="/write">Написать материал</a></div></div>';
          return;
        }

        var rows = posts
          .map(function (p) {
            return (
              '<label class="check-line" style="align-items:flex-start">' +
              '<input type="checkbox" checked value="' + esc(p.id) + '" data-card-post>' +
              "<span><b>№ " + String(p.number || 0).padStart(4, "0") + "</b> · " + esc(p.title) +
              '<small style="display:block;color:var(--muted)">' + esc(regionName(p.region) || "регион не выбран") +
              " · " + esc(fmtDate(p.date)) + "</small></span></label>"
            );
          })
          .join("");

        body.innerHTML =
          head +
          '<div class="panel"><div class="stack">' + rows + "</div>" +
          '<div class="pcard__section" style="margin-top:18px">' +
          '<span class="kicker">Как получить карту</span>' +
          '<p class="form__note" style="margin:0">Карта не приходит сама: её либо передают лично ' +
          "в Москве, либо отправляют почтой России. Выберите способ — редакция согласует с вами " +
          "время и место выдачи.</p>" +
          '<label class="check-line"><input type="radio" name="card-method" value="personal" checked data-card-method>' +
          "<span><b>Лично в Москве</b><small style=\"display:block;color:var(--muted)\">" +
          "Договоримся о встрече, карту передадут из рук в руки. Нужен телефон для связи.</small></span></label>" +
          '<label class="check-line"><input type="radio" name="card-method" value="post" data-card-method>' +
          "<span><b>Почтой России</b><small style=\"display:block;color:var(--muted)\">" +
          "Заказным письмом на ваш адрес. Нужны индекс, город, улица, дом и квартира.</small></span></label>" +
          '<div class="field"><label for="card-fullname">Фамилия и имя полностью</label>' +
          '<input id="card-fullname" type="text" data-card-fullname placeholder="Иванова Анна Сергеевна" ' +
          'autocomplete="name"></div>' +
          '<div class="field"><label for="card-phone">Телефон</label>' +
          '<input id="card-phone" type="tel" data-card-phone placeholder="+7 900 000-00-00" autocomplete="tel"></div>' +
          '<div data-card-post-fields hidden>' +
          '<div class="field"><label for="card-index">Индекс</label>' +
          '<input id="card-index" type="text" inputmode="numeric" maxlength="6" data-card-index placeholder="101000"></div>' +
          '<div class="field"><label for="card-address">Адрес</label>' +
          '<input id="card-address" type="text" data-card-address ' +
          'placeholder="Город, улица, дом, квартира" autocomplete="street-address"></div></div>' +
          '<label class="check-line"><input type="checkbox" data-card-agree>' +
          "<span>Согласен на обработку персональных данных для печати и отправки карты. " +
          'Данные нужны только для этого и удаляются после выдачи.</span></label>' +
          '<div class="row" style="margin-top:6px">' +
          '<button class="btn" type="button" data-card-send>Подать заявку</button>' +
          '<span class="form__note" data-card-note>Материалы уже приложены — редакция проверит их по номерам.</span>' +
          "</div></div></div>";

        var send = $("[data-card-send]", section);
        var note = $("[data-card-note]", section);
        var postFields = $("[data-card-post-fields]", section);
        var nameEl = $("[data-card-fullname]", section);
        var phoneEl = $("[data-card-phone]", section);
        var indexEl = $("[data-card-index]", section);
        var addressEl = $("[data-card-address]", section);
        var agreeEl = $("[data-card-agree]", section);
        var me = Store.currentUser();

        if (me && nameEl && !nameEl.value) nameEl.value = me.name || "";

        function methodNow() {
          var picked = $$("[data-card-method]", section).filter(function (el) {
            return el.checked;
          })[0];
          return picked ? picked.value : "personal";
        }

        function syncMethod() {
          if (postFields) postFields.hidden = methodNow() !== "post";
        }
        $$("[data-card-method]", section).forEach(function (el) {
          el.addEventListener("change", syncMethod);
        });
        syncMethod();

        send.addEventListener("click", function () {
          var chosen = $$("[data-card-post]", section)
            .filter(function (el) {
              return el.checked;
            })
            .map(function (el) {
              return el.value;
            });
          if (chosen.length !== posts.length) {
            note.textContent = "Отметьте все свои материалы: заявка подаётся со всеми публикациями.";
            return;
          }
          if (chosen.length < need) {
            note.textContent = "Нужно не меньше " + need + " опубликованных материалов.";
            return;
          }
          var method = methodNow();
          var fullName = (nameEl && nameEl.value || "").trim();
          var phone = (phoneEl && phoneEl.value || "").trim();
          if (fullName.length < 5) {
            note.textContent = "Напишите фамилию и имя полностью — карта печатается по этим данным.";
            return;
          }
          if (phone.replace(/[^0-9]/g, "").length < 10) {
            note.textContent = "Без телефона не получится согласовать выдачу.";
            return;
          }
          if (!agreeEl || !agreeEl.checked) {
            note.textContent = "Нужно согласие на обработку данных: без него карту нельзя напечатать.";
            return;
          }
          if (method === "post") {
            var idx = (indexEl && indexEl.value || "").replace(/[^0-9]/g, "");
            var addr = (addressEl && addressEl.value || "").trim();
            if (idx.length !== 6) {
              note.textContent = "Индекс — шесть цифр.";
              return;
            }
            if (addr.length < 12) {
              note.textContent = "Напишите адрес полностью: город, улица, дом, квартира.";
              return;
            }
          }
          send.disabled = true;
          note.textContent = "Отправляем…";
          Store.cardApply({
            delivery: method,
            fullName: fullName,
            phone: phone,
            index: method === "post" ? (indexEl.value || "") : "",
            address: method === "post" ? (addressEl.value || "") : "",
            agree: true,
          }).then(function () {
            send.disabled = false;
            window.alert(
              method === "post"
                ? "Заявка отправлена. Карту отправим почтой — редакция напишет вам, когда письмо уйдёт."
                : "Заявка отправлена. Редакция напишет вам, когда и где передать карту в Москве."
            );
            render();
          }, function (err) {
            send.disabled = false;
            note.textContent = (err && err.message) || "Не удалось отправить заявку.";
          });
        });
      });
    }

    render();

    // статусы материалов, которые ушли в общую приёмную на хостинге
    if (Store.syncMine) {
      Store.syncMine()
        .then(function (ok) {
          if (ok) render();
        })
        .catch(function () {
          /* сервер недоступен — показываем локальные данные */
        });
    }
  }

  /* 13. Редактор материала ================================================= */

  function initWrite() {
    var host = $("[data-write]");
    if (!host) return;
    var user = Store ? Store.currentUser() : null;
    if (!user) {
      window.location.replace("/join?next=write#login");
      return;
    }

    var editId = param("id");
    var existing = editId ? Store.getPost(editId) : null;
    if (editId && (!existing || existing.authorId !== user.id)) existing = null;

    var topics = SC.topics || [];
    var formats = (SC.formats || []).map(function (f) { return f.name; });

    var media = {
      gallery: (existing && existing.gallery) || [],
      video: (existing && existing.video) || "",
      audio: (existing && existing.audio) || "",
    };

    host.innerHTML =
      '<section class="section wrap">' +
      '<div class="write-head">' +
      '<div><span class="kicker">' + (existing ? "Редактирование" : "Новый материал") + "</span>" +
      "<h1>" + (existing ? "Изменить материал" : "Написать материал") + "</h1>" +
      '<p class="lead">Пишите так, как рассказали бы другу. Черновик можно сохранить ' +
      "и вернуться к нему позже.</p></div>" +
      '<div class="write-head__side">' +
      '<a class="btn btn--sm btn--ghost" href="/profile">← В кабинет</a>' +
      "</div></div>" +
      '<form class="write-form" data-write-form>' +
      '<div class="write-main">' +
      '<div class="field"><label for="w-title">Заголовок</label>' +
      '<input id="w-title" name="title" type="text" maxlength="140" placeholder="О чём материал — одной фразой" value="' +
      esc(existing ? existing.title : "") + '" required></div>' +
      '<div class="field"><label for="w-excerpt">Короткое описание (лид)</label>' +
      '<textarea id="w-excerpt" name="excerpt" maxlength="260" rows="3" placeholder="2–3 предложения, которые объясняют суть">' +
      esc(existing ? existing.excerpt : "") + "</textarea></div>" +
      '<div class="field"><label for="w-body">Текст материала</label>' +
      '<div class="md-toolbar" data-md-toolbar>' +
      '<button type="button" class="md-btn" data-md="bold" title="Жирный — Ctrl+B"><b>Ж</b></button>' +
      '<button type="button" class="md-btn" data-md="italic" title="Курсив — Ctrl+I"><i>К</i></button>' +
      '<button type="button" class="md-btn" data-md="quote" title="Цитата — строка с отступом">Цитата</button>' +
      '<button type="button" class="md-btn" data-md="h2" title="Подзаголовок">Подзаголовок</button>' +
      '<button type="button" class="md-btn" data-md="list" title="Список">Список</button>' +
      '<button type="button" class="md-btn" data-md="link" title="Ссылка">Ссылка</button>' +
      "</div>" +
      '<textarea id="w-body" name="body" rows="16" placeholder="Пишите обычным текстом. Кнопки выше добавляют жирный, курсив, цитату, подзаголовок.">' +
      esc(existing ? existing.body.join("\n\n") : "") + "</textarea>" +
      '<p class="field__hint">Выделите слово и нажмите <code>Ж</code> или <code>К</code> — получатся жирный и курсив. Абзацы разделяются пустой строкой, цитата и подзаголовок добавляются кнопками.</p></div>' +
      '<div class="write-cover field"><label>Обложка</label>' +
      '<div class="cover-picker">' +
      '<div class="cover-picker__preview" data-cover-preview>' +
      (existing && existing.image
        ? '<img src="' + existing.image + '" alt="">'
        : '<span class="mono">нет изображения</span>') +
      "</div>" +
      '<div class="cover-picker__ui">' +
      '<label class="btn btn--sm btn--ghost" for="w-file">Загрузить файл</label>' +
      '<input id="w-file" type="file" accept="image/*" class="visually-hidden" data-cover-file>' +
      '<input type="text" name="image" placeholder="…или ссылка на изображение" value="' +
      esc(existing ? existing.image : "") + '" data-cover-url>' +
      '<p class="field__hint">Файл сжимается автоматически. Больше 5 МБ не загружайте.</p>' +
      "</div></div>" +
      '<div class="field"><label for="w-alt">Подпись к обложке</label>' +
      '<input id="w-alt" name="imageAlt" type="text" placeholder="Что на фотографии" value="' +
      esc(existing ? existing.imageAlt : "") + '"></div>' +
      "</div>" +
      '<div class="write-media field"><label>Альбом: остальные фотографии</label>' +
      '<div class="media-grid" data-gallery-grid></div>' +
      '<div class="media-actions">' +
      '<label class="btn btn--sm btn--ghost" for="w-gallery">Добавить фото</label>' +
      '<input id="w-gallery" type="file" accept="image/*" multiple class="visually-hidden" data-gallery-file>' +
      "</div>" +
      '<p class="field__hint">Главное фото — обложка выше. Здесь остальные кадры, до 11 штук. ' +
      "Файлы сжимаются и хранятся на платформе: чужие ссылки и видеохостинги не нужны.</p></div>" +
      '<div class="write-media field"><label>Видео</label>' +
      '<div class="media-slot" data-video-slot></div>' +
      '<div class="media-actions">' +
      '<label class="btn btn--sm btn--ghost" for="w-video">Загрузить видео</label>' +
      '<input id="w-video" type="file" accept="video/mp4,video/webm,video/quicktime" class="visually-hidden" data-video-file>' +
      "</div>" +
      '<p class="field__hint">MP4, WebM или MOV, до 6 МБ. Видео живёт на нашей платформе.</p></div>' +
      '<div class="write-media field"><label>Аудио</label>' +
      '<div class="media-slot" data-audio-slot></div>' +
      '<div class="media-actions">' +
      '<label class="btn btn--sm btn--ghost" for="w-audio">Загрузить аудио</label>' +
      '<input id="w-audio" type="file" accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav" class="visually-hidden" data-audio-file>' +
      "</div>" +
      '<p class="field__hint">MP3, M4A, OGG или WAV, до 6 МБ — для подкастов и интервью.</p></div>' +
      '<div class="write-side">' +
      '<div class="write-side__box">' +
      '<div class="field"><label for="w-topic">Тема</label><select id="w-topic" name="topic">' +
      topics.map(function (t) {
        return "<option" + (existing && existing.topic === t ? " selected" : "") + ">" + esc(t) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="field"><label for="w-format">Формат</label><select id="w-format" name="format">' +
      formats.map(function (f) {
        return "<option" + (existing && existing.format === f ? " selected" : "") + ">" + esc(f) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="field"><label for="w-region">Регион</label><select id="w-region" name="region">' +
      '<option value="">Не выбран</option>' +
      regionOptions(existing ? existing.region : user.region) + "</select></div>" +
      "</div>" +
      '<div class="write-side__box">' +
      '<div class="write-status" data-write-status></div>' +
      '<button class="btn btn--block" type="submit" data-action="draft">Сохранить черновик</button>' +
      '<button class="btn btn--accent btn--block" type="submit" data-action="submit">' +
      (Store && Store.can(user, "publish") ? "Опубликовать" : "Отправить на проверку") + "</button>" +
      '<p class="form__note">' +
      (Store && Store.can(user, "publish")
        ? "У вас права редакции: материал выйдет сразу."
        : "Материал проверит редакция — обычно в течение дня. Черновик останется у вас.") +
      "</p>" +
      "</div>" +
      '<div class="write-side__box write-side__box--muted">' +
      "<h3>Перед публикацией</h3><ul class=\"check-list\">" +
      "<li>Проверьте факты и имена</li>" +
      "<li>Спросите героев о согласии</li>" +
      "<li>Укажите автора фотографии</li>" +
      '<li><a href="/assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору (PDF)</a></li>' +
      "</ul></div>" +
      "</div></form></section>";

    var form = $("[data-write-form]", host);
    var statusEl = $("[data-write-status]", host);
    var preview = $("[data-cover-preview]", host);
    var fileInput = $("[data-cover-file]", host);
    var urlInput = $("[data-cover-url]", host);
    var action = "draft";
    var bodyEl = $("#w-body", host);
    var toolbar = $("[data-md-toolbar]", host);

    function wrapSelection(mark, hint) {
      var start = bodyEl.selectionStart;
      var end = bodyEl.selectionEnd;
      var value = bodyEl.value;
      var sel = value.slice(start, end) || hint;
      bodyEl.value = value.slice(0, start) + mark + sel + mark + value.slice(end);
      bodyEl.focus();
      bodyEl.selectionStart = start + mark.length;
      bodyEl.selectionEnd = start + mark.length + sel.length;
    }

    function prefixLine(prefix, hint) {
      var value = bodyEl.value;
      var pos = bodyEl.selectionStart;
      var lineStart = value.lastIndexOf("\n", pos - 1) + 1;
      var lineEnd = value.indexOf("\n", pos);
      if (lineEnd === -1) lineEnd = value.length;
      var line = value.slice(lineStart, lineEnd);
      var already = line.indexOf(prefix) === 0;
      var next = already ? line.slice(prefix.length) : prefix + (line || hint);
      bodyEl.value = value.slice(0, lineStart) + next + value.slice(lineEnd);
      bodyEl.focus();
      bodyEl.selectionStart = bodyEl.selectionEnd = lineStart + next.length;
    }

    if (toolbar) {
      toolbar.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-md]");
        if (!btn) return;
        e.preventDefault();
        var kind = btn.getAttribute("data-md");
        if (kind === "bold") wrapSelection("**", "жирный текст");
        if (kind === "italic") wrapSelection("*", "курсив");
        if (kind === "quote") prefixLine("> ", "текст цитаты");
        if (kind === "h2") prefixLine("## ", "подзаголовок");
        if (kind === "list") prefixLine("- ", "пункт списка");
        if (kind === "link") {
          var start = bodyEl.selectionStart;
          var end = bodyEl.selectionEnd;
          var value = bodyEl.value;
          var text = value.slice(start, end) || "текст ссылки";
          var ins = "[" + text + "](https://)";
          bodyEl.value = value.slice(0, start) + ins + value.slice(end);
          bodyEl.focus();
          var linkStart = start + text.length + 3;
          bodyEl.selectionStart = linkStart;
          bodyEl.selectionEnd = linkStart + 8;
        }
      });
    }

    if (bodyEl) {
      bodyEl.addEventListener("keydown", function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          wrapSelection("**", "жирный текст");
        }
        if (e.key === "i" || e.key === "I") {
          e.preventDefault();
          wrapSelection("*", "курсив");
        }
      });
    }

    function setStatus(text, isError) {
      statusEl.textContent = text || "";
      statusEl.className = "write-status" + (isError ? " is-error" : text ? " is-ok" : "");
    }

    if (urlInput) {
      urlInput.addEventListener("input", function () {
        var v = urlInput.value.trim();
        preview.innerHTML = v ? '<img src="' + esc(v) + '" alt="">' : '<span class="mono">нет изображения</span>';
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        setStatus("Загружаем обложку…");
        Store.uploadMedia(file)
          .catch(function () {
            return new Promise(function (resolve) { resizeImage(file, resolve); });
          })
          .then(function (url) {
            urlInput.value = url;
            preview.innerHTML = '<img src="' + url + '" alt="">';
            setStatus("Обложка загружена");
          }, function (err) {
            setStatus((err && err.message) || "Не удалось загрузить обложку.", true);
          });
      });
    }

    /* альбом, видео и аудио: всё грузим на платформу */
    var galleryGrid = $("[data-gallery-grid]", form);
    var videoSlot = $("[data-video-slot]", form);
    var audioSlot = $("[data-audio-slot]", form);

    function drawGallery() {
      if (!galleryGrid) return;
      galleryGrid.innerHTML = media.gallery.length
        ? media.gallery
            .map(function (url, i) {
              return '<figure class="media-thumb"><img src="' + esc(url) + '" alt="Фото ' + (i + 2) + '">' +
                '<button type="button" data-gallery-remove="' + i + '" aria-label="Убрать фото">×</button></figure>';
            })
            .join("")
        : '<p class="media-empty">Фотографий в альбоме пока нет.</p>';
      $$("[data-gallery-remove]", galleryGrid).forEach(function (b) {
        b.addEventListener("click", function () {
          media.gallery.splice(Number(b.getAttribute("data-gallery-remove")), 1);
          drawGallery();
        });
      });
    }

    function drawSlot(kind, host) {
      if (!host) return;
      var url = media[kind];
      if (!url) {
        host.innerHTML = '<p class="media-empty">Файл не выбран.</p>';
        return;
      }
      host.innerHTML =
        (kind === "video"
          ? '<video controls preload="metadata" src="' + esc(url) + '"></video>'
          : '<audio controls preload="metadata" src="' + esc(url) + '"></audio>') +
        '<button class="btn btn--sm btn--ghost" type="button" data-' + kind + '-remove>Убрать</button>';
      var rm = host.querySelector("[data-" + kind + "-remove]");
      if (rm) {
        rm.addEventListener("click", function () {
          media[kind] = "";
          drawSlot(kind, host);
        });
      }
    }

    drawGallery();
    drawSlot("video", videoSlot);
    drawSlot("audio", audioSlot);

    var galleryInput = $("[data-gallery-file]", form);
    if (galleryInput) {
      galleryInput.addEventListener("change", function () {
        var files = Array.prototype.slice.call(galleryInput.files || []);
        if (!files.length) return;
        var room = 11 - media.gallery.length;
        if (room <= 0) {
          setStatus("В альбоме уже 11 фото — больше не влезет.", true);
          return;
        }
        setStatus("Загружаем фотографии…");
        files.slice(0, room).reduce(function (chain, file) {
          return chain.then(function () {
            return Store.uploadMedia(file).then(function (url) {
              media.gallery.push(url);
              drawGallery();
            });
          });
        }, Promise.resolve()).then(function () {
          galleryInput.value = "";
          setStatus("Фотографии добавлены в альбом");
        }, function (err) {
          galleryInput.value = "";
          setStatus((err && err.message) || "Не удалось загрузить фотографии.", true);
        });
      });
    }

    function bindSingle(kind, selector, slot) {
      var input = $(selector, form);
      if (!input) return;
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) return;
        setStatus("Загружаем файл…");
        Store.uploadMedia(file).then(function (url) {
          media[kind] = url;
          drawSlot(kind, slot);
          input.value = "";
          setStatus(kind === "video" ? "Видео готово" : "Аудио готово");
        }, function (err) {
          input.value = "";
          setStatus((err && err.message) || "Не удалось загрузить файл.", true);
        });
      });
    }

    bindSingle("video", "[data-video-file]", videoSlot);
    bindSingle("audio", "[data-audio-file]", audioSlot);

    $$("[data-action]", form).forEach(function (b) {
      b.addEventListener("click", function () { action = b.getAttribute("data-action"); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = new FormData(form);
      var title = String(d.get("title") || "").trim();
      var excerpt = String(d.get("excerpt") || "").trim();
      var body = String(d.get("body") || "").trim();
      var region = String(d.get("region") || "");

      if (action === "submit") {
        var consentState = Store.consent();
        if (!consentState || consentState.status !== "approved") {
          return setStatus(
            "Публикация закрыта, пока комиссия не проверит согласие на обработку персональных " +
            "данных. Скачать форму и загрузить скан можно в личном кабинете.",
            true
          );
        }
        if (title.length < 8) return setStatus("Заголовок слишком короткий — минимум 8 символов.", true);
        if (excerpt.length < 20) return setStatus("Добавьте короткое описание: 20+ символов.", true);
        if (body.length < 200) return setStatus("Текст пока короткий: нужно хотя бы 200 символов.", true);
        if (!region) return setStatus("Выберите регион — он нужен для карты и ленты.", true);
      } else if (!title) {
        return setStatus("Чтобы сохранить черновик, нужен хотя бы заголовок.", true);
      }

      var res = Store.savePost(
        {
          title: title,
          excerpt: excerpt,
          body: body,
          topic: d.get("topic"),
          format: d.get("format"),
          region: region,
          image: String(d.get("image") || ""),
          imageAlt: String(d.get("imageAlt") || ""),
          gallery: media.gallery.slice(),
          video: media.video,
          audio: media.audio,
          status: "draft",
        },
        existing ? existing.id : null
      );

      if (!res.ok) return setStatus(res.error || "Не удалось сохранить.", true);

      if (action === "submit") {
        var sent = Store.submitPost(res.post.id);
        if (!sent.ok) return setStatus(sent.error || "Не удалось отправить материал.", true);
        setStatus(sent.message || "Готово");
        setTimeout(function () {
          window.location.href = sent.direct
            ? "/article?id=" + encodeURIComponent("u:" + res.post.id)
            : "/profile";
        }, 600);
      } else {
        setStatus("Черновик сохранён");
        if (!existing) {
          existing = res.post;
          window.history.replaceState({}, "", "/write?id=" + res.post.id);
        }
      }
    });
  }

  function resizeImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var max = 1280;
        var w = img.width;
        var h = img.height;
        if (w > max) {
          h = Math.round((h * max) / w);
          w = max;
        }
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        try {
          cb(canvas.toDataURL("image/jpeg", 0.72));
        } catch (err) {
          cb(e.target.result);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* 14. Прочее ============================================================= */

  /* страница основателей: карточки с фото и раскрытием */
  function initFoundersPage() {
    var host = $("[data-founders-page]");
    if (!host) return;
    var list = (SC.founders || []).filter(function (f) {
      return f && String(f.name || "").trim();
    });
    if (!list.length) {
      host.innerHTML = '<div class="no-data">Данные основателей появятся здесь.</div>';
      return;
    }

    function initials(name) {
      return Store ? Store.initials(name) : String(name || "").slice(0, 2).toUpperCase();
    }

    host.innerHTML = list
      .map(function (f, i) {
        var photo = f.photo
          ? '<img class="founder__photo founder__photo--main" src="' + esc(f.photo) + '" alt="' + esc(f.name) + '">'
          : '<span class="founder__photo founder__photo--mono">' + esc(initials(f.name)) + "</span>";
        var alt = f.photoAlt
          ? '<img class="founder__photo founder__photo--alt" src="' + esc(f.photoAlt) + '" alt="">'
          : "";
        var bio = f.bio
          ? esc(f.bio)
          : "Основатель проекта «Смена контента»: молодёжного медиасообщества с редакциями, " +
            "медиашколой и картой регионов.";
        return (
          '<article class="founder founder--page" id="' + esc(f.id || "f" + i) + '">' +
          '<div class="founder__photos">' + photo + alt + "</div>" +
          '<div class="founder__body">' +
          "<h2>" + esc(f.name) + "</h2>" +
          '<p class="founder__role">' + esc(f.role || "Основатель") +
          (f.city ? " · " + esc(f.city) : "") + "</p>" +
          '<p class="founder__bio">' + bio + "</p>" +
          '<dl class="founder__facts">' +
          (f.city ? "<div><dt>Город</dt><dd>" + esc(f.city) + "</dd></div>" : "") +
          (f.role ? "<div><dt>Роль</dt><dd>" + esc(f.role) + "</dd></div>" : "") +
          (f.since ? "<div><dt>На проекте с</dt><dd>" + esc(f.since) + "</dd></div>" : "") +
          "</dl>" +
          "</div></article>"
        );
      })
      .join("");
  }

  /* партнёры: блок появляется, только когда партнёр добавлен */
  function initPartners() {
    var host = $("[data-partners]");
    var section = $("[data-partners-section]");
    if (!host || !section) return;
    var list = (SC.partners || []).filter(function (p) {
      return p && String(p.name || "").trim();
    });
    if (!list.length) return;
    section.hidden = false;
    host.innerHTML = list
      .map(function (p) {
        var inner =
          (p.logo
            ? '<img class="partner__logo" src="' + esc(p.logo) + '" alt="' + esc(p.name) + '" loading="lazy">'
            : p.mark
              ? '<div class="partner__mark" aria-hidden="true">' + esc(p.mark) + "</div>"
              : "") +
          '<div class="partner__body">' + (p.mark ? "" : "<h3>" + esc(p.name) + "</h3>") +
          (p.about ? "<p>" + esc(p.about) + "</p>" : "") +
          (p.url ? '<span class="partner__link">' + esc(p.url.replace(/^https?:\/\//, "")) + "</span>" : "") +
          "</div>";
        return p.url
          ? '<a class="partner" href="' + esc(p.url) + '" target="_blank" rel="noopener" title="' +
              esc(p.name) + '">' + inner + "</a>"
          : '<div class="partner" title="' + esc(p.name) + '">' + inner + "</div>";
      })
      .join("");
  }

  /* основатели на странице «О проекте»: две фотографии и раскрытие */
  function initFounders() {
    var host = $("[data-founders]");
    var section = $("[data-founders-section]");
    if (!host || !section) return;

    var list = (SC.founders || []).filter(function (f) {
      return f && String(f.name || "").trim();
    });
    if (!list.length) return;
    section.hidden = false;

    host.innerHTML = list
      .map(function (f, i) {
        var main = f.photo
          ? '<img class="founder__photo founder__photo--main" src="' + esc(f.photo) + '" alt="' + esc(f.name) + '" loading="lazy">'
          : '<span class="founder__photo founder__photo--mono">' +
            esc(Store.initials(f.name)) + "</span>";
        var alt = f.photoAlt
          ? '<img class="founder__photo founder__photo--alt" src="' + esc(f.photoAlt) + '" alt="" loading="lazy">'
          : "";
        return (
          '<article class="founder" data-founder="' + i + '" tabindex="0" role="button" aria-expanded="false">' +
          '<div class="founder__photos">' + main + alt + "</div>" +
          '<div class="founder__body"><h3>' + esc(f.name) + "</h3>" +
          '<p class="founder__role">' + esc(f.role || "Основатель") +
          (f.city ? " · " + esc(f.city) : "") + "</p></div>" +
          '<div class="founder__more"><p>' + (esc(f.bio) || "Основатель проекта «Смена контента».") +
          '</p><a class="founder__link" href="/founders#' + esc(f.id || "") + '">Подробнее →</a></div>' +
          "</article>"
        );
      })
      .join("");

    $$("[data-founder]", host).forEach(function (card) {
      function toggle() {
        var open = card.classList.toggle("is-open");
        card.setAttribute("aria-expanded", open ? "true" : "false");
      }
      card.addEventListener("click", toggle);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  function initPageBits() {
    $$("[data-brand-name]").forEach(function (el) { el.textContent = SC.brand.name; });
    $$("[data-brand-email]").forEach(function (el) {
      var mail = contactEmail();
      if (mail) {
        el.textContent = mail;
        el.setAttribute("href", "mailto:" + mail);
      } else {
        el.textContent = "почта пока не заведена";
        el.removeAttribute("href");
        el.classList.add("is-pending");
      }
    });
    $$("[data-total-articles]").forEach(function (el) {
      el.textContent = allArticles().length;
    });
    $$("[data-total-regions]").forEach(function (el) {
      el.textContent = (MAP.regions || []).length;
    });
    $$("[data-year]").forEach(function (el) { el.textContent = SC.brand.year; });

    // ссылки на редактор для незарегистрированных ведут на регистрацию
    if (Store && !Store.currentUser()) {
      $$('a[href="/write"]').forEach(function (a) {
        if (!a.hasAttribute("data-keep")) {
          a.setAttribute("href", "/join?next=write");
        }
      });
    }
  }

  function boot() {
    initTheme();
    initAccent();
    initOnboard();
    initFounders();
    initPartners();
    mountHeader();
    mountFooter();
    mountSearch();
    initPageBits();
    applySiteState();

    var page = document.body.getAttribute("data-page");
    if (page === "home") initHome();
    if (page === "news") initNews();
    if (page === "article") initArticle();
    if (page === "region") initRegion();
    if (page === "auth") initAuth();
    if (page === "profile") initProfile();
    if (page === "write") initWrite();
    if (page === "docs") initDocs();
    if (page === "admin") initAdmin();
    if (page === "founders") {
      if (Store && Store.founders) {
        Store.founders().then(function (list) {
          if (list && list.length) SC.founders = list;
          initFoundersPage();
        }, initFoundersPage);
      } else {
        initFoundersPage();
      }
    }
    if (page === "support") initSupport();

    initAnimations();
    initHeroParallax();
  }

  /* страницы ждут короткой проверки сервера: так материалы, одобренные
     редакцией, появляются в ленте сразу при загрузке страницы */
  var started = false;
  function start() {
    if (started) return;
    started = true;
    boot();
  }

  function afterServer() {
    try {
      if (Store && Store.ready && typeof Store.ready.then === "function") {
        Store.ready.then(start, start);
        setTimeout(start, 3000);
        return;
      }
    } catch (e) {
      /* пусто */
    }
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", afterServer);
  } else {
    afterServer();
  }
})();
