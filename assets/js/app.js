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
      if (!btn) return;
      e.preventDefault();
      toggleTheme();
    });
  }

  var LOGO =
    '<img class="logo__img" src="/assets/img/logo.png" alt="Смена контента" ' +
    'width="199" height="36" decoding="async">';

  /* 2. Шапка и подвал ====================================================== */

  var NAV = [
    { href: "/news", label: "Материалы", key: "news" },
    { href: "/#map", label: "Регионы", key: "region" },
    { href: "/media-school", label: "Медиашкола", key: "school" },
    { href: "/docs", label: "Документы", key: "docs" },
    { href: "/about", label: "О проекте", key: "about" },
    { href: "/founders", label: "Основатели", key: "founders" },
    { href: "/partners", label: "Партнёрам", key: "partners" },
  ];

  function mountHeader() {
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
        '<span class="user-chip__ava">' + esc(Store.initials(user.name)) + "</span>" +
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
      "</div></div></div>" +
      '<div class="wrap"><div class="masthead">' +
      '<a class="logo" href="/" aria-label="Смена контента — на главную">' +
      LOGO + "</a>" +
      '<nav class="nav" aria-label="Основная навигация">' + navHtml + "</nav>" +
      '<div class="header-actions">' +
      '<button class="icon-btn theme-toggle" type="button" data-theme-toggle aria-label="Светлая тема">' +
      ICONS.sun + "</button>" +
      '<button class="icon-btn" type="button" data-search-open aria-label="Поиск по сайту">' +
      ICONS.search + "</button>" +
      accountHtml +
      '<button class="icon-btn burger" type="button" data-menu-open aria-label="Открыть меню">' +
      ICONS.menu + "</button>" +
      "</div></div></div>";

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
      (contactEmail()
        ? '<li><a href="mailto:' + esc(contactEmail()) + '">' + esc(contactEmail()) + "</a></li>"
        : '<li><span class="footer-pending">Почта проекта: пока не заведена</span></li>') +
      "</ul></div></div>" +
      '<div class="footer-bottom">' +
      '<span>© ' + (SC.brand.year || new Date().getFullYear()) + " «Смена контента»</span>" +
      '<span class="footer-note">Медиа о молодёжи и регионах России. Участие авторов бесплатное.</span>' +
      '<span><a href="/assets/docs/politika-konfidencialnosti.pdf" target="_blank" rel="noopener">Конфиденциальность</a>' +
      ' · <a href="/assets/docs/polzovatelskoe-soglashenie.pdf" target="_blank" rel="noopener">Соглашение</a>' +
      ' · <a href="/docs">Документы</a></span>' +
      "</div></div>";
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
      regions.map(function (r, i) {
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
    var user = Store ? Store.currentUser() : null;
    if (!user) {
      window.location.replace("/join?next=admin");
      return;
    }

    var settings = Store.getSettings();
    var isOwner = Store.can(user, "manage") || user.number === 101;

    if (!isOwner) {
      host.innerHTML =
        '<section class="section wrap"><div class="panel">' +
        "<h3>Панель доступна редакции</h3>" +
        "<p>Настройки проекта меняет первый зарегистрированный аккаунт или аккаунт с ролью " +
        "«Редактор». Вы вошли как «" + esc(user.name) + "» — " + esc(user.role) + ".</p>" +
        '<div class="row"><a class="btn btn--sm" href="/profile">В кабинет</a>' +
        '<a class="btn btn--sm btn--ghost" href="/docs">Документы</a></div></div></section>';
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
          return '<option' + (r === (a.access || "Автор") ? " selected" : "") + ">" + esc(r) + "</option>";
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
        '<div class="page-hero__aside"><p class="lead">Здесь заполняются данные организации и ' +
        "правила выдачи пресс-карт. Всё, что вы сохраните, сразу появляется на сайте: в пресс-карте, " +
        "подвале и документах.</p>" +
        '<p class="admin-note">Материалы авторов приходят на сервер проекта — их видно ' +
        "с любого устройства в блоке «Материалы авторов» ниже. Настройки вроде названия " +
        "и правил пресс-карты пока хранятся в этом браузере.</p></div></div></section>" +

        '<section class="section wrap"><div class="admin-grid">' +
        '<form class="admin-card" data-admin-org><h2>Организация</h2>' +
        '<p class="admin-card__hint">Эти данные печатаются на пресс-карте и указываются в документах.</p>' +
        adminField("Название проекта", "org-name", settings.org.name, "Смена контента") +
        adminField("Кем выдана пресс-карта", "org-center", settings.org.center,
                   "Редакция «Смена контента»") +
        adminField("Руководитель", "org-head", settings.org.head, "Имя и фамилия") +
        adminField("Почта для связи", "org-email", settings.org.email, "name@example.ru", "email") +
        adminField("Телефон", "org-phone", settings.org.phone, "+7 900 000-00-00", "tel") +
        adminField("Город", "org-city", settings.org.city, "Москва") +
        '<div class="row"><button class="btn" type="submit">Сохранить</button>' +
        '<span class="form__note" data-org-status></span></div></form>' +

        '<form class="admin-card" data-admin-founders><h2>Учредители</h2>' +
        '<p class="admin-card__hint">Проект ведут два человека — их данные указываются ' +
        'в политике конфиденциальности и соглашении как оператора.</p>' +
        foundersFields(settings.org.founders) +
        '<div class="row"><button class="btn" type="submit">Сохранить</button>' +
        '<span class="form__note" data-founders-status></span></div></form>' +

        '<form class="admin-card" data-admin-card><h2>Пресс-карта</h2>' +
        '<p class="admin-card__hint">Правила, по которым автор получает карту с номером.</p>' +
        adminField("Серия", "card-prefix", settings.card.prefix, "СК") +
        adminField("Год", "card-year", settings.card.year, "2026", "number") +
        adminField("Публикаций до личной карты", "card-min", settings.card.minPosts, "5", "number") +
        adminField("Публикаций до карты редакции", "card-team-min", settings.card.teamMinPosts, "20", "number") +
        adminField("Срок действия, месяцев", "card-valid", settings.card.validMonths, "12", "number") +
        '<div class="row"><button class="btn" type="submit">Сохранить</button>' +
        '<span class="form__note" data-card-status></span></div></form>' +
        "</div></section>" +

        '<section class="section wrap" style="padding-top:0">' +
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Проверка</span>' +
        "<h2>Материалы на проверке</h2></div>" +
        '<span class="sec-link">' + pending.length + " в очереди</span></div>" +
        (pending.length
          ? pending.map(pendingRow).join("")
          : '<div class="empty"><h3>Очередь пуста</h3><p>Когда автор отправит материал на проверку, ' +
            "он появится здесь: можно прочитать, опубликовать или вернуть с замечанием.</p></div>") +
        "</section>" +

        '<section class="section wrap" style="padding-top:0">' +
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Редакции</span>' +
        "<h2>Команды проекта</h2></div></div>" +
        (teams.length
          ? '<div class="admin-table">' + teams.map(function (t) {
              return '<div class="admin-table__row">' +
                "<div><b>" + esc(t.name) + "</b><small>код " + esc(t.code) + "</small></div>" +
                "<div>" + esc(regionName(t.region) || "—") + "</div>" +
                "<div>" + t.members + " чел.</div>" +
                "<div>" + t.published + " публ.</div>" +
                '<div><span class="status ' + (t.published >= settings.card.teamMinPosts ? "status--pub" : "status--draft") + '">' +
                (t.published >= settings.card.teamMinPosts ? "карта редакции" : "до карты " + (settings.card.teamMinPosts - t.published)) +
                "</span></div></div>";
            }).join("") + "</div>"
          : '<div class="empty"><h3>Команд пока нет</h3><p>Автор может создать редакцию в личном кабинете.</p></div>') +
        "</section>" +

        '<section class="section wrap" style="padding-top:0">' +
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Авторы</span>' +
        "<h2>Кто уже на проекте</h2></div>" +
        '<div class="row"><button class="btn btn--sm btn--ghost" type="button" data-export>' +
        "Скачать данные</button></div></div>" +
        (authors.length
          ? '<div class="admin-table">' + authors.map(authorRow).join("") + "</div>"
          : '<div class="empty"><h3>Пока никто не зарегистрировался</h3>' +
            "<p>Аккаунты появятся здесь после регистрации авторов.</p></div>") +
        "</section>";

      bind();
      mountServerQueue(host);
      mountCardQueue(host);
    }

    /* --- заявки на пресс-карту ---------------------------------------------- */
    function mountCardQueue(host) {
      var old = $("[data-card-queue]");
      if (old) old.remove();
      if (!Store.apiCardQueue) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-card-queue", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Пресс-карты</span>' +
        "<h2>Заявки на карту автора</h2>" +
        '<p class="sec-head__text">Автор прикладывает свои опубликованные материалы по номерам. ' +
        "Одобрение выдаёт карту с номером, автор увидит её в кабинете.</p></div></div>" +
        '<div class="panel"><div class="row" style="align-items:flex-end">' +
        '<div class="field" style="margin:0;flex:1;min-width:220px">' +
        '<label for="card-pass">Пароль редакции</label>' +
        '<input id="card-pass" type="password" placeholder="Тот же пароль, что и для материалов" value="' +
        esc(savedPass()) + '"></div>' +
        '<button class="btn btn--sm" type="button" data-card-load>Показать заявки</button></div>' +
        '<p class="form__note" data-card-status></p></div><div data-card-list></div>';
      host.appendChild(section);

      var passEl = $("#card-pass", section);
      var statusEl = $("[data-card-status]", section);
      var listEl = $("[data-card-list]", section);

      function row(card) {
        var posts = (card.posts || [])
          .map(function (p) {
            return "№ " + String(p.number || 0).padStart(4, "0") + " " + p.title;
          })
          .join(" · ");
        var badge =
          card.status === "pending"
            ? '<span class="status status--pending">ждёт решения</span>'
            : card.status === "issued"
              ? '<span class="status status--pub">выдана ' + esc(card.number || "") + "</span>"
              : '<span class="status status--rejected">возвращена</span>';
        return (
          '<div class="admin-review"><div class="admin-review__top"><b>' + esc(card.authorName || "Автор") +
          "</b>" + badge + "</div>" +
          '<div class="admin-review__meta">Материалов в заявке: ' + (card.posts || []).length +
          " · " + esc(fmtDate(card.createdAt)) + "</div>" +
          '<p class="admin-review__excerpt">' + esc(posts) + "</p>" +
          (card.status === "pending"
            ? '<div class="admin-review__actions">' +
              '<input class="admin-review__note" type="text" placeholder="Комментарий автору" data-card-note="' + esc(card.id) + '">' +
              '<button class="btn btn--sm" type="button" data-card-approve="' + esc(card.id) + '">Выдать карту</button>' +
              '<button class="btn btn--sm btn--ghost" type="button" data-card-reject="' + esc(card.id) + '">Вернуть</button>' +
              "</div>"
            : "") +
          "</div>"
        );
      }

      function load() {
        var pass = passEl.value.trim();
        if (!pass) {
          statusEl.textContent = "Введите пароль редакции.";
          return;
        }
        statusEl.textContent = "Загружаем…";
        Store.apiCardQueue(pass).then(function (res) {
          if (!res || !res.ok) {
            statusEl.textContent = (res && res.error) || "Сервер не ответил.";
            return;
          }
          var list = res.requests || [];
          var waiting = list.filter(function (c) {
            return c.status === "pending";
          }).length;
          statusEl.textContent = "Заявок всего: " + list.length + ", ждут решения: " + waiting + ".";
          listEl.innerHTML = list.length
            ? list.map(row).join("")
            : '<div class="empty"><h3>Заявок пока нет</h3><p>Автор подаёт заявку в личном кабинете, ' +
              "когда у него появятся опубликованные материалы.</p></div>";
          $$("[data-card-approve], [data-card-reject]", listEl).forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = btn.getAttribute("data-card-approve") || btn.getAttribute("data-card-reject");
              var approve = btn.hasAttribute("data-card-approve");
              var noteEl = $('[data-card-note="' + id + '"]', listEl);
              btn.disabled = true;
              Store.apiCardReview(pass, id, approve ? "approve" : "reject", noteEl ? noteEl.value.trim() : "")
                .then(function (r) {
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

      $("[data-card-load]", section).addEventListener("click", load);
      if (savedPass()) load();
    }

    /* --- очередь материалов, присланных авторами с их устройств ------------- */
    var SERVER_PASS = "smena_editor_pass";
    var serverState = { pending: [], total: 0, published: 0, status: "", busy: false, loaded: false };

    function savedPass() {
      try {
        return window.localStorage.getItem(SERVER_PASS) || "";
      } catch (e) {
        return "";
      }
    }

    function rememberPass(value) {
      try {
        window.localStorage.setItem(SERVER_PASS, value);
      } catch (e) {
        /* пусто */
      }
    }

    function serverRow(p) {
      return (
        '<div class="admin-review" data-server-row="' + esc(p.id) + '">' +
        '<div class="admin-review__top"><b>' + esc(p.title) + "</b>" +
        '<span class="status status--pending">ждёт решения</span></div>' +
        '<div class="admin-review__meta">' + esc(p.authorName) +
        (p.authorRole ? " · " + esc(p.authorRole) : "") +
        " · " + esc(regionName(p.region) || "регион не выбран") +
        " · " + esc(fmtDate(p.submittedAt || p.date)) + "</div>" +
        '<p class="admin-review__excerpt">' + esc(p.excerpt || "") + "</p>" +
        '<details class="admin-review__full"><summary>Показать текст</summary>' +
        "<div>" + esc(String(p.body || "").slice(0, 6000)) + "</div></details>" +
        '<div class="admin-review__actions">' +
        '<input class="admin-review__note" type="text" placeholder="Замечание автору (если правки)" data-server-note="' + esc(p.id) + '">' +
        '<button class="btn btn--sm" type="button" data-server-approve="' + esc(p.id) + '">Опубликовать</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-server-reject="' + esc(p.id) + '">Вернуть на правки</button>' +
        "</div></div>"
      );
    }

    function mountServerQueue(host) {
      var wrap = document.createElement("section");
      wrap.className = "section wrap";
      wrap.setAttribute("style", "padding-top:0");
      wrap.innerHTML =
        '<div class="sec-head"><div class="sec-head__left">' +
        '<span class="kicker">С сайта</span><h2>Материалы авторов</h2>' +
        '<p class="sec-head__text">Сюда попадают материалы, отправленные с любых устройств — ' +
        "через общую приёмную на хостинге. Пароль редакции задаётся в файле api/index.php " +
        "и нужен, чтобы одобрять чужие тексты.</p></div></div>" +
        '<div class="panel"><div class="row" style="align-items:flex-end">' +
        '<div class="field" style="margin:0;flex:1;min-width:220px">' +
        '<label for="server-pass">Пароль редакции</label>' +
        '<input id="server-pass" type="password" autocomplete="current-password" placeholder="Пароль доступа к очереди" value="' +
        esc(savedPass()) + '"></div>' +
        '<button class="btn btn--sm" type="button" data-server-load>Показать очередь</button></div>' +
        '<p class="form__note" data-server-status></p></div>' +
        '<div data-server-list></div>' +
        '<details class="panel" style="margin-top:16px"><summary>Сменить пароль редакции</summary>' +
        '<div class="row" style="margin-top:12px;align-items:flex-end">' +
        '<div class="field" style="margin:0"><label for="server-pass-old">Текущий пароль</label>' +
        '<input id="server-pass-old" type="password" autocomplete="current-password"></div>' +
        '<div class="field" style="margin:0"><label for="server-pass-new">Новый пароль</label>' +
        '<input id="server-pass-new" type="password" autocomplete="new-password" placeholder="Не короче 10 символов"></div>' +
        '<button class="btn btn--sm" type="button" data-server-setpass>Сменить</button></div>' +
        '<p class="form__note">Пароль по умолчанию знает только владелец проекта. Смените его ' +
        "до того, как о панели узнают посторонние.</p></details>";
      host.appendChild(wrap);

      var passEl = $("#server-pass", wrap);
      var statusEl = $("[data-server-status]", wrap);
      var listEl = $("[data-server-list]", wrap);

      function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
      }

      function paint() {
        if (serverState.busy) {
          setStatus("Загружаем…");
          return;
        }
        if (serverState.status) setStatus(serverState.status);
        if (!serverState.loaded) return;
        listEl.innerHTML = serverState.pending.length
          ? serverState.pending.map(serverRow).join("")
          : '<div class="empty"><h3>Очередь пуста</h3><p>Все присланные материалы уже разобраны. ' +
            "Опубликовано всего: " + serverState.published + " из " + serverState.total + ".</p></div>";
      }

      function load() {
        var pass = passEl ? passEl.value.trim() : "";
        if (!pass) {
          setStatus("Введите пароль редакции — он задаётся в файле api/index.php.");
          return;
        }
        rememberPass(pass);
        serverState.busy = true;
        serverState.status = "";
        paint();
        Store.apiQueue(pass)
          .then(function (res) {
            serverState.busy = false;
            if (!res || !res.ok) {
              serverState.loaded = false;
              serverState.status = (res && res.error) || "Сервер не ответил. Проверьте, что PHP работает.";
              paint();
              return;
            }
            serverState.loaded = true;
            serverState.pending = res.pending || [];
            serverState.total = res.total || 0;
            serverState.published = res.published || 0;
            serverState.status = "В очереди: " + serverState.pending.length + ". Опубликовано: " +
              serverState.published + " из " + serverState.total + ".";
            paint();
          })
          .catch(function () {
            serverState.busy = false;
            serverState.loaded = false;
            serverState.status = "Нет связи с сервером.";
            paint();
          });
      }

      $("[data-server-load]", wrap).addEventListener("click", load);

      var setBtn = $("[data-server-setpass]", wrap);
      if (setBtn)
        setBtn.addEventListener("click", function () {
          var oldPass = $("#server-pass-old", wrap).value.trim();
          var newPass = $("#server-pass-new", wrap).value.trim();
          if (newPass.length < 10) {
            setStatus("Новый пароль должен быть не короче десяти символов.");
            return;
          }
          setBtn.disabled = true;
          Store.apiSetPass(oldPass, newPass).then(function (res) {
            setBtn.disabled = false;
            if (!res || !res.ok) {
              setStatus((res && res.error) || "Не удалось сменить пароль.");
              return;
            }
            if (passEl) passEl.value = newPass;
            rememberPass(newPass);
            setStatus("Пароль редакции изменён.");
          });
        });

      listEl.addEventListener("click", function (e) {
        var approve = e.target.closest("[data-server-approve]");
        var reject = e.target.closest("[data-server-reject]");
        var button = approve || reject;
        if (!button) return;
        var id = button.getAttribute(approve ? "data-server-approve" : "data-server-reject");
        var noteEl = $('[data-server-note="' + id + '"]', listEl);
        var note = noteEl ? noteEl.value.trim() : "";
        button.disabled = true;
        setStatus("Отправляем решение…");
        Store.apiReview(passEl.value.trim(), id, approve ? "approve" : "reject", note).then(function (res) {
          button.disabled = false;
          if (!res || !res.ok) {
            setStatus((res && res.error) || "Не удалось сохранить решение.");
            return;
          }
          serverState.status = approve
            ? "Материал опубликован — он уже в ленте и на странице региона."
            : "Материал возвращён автору с замечанием.";
          load();
        });
      });

      // если пароль уже сохранён, очередь подтягивается сама
      if (savedPass()) load();
    }

    function bind() {
      var org = $("[data-admin-org]", host);
      var card = $("[data-admin-card]", host);
      if (org)
        org.addEventListener("submit", function (e) {
          e.preventDefault();
          Store.saveSettings({
            org: {
              name: val("org-name"),
              center: val("org-center"),
              head: val("org-head"),
              email: val("org-email"),
              phone: val("org-phone"),
              city: val("org-city"),
            },
          });
          var st = $("[data-org-status]", host);
          if (st) st.textContent = "Сохранено";
        });
      if (card)
        card.addEventListener("submit", function (e) {
          e.preventDefault();
          Store.saveSettings({
            card: {
              prefix: val("card-prefix") || "СК",
              year: Number(val("card-year")) || new Date().getFullYear(),
              minPosts: Math.max(1, Number(val("card-min")) || 5),
              teamMinPosts: Math.max(1, Number(val("card-team-min")) || 20),
              validMonths: Math.max(1, Number(val("card-valid")) || 12),
            },
          });
          render();
        });
      var founders = $("[data-admin-founders]", host);
      if (founders)
        founders.addEventListener("submit", function (e) {
          e.preventDefault();
          Store.saveSettings({
            org: {
              founders: [1, 2].map(function (n) {
                return {
                  name: val("f" + n + "-name"),
                  inn: val("f" + n + "-inn"),
                  role: val("f" + n + "-role") || "Директор",
                };
              }),
            },
          });
          var st = $("[data-founders-status]", host);
          if (st) st.textContent = "Сохранено";
        });

      $$("[data-approve]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          Store.reviewPost(b.getAttribute("data-approve"), "approve", "");
          render();
        });
      });

      $$("[data-reject]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-reject");
          var noteEl = $('[data-note="' + id + '"]', host);
          var note = noteEl ? noteEl.value.trim() : "";
          if (!note) {
            window.alert("Напишите автору, что нужно поправить — это поле рядом.");
            if (noteEl) noteEl.focus();
            return;
          }
          Store.reviewPost(id, "reject", note);
          render();
        });
      });

      $$("[data-access]", host).forEach(function (sel) {
        sel.addEventListener("change", function () {
          var data = JSON.parse(window.localStorage.getItem("smena_content_v1") || "{}");
          data.users = (data.users || []).map(function (u) {
            return u.id === sel.getAttribute("data-access")
              ? Object.assign({}, u, { access: sel.value })
              : u;
          });
          window.localStorage.setItem("smena_content_v1", JSON.stringify(data));
          render();
        });
      });

      var exp = $("[data-export]", host);
      if (exp)
        exp.addEventListener("click", function () {
          var blob = new Blob([Store.exportAll()], { type: "application/json" });
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "smena-kontenta-" + new Date().toISOString().slice(0, 10) + ".json";
          a.click();
          setTimeout(function () {
            URL.revokeObjectURL(a.href);
          }, 1000);
        });
    }

    render();
  }

  /* 7. Главная ============================================================= */

  function contactEmail() {
    var s = Store ? Store.getSettings() : null;
    return (s && s.org.email) || SC.brand.email || "";
  }

  function pressCardBlock() {
    var all = allArticles();
    var settings = Store ? Store.getSettings() : { card: { prefix: "СК", year: 2026, minPosts: 5 }, org: {} };
    var stats = [
      { n: MAP.regions.length, l: "регионов на карте" },
      { n: all.length, l: "материалов в ленте" },
      { n: (SC.docs || []).length, l: "документов проекта" },
      { n: settings.card.minPosts, l: "публикаций до пресс-карты" },
    ];
    return (
      '<section class="section--tight wrap presscard-wrap">' +
      '<div class="presscard" data-reveal>' +
      '<div class="presscard__main">' +
      '<div class="presscard__top">' +
      '<span class="presscard__label">Пресс-карта проекта</span>' +
      '<span class="presscard__code">' + esc(settings.card.prefix) + "-" +
      esc(String(settings.card.year)) + "-000</span>" +
      "</div>" +
      '<img class="presscard__logo" src="/assets/img/logo.png" alt="Смена контента" ' +
      'width="166" height="30" loading="lazy">' +
      '<div class="presscard__desc">Молодёжное медиа · Медиашкола · Сообщество авторов. ' +
      "Рассказываем истории из регионов России и учим их делать.</div>" +
      '<div class="presscard__row">' +
      "<span><b>Основан</b>" + esc(String(SC.brand.year || 2026)) + "</span>" +
      "<span><b>Выдаёт</b>" + esc(settings.org.center || settings.org.name) + "</span>" +
      "<span><b>Пресс-карта автора</b>после " + esc(String(settings.card.minPosts)) +
      " публикаций</span>" +
      "<span><b>Регион запуска</b>" + esc(SC.brand.launchRegionName || settings.org.city || "—") + "</span>" +
      "</div>" +
      "</div>" +
      '<div class="presscard__side">' +
      '<div class="presscard__stats">' +
      stats.map(function (st) {
        return '<div><b data-count="' + st.n + '">' + st.n + "</b><span>" + st.l + "</span></div>";
      }).join("") +
      "</div>" +
      '<div class="presscard__actions">' +
      '<a class="btn btn--sm" href="/assets/docs/press-kit.pdf" target="_blank" rel="noopener">Пресс-кит (PDF)</a>' +
      '<a class="btn btn--sm btn--ghost" href="/docs">Документы</a>' +
      "</div>" +
      '<div class="presscard__stamp" aria-hidden="true">смена<br>контента<br><span>' +
      esc(String(SC.brand.year || 2026)) + "</span></div>" +
      "</div></div></section>"
    );
  }

  function initHome() {
    var all = sortedArticles();
    var lead = all[0];
    var heroHost = $("[data-hero]");

    if (heroHost && lead) {
      var liveItems = all.slice(1, 5);
      var sideCard = all.filter(function (a) { return a.image && a.id !== lead.id; })[0] || all[1];

      heroHost.innerHTML =
        '<div class="wrap"><div class="hero__grid">' +
        '<div class="hero__lead-col">' +
        '<a class="hero__lead" href="' + articleUrl(lead.id) + '">' +
        '<div class="hero__media"><img src="' + thumb(lead.image || "") + '" alt="' +
        esc(lead.imageAlt || lead.title) + '"><span class="hero__flag">Главное</span></div>' +
        '<div class="hero__text">' +
        '<span class="kicker">' + esc(lead.format) + " · " + esc(regionName(lead.region)) + "</span>" +
        '<h1 class="hero__title">' + esc(lead.title) + "</h1>" +
        '<p class="hero__excerpt">' + esc(lead.excerpt) + "</p>" +
        '<div class="meta"><span>' + esc(authorOf(lead).name) + "</span>" +
        '<span class="meta__dot"></span><span>' + fmtDate(lead.date) + "</span>" +
        '<span class="meta__dot"></span><span>' + (lead.read || 4) + " мин чтения</span></div>" +
        "</div></a></div>" +
        '<aside class="hero__side">' +
        '<div class="side-head"><h2>Лента редакции</h2><span class="live-dot">свежее</span></div>' +
        '<ul class="live-list">' +
        liveItems.map(function (a) {
          return '<li><a href="' + articleUrl(a.id) + '"><time>' + fmtWhen(a.date) +
            "</time><h3>" + esc(a.title) + "</h3></a></li>";
        }).join("") +
        "</ul>" +
        (sideCard
          ? '<a class="side-card" href="' + articleUrl(sideCard.id) + '">' +
            (sideCard.image
              ? '<img src="' + thumb(sideCard.image) + '" alt="' +
                esc(sideCard.imageAlt || sideCard.title) + '" loading="lazy">'
              : "") +
            '<div class="meta"><span>' + esc(sideCard.format) +
            '</span><span class="meta__dot"></span><span>' +
            esc(regionName(sideCard.region)) + "</span></div>" +
            "<h3>" + esc(sideCard.title) + "</h3></a>"
          : "") +
        '<div class="side-note"><b>Хотите публиковаться?</b> Регистрация занимает минуту — ' +
        'после неё вы получаете пресс-карту и можете писать материалы. ' +
        '<a href="/join">Зарегистрироваться</a></div>' +
        "</aside></div></div>";
    } else if (heroHost) {
      heroHost.innerHTML =
        '<div class="wrap"><div class="hero-empty" data-reveal>' +
        '<div class="hero-empty__text">' +
        '<span class="kicker">Лента пока пустая</span>' +
        '<h1>Здесь появятся материалы авторов из регионов</h1>' +
        '<p class="lead">Проект только открывается. Первые тексты, репортажи и фотоистории ' +
        "появятся здесь, как только авторы их опубликуют — без выдуманных новостей и заглушек.</p>" +
        '<div class="row"><a class="btn btn--accent" href="/join">Стать автором</a>' +
        '<a class="btn btn--ghost" href="#map">Посмотреть карту регионов</a></div>' +
        "</div>" +
        '<div class="hero-empty__side">' +
        '<div class="hero-empty__item"><b>01</b><span>Регистрация — минута</span></div>' +
        '<div class="hero-empty__item"><b>02</b><span>Материал проверяет редакция</span></div>' +
        '<div class="hero-empty__item"><b>03</b><span>Публикация и пресс-карта</span></div>' +
        "</div></div></div>";
    }

    var ticker = $("[data-ticker]");
    if (ticker) {
      var items = all.slice(0, 8).map(function (a) {
        return '<a class="ticker__item" href="' + articleUrl(a.id) + '"><time>' +
          fmtTime(a.date) + "</time>" + esc(a.title) + "</a>";
      }).join("");
      ticker.innerHTML = items
        ? '<div class="ticker__inner"><div class="ticker__label"><span>Лента</span></div>' +
          '<div class="ticker__viewport"><div class="ticker__track">' + items + items +
          "</div></div></div>"
        : '<div class="ticker__inner"><div class="ticker__label"><span>Лента</span></div>' +
          '<div class="ticker__viewport"><div class="ticker__text">Лента наполняется — ' +
          "первыми будут материалы авторов проекта</div></div></div>";
    }

    var pcHost = $("[data-presscard]");
    if (pcHost) pcHost.innerHTML = pressCardBlock();

    mountMapSection();

    // лента с фильтрами по темам
    var feed = $("[data-feed]");
    if (feed) {
      var tabs = $("[data-feed-tabs]");
      var topics = ["Все"].concat(SC.topics || []);
      var state = { topic: "Все", limit: 9 };

      function renderFeed() {
        var list = all.filter(function (a) {
          return state.topic === "Все" || a.topic === state.topic;
        });
        var shown = list.slice(0, state.limit);
        feed.innerHTML = shown.length
          ? shown.map(function (a, i) {
              return card(a, "default", ' data-reveal data-delay="' + (i % 3) + '"');
            }).join("")
          : '<div class="no-data">По этой теме материалов пока нет.</div>';
        var more = $("[data-feed-more]");
        if (more) more.classList.toggle("is-hidden", list.length <= state.limit);
        initAnimations();
      }

      if (tabs) {
        tabs.innerHTML = topics.map(function (t, i) {
          return '<button class="chip' + (i === 0 ? " is-on" : "") +
            '" type="button" data-topic="' + esc(t) + '">' + esc(t) + "</button>";
        }).join("");
        tabs.addEventListener("click", function (e) {
          var b = e.target.closest("[data-topic]");
          if (!b) return;
          $$(".chip", tabs).forEach(function (c) { c.classList.remove("is-on"); });
          b.classList.add("is-on");
          state.topic = b.getAttribute("data-topic");
          state.limit = 9;
          renderFeed();
        });
      }
      var moreBtn = $("[data-feed-more]");
      if (moreBtn) moreBtn.addEventListener("click", function () { state.limit += 6; renderFeed(); });
      renderFeed();
    }

    var formatsHost = $("[data-formats]");
    if (formatsHost) {
      formatsHost.innerHTML = (SC.formats || []).map(function (f, i) {
        return '<a class="format" href="/news?format=' + encodeURIComponent(f.name) + '">' +
          '<span class="format__n">0' + (i + 1) + "</span>" +
          '<span class="format__name">' + esc(f.name) + "</span>" +
          '<span class="format__desc">' + esc(f.desc) + "</span></a>";
      }).join("");
    }

    var regionalHost = $("[data-regional]");
    if (regionalHost) {
      regionalHost.innerHTML = all
        .slice(5, 11)
        .map(function (a) { return cardRow(a); })
        .join("");
    }

    // лица проекта
    var authorsHost = $("[data-authors]");
    if (authorsHost) {
      var faces = (SC.authors || []).slice(0, 8);
      authorsHost.innerHTML = faces.length
        ? faces
            .map(function (a, i) {
              return '<div class="author-card" data-reveal data-delay="' + (i % 4) + '">' +
                '<span class="author-card__ava">' + esc(a.initials) + "</span>" +
                '<div><div class="author-card__name">' + esc(a.name) + "</div>" +
                '<div class="author-card__role">' + esc(a.role) + "</div></div></div>";
            })
            .join("")
        : '<div class="no-data">Лица проекта появятся здесь, когда авторы зарегистрируются ' +
          "и опубликуют первые материалы.</div>";
    }

    // возможности
    var oppHost = $("[data-opportunities]");
    if (oppHost) {
      var opp = all.filter(function (a) { return a.topic === "Возможности"; }).slice(0, 3);
      var fallback = all.slice(0, 3);
      oppHost.innerHTML = (opp.length ? opp : fallback).length
        ? (opp.length ? opp : fallback).map(function (a) { return card(a); }).join("")
        : '<div class="no-data">Возможности появятся вместе с первыми материалами.</div>';
    }
  }

  /* 8. Лента материалов ==================================================== */

  function initNews() {
    var host = $("[data-news-list]");
    if (!host) return;

    var state = {
      q: param("q") || "",
      topic: param("topic") || "",
      format: param("format") || "",
      district: "",
      region: param("region") || "",
      sort: "new",
    };

    var topicHost = $("[data-filter-topic]");
    var formatHost = $("[data-filter-format]");
    var districtHost = $("[data-filter-district]");
    var regionSelect = $("[data-filter-region]");
    var searchInput = $("[data-filter-search]");
    var countHost = $("[data-result-count]");

    if (searchInput) searchInput.value = state.q;

    if (topicHost) {
      topicHost.innerHTML = '<button class="chip is-on" type="button" data-v="">Любая</button>' +
        (SC.topics || []).map(function (t) {
          return '<button class="chip" type="button" data-v="' + esc(t) + '">' + esc(t) + "</button>";
        }).join("");
    }
    if (formatHost) {
      formatHost.innerHTML = '<button class="chip is-on" type="button" data-v="">Любой</button>' +
        (SC.formats || []).map(function (f) {
          return '<button class="chip" type="button" data-v="' + esc(f.name) + '">' +
            esc(f.name) + "</button>";
        }).join("");
    }
    if (districtHost) {
      districtHost.innerHTML = '<button class="chip is-on" type="button" data-v="">Все округа</button>' +
        districts().map(function (d) {
          return '<button class="chip" type="button" data-v="' + esc(d) + '">' +
            esc(d.replace(" ФО", "")) + "</button>";
        }).join("");
    }
    if (regionSelect) {
      regionSelect.innerHTML = '<option value="">Все регионы</option>' + regionOptions(state.region);
    }

    function markActive(hostEl, value) {
      if (!hostEl) return;
      $$(".chip", hostEl).forEach(function (b) {
        b.classList.toggle("is-on", b.getAttribute("data-v") === value);
      });
    }
    markActive(topicHost, state.topic);
    markActive(formatHost, state.format);

    function render() {
      var list = sortedArticles().filter(function (a) {
        if (state.topic && a.topic !== state.topic) return false;
        if (state.format && a.format !== state.format) return false;
        if (state.region && a.region !== state.region) return false;
        if (state.district) {
          var r = regionBySlug(a.region);
          if (!r || r.district !== state.district) return false;
        }
        if (state.q) {
          var hay = (a.title + " " + a.excerpt + " " + a.topic + " " + a.format + " " +
            (regionName(a.region) || "")).toLowerCase();
          if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
        }
        return true;
      });

      if (state.sort === "old") list = list.reverse();

      host.innerHTML = list.length
        ? list.map(function (a, i) {
            return card(a, "default", ' data-reveal data-delay="' + (i % 3) + '"');
          }).join("")
        : (state.topic || state.format || state.region || state.district || state.q
            ? '<div class="empty"><h3>Ничего не нашлось</h3>' +
              "<p>Попробуйте убрать фильтры или поискать по другому слову. " +
              "А если вы знаете историю, которой ещё нет на сайте, — опубликуйте её сами.</p>" +
              '<div class="empty__actions"><a class="btn btn--sm" href="/news">Сбросить фильтры</a>' +
              '<a class="btn btn--sm btn--ghost" href="/write">Написать материал</a></div></div>'
            : '<div class="empty"><h3>Публикаций пока нет</h3>' +
              "<p>Лента только открылась. Первый материал может быть ваш — из вашего города, " +
              "двора или вуза. Редакция поможет с текстом, а после публикации вы получите " +
              "пресс-карту автора.</p>" +
              '<div class="empty__actions"><a class="btn btn--sm" href="/join">Стать автором</a>' +
              '<a class="btn btn--sm btn--ghost" href="/assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору</a></div></div>');

      var note = $("[data-news-note]");
      if (note) note.hidden = allArticles().length === 0;

      if (countHost) {
        countHost.textContent = "Найдено: " + list.length + " " +
          plural(list.length, ["материал", "материала", "материалов"]);
      }
      initAnimations();
    }

    function bind(hostEl, key) {
      if (!hostEl) return;
      hostEl.addEventListener("click", function (e) {
        var b = e.target.closest("[data-v]");
        if (!b) return;
        state[key] = b.getAttribute("data-v");
        markActive(hostEl, state[key]);
        render();
      });
    }
    bind(topicHost, "topic");
    bind(formatHost, "format");
    bind(districtHost, "district");

    if (regionSelect) {
      regionSelect.addEventListener("change", function () {
        state.region = regionSelect.value;
        render();
      });
    }
    if (searchInput) {
      var t;
      searchInput.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () { state.q = searchInput.value.trim(); render(); }, 140);
      });
    }
    $$("[data-sort]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.sort = b.getAttribute("data-sort");
        $$("[data-sort]").forEach(function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        render();
      });
    });

    render();
  }

  /* 9. Страница материала ================================================== */

  function initArticle() {
    var host = $("[data-article]");
    if (!host) return;
    var id = param("id");
    var a = findArticle(id);
    var user = Store ? Store.currentUser() : null;
    var isMine =
      a && a.isUserPost && user && id.indexOf("u:") === 0 &&
      Store.getPost(id.slice(2)) && Store.getPost(id.slice(2)).authorId === user.id;

    if (!a) {
      host.innerHTML =
        '<div class="wrap section"><div class="empty"><h3>Материал не найден</h3>' +
        "<p>Скорее всего, ссылка устарела. Посмотрите все материалы в ленте.</p>" +
        '<div class="empty__actions"><a class="btn" href="/news">К ленте материалов</a></div>' +
        "</div></div>";
      return;
    }

    var au = authorOf(a);
    var bodyHtml = (function (blocks) {
      var out = [];
      var list = [];
      function flush() {
        if (!list.length) return;
        out.push("<ul>" + list.map(function (li) { return "<li>" + inlineMd(li) + "</li>"; }).join("") + "</ul>");
        list = [];
      }
      (blocks || []).forEach(function (p) {
        if (p.indexOf("- ") === 0) {
          list.push(p.slice(2));
          return;
        }
        flush();
        if (p.indexOf("> ") === 0) out.push("<blockquote>" + inlineMd(p.slice(2)) + "</blockquote>");
        else if (p.indexOf("## ") === 0) out.push("<h2>" + inlineMd(p.slice(3)) + "</h2>");
        else out.push("<p>" + inlineMd(p) + "</p>");
      });
      flush();
      return out.join("");
    })(a.body);

    var relatedTitle = "Ещё из этого региона";
    var related = allArticles()
      .filter(function (x) { return x.id !== a.id && x.region === a.region; })
      .slice(0, 3);
    if (!related.length) {
      var myRegion = regionBySlug(a.region);
      relatedTitle = "Из того же федерального округа";
      related = allArticles()
        .filter(function (x) {
          var rr = regionBySlug(x.region);
          return x.id !== a.id && rr && myRegion && rr.district === myRegion.district;
        })
        .slice(0, 3);
    }
    var latest = allArticles().filter(function (x) { return x.id !== a.id; }).slice(0, 4);

    document.title = a.title + " — Смена контента";

    host.innerHTML =
      '<div class="progress"><i data-progress></i></div>' +
      '<article><div class="wrap article-head">' +
      '<div class="breadcrumbs">' +
      '<a href="/news">Материалы</a><span>/</span>' +
      '<a href="' + regionUrl(a.region) + '">' + esc(regionName(a.region)) + "</a>" +
      "<span>/</span><span>" + esc(a.format) + "</span></div>" +
      '<span class="kicker">' + esc(a.topic) + " · " + esc(a.format) +
      (a.isUserPost ? ' · <span class="kicker-flag">автор проекта</span>' : "") +
      (a.number ? " · № " + String(a.number).padStart(4, "0") : "") + "</span>" +
      '<h1 class="article-title">' + esc(a.title) + "</h1>" +
      '<p class="article-lead">' + esc(a.excerpt) + "</p>" +
      '<div class="article-meta">' +
      '<div class="author"><span class="author__ava">' + esc(au.initials) + "</span>" +
      '<div><div class="author__name">' + esc(au.name) + "</div>" +
      '<div class="author__role">' + esc(au.role) + "</div></div></div>" +
      '<div class="meta"><span>' + fmtDate(a.date) + "</span>" +
      '<span class="meta__dot"></span><span>' + (a.read || 4) + " мин чтения</span>" +
      '<span class="meta__dot"></span><a href="' + regionUrl(a.region) + '" style="color:inherit">' +
      esc(regionName(a.region)) + "</a></div>" +
      (isMine
        ? '<a class="btn btn--sm btn--ghost" href="/write?id=' + encodeURIComponent(id.slice(2)) +
          '">Редактировать</a>'
        : "") +
      "</div>" +
      (a.image
        ? '<img class="article-cover" src="' + a.image + '" alt="' + esc(a.imageAlt || a.title) + '">' +
          '<div class="article-cover-caption"><span>' + esc(a.imageAlt || "Иллюстрация к материалу") +
          "</span><span>" + esc(regionName(a.region)) + "</span></div>"
        : "") +
      "</div>" +
      '<div class="wrap"><div class="article-layout">' +
      '<div><div class="prose">' + bodyHtml + "</div>" +
      '<div class="article-tags">' +
      '<a class="tag" href="/news?topic=' + encodeURIComponent(a.topic) + '">' + esc(a.topic) + "</a>" +
      '<a class="tag" href="/news?format=' + encodeURIComponent(a.format) + '">' + esc(a.format) + "</a>" +
      '<a class="tag" href="/news?region=' + encodeURIComponent(a.region) + '">' +
      esc(regionName(a.region)) + "</a></div>" +
      (a.isUserPost
        ? '<div class="author-box"><span class="author-box__ava">' + esc(au.initials) + "</span>" +
          '<div><div class="author-box__name">' + esc(au.name) + "</div>" +
          '<div class="author-box__role">' + esc(au.role) + " · автор проекта</div>" +
          '<p class="author-box__text">Материал опубликован участником «Смены контента».</p>' +
          "</div></div>"
        : "") +
      "</div>" +
      '<aside class="article-aside">' +
      '<div class="aside-box"><h3>Регион</h3>' +
      '<a class="btn btn--sm btn--ghost btn--block" href="' + regionUrl(a.region) + '">' +
      "Все материалы: " + esc(regionName(a.region)) + "</a></div>" +
      '<div class="aside-box"><h3>Поделиться</h3><div class="share">' +
      '<button type="button" data-copy>Скопировать ссылку</button>' +
      "</div></div>" +
      '<div class="aside-box"><h3>Свежие материалы</h3><ul>' +
      latest.map(function (x) {
        return '<li><a href="' + articleUrl(x.id) + '">' + esc(x.title) + "</a></li>";
      }).join("") +
      "</ul></div>" +
      '<div class="aside-box"><h3>Написать своё</h3>' +
      '<p style="font-size:.88rem;color:var(--ink-soft);margin-bottom:12px">Любой ' +
      "зарегистрированный автор может опубликовать материал на сайте.</p>" +
      '<a class="btn btn--sm btn--accent btn--block" href="/write">Опубликовать материал</a>' +
      "</div></aside></div></div></article>" +
      (related.length
        ? '<div class="wrap section"><div class="sec-head"><div class="sec-head__left">' +
          '<span class="kicker">' + esc(relatedTitle) + "</span>" +
          "<h2>Материалы рядом</h2></div>" +
          '<a class="sec-link" href="' + regionUrl(a.region) + '">Весь регион</a></div>' +
          '<div class="cards">' + related.map(function (x) { return card(x); }).join("") +
          "</div></div>"
        : "");

    var copyBtn = $("[data-copy]", host);
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var url = window.location.href;
        function done() {
          copyBtn.textContent = "Ссылка скопирована";
          setTimeout(function () { copyBtn.textContent = "Скопировать ссылку"; }, 1800);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, done);
        } else {
          done();
        }
      });
    }
    initReadingProgress();
  }

  /* 10. Страница региона =================================================== */

  function initRegion() {
    var host = $("[data-region]");
    if (!host) return;

    var slug = param("r");
    var r = regionBySlug(slug);

    if (!r) {
      host.innerHTML =
        '<div class="wrap section"><div class="empty"><h3>Регион не найден</h3>' +
        "<p>Проверьте ссылку или выберите регион на карте.</p>" +
        '<div class="empty__actions"><a class="btn" href="/#map">К карте регионов</a></div>' +
        "</div></div>";
      return;
    }

    var list = articlesByRegion(slug);
    var authorsHere = list.reduce(function (acc, a) {
      if (acc.indexOf(authorOf(a).name) === -1) acc.push(authorOf(a).name);
      return acc;
    }, []);
    document.title = r.name + " — Смена контента";

    var miniMap = '<svg viewBox="' + MAP.viewBox + '" role="img" aria-label="' +
      esc(r.name) + ' на карте России">' +
      MAP.regions.map(function (x) {
        return '<path class="map-region' + (x.slug === slug ? " is-selected" : "") +
          '" d="' + x.d + '"></path>';
      }).join("") + "</svg>";

    var districtMates = MAP.regions.filter(function (x) {
      return x.district === r.district && x.slug !== slug;
    });

    host.innerHTML =
      '<div class="region-hero"><div class="wrap region-hero__grid">' +
      "<div>" +
      '<div class="breadcrumbs" style="color:rgba(247,245,239,.55)">' +
      '<a href="/">Главная</a><span>/</span>' +
      '<a href="/#map">Регионы</a><span>/</span><span>' + esc(r.district || "") + "</span></div>" +
      '<span class="kicker">' + esc(r.district || "Регион") + "</span>" +
      "<h1>" + esc(r.name) + "</h1>" +
      '<p class="region-hero__sub">' +
      (list.length
        ? "Материалы местных авторов: " + list.length + ". Здесь публикуются истории из региона."
        : "Публикаций из этого региона пока нет. Мы не придумываем новости — поэтому на этой " +
          "странице пока пусто, и это честно.") +
      "</p>" +
      '<div class="region-stats">' +
      "<div><b>" + list.length + "</b><span>" + plural(list.length, ["материал", "материала", "материалов"]) + "</span></div>" +
      "<div><b>" + authorsHere.length + "</b><span>" + plural(authorsHere.length, ["автор", "автора", "авторов"]) + "</span></div>" +
      "<div><b style=\"font-size:1rem;font-family:var(--font-mono);letter-spacing:0\">" +
      esc((r.district || "—").replace(" ФО", "")) + "</b><span>федеральный округ</span></div>" +
      "</div>" +
      '<div class="row" style="margin-top:20px">' +
      '<a class="btn btn--paper btn--sm" href="/write">Опубликовать материал</a>' +
      '<a class="btn btn--outline-paper btn--sm" href="/#map">Выбрать другой регион</a></div>' +
      "</div>" +
      '<div class="region-map-mini">' + miniMap + "</div>" +
      "</div></div>" +
      '<div class="wrap region-body"><div class="region-layout">' +
      "<div>" +
      (list.length
        ? '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Лента региона</span>' +
          "<h2>" + (list.length === 1 ? "Один материал" : "Все материалы") + "</h2></div></div>" +
          '<div class="cards">' + list.map(function (a) { return card(a); }).join("") + "</div>"
        : '<div class="region-empty"><span class="kicker">Пусто — и это честно</span>' +
          "<h2>Публикаций из этого региона пока нет</h2>" +
          "<p>Вы можете стать первым автором оттуда. Зарегистрируйтесь — и опубликуйте " +
          "историю, которая происходит рядом с вами. Редактор поможет с темой и текстом.</p>" +
          '<div class="empty__actions">' +
          '<a class="btn btn--accent" href="/write">Опубликовать материал</a>' +
          '<a class="btn btn--ghost" href="/join">Создать аккаунт</a>' +
          "</div></div>") +
      (districtMates.length
        ? '<div class="sec-head" style="margin-top:40px"><div class="sec-head__left">' +
          '<span class="kicker">Рядом</span><h2>Другие регионы округа</h2></div></div>' +
          '<div class="region-chips">' + districtMates.map(function (x) {
            var n = countByRegion(x.slug);
            return '<a class="region-chip" href="' + regionUrl(x.slug) + '">' + esc(x.name) +
              "<span>" + (n ? n : "—") + "</span></a>";
          }).join("") + "</div>"
        : "") +
      "</div>" +
      '<aside class="article-aside">' +
      '<div class="aside-box"><h3>Пишете отсюда?</h3>' +
      '<p style="font-size:.9rem;color:var(--ink-soft);margin-bottom:12px">Мы ищем авторов, ' +
      "фотографов и видеографов в каждом регионе. Опыт публикаций не обязателен.</p>" +
      '<a class="btn btn--sm btn--block" href="/join">Зарегистрироваться</a></div>' +
      '<div class="aside-box"><h3>Документы</h3><ul>' +
      '<li><a href="/assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору (PDF)</a></li>' +
      '<li><a href="/assets/docs/polozhenie-o-redakcii.pdf" target="_blank" rel="noopener">Положение о редакции (PDF)</a></li>' +
      '<li><a href="/docs">Все документы</a></li>' +
      "</ul></div>" +
      '<div class="aside-box"><h3>На карте</h3>' +
      '<a class="btn btn--sm btn--ghost btn--block" href="/#map">Открыть всю карту</a></div>' +
      "</aside></div></div>";
  }

  /* 11. Регистрация и вход ================================================= */

  function initAuth() {
    var box = $("[data-auth]");
    if (!box) return;
    var user = Store ? Store.currentUser() : null;
    var nextParam = param("next");
    var next = nextParam === "write" ? "/write" : nextParam === "admin" ? "/admin" : "/profile";
    if (user) {
      window.location.replace(next);
      return;
    }

    var regionSelect = $("[data-auth-region]", box);
    if (regionSelect) {
      regionSelect.innerHTML = '<option value="">Выберите регион</option>' +
        regionOptions(SC.brand.launchRegion || "");
    }
    var roleSelect = $("[data-auth-role]", box);
    if (roleSelect) {
      roleSelect.innerHTML = Store.ROLES.map(function (r) {
        return "<option>" + esc(r) + "</option>";
      }).join("");
    }

    function switchTab(name) {
      $$("[data-auth-tab]").forEach(function (b) {
        b.classList.toggle("is-on", b.getAttribute("data-auth-tab") === name);
      });
      $$("[data-auth-panel]").forEach(function (p) {
        p.classList.toggle("is-hidden", p.getAttribute("data-auth-panel") !== name);
      });
    }
    $$("[data-auth-tab]").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.getAttribute("data-auth-tab")); });
    });
    if (window.location.hash === "#login") switchTab("login");

    var regForm = $("[data-register-form]", box);
    if (regForm) {
      regForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var data = new FormData(regForm);
        var errBox = $("[data-register-error]", box);
        if (!data.get("agree")) {
          if (errBox) {
            errBox.textContent = "Отметьте согласие с правилами — без этого аккаунт создать нельзя.";
            errBox.classList.remove("is-hidden");
          }
          return;
        }
        var res = Store.register({
          name: data.get("name"),
          email: data.get("email"),
          pass: data.get("pass"),
          region: data.get("region"),
          role: data.get("role"),
        });
        var out = $("[data-register-error]", box);
        if (!res.ok) {
          out.textContent = res.error;
          out.classList.remove("is-hidden");
          return;
        }
        window.location.href = next === "/profile" ? "/profile?new=1" : next;
      });
    }

    var loginForm = $("[data-login-form]", box);
    if (loginForm) {
      loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var data = new FormData(loginForm);
        var res = Store.login(data.get("email"), data.get("pass"));
        var out = $("[data-login-error]", box);
        if (!res.ok) {
          out.textContent = res.error;
          out.classList.remove("is-hidden");
          return;
        }
        window.location.href = next;
      });
    }
  }

  /* 12. Личный кабинет ===================================================== */

  /* пресс-карта автора: до нужного числа публикаций — прогресс, после — карта */
  function issueCardBlock(card) {
    var percent = Math.min(100, Math.round((card.posts / card.need) * 100));
    if (!card.issued) {
      return (
        '<div class="presscard presscard--personal presscard--pending" data-reveal>' +
        '<div class="presscard__main">' +
        '<div class="presscard__top"><span class="presscard__label">Пресс-карта автора</span>' +
        '<span class="presscard__code">не выдана</span></div>' +
        '<div class="presscard__name">' + esc(card.name) + "</div>" +
        '<div class="presscard__desc">' + esc(card.role) + " · " + esc(card.region) + "</div>" +
        '<div class="presscard__editorial">' + esc(card.editorial) + "</div>" +
        '<div class="card-progress">' +
        '<div class="card-progress__head"><b>' + card.posts + " из " + card.need +
        "</b><span>осталось " + card.left + " " +
        plural(card.left, ["материал", "материала", "материалов"]) +
        "</span></div>" +
        '<div class="card-progress__bar"><i style="width:' + percent + '%"></i></div>' +
        '<p class="card-progress__note">' +
        (card.scope === "team"
          ? "Карта выдаётся, когда редакция «" + esc(card.teamName) + "» наберёт " + card.need +
            " опубликованных материалов — тогда её получает каждый участник команды."
          : "Карта выдаётся после " + card.need + " опубликованных материалов. С ней можно " +
            "брать интервью и ходить на события как журналист проекта.") +
        "</p>" +
        "</div>" +
        '<div class="presscard__row">' +
        "<span><b>Публикаций</b>" + card.posts + "</span>" +
        "<span><b>Нужно</b>" + card.need + "</span>" +
        "<span><b>Выдаёт</b>" + esc(card.issuer) + "</span>" +
        "</div></div>" +
        '<div class="presscard__side">' +
        '<div class="presscard__stamp presscard__stamp--muted">пресс<br>карта<br><span>после ' +
        card.need + "</span></div>" +
        "</div></div>"
      );
    }
    return (
      '<div class="presscard presscard--personal" data-reveal>' +
      '<div class="presscard__main">' +
      '<div class="presscard__top"><span class="presscard__label">Пресс-карта автора</span>' +
      '<span class="presscard__code">' + esc(card.number) + "</span></div>" +
      '<div class="presscard__name">' + esc(card.name) + "</div>" +
      '<div class="presscard__desc">' + esc(card.role) + " · " + esc(card.region) + "</div>" +
      '<div class="presscard__editorial">' + esc(card.editorial) + "</div>" +
      '<div class="presscard__row">' +
      "<span><b>Выдана</b>" + fmtDate(card.issuedAt) + "</span>" +
      "<span><b>Действует до</b>" + fmtDate(card.validUntil) + "</span>" +
      "<span><b>Публикаций</b>" + card.posts + "</span>" +
      "<span><b>Выдаёт</b>" + esc(card.issuer) + "</span>" +
      (card.head ? "<span><b>Руководитель</b>" + esc(card.head) + "</span>" : "") +
      "</div></div>" +
      '<div class="presscard__side">' +
      '<div class="presscard__stamp">смена<br>контента<br><span>' +
      esc(String(new Date(card.issuedAt).getFullYear() || "")) + "</span></div>" +
      '<button class="btn btn--sm btn--ghost" type="button" data-print>Печать</button>' +
      "</div></div>"
    );
  }

  function initProfile() {
    var host = $("[data-profile]");
    if (!host) return;
    var user = Store ? Store.currentUser() : null;
    if (!user) {
      window.location.replace("/join?next=write#login");
      return;
    }

    var savedNote = "";

    function render() {
      var user = Store.currentUser();
      var card = Store.pressCard();
      var published = Store.listPosts({ authorId: user.id, status: "published" });
      var drafts = Store.listPosts({ authorId: user.id, status: "draft" });
      var pending = Store.listPosts({ authorId: user.id, status: "pending" });
      var rejected = Store.listPosts({ authorId: user.id, status: "rejected" });
      var mine = drafts.concat(pending, rejected, published);
      document.title = user.name + " — личный кабинет";

      var STATUS = {
        draft: { label: "черновик", cls: "status--draft" },
        pending: { label: "на проверке", cls: "status--pending" },
        rejected: { label: "нужны правки", cls: "status--rejected" },
        published: { label: "опубликовано", cls: "status--pub" },
      };

      var postRow = function (p) {
        var st = STATUS[p.status] || STATUS.draft;
        var canPublish = Store.can(user, "publish");
        var action = "";
        if (p.status === "draft" || p.status === "rejected") {
          action =
            '<button class="btn btn--sm btn--accent" type="button" data-submit="' + p.id + '">' +
            (canPublish ? "Опубликовать" : "Отправить на проверку") + "</button>";
        } else if (p.status === "pending") {
          action = '<span class="post-row__wait">Ждёт редактора</span>';
        } else {
          action = '<a class="btn btn--sm btn--ghost" href="/article?id=' +
            encodeURIComponent("u:" + p.id) + '">Открыть</a>';
        }
        return (
          '<div class="post-row">' +
          '<div class="post-row__main">' +
          '<div class="post-row__meta"><span class="status ' + st.cls + '">' + st.label +
          "</span><span>" + fmtDate(p.updatedAt || p.date) + "</span><span>" + esc(p.format) +
          " · " + esc(regionName(p.region)) + "</span></div>" +
          '<div class="post-row__title">' + esc(p.title) + "</div>" +
          (p.status === "rejected" && p.reviewNote
            ? '<div class="post-row__note">Замечание редактора: ' + esc(p.reviewNote) + "</div>"
            : "") +
          "</div>" +
          '<div class="post-row__actions">' + action +
          '<a class="btn btn--sm btn--ghost" href="/write?id=' + p.id + '">Изменить</a>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-delete="' + p.id + '">Удалить</button>' +
          "</div></div>"
        );
      };

      var team = Store.myTeam();
      var teamCard = Store.pressCard();
      var teamBlock = team
        ? '<div class="panel panel--team">' +
          '<div class="panel__head"><h3>' + esc(team.name) + "</h3>" +
          '<span class="panel__tag">ваша редакция</span></div>' +
          "<p>" + (team.about ? esc(team.about) : "Команда проекта.") + "</p>" +
          '<div class="team-stats"><span><b>' + team.members + "</b> участников</span>" +
          "<span><b>" + team.published + "</b> публикаций</span>" +
          "<span><b>" + Math.max(0, (teamCard ? teamCard.need : 20) - team.published) + "</b> до командной карты</span></div>" +
          '<p class="team-code">Код для приглашения: <code>' + esc(team.code) + "</code></p>" +
          '<div class="row"><button class="btn btn--sm btn--ghost" type="button" data-team-leave>Выйти из команды</button></div>' +
          "</div>"
        : '<div class="panel panel--team">' +
          "<h3>Вы в индивидуальной редакции</h3>" +
          "<p>Пока вы работаете один: пресс-карта появится после " +
          (teamCard ? teamCard.need : 5) + " материалов. Если соберётесь с друзьями — " +
          "создайте свою редакцию: тогда карта выдаётся всей команде после " +
          Store.getSettings().card.teamMinPosts + " публикаций.</p>" +
          '<form class="team-form" data-team-create>' +
          '<div class="field"><label for="t-name">Название команды</label>' +
          '<input id="t-name" name="name" type="text" placeholder="Например, НоВоСебирьСети" maxlength="60"></div>' +
          '<div class="field"><label for="t-about">О чём вы</label>' +
          '<input id="t-about" name="about" type="text" placeholder="Коротко: город и темы" maxlength="120"></div>' +
          '<div class="row"><button class="btn btn--sm" type="submit">Создать команду</button>' +
          '<span class="form__note" data-team-status></span></div></form>' +
          '<form class="team-form team-form--join" data-team-join>' +
          '<div class="field"><label for="t-code">Или присоединитесь по коду</label>' +
          '<input id="t-code" name="code" type="text" placeholder="Шесть символов от команды" maxlength="12"></div>' +
          '<div class="row"><button class="btn btn--sm btn--ghost" type="submit">Вступить</button>' +
          '<span class="form__note" data-team-join-status></span></div></form>' +
          "</div>";

      host.innerHTML =
        '<section class="profile-hero"><div class="wrap">' +
        '<div class="profile-hero__grid">' +
        '<div class="profile-id">' +
        '<span class="profile-id__ava">' + esc(Store.initials(user.name)) + "</span>" +
        "<div><h1>" + esc(user.name) + "</h1>" +
        '<p class="profile-id__role">' + esc(user.role) +
        (user.region ? " · " + esc(regionName(user.region)) : "") + "</p>" +
        '<p class="profile-id__since">На проекте с ' + fmtDate(user.createdAt) + "</p></div>" +
        "</div>" +
        '<div class="profile-hero__actions">' +
        '<a class="btn btn--accent" href="/write">Написать материал</a>' +
        '<a class="btn btn--ghost" href="/admin">Панель проекта</a>' +
        '<button class="btn btn--ghost" type="button" data-logout>Выйти</button>' +
        "</div></div></div></section>" +

        '<section class="section wrap">' +
        (param("new")
          ? '<div class="welcome"><b>Аккаунт создан.</b> Можно сразу писать первый материал. ' +
            "Пресс-карта появится, когда вы опубликуете " +
            Store.getSettings().card.minPosts + " материала: до этого момента в кабинете виден прогресс.</div>"
          : "") +
        '<div class="profile-grid">' +

        // пресс-карта (выдаётся после нужного числа публикаций)
        issueCardBlock(card) +

        // статистика
        '<div class="profile-side">' +
        '<div class="kpi kpi--stack">' +
        '<div class="kpi__item"><b>' + published.length + "</b><span>публикаций</span></div>" +
        '<div class="kpi__item"><b>' + drafts.length + "</b><span>черновиков</span></div>" +
        '<div class="kpi__item"><b>' + pending.length + "</b><span>на проверке</span></div>" +
        '<div class="kpi__item"><b>' + (user.region ? esc(regionName(user.region).split(" ")[0]) : "—") +
        "</b><span>ваш регион</span></div>" +
        "</div>" +
        teamBlock +
        '<div class="panel"><h3>Как это работает</h3>' +
        '<p>Материал проходит проверку редакции: сначала статус «на проверке», потом ' +
        "«опубликовано» или «нужны правки» с замечанием. Черновики видите только вы.</p></div>" +
        "</div></div>" +

        // материалы
        '<div class="profile-posts" style="margin-top:44px">' +
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Мои материалы</span>' +
        "<h2>Материалы и статусы</h2></div>" +
        '<a class="sec-link" href="/write">Новый материал <span aria-hidden="true">→</span></a></div>' +
        (mine.length
          ? mine.map(postRow).join("")
          : '<div class="empty"><h3>Пока ничего не опубликовано</h3>' +
            "<p>Начните с простого: история из вашего двора, района или вуза. " +
            "Памятка автору подскажет, с чего начать.</p>" +
            '<div class="empty__actions"><a class="btn btn--accent" href="/write">Написать материал</a>' +
            '<a class="btn btn--ghost" href="/assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору</a></div></div>') +
        "</div>" +

        // настройки
        '<div class="profile-settings" style="margin-top:44px;max-width:720px">' +
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Настройки</span>' +
        "<h2>Профиль автора</h2></div></div>" +
        '<form class="form" data-profile-form>' +
        '<div class="field"><label for="p-name">Имя</label>' +
        '<input id="p-name" name="name" type="text" value="' + esc(user.name) + '"></div>' +
        '<div class="field"><label>Почта</label><input type="text" value="' +
        esc(user.email) + '" disabled></div>' +
        '<div class="field"><label for="p-role">Роль</label><select id="p-role" name="role">' +
        Store.ROLES.map(function (r) {
          return "<option" + (r === user.role ? " selected" : "") + ">" + esc(r) + "</option>";
        }).join("") + "</select></div>" +
        '<div class="field"><label for="p-region">Регион</label><select id="p-region" name="region">' +
        '<option value="">Не выбран</option>' + regionOptions(user.region) + "</select></div>" +
        '<div class="field form__full"><label for="p-bio">О себе</label>' +
        '<textarea id="p-bio" name="bio" placeholder="Пара предложений: о чём хотите рассказывать">' +
        esc(user.bio || "") + "</textarea></div>" +
        '<div class="form__full row"><button class="btn" type="submit">Сохранить</button>' +
        '<span class="form__note" data-profile-status>' + esc(savedNote) + "</span></div>" +
        "</form>" +
        '<div class="storage-note">Аккаунт и черновики хранятся в этом браузере. ' +
        "Отправленный материал уходит в общую приёмную редакции: он доходит до неё с любого " +
        "устройства, а после одобрения его видят все посетители сайта.</div>" +
        "</div>" +
        "</section>";

      initAnimations();
      mountCardApplication();

      var form = $("[data-profile-form]", host);
      if (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var d = new FormData(form);
          Store.updateUser({ name: d.get("name"), role: d.get("role"), region: d.get("region"), bio: d.get("bio") });
          savedNote = "Сохранено";
          render();
        });
      }
      var printBtn = $("[data-print]", host);
      if (printBtn) printBtn.addEventListener("click", function () { window.print(); });

      $$("[data-logout]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          Store.logout();
          window.location.href = "/";
        });
      });

      $$("[data-submit]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          var res = Store.submitPost(b.getAttribute("data-submit"));
          if (!res.ok) {
            window.alert(res.error || "Не удалось отправить материал.");
            return;
          }
          render();
        });
      });

      var teamCreate = $("[data-team-create]", host);
      if (teamCreate) {
        teamCreate.addEventListener("submit", function (e) {
          e.preventDefault();
          var fd = new FormData(teamCreate);
          var res = Store.createTeam({ name: fd.get("name"), about: fd.get("about"), region: user.region });
          var note = $("[data-team-status]", host);
          if (!res.ok) {
            if (note) note.textContent = res.error || "Не получилось";
            return;
          }
          render();
        });
      }

      var teamJoin = $("[data-team-join]", host);
      if (teamJoin) {
        teamJoin.addEventListener("submit", function (e) {
          e.preventDefault();
          var fd = new FormData(teamJoin);
          var res = Store.joinTeam(fd.get("code"));
          var note = $("[data-team-join-status]", host);
          if (!res.ok) {
            if (note) note.textContent = res.error || "Не получилось";
            return;
          }
          render();
        });
      }

      $$("[data-team-leave]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          if (!window.confirm("Выйти из команды? Публикации останутся, но карта будет считаться по личным материалам.")) return;
          Store.leaveTeam();
          render();
        });
      });

      $$("[data-delete]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          if (!window.confirm("Удалить материал? Действие необратимо.")) return;
          Store.deletePost(b.getAttribute("data-delete"));
          render();
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
            '<p class="form__note">Материалов в заявке: ' + (last.posts || []).length + "</p></div>";
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
          '<div class="row" style="margin-top:16px">' +
          '<button class="btn" type="button" data-card-send>Подать заявку</button>' +
          '<span class="form__note" data-card-note>Приложите все материалы — редакция проверяет их по номерам.</span>' +
          "</div></div>";

        var send = $("[data-card-send]", section);
        var note = $("[data-card-note]", section);
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
          var me = Store.currentUser();
          send.disabled = true;
          note.textContent = "Отправляем…";
          Store.apiCardRequest({
            authorName: me ? me.name : "",
            authorRegion: me ? me.region : "",
            authorRole: me ? me.role : "",
            posts: chosen,
          }).then(function (res) {
            send.disabled = false;
            if (!res || !res.ok) {
              note.textContent = (res && res.error) || "Не удалось отправить заявку.";
              return;
            }
            render();
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
        if (file.size > 5 * 1024 * 1024) {
          setStatus("Файл больше 5 МБ — выберите поменьше.", true);
          return;
        }
        resizeImage(file, function (dataUrl) {
          urlInput.value = dataUrl;
          preview.innerHTML = '<img src="' + dataUrl + '" alt="">';
          setStatus("Обложка загружена");
        });
      });
    }

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
          (p.logo ? '<img class="partner__logo" src="' + esc(p.logo) + '" alt="' + esc(p.name) + '" loading="lazy">' : "") +
          '<div class="partner__body"><h3>' + esc(p.name) + "</h3>" +
          (p.about ? "<p>" + esc(p.about) + "</p>" : "") +
          (p.url ? '<span class="partner__link">' + esc(p.url.replace(/^https?:\/\//, "")) + "</span>" : "") +
          "</div>";
        return p.url
          ? '<a class="partner" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + inner + "</a>"
          : '<div class="partner">' + inner + "</div>";
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
    initFounders();
    initPartners();
    mountHeader();
    mountFooter();
    mountSearch();
    initPageBits();

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
    if (page === "founders") initFoundersPage();

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
