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

  /* Карточки основателей: основа — текст из data.js, поверх — то, что
     сохранено в панели проекта. Старые серверные записи (до 11.11.2026)
     дают только фото и город: их текст устарел, поэтому он не перекрывает
     зашитый. Записи, сохранённые из панели после, главнее во всём. */
  var LOCAL_FOUNDERS = (SC.founders || []).slice();

  function founderWithText(f) {
    if (!f) return f;
    var local = null;
    for (var i = 0; i < LOCAL_FOUNDERS.length; i++) {
      var l = LOCAL_FOUNDERS[i] || {};
      if ((l.id && l.id === f.id) || (l.name && l.name === f.name)) { local = l; break; }
    }
    if (!local) return f;
    var out = {};
    var k;
    for (k in local) if (Object.prototype.hasOwnProperty.call(local, k)) out[k] = local[k];
    for (k in f) {
      if (!Object.prototype.hasOwnProperty.call(f, k)) continue;
      var filled = String(f[k] == null ? "" : f[k]).trim() !== "";
      var text = k === "role" || k === "bio" || k === "name" || k === "since";
      if (!filled) continue;
      if (text && !f.edited && String(local[k] || "").trim()) continue;
      out[k] = f[k];
    }
    return out;
  }

  /* Серверный список накладывается на зашитый по id, имени или порядку:
     у старых записей id — f1, f2, а в data.js — sirik, ilin. */
  function mergeFounders(remote) {
    var base = LOCAL_FOUNDERS.slice();
    if (!remote || !remote.length) return base;
    var used = {};
    var out = base.map(function (l, i) {
      var match = null;
      remote.forEach(function (r, j) {
        if (match || used[j]) return;
        if ((r.id && r.id === l.id) || (r.name && r.name === l.name)) { match = r; used[j] = true; }
      });
      if (!match && remote[i] && !used[i] && /^f\d+$/.test(String(remote[i].id || ""))) { match = remote[i]; used[i] = true; }
      if (!match) return l;
      var merged = founderWithText(Object.assign({}, match, { id: l.id, name: match.edited ? match.name : l.name }));
      return merged;
    });
    remote.forEach(function (r, j) { if (!used[j] && r.edited && String(r.name || "").trim()) out.push(r); });
    return out;
  }

  var foundersLoaded = false;
  function loadFounders(done) {
    if (foundersLoaded || !Store || !Store.founders) return;
    foundersLoaded = true;
    Store.founders().then(function (list) {
      if (list && list.length) {
        SC.founders = mergeFounders(list);
        if (typeof done === "function") done();
      }
    }, function () {});
  }

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

  /* Фото профиля: обрезаем по центру в квадрат и ужимаем до 480 px.
     Сервер принимает только сам файл (data URL до 400 КБ), а не ссылку. */
  function avatarToSquare(file) {
    return fileToDataUrl(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var side = Math.min(img.width, img.height);
          var size = 480;
          var canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          try {
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          } catch (e) {
            resolve(dataUrl);
          }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      });
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

  /* материалы редакции + материалы авторов, которые опубликовал сервер */
  function allArticles() {
    var base = (SC.articles || []).slice();
    var extra = [];
    if (Store && Store.remoteArticles) {
      try {
        extra = Store.remoteArticles();
      } catch (e) {
        extra = [];
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
            "<li><div><b>Карта регионов</b><span>" +
            (MAP.regions.length
              ? MAP.regions.length + " регионов, у каждого — свои авторы и редакции. Где материалов пока нет, мы честно об этом пишем."
              : "У каждого региона свои авторы и редакция. Где материалов пока нет, мы честно об этом пишем.") +
            "</span></div></li>" +
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
    { href: "/poisk", label: "Поиск смен", key: "poisk" },
    { href: "/media-school", label: "Медиашкола", key: "school" },
    { href: "/about", label: "О проекте", key: "about" },
    { href: "/founders", label: "Основатели", key: "founders" },
    { href: "/#press-card", label: "Пресс-карта", key: "press" },
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
      '<li><a href="/verify">Проверка пресс-карты</a></li>' +
      '<li><a href="/about#roadmap">План развития</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h3>' + (user ? "Аккаунт" : "Участие") + "</h3><ul>" +
      (user
        ? '<li><a href="/profile">Личный кабинет</a></li>' +
          '<li><a href="/write">Новый материал</a></li>' +
          (Store.isStaff && Store.isStaff() ? '<li><a href="/admin">Панель проекта</a></li>' : "")
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
      '<span><a href="/assets/docs/politika-konfidencialnosti.pdf" target="_blank" rel="noopener">Персональные данные</a>' +
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

      document.body.classList.add("is-maint");
      var prevScreen = document.querySelector("[data-maint-screen]");
      if (prevScreen) prevScreen.remove();
      var screen = document.createElement("div");
      screen.className = "maint-screen";
      screen.setAttribute("data-maint-screen", "");
      screen.setAttribute("role", "alert");
      screen.innerHTML =
        '<div class="maint-screen__glow" aria-hidden="true"></div>' +
        '<div class="maint-screen__card">' +
        '<span class="maint-screen__badge"><span class="maint-screen__pulse"></span>обновляем сайт</span>' +
        "<h1>Скоро вернёмся</h1>" +
        "<p>Мы обновляем «Смену контента»: чиним мелочи и готовим новые разделы. " +
        "Материалы, аккаунты и черновики в порядке — ничего не потеряется.</p>" +
        (site.notice ? '<p class="maint-screen__note">' + esc(site.notice) + "</p>" : "") +
        '<div class="maint-screen__bar" aria-hidden="true"><span></span></div>' +
        '<div class="maint-screen__row">' +
        '<a class="btn btn--accent btn--sm" href="/join#login">Войти в кабинет</a>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-maint-reload>Проверить снова</button>' +
        "</div></div>";
      document.body.appendChild(screen);
      var reloadBtn = screen.querySelector("[data-maint-reload]");
      if (reloadBtn) reloadBtn.addEventListener("click", function () { window.location.reload(); });
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
      { title: "Смена контента в поиске", url: "/poisk", note: "Смены, конкурсы, гранты", keys: "поиск смены смена артек орлёнок океан сириус лагерь конкурс грант олимпиада школа стажировка возможности" },
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
      '<svg class="map-svg" viewBox="' + MAP.viewBox + '" preserveAspectRatio="xMidYMid meet" role="group" ' +
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
      /* Карта живёт только внутри своего квадрата: при перетаскивании и
         масштабировании подрезаем сдвиг, чтобы фон не уезжал за рамки. */
      state.s = Math.min(6, Math.max(1, state.s));
      var minTx = vbW - state.s * vbW;
      var minTy = vbH - state.s * vbH;
      state.tx = Math.min(0, Math.max(minTx, state.tx));
      state.ty = Math.min(0, Math.max(minTy, state.ty));
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
      '<div class="map-pick__name">Выберите регион</div>' +
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



  function initAdmin() {
    var host = $("[data-admin]");
    if (!host) return;
    bindConfirmDelegation();
    var user = Store ? Store.currentUser() : null;
    if (!user) {
      window.location.replace("/join?next=admin");
      return;
    }

    /* Сама панель — в assets/js/admin.js: вход по правам с сервера, вкладки
       со счётчиками, очереди и карточка человека. Здесь остались разделы,
       которые она подключает как есть: почта, задачи, приём в команду,
       поддержка, заявки в редакции, настройки сайта. */
    if (typeof window.SCAdmin === "function") {
      window.SCAdmin(host, UI, {
        portfolio: mountPortfolioQueue,
        site: mountSite,
        authorsShow: mountAuthorsShow,
        teamChat: mountTeamChat,
        tasks: mountTasksAdmin,
        mail: mountMailClient,
        mailSettings: mountMailSettings,
        hiring: mountHiringAdmin,
        support: mountSupportQueue,
        editorialApps: mountEditorialQueue,
      }, { rowHtml: confirmRowHtml, ready: confirmReady, ask: askConfirm, bind: bindConfirmDelegation });
    } else {
      host.innerHTML = '<section class="section wrap"><p class="no-data">Панель не загрузилась. Обновите страницу.</p></section>';
    }

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
        '<div data-confirm-slot style="display:none"></div>' +
        '<button class="btn btn--sm" type="button" data-pf-load>Показать работы</button></div>' +
        '<p class="form__note" data-pf-status></p></div><div data-pf-list></div>';
      host.appendChild(section);

            var statusEl = $("[data-pf-status]", section);
      var listEl = $("[data-pf-list]", section);
      var slotEl = $("[data-confirm-slot]", section);

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
              function sendReview() {
                btn.disabled = true;
                Store.portfolioReview(id, approve ? "approved" : "rejected", note,
                  pointsEl ? Number(pointsEl.value) || 0 : 5
                ).then(function (r) {
                  btn.disabled = false;
                  if (r && r.needConfirm) { askConfirm(slotEl, statusEl, sendReview); return; }
                  if (!r || !r.ok) {
                    statusEl.textContent = (r && r.error) || "Не удалось сохранить решение.";
                    return;
                  }
                  load();
                });
              }
              sendReview();
            });
          });
        });
      }

      $("[data-pf-load]", section).addEventListener("click", load);
      load();
    }

    /* --- согласия на обработку ПД: проверка сканов ------------------------- */
    /* Обзор: одна цифра на каждый раздел и быстрые переходы. */

    /* Материалы: что ждёт проверки на сервере. */

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

    /* Кого показывать в блоке «Кто делает материалы» на главной: лучших по
       баллам или выбранных вручную. Видят только люди с публикациями. */
    function mountAuthorsShow(host) {
      var old = $("[data-authors-show]");
      if (old) old.remove();
      if (!Store.authorsShowSave) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-authors-show", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Главная</span>' +
        "<h2>Кто делает материалы</h2>" +
        '<p class="sec-head__text">Блок на главной странице. Можно показывать лучших по баллам — ' +
        "или выбрать людей вручную. В список попадают только те, у кого есть опубликованные " +
        "материалы: выдуманных карточек на сайте нет.</p></div></div>" +
        '<div class="panel" style="padding:22px">' +
        '<label class="switch"><input type="radio" name="authors-show-mode" value="points" data-ash-mode>' +
        "<span><b>Лучшие по баллам</b><small>Сортировка по баллам, затем по числу материалов</small></span></label>" +
        '<label class="switch"><input type="radio" name="authors-show-mode" value="manual" data-ash-mode>' +
        "<span><b>Выбрать вручную</b><small>Показываем тех, кого отметите, в вашем порядке</small></span></label>" +
        '<div class="field" style="max-width:220px"><label for="ash-limit">Сколько человек</label>' +
        '<input id="ash-limit" type="number" min="3" max="8" value="6" data-ash-limit></div>' +
        '<div data-ash-people style="margin-top:6px"><p class="form__note">Загружаем список…</p></div>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px">' +
        '<button class="btn btn--accent btn--sm" type="button" data-ash-save>Сохранить</button>' +
        '<span class="form__note" data-ash-status></span></div></div>';
      host.appendChild(section);

      var peopleEl = $("[data-ash-people]", section);
      var limitEl = $("[data-ash-limit]", section);
      var statusEl = $("[data-ash-status]", section);
      var chosen = [];

      function modeNow() {
        var picked = $$("[data-ash-mode]", section).filter(function (el) { return el.checked; })[0];
        return picked ? picked.value : "points";
      }

      function drawPeople(users) {
        var list = (users || []).filter(function (u) {
          return (u.posts || u.published || u.points || 0) && u.status !== "deleted";
        });
        if (!list.length) {
          peopleEl.innerHTML = '<p class="form__note">Пока не у кого выбирать: список появится, ' +
            "когда участники опубликуют первые материалы.</p>";
          return;
        }
        peopleEl.innerHTML = list.map(function (u) {
          return '<label class="authors-show__row"><input type="checkbox" data-ash-pick="' + esc(u.id) + '"' +
            (chosen.indexOf(u.id) !== -1 ? " checked" : "") + ">" +
            "<b>" + esc(u.name) + "</b><small>" + esc(u.email || "") + " · " +
            (u.points || 0) + " б.</small></label>";
        }).join("");
        $$("[data-ash-pick]", peopleEl).forEach(function (box) {
          box.addEventListener("change", function () {
            var id = box.getAttribute("data-ash-pick");
            if (box.checked) {
              if (chosen.indexOf(id) === -1) chosen.push(id);
            } else {
              chosen = chosen.filter(function (x) { return x !== id; });
            }
          });
        });
      }

      Store.authorsShow().then(function (res) {
        if (!res || !res.ok) return;
        limitEl.value = res.limit || 6;
        $$("[data-ash-mode]", section).forEach(function (el) {
          el.checked = el.value === (res.mode || "points");
        });
        chosen = (res.authors || []).map(function (a) { return a.id; });
        if (Store.usersList) {
          Store.usersList().then(function (list) {
            drawPeople((list && list.users) || []);
          }, function () { drawPeople([]); });
        }
      }, function () {
        peopleEl.innerHTML = '<p class="form__note">Список не загрузился: сервер не ответил.</p>';
      });

      $("[data-ash-save]", section).addEventListener("click", function () {
        var mode = modeNow();
        if (mode === "manual" && !chosen.length) {
          statusEl.textContent = "Отметьте хотя бы одного человека.";
          return;
        }
        statusEl.textContent = "Сохраняем…";
        Store.authorsShowSave({
          mode: mode,
          limit: Number(limitEl.value) || 6,
          ids: chosen,
        }).then(function (res) {
          statusEl.textContent = "Сохранено. На главной " + ((res.authors || []).length) + " карточек.";
        }, function (err) {
          statusEl.textContent = (err && err.message) || "Не сохранилось.";
        });
      });
    }

    /* Вкладки: каждая показывает ровно одну панель и поднимает страницу к её началу. */

    /* Люди: список с поиском, по клику — карточка человека со всеми решениями. */
    /* Чат команды: общая лента коротких сообщений для тех, у кого есть
       доступ к панели. Ничего не шифруем и не обещаем: обычный рабочий чат. */
    function mountTeamChat(host) {
      var old = $("[data-team-chat]");
      if (old) old.remove();
      if (!Store.teamChatList) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:6px");
      section.setAttribute("data-team-chat", "");
      section.innerHTML =
        '<div class="chat"><div class="chat__head">' +
        '<span class="kicker">Команда</span><h2>Чат команды</h2>' +
        '<p class="chat__hint">Короткие сообщения между теми, у кого есть доступ к панели. ' +
        "Ленту видят все в редакции.</p></div>" +
        '<div class="chat__log" data-chat-log><p class="form__note">Загружаем сообщения…</p></div>' +
        '<form class="chat__form" data-chat-form>' +
        '<textarea rows="2" data-chat-text maxlength="1500" ' +
        'placeholder="Написать команде: кто чем занят, что нужно сделать"></textarea>' +
        '<button class="btn btn--accent btn--sm" type="submit">Отправить</button></form>' +
        '<p class="form__note" data-chat-note></p></div>';
      host.appendChild(section);

      var logEl = $("[data-chat-log]", section);
      var form = $("[data-chat-form]", section);
      var field = $("[data-chat-text]", section);
      var noteEl = $("[data-chat-note]", section);
      var me = "";

      function draw(messages) {
        if (!messages.length) {
          logEl.innerHTML = '<div class="chat__empty">Пока пусто: напишите первое сообщение — ' +
            "его увидит вся команда.</div>";
          return;
        }
        logEl.innerHTML = messages.map(function (m) {
          var mine = m.from === me;
          return '<div class="chat__msg' + (mine ? " is-mine" : "") + '">' +
            "<b>" + esc(m.from || "участник") + "</b>" +
            (m.role ? '<span class="chat__role">' + esc(m.role) + "</span>" : "") +
            '<div class="chat__text">' + esc(m.text) + "</div>" +
            '<time>' + esc(fmtMailDate(m.createdAt)) + "</time></div>";
        }).join("");
        logEl.scrollTop = logEl.scrollHeight;
      }

      function load() {
        Store.teamChatList().then(function (res) {
          me = res.me || me;
          draw(res.messages || []);
        }, function (err) {
          if (logEl.querySelector(".form__note")) {
            logEl.innerHTML = '<p class="form__note">' + esc((err && err.message) || "Чат недоступен.") + "</p>";
          }
        });
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var text = (field.value || "").trim();
        if (text.length < 1) return;
        var btn = form.querySelector("button");
        btn.disabled = true;
        Store.teamChatSend(text).then(function () {
          btn.disabled = false;
          field.value = "";
          if (noteEl) noteEl.textContent = "";
          load();
        }, function (err) {
          btn.disabled = false;
          if (noteEl) noteEl.textContent = (err && err.message) || "Не отправилось.";
        });
      });

      load();
      var timer = setInterval(function () {
        if (!document.body.contains(section)) { clearInterval(timer); return; }
        if (document.hidden) return;
        load();
      }, 25000);
    }


    /* Диагностика: почему не пускает и что с сервером. */

    /* Почта: настройки SMTP и проверка письмом. Пароль наружу не отдаём. */
    /* --- Задачи команды: у сотрудника — свои, у редакции — все --------- */
    function taskBadge(t) {
      var cls = t.priority === "urgent" ? " task-badge--urgent" : t.priority === "high" ? " task-badge--high" : "";
      return '<span class="task-badge' + cls + '">' + esc(t.priorityLabel || "Обычная") + "</span>";
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
    /* --- Удаление аккаунта из кабинета ---------------------------------- */
    /* --- Почта: ящики домена, чтение, отправка, шаблоны --------------------- */
    function mountMailClient(host) {
      if (!Store.mailBoxes) return;
      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:8px");
      section.setAttribute("data-mail-client", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Почта проекта</span>' +
        "<h2>Почта</h2>" +
        '<p class="sec-head__text">Слева — ящики и папки, в середине письма, справа открытое письмо. ' +
        "Читать, отвечать, пересылать и отправлять можно прямо здесь; пароли ящиков хранятся на " +
        "сервере и в браузер не возвращаются.</p></div></div>" +
        '<div class="mail-app">' +
          '<aside class="mail-side">' +
            '<button class="btn btn--accent btn--sm mail-side__write" type="button" data-mail-write>Написать письмо</button>' +
            '<div class="mail-side__label">Ящики</div>' +
            '<div class="mail-side__boxes" data-mailboxes></div>' +
            '<div class="mail-side__label">Папки</div>' +
            '<div class="mail-side__folders" data-mail-folders></div>' +
            '<div class="mail-side__label">Ещё</div>' +
            '<button class="mail-side__link" type="button" data-mail-drafts>Черновики</button>' +
            '<button class="mail-side__link" type="button" data-mail-templates>Шаблоны писем</button>' +
          "</aside>" +
          '<section class="mail-list-wrap">' +
            '<div class="mail-bar">' +
              '<input type="search" data-mail-q placeholder="Поиск по письмам">' +
              '<button class="btn btn--ghost btn--sm" type="button" data-mail-refresh>Обновить</button>' +
            "</div>" +
            '<p class="mail-state" data-mail-state></p>' +
            '<div class="mail-list" data-mail-list>' +
              '<p class="form__note" style="padding:18px">Загружаем письма…</p></div>' +
          "</section>" +
          '<section class="mail-read" data-mail-read>' +
            '<div class="mail-empty"><b>Письмо не выбрано</b>' +
            "<p>Выберите ящик и папку слева, затем письмо в списке — оно откроется здесь.</p></div>" +
          "</section>" +
        "</div>" +
        '<div data-mail-compose></div>' +
        '<div data-mail-templates-box style="margin-top:14px"></div>';
      host.appendChild(section);

      var boxesEl = $("[data-mailboxes]", section);
      var listEl = $("[data-mail-list]", section);
      var readEl = $("[data-mail-read]", section);
      var composeEl = $("[data-mail-compose]", section);
      var stateEl = $("[data-mail-state]", section);
      var foldersEl = $("[data-mail-folders]", section);
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
          var on = b.key === state.box ? " is-on" : "";
          return '<button class="mail-box' + on + '" type="button" data-box="' + esc(b.key) + '">' +
            '<span class="mail-box__label">' + esc(b.label) +
            (b.ready ? "" : '<span class="mail-box__off">не подключён</span>') + "</span>" +
            '<span class="mail-box__addr">' + esc(b.address) + "</span></button>";
        }).join("") || '<p class="form__note">Ящики не загрузились. Проверьте связь и нажмите «Обновить».</p>';
        $$("[data-box]", boxesEl).forEach(function (b) {
          b.addEventListener("click", function () {
            state.box = b.getAttribute("data-box");
            state.msg = null;
            state.folder = "INBOX";
            readEl.innerHTML = '<div class="mail-empty"><b>Письмо не выбрано</b>' +
              "<p>Выберите письмо в списке.</p></div>";
            drawBoxes();
            loadFolders();
            load();
          });
        });
      }

      /* Папки берём у самого ящика: у редакции их девять, у нового — пять.
         Названия сервера переводим на русский, незнакомые показываем как есть. */
      function folderLabel(name) {
        var low = String(name || "").toLowerCase();
        if (low === "inbox") return "Входящие";
        if (low === "sent" || low === "sent items" || low === "отправленные") return "Отправленные";
        if (low === "drafts" || low === "черновики") return "Черновики";
        if (low === "trash" || low === "deleted" || low === "корзина") return "Корзина";
        if (low === "junk" || low === "spam" || low === "спам") return "Спам";
        if (low === "archive" || low === "архив") return "Архив";
        return name;
      }

      function drawFolders(names) {
        var order = ["inbox", "sent", "drafts", "archive", "junk", "trash"];
        names = (names || []).slice().sort(function (a, b) {
          var ia = order.indexOf(String(a).toLowerCase());
          var ib = order.indexOf(String(b).toLowerCase());
          if (ia < 0) ia = 50;
          if (ib < 0) ib = 50;
          return ia - ib;
        });
        if (!names.length) names = ["INBOX", "Sent", "Drafts", "Archive", "Junk", "Trash"];
        function folderBtn(n) {
          var on = n === state.folder ? " is-on" : "";
          return '<button class="mail-folder' + on + '" type="button" data-folder="' + esc(n) + '">' +
            esc(folderLabel(n)) + "</button>";
        }
        var MAIN = ["inbox", "sent", "drafts", "archive", "junk", "trash"];
        var mainFolders = names.filter(function (n) {
          return MAIN.indexOf(String(n).toLowerCase()) !== -1;
        });
        var otherFolders = names.filter(function (n) {
          return MAIN.indexOf(String(n).toLowerCase()) === -1;
        });
        foldersEl.innerHTML = mainFolders.map(folderBtn).join("") +
          (otherFolders.length
            ? '<details class="mail-more"><summary>Ещё папки · ' + otherFolders.length + "</summary>" +
              otherFolders.map(folderBtn).join("") + "</details>"
            : "");
        $$("[data-folder]", foldersEl).forEach(function (b) {
          b.addEventListener("click", function () {
            state.folder = b.getAttribute("data-folder");
            state.msg = null;
            readEl.innerHTML = '<div class="mail-empty"><b>Письмо не выбрано</b>' +
              "<p>Выберите письмо в списке.</p></div>";
            drawFolders(names);
            load();
          });
        });
      }

      function loadFolders() {
        if (!Store.mailFolders) { drawFolders([]); return; }
        drawFolders([]);
        Store.mailFolders(state.box).then(function (res) {
          drawFolders((res && res.folders) || []);
        }, function () { drawFolders([]); });
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
          var from = String(m.from || "неизвестный");
          var name = from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
          var addr = (from.match(/[^\s<>"]+@[^\s<>"]+/) || [""])[0];
          var letter = String(name || addr || "?").replace(/^\s+/, "").charAt(0).toUpperCase();
          return '<button type="button" class="mail-row' + (m.seen ? "" : " is-unread") +
            (state.msg && state.msg.uid === m.uid ? " is-open" : "") + '" data-uid="' + m.uid + '">' +
            '<span class="mail-row__ava">' + esc(letter) + "</span>" +
            '<span class="mail-row__main">' +
              '<span class="mail-row__top"><span class="mail-row__from">' + esc(name || addr) + "</span>" +
              '<span class="mail-row__date">' + esc(fmtMailDate(m.date)) + "</span></span>" +
              '<span class="mail-row__subj">' + esc(m.subject || "(без темы)") + "</span>" +
              '<span class="mail-row__prev">' + esc(addr) + "</span>" +
            "</span>" +
            (m.flagged ? '<span class="mail-row__star" title="Избранное">★</span>' : "") +
            (m.seen ? "" : '<span class="mail-row__dot" title="Не прочитано"></span>') +
            "</button>";
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
        readEl.innerHTML = '<div class="mail-sheet"><p class="form__note">Загружаем шаблоны…</p></div>';
        Store.mailTemplates().then(function (res) {
          readEl.innerHTML =
            '<div class="mail-sheet"><div class="mail-sheet__head"><span class="kicker">Письма проекта</span>' +
            '<h3>Шаблоны</h3>' +
            '<p class="form__note">Фирменный макет один для всех писем: логотип, заголовок, кнопка, ' +
            "колонтитул и причина получения. Текст можно поправить без правки кода.</p>" +
            "</div>" + '<div class="mail-template-list">' + res.templates.map(function (t) {
              return '<div class="mail-template-row" data-tpl="' + esc(t.key) + '"><div>' +
                "<b>" + esc(t.name) + "</b><br><span class=\"form__note\">" + esc(t.subject) + "</span></div>" +
                '<div class="row" style="gap:6px"><button class="btn btn--ghost btn--sm" type="button" data-tpl-preview="' +
                esc(t.key) + '">Предпросмотр</button>' +
                '<button class="btn btn--ghost btn--sm" type="button" data-tpl-test="' + esc(t.key) + '">Прислать себе</button>' +
                "</div></div>";
            }).join("") + "</div>" +
            '<div data-tpl-preview-box style="margin-top:14px"></div>' +
            '<div data-tpl-log style="margin-top:18px"></div></div>';
          $$("[data-tpl-preview]", readEl).forEach(function (b) {
            b.addEventListener("click", function () {
              Store.mailTemplatePreview(b.getAttribute("data-tpl-preview")).then(function (res) {
                $("[data-tpl-preview-box]", readEl).innerHTML =
                  '<p class="form__note">Тема: ' + esc(res.subject) + "</p>" +
                  '<iframe sandbox="" title="Предпросмотр письма" style="width:100%;height:560px;border:1px solid #ddd;border-radius:10px;background:#fff" ' +
                  "srcdoc=\"" + String(res.html).replace(/"/g, "&quot;") + "\"></iframe>";
              }, function (err) { note(err.message, true); });
            });
          });
          $$("[data-tpl-test]", readEl).forEach(function (b) {
            b.addEventListener("click", function () {
              b.disabled = true;
              Store.mailTemplateTest(b.getAttribute("data-tpl-test")).then(function (res) {
                b.disabled = false;
                note("Тестовое письмо ушло на " + res.to + ".");
              }, function (err) { b.disabled = false; note(err.message, true); });
            });
          });
        }, function (err) {
          readEl.innerHTML = '<div class="mail-sheet"><p class="form__note">' + esc(err.message) + "</p></div>";
        });
      }

      function openDrafts() {
        readEl.innerHTML = '<div class="mail-sheet"><div class="mail-sheet__head">' +
          '<span class="kicker">Почта</span><h3>Черновики</h3>' +
          '<p class="form__note">Письма, которые вы начали и не отправили.</p></div>' +
          '<p class="form__note">Загружаем…</p></div>';
        Store.mailDrafts().then(function (res) {
          readEl.innerHTML = '<div class="mail-sheet"><div class="mail-sheet__head">' +
            '<span class="kicker">Почта</span><h3>Черновики</h3>' +
            '<p class="form__note">Письма, которые вы начали и не отправили.</p></div>' +
            (res.drafts.length
              ? '<div class="mail-sheet__list">' + res.drafts.map(function (d) {
                  return '<div class="mail-sheet__row"><div class="mail-sheet__main">' +
                    "<b>" + esc(d.subject || "(без темы)") + "</b>" +
                    '<span class="form__note">' + esc(d.to || "получатель не указан") + " · " +
                    esc(fmtMailDate(d.updatedAt)) + "</span></div>" +
                    '<div class="row" style="gap:6px">' +
                    '<button class="btn btn--ghost btn--sm" type="button" data-draft-open="' + esc(d.id) + '">Открыть</button>' +
                    '<button class="btn btn--ghost btn--sm" type="button" data-draft-del="' + esc(d.id) + '">Удалить</button>' +
                    "</div></div>";
                }).join("") + "</div>"
              : '<div class="mail-empty"><b>Черновиков нет</b><p>Начните письмо — оно появится здесь, ' +
                "если вы закроете его, не отправив.</p></div>") + "</div>";
          $$("[data-draft-open]", readEl).forEach(function (b) {
            b.addEventListener("click", function () {
              var id = b.getAttribute("data-draft-open");
              var d = res.drafts.filter(function (x) { return x.id === id; })[0];
              if (d) openCompose({ to: d.to, subject: d.subject, text: d.text, draftId: d.id });
            });
          });
          $$("[data-draft-del]", readEl).forEach(function (b) {
            b.addEventListener("click", function () {
              Store.mailDraftDelete(b.getAttribute("data-draft-del")).then(function () { openDrafts(); }, function (e) { note(e.message, true); });
            });
          });
        }, function (err) { note(err.message, true); });
      }

      readEl.innerHTML = '<div class="mail-empty"><b>Письмо не выбрано</b>' +
        "<p>Выберите ящик и папку слева, затем письмо в списке — оно откроется здесь.</p></div>";
      drawFolders([]);
      $("[data-mail-refresh]", section).addEventListener("click", function () { loadFolders(); load(); });
      $("[data-mail-write]", section).addEventListener("click", function () { openCompose({}); });
      $("[data-mail-drafts]", section).addEventListener("click", openDrafts);
      $("[data-mail-templates]", section).addEventListener("click", openTemplates);
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
          note("Ящики ещё не подключены. Раздел «Ящики проекта» ниже — там кнопки проверки.", true);
          listEl.innerHTML = '<p class="form__note" style="padding:18px">Нет ни одного подключённого ящика.</p>';
          return;
        }
        loadFolders();
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

    /* Просмотр очередей кодом не запираем: он нужен только за само решение.
       Сервер ответил «нужен код» — показываем строку подтверждения на месте
       и повторяем действие сами, без повторного нажатия. */
    function askConfirm(slot, noteEl, retry) {
      if (!slot) {
        if (noteEl) noteEl.textContent = "Подтвердите действие кодом из письма.";
        return;
      }
      if (Store.hasConfirm && Store.hasConfirm()) Store.clearConfirm();
      slot.style.display = "";
      slot.innerHTML = confirmRowHtml();
      bindConfirmDelegation();
      if (noteEl) noteEl.textContent = "Подтвердите действие: пришлём шесть цифр на вашу почту.";
      /* одно ожидание на место: повторное нажатие не должно дать два повтора */
      if (slot._waiting) document.removeEventListener("smena:confirmed", slot._waiting);
      var once = function () {
        document.removeEventListener("smena:confirmed", once);
        slot._waiting = null;
        slot.innerHTML = "";
        slot.style.display = "none";
        if (typeof retry === "function") retry();
      };
      slot._waiting = once;
      document.addEventListener("smena:confirmed", once);
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
            try { document.dispatchEvent(new Event("smena:confirmed")); } catch (e) {}
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

    /* --- Кабинет: работа в команде --------------------------------------- */
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
    /* Помощник письма. Ключ DeepSeek уже лежит на сервере: на экране только
       состояние и кнопка проверки. Поле для замены ключа спрятано в
       «Заменить ключ» — чтобы не выглядело, будто ключ нужно вводить заново. */
    function mountMailSettings(host) {
      if (!Store.aiStatus) return;
      var old = $("[data-mail-admin]");
      if (old) old.remove();

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:6px");
      section.setAttribute("data-mail-admin", "");
      section.innerHTML =
        '<div class="panel ai-panel" style="padding:20px" data-ai-panel>' +
        '<span class="kicker">Помощник писем</span>' +
        '<h3 style="margin:6px 0 8px">DeepSeek</h3>' +
        '<p class="form__note">Помощник составляет, сокращает и переводит текст письма. ' +
        "Ключ уже сохранён на сервере — вводить его не нужно и в браузер он не возвращается.</p>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-ai-test>Проверить связь</button>' +
        "</div>" +
        '<p class="form__note" data-ai-note style="margin-top:10px"></p>' +
        '<details class="ai-key"><summary>Заменить ключ</summary>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">' +
        '<input type="password" data-ai-key placeholder="Новый ключ DeepSeek, sk-…" ' +
        'autocomplete="new-password" style="flex:1;min-width:240px;max-width:420px">' +
        '<button class="btn btn--accent btn--sm" type="button" data-ai-save>Сохранить ключ</button>' +
        "</div></details></div>";
      host.appendChild(section);

      var aiNote = $("[data-ai-note]", section);

      function fillAi(ai) {
        if (!aiNote) return;
        aiNote.textContent = ai && ai.ready
          ? "Ключ на сервере, модель " + ai.model +
            (ai.lastTest ? " · проверка: " + (ai.lastTest.ok ? "работает" : ai.lastTest.error) : " · ещё не проверялся")
          : "Ключ не задан — помощник в письмах выключен.";
      }

      Store.aiStatus().then(function (res) { fillAi(res.ai); }, function () {});

      var testAi = $("[data-ai-test]", section);
      if (testAi) testAi.addEventListener("click", function () {
        testAi.disabled = true;
        aiNote.textContent = "Спрашиваем DeepSeek…";
        Store.aiTest().then(function (res) {
          testAi.disabled = false;
          aiNote.textContent = "DeepSeek ответил: «" + res.answer + "». Модель: " + (res.ai && res.ai.model);
        }, function (err) {
          testAi.disabled = false;
          aiNote.textContent = (err && err.message) || "Не ответил.";
        });
      });

      var saveAi = $("[data-ai-save]", section);
      if (saveAi) saveAi.addEventListener("click", function () {
        var keyEl = $("[data-ai-key]", section);
        var key = ((keyEl && keyEl.value) || "").trim();
        if (!key) { aiNote.textContent = "Вставьте новый ключ DeepSeek."; return; }
        saveAi.disabled = true;
        Store.aiSave({ key: key }).then(function (res) {
          saveAi.disabled = false;
          if (keyEl) keyEl.value = "";
          fillAi(res.ai);
        }, function (err) {
          saveAi.disabled = false;
          aiNote.textContent = (err && err.message) || "Не сохранилось.";
        });
      });
    }

    /* Обращения: автор пишет через /support, здесь — очередь и ответ. */
    function mountSupportQueue(host) {
      var old = $("[data-support-admin]");
      if (old) old.remove();
      if (!Store.supportQueue) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-support-admin", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Поддержка</span>' +
        "<h2>Обращения авторов</h2>" +
        '<p class="sec-head__text">Ответ уходит автору письмом — если почта настроена. ' +
        "Если нет, ответ сохраняется здесь, и его можно переслать вручную.</p></div></div>" +
        '<div data-support-admin-list><p class="form__note">Загружаем…</p></div>';
      host.appendChild(section);

      var listEl = $("[data-support-admin-list]", section);

      function draw(items) {
        if (!items.length) {
          listEl.innerHTML = '<div class="fill-note fill-note--flat"><b>Обращений нет</b>' +
            "<p>Новые вопросы появятся здесь сразу после отправки формы на /support.</p></div>";
          return;
        }
        listEl.innerHTML = '<div class="editorial-queue">' + items.map(function (t) {
          return '<div class="editorial-card"><div class="editorial-card__top"><b>' +
            esc(t.name) + " · " + esc(t.topic) + "</b><span>" + esc(fmtDate(t.createdAt)) +
            "</span></div>" +
            '<div class="editorial-card__meta">' + esc(t.email) + " · № " +
            esc(t.id.replace("sp_", "").toUpperCase()) + (t.mailed ? " · письмо ушло" : "") +
            "</div><p>" + esc(t.message) + "</p>" +
            '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +
            '<input class="confirm-input" style="flex:1;min-width:220px" type="text" ' +
            'placeholder="Ответ автору" data-sp-answer="' + esc(t.id) + '">' +
            '<button class="btn btn--accent btn--sm" type="button" data-sp-close="' + esc(t.id) +
            '">Ответить и закрыть</button></div></div>';
        }).join("") + "</div>";

        $$("[data-sp-close]", listEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var id = b.getAttribute("data-sp-close");
            var input = listEl.querySelector('[data-sp-answer="' + id + '"]');
            var answer = input ? input.value.trim() : "";
            if (answer.length < 5) {
              window.alert("Напишите ответ — минимум пять символов.");
              return;
            }
            b.disabled = true;
            Store.supportClose(id, answer).then(function (res) {
              b.disabled = false;
              if (!res.mailed) {
                window.alert("Ответ сохранён. Почта не настроена, поэтому письмо не ушло — " +
                  "перешлите ответ вручную на адрес автора.");
              }
              return Store.supportQueue();
            }).then(draw, function (e) {
              b.disabled = false;
              window.alert(e.message);
            });
          });
        });
      }

      Store.supportQueue().then(draw, function () { draw([]); });
    }

    function mountEditorialQueue(host) {
      var old = $("[data-editorial-admin]");
      if (old) old.remove();
      if (!Store.editorialQueue) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-editorial-admin", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Редакции</span>' +
        "<h2>Заявки в редакции регионов</h2>" +
        '<p class="sec-head__text">Основатель решает сам. Если решения нет семь дней, заявка ' +
        "попадает сюда: центральная комиссия принимает или отказывает с основанием.</p></div></div>" +
        '<div data-editorial-admin-list><p class="form__note">Загружаем…</p></div>';
      host.appendChild(section);

      var listEl = $("[data-editorial-admin-list]", section);

      function draw(items) {
        if (!items.length) {
          listEl.innerHTML = '<div class="fill-note fill-note--flat"><b>Заявок нет</b>' +
            "<p>Новые заявления появятся здесь в тот же момент.</p></div>";
          return;
        }
        listEl.innerHTML = '<div class="editorial-queue">' + items.map(function (a) {
          return '<div class="editorial-card"><div class="editorial-card__top"><b>' + esc(a.name) +
            "</b><span>" + esc(fmtDate(a.createdAt)) +
            (a.escalated ? " · передано комиссии" : "") + "</span></div>" +
            '<div class="editorial-card__meta">' + esc(a.email) + " · " + esc(a.birthDate) +
            " · редакция: " + esc(a.editorialId) + "</div>" +
            "<p>" + esc(a.why) + "</p>" +
            '<div class="row" style="margin-top:10px">' +
            '<button class="btn btn--accent btn--sm" type="button" data-edc-ok="' + esc(a.id) + '">Принять</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-edc-no="' + esc(a.id) + '">Отказать</button>' +
            "</div></div>";
        }).join("") + "</div>";

        $$("[data-edc-ok]", listEl).forEach(function (b) {
          b.addEventListener("click", function () {
            Store.editorialReview(b.getAttribute("data-edc-ok"), "approved", "")
              .then(function () { return Store.editorialQueue(); }).then(draw, function (e) { window.alert(e.message); });
          });
        });
        $$("[data-edc-no]", listEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var note = window.prompt("Основание отказа:", "");
            if (note === null) return;
            if (note.trim().length < 5) { window.alert("Основание — минимум 5 символов."); return; }
            Store.editorialReview(b.getAttribute("data-edc-no"), "rejected", note.trim())
              .then(function () { return Store.editorialQueue(); }).then(draw, function (e) { window.alert(e.message); });
          });
        });
      }

      Store.editorialQueue().then(draw, function () { draw([]); });
    }



  }

  /* 7. Главная ============================================================= */

  function contactEmail() {
    var s = Store ? Store.getSettings() : null;
    return (s && s.org.email) || SC.brand.email || "";
  }

  function pressCardBlock() {
    var all = allArticles();
    var settings = Store ? Store.getSettings() : { card: { prefix: "СК", minPosts: 5 }, org: {} };
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
      esc(String(new Date().getFullYear())) + "-0000</span>" +
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
      var regional = all.slice(1, 7);
      regionalHost.innerHTML =
        (regional.length
          ? regional.map(function (a) { return cardRow(a); }).join("")
          : "") +
        (regional.length < 3
          ? '<div class="fill-note fill-note--top"><b>Историй из регионов пока немного</b>' +
            "<p>Материалов ровно столько, сколько написали авторы — мы не придумываем новости. " +
            "Ваш город может стать следующим на карте.</p></div>" +
            '<div class="region-teaser">' +
            MAP.regions
              .filter(function (x) {
                return ["moskva", "sankt-peterburg", "sevastopol", "donetskaya-narodnaya-respublika",
                  "zaporozhskaya-oblast", "khersonskaya-oblast"].indexOf(x.slug) !== -1;
              })
              .map(function (x) {
                var n = countByRegion(x.slug);
                return '<a class="region-teaser__card" href="' + regionUrl(x.slug) + '">' +
                  '<span class="region-teaser__name">' + esc(x.short || x.name) + "</span>" +
                  '<span class="region-teaser__meta">' + (n ? n + " " + plural(n, ["материал", "материала", "материалов"]) : "авторов пока нет") +
                  "</span></a>";
              })
              .join("") +
            "</div>" +
            '<div class="row" style="margin-top:14px"><a class="btn btn--accent btn--sm" href="/join">' +
            "Стать автором</a>" +
            '<a class="btn btn--ghost btn--sm" href="/#map">Открыть карту</a></div>'
          : "");
    }

    // лица проекта
    var authorsHost = $("[data-authors]");
    if (authorsHost) {
      var faces = (SC.authors || []).slice(0, 8);
      /* Уже опубликовавшие авторы приходят с сервера: редакция решает в
         админке, показывать лучших по баллам или свой список. Пока таких
         нет — честные «места свободны», без выдуманных имён. */
      function drawRealAuthors(list) {
        if (!list || !list.length) return false;
        authorsHost.innerHTML = list
          .map(function (a, i) {
            return '<div class="author-card" data-reveal data-delay="' + (i % 4) + '">' +
              '<span class="author-card__ava">' + esc(a.initials) + "</span>" +
              '<div><div class="author-card__name">' + esc(a.name) + "</div>" +
              '<div class="author-card__role">' + esc(a.role || "автор проекта") +
              (a.regionName || a.region ? " · " + esc(regionName(a.region) || a.region) : "") + "</div>" +
              '<div class="author-card__points">' + (a.points || 0) + " " +
              plural(a.points || 0, ["балл", "балла", "баллов"]) + " · " +
              (a.posts || 0) + " " + plural(a.posts || 0, ["материал", "материала", "материалов"]) +
              "</div></div></div>";
          })
          .join("");
        return true;
      }

      authorsHost.innerHTML = faces.length
        ? faces
            .map(function (a, i) {
              return '<div class="author-card" data-reveal data-delay="' + (i % 4) + '">' +
                '<span class="author-card__ava">' + esc(a.initials) + "</span>" +
                '<div><div class="author-card__name">' + esc(a.name) + "</div>" +
                '<div class="author-card__role">' + esc(a.role) + "</div></div></div>";
            })
            .join("")
        : ["Автор текстов", "Фотограф", "Видеограф"]
            .map(function (role) {
              return '<div class="author-card author-card--slot">' +
                '<span class="author-card__ava" aria-hidden="true">+</span>' +
                '<div><div class="author-card__name">Место свободно</div>' +
                '<div class="author-card__role">' + esc(role) + "</div></div></div>";
            })
            .join("") +
          '<div class="fill-note fill-note--flat"><b>Здесь будут настоящие имена</b>' +
          "<p>Мы не показываем выдуманных авторов: карточки появятся, когда участники " +
          "зарегистрируются и опубликуют первые материалы.</p>" +
          '<a class="btn btn--accent btn--sm" href="/join">Занять место</a></div>';

      if (Store.authorsShow) {
        Store.authorsShow().then(function (res) {
          if (res && res.ok) drawRealAuthors(res.authors || []);
        }, function () {
          /* сервер молчит — остаются места и приглашение */
        });
      }
    }

    // возможности
    var oppHost = $("[data-opportunities]");
    if (oppHost) {
      var opp = all.filter(function (a) { return a.topic === "Возможности"; }).slice(0, 3);
      var fallback = all.slice(0, 3);
      var oppList = opp.length ? opp : fallback;
      oppHost.innerHTML = oppList.length
        ? oppList.map(function (a) { return card(a); }).join("")
        : '<a class="fill-card" href="/media-school"><span class="kicker">Медиашкола</span>' +
          '<b>Учиться делать материалы</b><p>Практика, разборы и наставники: от первой заметки ' +
          'до собственного проекта.</p><span class="fill-card__go">Перейти →</span></a>' +
          '<a class="fill-card" href="/docs"><span class="kicker">Пресс-карта</span>' +
          '<b>Стать автором с картой</b><p>Пять опубликованных материалов — и у вас пресс-карта ' +
          'автора проекта.</p><span class="fill-card__go">Как это работает →</span></a>' +
          '<a class="fill-card" href="/#map"><span class="kicker">Редакции</span>' +
          '<b>Своя редакция в регионе</b><p>Заявление на имя основателя, набор штата и работа ' +
          'с авторами своего региона.</p><span class="fill-card__go">Открыть карту →</span></a>';
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

    /* свой неопубликованный материал: автор должен видеть, как он выглядит,
       и понимать, что на сайте его ещё нет */
    if (!a && id.indexOf("u:") === 0 && Store && user) {
      var own = Store.getPost(id.slice(2));
      if (own && own.authorId === user.id) {
        a = {
          id: id,
          title: own.title,
          excerpt: own.excerpt,
          body: own.body,
          topic: own.topic,
          format: own.format,
          region: own.region,
          image: own.image || "",
          imageAlt: own.imageAlt || "",
          gallery: own.gallery || [],
          video: own.video || "",
          audio: own.audio || "",
          date: own.date,
          read: own.read || 4,
          status: own.status,
          isUserPost: true,
          authorName: user.name,
          authorRole: user.role || "",
          authorRegion: user.region || "",
        };
      }
    }
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
      (!a.status || a.status === "published"
        ? ""
        : '<div class="article-state article-state--' + esc(a.status) + '">' +
          "<b>" + (a.status === "pending"
            ? "Материал ещё не выложен: он на проверке у редакции"
            : a.status === "rejected"
              ? "Материал ещё не выложен: нужны правки"
              : "Это черновик — его видите только вы") + "</b>" +
          "<span>На сайте материал появится после одобрения редакцией. " +
          "Черновик и правки доступны только автору.</span></div>") +
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
      (a.audio
        ? '<div class="article-audio"><span class="kicker">Аудио</span>' +
          '<audio controls preload="metadata" src="' + esc(a.audio) + '"></audio></div>'
        : "") +
      (a.video
        ? '<div class="article-video"><span class="kicker">Видео</span>' +
          '<video controls preload="metadata" playsinline src="' + esc(a.video) + '"></video></div>'
        : "") +
      (a.gallery && a.gallery.length
        ? '<div class="article-gallery"><span class="kicker">Альбом · ' + a.gallery.length + ' ' +
          plural(a.gallery.length, ["кадр", "кадра", "кадров"]) + "</span>" +
          '<div class="article-gallery__grid">' +
          a.gallery
            .map(function (url, i) {
              return '<a class="article-gallery__item" href="' + esc(url) + '" target="_blank" rel="noopener">' +
                '<img src="' + esc(url) + '" alt="Фотография ' + (i + 1) + ' к материалу" loading="lazy"></a>';
            })
            .join("") + "</div></div>"
        : "") +
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
      MAP.regions.filter(function (x) { return x.d; }).map(function (x) {
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
      '<div data-region-editorials></div>' +
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
      '<li><a href="/assets/docs/polozhenie-o-redakcii.pdf" target="_blank" rel="noopener">Кодекс редакции (PDF)</a></li>' +
      '<li><a href="/docs">Все документы</a></li>' +
      "</ul></div>" +
      '<div class="aside-box"><h3>На карте</h3>' +
      '<a class="btn btn--sm btn--ghost btn--block" href="/#map">Открыть всю карту</a></div>' +
      "</aside></div></div>";

    mountRegionEditorials(slug, r);
  }

  /* Редакции региона: список, заявление на вступление и создание своей.
     Заявка без решения семь дней уходит в центральную комиссию — это
     свойство сервера, здесь только показываем статусы. */
  function mountRegionEditorials(slug, region) {
    var host = $("[data-region-editorials]");
    if (!host) return;
    var user = Store ? Store.currentUser() : null;

    host.innerHTML =
      '<div class="sec-head" style="margin-top:0"><div class="sec-head__left">' +
      '<span class="kicker">Редакции</span><h2>Редакции региона</h2>' +
      '<p class="sec-head__text">Руководитель редакции набирает штат сам: смотрит заявление, ' +
      "портфолио и материалы на сайте. Если решения нет семь дней, заявка уходит в центральную " +
      "редакцию проекта — молчание без ответа не допускается.</p></div></div>" +
      '<div class="path-choice" data-path-choice>' +
      '<button class="path-choice__card" type="button" data-path-pick="individual">' +
      '<b>Писать индивидуально</b><span>Свой аккаунт, свои темы, проверка редакции. ' +
      "Пресс-карта — после пяти публикаций.</span></button>" +
      '<button class="path-choice__card" type="button" data-path-pick="editorial">' +
      '<b>Вступить в редакцию региона</b><span>Заявление руководителю редакции, работа в команде, ' +
      "общие проекты. Материалы первым проверяет руководитель.</span></button></div>" +
      '<p class="form__note" data-path-note></p>' +
      '<div class="editorial-list" data-editorial-list><p class="media-empty">Загружаем редакции…</p></div>' +
      (user
        ? '<div class="editorial-actions">' +
          '<button class="btn btn--accent btn--sm" type="button" data-editorial-join>Подать заявление в редакцию</button>' +
          '<a class="btn btn--ghost btn--sm" href="/profile#editorial">Открыть свою редакцию</a>' +
          "</div>" +
          '<div data-editorial-gate></div>' +
          '<form class="editorial-form is-hidden" data-editorial-apply>' +
          '<div class="field"><label for="ed-target">Редакция</label>' +
          '<select id="ed-target" name="editorialId" data-editorial-target></select></div>' +
          '<div class="field"><label for="ed-birth">Дата рождения</label>' +
          '<input id="ed-birth" name="birthDate" type="text" placeholder="ДД.ММ.ГГГГ" maxlength="10"></div>' +
          '<div class="field"><label for="ed-why">Почему именно сюда</label>' +
          '<textarea id="ed-why" name="why" rows="4" maxlength="1200" ' +
          'placeholder="Что вы умеете, что хотите делать в редакции"></textarea></div>' +
          '<div class="field"><label for="ed-files">Личное портфолио (до трёх файлов)</label>' +
          '<input id="ed-files" type="file" accept="image/*,application/pdf" multiple data-editorial-files>' +
          '<p class="field__hint">Материалы с сайта приложатся автоматически.</p></div>' +
          '<div class="row"><button class="btn" type="submit">Отправить заявление</button>' +
          '<span class="form__note" data-editorial-note></span></div></form>'
        : '<div class="editorial-actions"><a class="btn btn--accent btn--sm" href="/join?next=profile">' +
          "Войдите, чтобы вступить в редакцию</a></div>");

    var listEl = $("[data-editorial-list]", host);
    var applyForm = $("[data-editorial-apply]", host);
    var targetSelect = $("[data-editorial-target]", host);
    var gateEl = $("[data-editorial-gate]", host);

    /* Вступить в редакцию можно только с принятым согласием: сервер проверит
       это сам, а здесь сразу говорим человеку, чего не хватает. */
    function consentReady() {
      var c = Store.consent();
      return !!(c && (c.exempt || c.granted));
    }
    function showGate() {
      if (!gateEl) return;
      var c = Store.consent();
      gateEl.innerHTML = '<p class="gate">' + (c && c.status === "pending"
        ? "<b>Согласие на проверке.</b> Заявление в редакцию откроется, как только редакция проекта примет ваше согласие на обработку данных. "
        : "<b>Сначала — согласие на обработку данных.</b> Без него в редакцию не вступить: в заявлении есть ваши персональные данные. ") +
        '<a href="/profile#docs">Открыть «Документы» в кабинете</a></p>';
    }

    function drawList(items) {
      if (!items.length) {
        listEl.innerHTML =
          '<div class="fill-note fill-note--flat"><b>В этом регионе редакции пока нет</b>' +
          "<p>Вы можете открыть её первым: анкета в личном кабинете, заявление на имя директора " +
          'проекта и команда от трёх человек. <a href="/profile#editorial">Как открыть редакцию</a></p></div>';
        if (targetSelect) targetSelect.innerHTML = '<option value="">Редакций нет</option>';
        return;
      }
      listEl.innerHTML = items
        .map(function (e) {
          return '<div class="editorial-card"><div class="editorial-card__top"><b>' + esc(e.name) +
            "</b><span>" + (e.members || 0) + " в штате</span></div>" +
            (e.about ? "<p>" + esc(e.about) + "</p>" : "") +
            '<div class="editorial-card__meta">Руководитель: ' + esc(e.founderName || "назначается") +
            " · " + esc(fmtDate(e.createdAt)) + "</div></div>";
        })
        .join("");
      if (targetSelect) {
        targetSelect.innerHTML = items
          .map(function (e) {
            return '<option value="' + esc(e.id) + '">' + esc(e.name) + "</option>";
          })
          .join("");
      }
    }

    var chosen = "";
    try { chosen = window.localStorage.getItem("smena_path_v1") || ""; } catch (e) {}
    var pathNote = $("[data-path-note]", host);
    function paintPath() {
      $$("[data-path-pick]", host).forEach(function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-path-pick") === chosen);
      });
      if (pathNote) {
        pathNote.textContent = chosen === "individual"
          ? "Выбран путь индивидуального автора: публикуете сами, редакция проверяет материал."
          : chosen === "editorial"
            ? "Выбран путь через редакцию региона: подайте заявление ниже."
            : "Выбор можно поменять в любой момент.";
      }
    }
    $$("[data-path-pick]", host).forEach(function (b) {
      b.addEventListener("click", function () {
        chosen = b.getAttribute("data-path-pick");
        try { window.localStorage.setItem("smena_path_v1", chosen); } catch (e) {}
        paintPath();
        if (chosen === "editorial" && applyForm && loaded.length) openApply(true);
      });
    });
    paintPath();

    function openApply(scroll) {
      if (!applyForm) return;
      if (!consentReady()) {
        applyForm.classList.add("is-hidden");
        showGate();
        if (scroll && gateEl) gateEl.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (gateEl) gateEl.innerHTML = "";
      if (scroll) applyForm.classList.remove("is-hidden"); else applyForm.classList.toggle("is-hidden");
      if (scroll) applyForm.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    var loaded = [];
    Store.editorialList(slug).then(function (items) {
      loaded = items;
      drawList(items);
    });

    if (!user) return;

    var joinBtn = $("[data-editorial-join]", host);
    if (joinBtn && applyForm) {
      joinBtn.addEventListener("click", function () {
        var noteEl = $("[data-path-note]", host);
        if (!loaded.length) {
          if (noteEl) noteEl.textContent = "В этом регионе пока нет редакций. Свою можно открыть через кабинет: кнопка «Открыть свою редакцию».";
          return;
        }
        openApply(false);
      });
    }
    /* свежий статус согласия: человек мог отправить его в соседней вкладке */
    if (Store.refreshConsent) Store.refreshConsent();

    if (applyForm) {
      applyForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var noteEl = $("[data-editorial-note]", host);
        var birthDate = applyForm.querySelector('[name="birthDate"]').value.trim();
        var why = applyForm.querySelector('[name="why"]').value.trim();
        var fileInput = $("[data-editorial-files]", applyForm);
        var files = Array.prototype.slice.call((fileInput && fileInput.files) || []).slice(0, 3);

        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(birthDate)) {
          noteEl.textContent = "Дата рождения в формате ДД.ММ.ГГГГ.";
          return;
        }
        if (why.length < 30) {
          noteEl.textContent = "Расскажите подробнее: минимум 30 символов.";
          return;
        }
        noteEl.textContent = "Готовим заявление…";
        var sitePosts = Store.listPosts({ authorId: user.id, status: "published" }).map(function (p) {
          return p.title;
        });
        files.reduce(function (chain, file) {
          return chain.then(function (acc) {
            return fileToDataUrl(file).then(function (url) { acc.push(url); return acc; });
          });
        }, Promise.resolve([])).then(function (dataUrls) {
          return Store.editorialApply({
            editorialId: targetSelect.value,
            birthDate: birthDate,
            why: why,
            portfolio: dataUrls,
            sitePosts: sitePosts,
          });
        }).then(function () {
          noteEl.innerHTML = 'Заявление отправлено. Руководитель редакции увидит его в кабинете, а статус — у вас: <a href="/profile#editorial">кабинет, вкладка «Редакция»</a>.';
          applyForm.reset();
        }, function (err) {
          if (err && err.needConsent) {
            applyForm.classList.add("is-hidden");
            showGate();
            return;
          }
          noteEl.textContent = (err && err.message) || "Не удалось отправить заявление.";
        });
      });
    }
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

    /* аккаунт, который сохранился только в этом браузере, надо перенести на сервер */
    if (Store && Store.localOnlyAccounts) {
      var local = Store.localOnlyAccounts();
      if (local.length) {
        var box2 = document.createElement("div");
        box2.className = "auth-notice";
        box2.innerHTML = "<b>Аккаунт сохранён только в этом браузере.</b> Войдите с той же почтой " +
          "и паролем на вкладке «Вход» — мы перенесём его на сервер, и он заработает на любом " +
          "устройстве (" + esc(local[0].email) + ").";
        var form2 = $("[data-register-form]", box);
        if (form2 && form2.parentNode) form2.parentNode.insertBefore(box2, form2);
      }
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

    /* восстановление доступа: код или заявка в редакцию */
    var recoveryOpen = $("[data-recovery-open]", box);
    var recoveryPanel = $("[data-recovery-panel]", box);
    if (recoveryOpen && recoveryPanel) {
      recoveryOpen.addEventListener("click", function () {
        recoveryPanel.classList.toggle("is-hidden");
        recoveryOpen.textContent = recoveryPanel.classList.contains("is-hidden")
          ? "Забыли пароль?"
          : "Скрыть восстановление";
      });
    }

    var resetForm = $("[data-recovery-reset]", box);
    if (resetForm) {
      resetForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var d = new FormData(resetForm);
        var err = $("[data-recovery-error]", box);
        var btn = $("button[type=submit]", resetForm);
        if (btn) btn.disabled = true;
        Store.recoveryReset(
          String(d.get("email") || "").trim(),
          String(d.get("code") || "").trim(),
          String(d.get("pass") || "")
        ).then(function (res) {
          if (btn) btn.disabled = false;
          if (res.ok) {
            window.location.href = "/profile?restored=1";
            return;
          }
          if (err) {
            err.textContent = res.error || "Не получилось.";
            err.classList.remove("is-hidden");
          }
        });
      });
    }

    var requestForm = $("[data-recovery-request]", box);
    if (requestForm) {
      requestForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var d = new FormData(requestForm);
        var err = $("[data-recovery-request-error]", box);
        var note = $("[data-recovery-request-note]", box);
        var btn = $("button[type=submit]", requestForm);
        if (btn) btn.disabled = true;
        Store.recoveryRequest(
          String(d.get("email") || "").trim(),
          String(d.get("note") || "").trim()
        ).then(function (res) {
          if (btn) btn.disabled = false;
          if (!res.ok) {
            if (err) {
              err.textContent = res.error || "Заявка не отправилась.";
              err.classList.remove("is-hidden");
            }
            return;
          }
          if (err) err.classList.add("is-hidden");
          if (note) {
            note.textContent = res.mailSent
              ? "Код отправлен на почту. Проверьте входящие и папку «Спам»."
              : "Заявка ушла в редакцию. Код восстановления выдадут вручную — " +
                "ответ придёт на эту почту, когда появится почтовый ящик проекта. " +
                "Пока код не выдан, старый пароль продолжает работать.";
          }
          requestForm.reset();
        });
      });
    }

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
        var out = $("[data-register-error]", box);
        var submitBtn = $("button[type=submit]", regForm);
        if (submitBtn) submitBtn.disabled = true;
        Store.signUp({
          name: data.get("name"),
          email: data.get("email"),
          pass: data.get("pass"),
          region: data.get("region"),
          role: data.get("role"),
        }).then(function (res) {
          if (submitBtn) submitBtn.disabled = false;
          if (!res.ok) {
            out.textContent = res.error;
            out.classList.remove("is-hidden");
            return;
          }
          /* код восстановления показывается один раз: сохраните его,
             иначе доступ возвращается только через заявку в редакцию */
          if (res.recoveryCode) {
            try {
              window.sessionStorage.setItem("smena_recovery_once", res.recoveryCode);
            } catch (e) {}
          }
          /* показываем код восстановления сразу: иначе человек его не увидит */
          /* без кода из письма аккаунт не включится, поэтому сразу ведём
             туда, где этот код вводят, и не обещаем «всё готово» */
          window.location.href = res.pending
            ? "/profile?confirm=1"
            : (res.recoveryCode || next === "/profile" ? "/profile?new=1" : next);
        }, function (err) {
          if (submitBtn) submitBtn.disabled = false;
          out.textContent = (err && err.message) || "Не получилось создать аккаунт. Попробуйте ещё раз.";
          out.classList.remove("is-hidden");
        });
      });
    }

    /* Форма второго шага: почта уже известна, нужен код из письма. */
    function showTwoFactor(email) {
      var old = $("[data-twofa-step]", box);
      if (old) old.remove();
      var step = document.createElement("div");
      step.className = "auth-notice";
      step.setAttribute("data-twofa-step", "");
      step.innerHTML = "<b>Код отправлен на " + esc(email) + ".</b> Введите шесть цифр из письма — " +
        "это второй шаг входа.<div class=\"row\" style=\"gap:8px;margin-top:10px;flex-wrap:wrap\">" +
        '<input class="confirm-input" type="text" inputmode="numeric" maxlength="6" data-twofa-code placeholder="000000" aria-label="Код из письма">' +
        '<button class="btn btn--sm" type="button" data-twofa-go>Войти</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-twofa-back>Назад</button></div>' +
        '<p class="form__note" data-twofa-note></p>';
      var form = $("[data-login-form]", box);
      if (form && form.parentNode) form.parentNode.insertBefore(step, form.nextSibling);
      var note = $("[data-twofa-note]", step);
      $("[data-twofa-go]", step).addEventListener("click", function () {
        var code = ($("[data-twofa-code]", step).value || "").replace(/\D/g, "");
        if (code.length !== 6) { note.textContent = "Код — шесть цифр."; return; }
        $("[data-twofa-go]", step).disabled = true;
        Store.loginTwoFactor(email, code).then(function (res) {
          if (res.ok) { window.location.href = next; return; }
          $("[data-twofa-go]", step).disabled = false;
          note.textContent = res.error || "Код не подошёл.";
        });
      });
      $("[data-twofa-back]", step).addEventListener("click", function () { step.remove(); });
    }

    var loginForm = $("[data-login-form]", box);
    if (loginForm) {
      loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var data = new FormData(loginForm);
        var out = $("[data-login-error]", box);
        var loginBtn = $("button[type=submit]", loginForm);
        if (loginBtn) loginBtn.disabled = true;
        Store.signIn(data.get("email"), data.get("pass")).then(function (res) {
          if (loginBtn) loginBtn.disabled = false;
          /* двухфакторная проверка: просим код из письма */
          if (res && res.needCode) {
            out.classList.add("is-hidden");
            showTwoFactor(res.email || String(data.get("email") || ""));
            return;
          }
          if (!res.ok) {
            out.textContent = res.error;
            out.classList.remove("is-hidden");
            return;
          }
          window.location.href = next;
        }, function (err) {
          if (loginBtn) loginBtn.disabled = false;
          out.textContent = (err && err.message) || "Не удалось войти. Попробуйте ещё раз.";
          out.classList.remove("is-hidden");
        });
      });
    }
  }

  /* Сообщения от редакции: письма, которые администрация отправила из карточки. */
  function mountInbox() {
    var host = $("[data-inbox]");
    if (!host || !Store.messagesMine) return;

    Store.messagesMine().then(function (list) {
      if (!list.length) {
        host.innerHTML = "";
        return;
      }
      var unread = list.filter(function (m) { return !m.read; }).length;
      host.innerHTML =
        '<div class="panel" style="padding:22px">' +
        '<span class="kicker">Связь</span>' +
        '<h3 style="margin:6px 0 10px">Сообщения от редакции' +
        (unread ? " · " + unread + " новых" : "") + "</h3>" +
        '<div class="pcard__list">' + list.slice(0, 5).map(function (m) {
          return '<div class="pcard__line"><span>' + esc(m.text) + "</span><small>" +
            esc(m.from || "редакция") + " · " + esc(fmtDate(m.createdAt)) + "</small></div>";
        }).join("") + "</div>" +
        '<p class="form__note">Ответить можно на письмо или через <a class="link-accent" href="/support">поддержку</a>.</p></div>';
    }, function () {});
  }

  /* Подтверждение почты: пока адрес не подтверждён, показываем спокойную
     карточку. Ничего не блокируем — публикация работает и без неё. */
  function mountEmailCard(user) {
    var host = $("[data-email-card]");
    if (!host || !user) return;

    function draw(verified) {
      if (verified) {
        host.innerHTML =
          '<div class="panel" style="padding:22px">' +
          '<span class="kicker">Почта</span>' +
          '<h3 style="margin:6px 0 8px">Адрес подтверждён</h3>' +
          '<p style="font-size:.94rem;color:var(--ink-soft);margin:0">' +
          esc(user.email) + " — на этот адрес придут коды восстановления и ответы редакции.</p></div>";
        return;
      }
      host.innerHTML =
        '<div class="panel" style="padding:22px">' +
        '<span class="kicker">Почта</span>' +
        '<h3 style="margin:6px 0 8px">Подтвердите адрес</h3>' +
        '<p style="font-size:.94rem;color:var(--ink-soft);margin:0 0 12px">' +
        "Пришлём шестизначный код на " + esc(user.email) + ". Пока адрес не подтверждён, " +
        "аккаунт не включён: отправка материалов, заявки и обращения закрыты. Так чужой " +
        "человек не займёт вашу почту, а письма проекта будут доходить именно вам.</p>" +
        '<div class="row" style="gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-confirm-send>Прислать код</button>' +
        '<input class="confirm-input" type="text" inputmode="numeric" maxlength="6" ' +
        'placeholder="000000" aria-label="Код из письма" data-confirm-code>' +
        '<button class="btn btn--accent btn--sm" type="button" data-confirm-check>Подтвердить</button>' +
        "</div>" +
        '<p class="form__note" data-confirm-status></p></div>';

      var sendBtn = $("[data-confirm-send]", host);
      var checkBtn = $("[data-confirm-check]", host);
      var codeInput = $("[data-confirm-code]", host);
      var status = $("[data-confirm-status]", host);

      if (sendBtn) {
        sendBtn.addEventListener("click", function () {
          sendBtn.disabled = true;
          status.textContent = "Отправляем письмо…";
          Store.confirmSend().then(function () {
            sendBtn.disabled = false;
            status.textContent = "Письмо ушло. Проверьте входящие и папку «Спам».";
            if (codeInput) codeInput.focus();
          }, function (err) {
            sendBtn.disabled = false;
            status.textContent = (err && err.message) || "Письмо не ушло.";
          });
        });
      }

      if (checkBtn) {
        checkBtn.addEventListener("click", function () {
          var code = (codeInput && codeInput.value || "").replace(/\D/g, "");
          if (code.length !== 6) {
            status.textContent = "Код — шесть цифр из письма.";
            return;
          }
          checkBtn.disabled = true;
          Store.confirmCheck(code).then(function () {
            checkBtn.disabled = false;
            var fresh = Store.currentUser();
            draw(!!(fresh && fresh.emailVerified));
          }, function (err) {
            checkBtn.disabled = false;
            status.textContent = (err && err.message) || "Код не подошёл.";
          });
        });
      }
    }

    draw(!!user.emailVerified);

    /* человек пришёл сразу после регистрации: подсвечиваем, что делать */
    if (!user.emailVerified) {
      var host2 = $("[data-profile-status]");
      var fromReg = param("confirm");
      if (host2 && fromReg) {
        host2.textContent = "Аккаунт создан. Ниже введите код из письма — без него действия закрыты.";
        host2.classList.remove("is-hidden");
      }
      var card = host;
      if (card && fromReg && card.scrollIntoView) {
        try { card.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      }
    }
  }

  /* Код восстановления: показываем один раз, потом только по кнопке. */
  function mountRecoveryCard() {
    var host = $("[data-recovery-card]");
    if (!host) return;

    var once = "";
    try {
      once = window.sessionStorage.getItem("smena_recovery_once") || "";
      window.sessionStorage.removeItem("smena_recovery_once");
    } catch (e) {}

    host.innerHTML =
      '<div class="panel" style="padding:22px">' +
      '<span class="kicker">Доступ</span>' +
      '<h3 style="margin:6px 0 8px">Код восстановления</h3>' +
      '<p style="font-size:.94rem;color:var(--ink-soft);margin:0 0 14px">' +
      "Пока почта проекта не подключена, доступ возвращается по коду. Он выдаётся один раз " +
      "и действует, пока не сменён. Храните его отдельно от пароля.</p>" +
      (once
        ? '<div class="recovery__code"><span>Ваш код</span><b data-recovery-value>' + esc(once) +
          "</b><p>Сохраните его сейчас: второй раз он не покажется.</p></div>"
        : '<div class="recovery__code is-hidden" data-recovery-box><span>Ваш новый код</span>' +
          "<b data-recovery-value></b><p>Запишите его. Прежний код больше не действует.</p></div>") +
      '<button class="btn btn--ghost btn--sm" type="button" data-recovery-new>' +
      (once ? "Выдать новый код" : "Показать новый код") + "</button>" +
      '<p class="form__note" data-recovery-status></p></div>';

    var btn = $("[data-recovery-new]", host);
    var box = $("[data-recovery-box]", host);
    var value = $("[data-recovery-value]", host);
    var status = $("[data-recovery-status]", host);

    if (btn) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        Store.recoveryCode().then(function (code) {
          btn.disabled = false;
          if (box) box.classList.remove("is-hidden");
          if (value) value.textContent = code;
          if (status) status.textContent = "Код обновлён. Старый больше не действует.";
        }, function (err) {
          btn.disabled = false;
          if (status) status.textContent = (err && err.message) || "Код не выдался.";
        });
      });
    }
  }

  /* Моя редакция: статусы моих заявлений и решения основателя. */
  /* 12. Личный кабинет =====================================================
     Сам кабинет живёт в assets/js/cabinet.js. Здесь остались блоки, которые
     он подключает: сообщения, почта, задачи, редакция, безопасность. */

  /* Кабинет: эти блоки вызываются со страницы профиля, поэтому живут
     в общем пространстве имён, а не внутри админки. */
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

    /* Опубликованный материал автор не переписывает: правки — через редакцию. */
    if (existing && existing.status === "published") {
      host.innerHTML = authorGateHtml("Материал опубликован",
        "Опубликованный материал правит редакция. Напишите, что нужно изменить, — через поддержку или ответом на письмо о публикации.",
        "/profile#posts", "К материалам", existing.remoteId ? "/article?id=" + encodeURIComponent("s:" + existing.remoteId) : "", "Открыть на сайте");
      return;
    }

    /* Редактор открыт тем, у кого подтверждена почта и принято согласие на
       обработку данных. Решает сервер; здесь — та же проверка заранее, чтобы
       человек не писал текст, который потом не сможет отправить. */
    var consentNow = Store.consent();
    var allowed = !!user.emailVerified && !!(consentNow && (consentNow.granted || consentNow.exempt));
    if (!allowed) {
      if (!initWrite.asked) {
        /* копия в браузере могла устареть — спрашиваем сервер один раз */
        initWrite.asked = true;
        host.innerHTML = '<section class="section wrap"><p class="no-data">Проверяем доступ к редактору…</p></section>';
        var again = function () { initWrite(); };
        Promise.all([Store.refreshMe(), Store.refreshConsent()]).then(again, again);
        return;
      }
      var st = (consentNow && consentNow.status) || "none";
      if (!user.emailVerified) {
        host.innerHTML = authorGateHtml("Сначала подтвердите почту",
          "Редактор откроется после кода из письма. Письмо можно запросить заново в кабинете.",
          "/profile#settings", "Подтвердить почту");
      } else if (st === "pending") {
        host.innerHTML = authorGateHtml("Согласие проверяется",
          "Вы загрузили согласие на обработку персональных данных — редакция его проверяет. Редактор откроется сразу после решения, оно придёт на почту.",
          "/profile#docs", "К документам");
      } else if (st === "rejected") {
        host.innerHTML = authorGateHtml("Согласие не принято",
          (consentNow.note ? "Причина: " + consentNow.note + ". " : "") + "Загрузите исправленный документ — после проверки редактор откроется.",
          "/profile#docs", "К документам");
      } else {
        host.innerHTML = authorGateHtml("Нужно согласие на обработку данных",
          "Имя автора стоит под материалами, а проект хранит вашу почту и тексты — на это по закону нужно письменное согласие. Скачайте бланк, подпишите и загрузите в кабинете.",
          "/profile#docs", "К документам");
      }
      return;
    }

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
        if (!existing) {
          existing = res.post;
          window.history.replaceState({}, "", "/write?id=" + res.post.id);
        }
        var buttons = $$("[data-action]", form);
        buttons.forEach(function (b) { b.disabled = true; });
        setStatus("Отправляем…");
        Store.submitPost(res.post.id).then(function (sent) {
          if (!sent.ok) {
            buttons.forEach(function (b) { b.disabled = false; });
            return setStatus((sent.error || "Не удалось отправить материал.") +
              (sent.offline ? " Черновик сохранён — отправьте его позже из кабинета." : ""), true);
          }
          setStatus(sent.message || "Готово");
          setTimeout(function () {
            window.location.href = sent.direct && sent.remoteId
              ? "/article?id=" + encodeURIComponent("s:" + sent.remoteId)
              : "/profile#posts";
          }, 700);
        });
      } else {
        setStatus("Черновик сохранён");
        if (!existing) {
          existing = res.post;
          window.history.replaceState({}, "", "/write?id=" + res.post.id);
        }
      }
    });
  }

  /* Экран «редактор пока закрыт»: что случилось и куда идти. */
  function authorGateHtml(title, text, href, label, href2, label2) {
    return (
      '<section class="section wrap"><div class="gate gate--page">' +
      '<span class="kicker">Редактор материала</span><h1>' + esc(title) + "</h1>" +
      '<p class="lead">' + esc(text) + "</p>" +
      '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:18px">' +
      '<a class="btn btn--accent" href="' + esc(href) + '">' + esc(label) + "</a>" +
      (href2 ? '<a class="btn btn--ghost" href="' + esc(href2) + '">' + esc(label2) + "</a>" : "") +
      '<a class="btn btn--ghost" href="/profile">В кабинет</a></div></div></section>'
    );
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
    var list = (SC.founders || []).map(founderWithText).filter(function (f) {
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
          ? String(f.bio).split(/\n{2,}/).map(function (par) {
              return '<p class="founder__bio">' + esc(par.trim()) + "</p>";
            }).join("")
          : '<p class="founder__bio">' +
            "Основатель проекта «Смена контента»: молодёжного медиасообщества с редакциями, " +
            "медиашколой и картой регионов.</p>";
        return (
          '<article class="founder founder--page" id="' + esc(f.id || "f" + i) + '">' +
          '<div class="founder__photos">' + photo + alt + "</div>" +
          '<div class="founder__body">' +
          "<h2>" + esc(f.name) + "</h2>" +
          '<p class="founder__role">' + esc(f.role || "Основатель") +
          (f.city ? " · " + esc(f.city) : "") + "</p>" +
          bio +
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

    var list = (SC.founders || []).map(founderWithText).filter(function (f) {
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
          /* в карточке на главной — только первый абзац, целиком биография на /founders */
          '<div class="founder__more"><p>' +
          (esc(String(f.bio || "").split(/\n{2,}/)[0].trim()) || "Основатель проекта «Смена контента».") +
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

  /* Скан документа: фото ужимаем до разумного размера, PDF отдаём как есть.
     Лист согласия должен читаться, но не весить десять мегабайт. */
  function docScanToDataUrl(file) {
    var LIMIT = 2300000;
    if (file.type === "application/pdf") {
      if (file.size > LIMIT) return Promise.reject(new Error("PDF больше 2,3 МБ. Сохраните его в меньшем качестве или загрузите фотографию листа."));
      return fileToDataUrl(file);
    }
    if (file.type.indexOf("image/") !== 0) {
      return Promise.reject(new Error("Нужна фотография (JPG, PNG) или PDF."));
    }
    return fileToDataUrl(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          try {
            var max = 1900;
            var k = Math.min(1, max / Math.max(img.width, img.height));
            var canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * k);
            canvas.height = Math.round(img.height * k);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            var out = canvas.toDataURL("image/jpeg", 0.82);
            resolve(out && out.length > 100 ? out : dataUrl);
          } catch (e) {
            resolve(dataUrl);
          }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      });
    });
  }

  /* data-URL нельзя открыть в новой вкладке напрямую — превращаем во временный адрес */
  function dataUrlToBlobUrl(dataUrl) {
    try {
      var parts = String(dataUrl).split(",");
      var mime = (/data:([^;]+)/.exec(parts[0]) || [])[1] || "application/octet-stream";
      var bin = window.atob(parts[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return window.URL.createObjectURL(new window.Blob([bytes], { type: mime }));
    } catch (e) {
      return "";
    }
  }

  /* Что получают страницы из отдельных файлов (cabinet.js, admin.js,
     pages.js, school.js): те же помощники, что использует этот файл. */
  var UI = {
    $: $, $$: $$, esc: esc, inlineMd: inlineMd, fmtDate: fmtDate, fmtTime: fmtTime, fmtWhen: fmtWhen,
    plural: plural, param: param, regionName: regionName, regionOptions: regionOptions,
    fileToDataUrl: fileToDataUrl, avatarToSquare: avatarToSquare, swatchesHtml: swatchesHtml,
    docScanToDataUrl: docScanToDataUrl, dataUrlToBlobUrl: dataUrlToBlobUrl,
    syncAccent: function () { syncSwatches(readAccent()); },
    initAnimations: function () { initAnimations(); },
    articleUrl: articleUrl, regionUrl: regionUrl,
    SC: SC, MAP: MAP, Store: Store,
    mounts: {
      inbox: mountInbox, emailCard: mountEmailCard, recovery: mountRecoveryCard,
      tasks: mountTasksCabinet, twofa: mountTwofaCard,
      danger: mountDangerZone, hiring: mountHiringCabinet,
    },
  };
  window.SCUI = UI;

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
    /* Кабинет, страницы документов и медиашкола лежат в своих файлах и
       регистрируются в window.SCPages; им передаются общие помощники. */
    var pages = window.SCPages || {};
    if (typeof pages[page] === "function") pages[page](UI);
    if (page === "home") initHome();
    if (page === "news") initNews();
    if (page === "article") initArticle();
    if (page === "region") initRegion();
    if (page === "auth") initAuth();
    if (page === "write") initWrite();
    if (page === "docs") initDocs();
    if (page === "admin") initAdmin();
    if (page === "founders") {
      /* карточки показываем сразу из данных проекта, а после ответа сервера
         дополняем тем, что сохранено в панели */
      initFoundersPage();
      loadFounders(initFoundersPage);
    }
    /* «О проекте»: тот же блок основателей, те же данные с сервера */
    if ($("[data-founders]")) loadFounders(initFounders);
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

  /* основатели не ждут проверки сервера: карточки видны сразу,
     фото и город подтянутся, когда ответит сервер */
  if (document.body && document.body.getAttribute("data-page") === "founders") {
    initFoundersPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", afterServer);
  } else {
    afterServer();
  }
})();
