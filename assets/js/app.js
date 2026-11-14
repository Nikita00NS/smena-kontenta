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

  /* Карточки основателей приходят с сервера (фото, город), но подписи и
     биографии живут в data.js: это текст о людях, а не данные кабинета.
     Запоминаем локальные версии до того, как сервер их подменит. */
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
    for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) out[k] = f[k];
    if (String(local.role || "").trim()) out.role = local.role;
    if (String(local.bio || "").trim()) out.bio = local.bio;
    return out;
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
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  /* Дата и время для писем и чата команды. */
  function fmtMailDate(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) + " " +
      d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
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
    grid:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.6"/>' +
      '<rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/>' +
      '<rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>',
    doc:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>' +
      '<path d="M9 12h6M9 16h6"/></svg>',
    card:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.4"/>' +
      '<path d="M2.5 10h19M6 15h4"/></svg>',
    star:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8 ' +
      '5.2 2.8-1-5.9L20.5 9.8l-5.9-.8z" transform="translate(-2.6)"/></svg>',
    users:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/>' +
      '<path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M16 5.4a3.2 3.2 0 010 6.2"/>' +
      '<path d="M17.5 14.9c2 .7 3.2 2.5 3.2 5.1"/></svg>',
    mail:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.2"/>' +
      '<path d="M3 7l9 6 9-6"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M12 2.8v2.6M12 18.6v2.6M4.5 7.5l2.2 1.3M17.3 15.2l2.2 1.3M4.5 16.5l2.2-1.3' +
      'M17.3 8.8l2.2-1.3"/></svg>',
    school:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><path d="M12 4L2.8 8.4 12 12.8l9.2-4.4z"/>' +
      '<path d="M6 10.6V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.4"/></svg>',
    chart:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><path d="M4 20V4"/><path d="M4 20h16"/>' +
      '<path d="M8 17v-5M12.5 17V8M17 17v-7"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="2" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.4l3.4 2"/></svg>',
    shield:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/>' +
      '<path d="M9 12l2.2 2.2L15.4 10"/></svg>',
    map:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><path d="M9 4.5L3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8z"/>' +
      '<path d="M9 4.5v12.7M15 6.8v12.7"/></svg>',
    inbox:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" aria-hidden="true"><path d="M3.5 13.5L6 5h12l2.5 8.5v5h-17z"/>' +
      '<path d="M3.5 13.5H8l1.4 2.4h5.2l1.4-2.4h4.5"/></svg>',
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

  /* Социальные сети в подвале. Ссылки и логотипы берутся только из
     SC.brand.social (assets/js/data.js) — руками в разметке их не дублируем. */
  function footerSocial() {
    var list = (SC && SC.brand && SC.brand.social) || [];
    if (!list.length) return "";
    var items = list.map(function (item) {
      if (!item || !item.url) return "";
      var label = item.title || item.url;
      return '<li><a class="footer-social__link" href="' + esc(item.url) + '"' +
        ' target="_blank" rel="noopener noreferrer"' +
        ' aria-label="' + esc(item.hint || label) + ' (откроется в новой вкладке)"' +
        ' title="' + esc(item.hint || label) + '">' +
        (item.icon
          ? '<img class="footer-social__icon" src="' + esc(item.icon) + '" alt="" width="24" height="24" loading="lazy">'
          : "") +
        '<span>' + esc(label) + "</span></a></li>";
    }).join("");
    return '<div class="footer-social">' +
      '<div class="footer-social__head">' +
      "<h3>Социальные сети</h3>" +
      "<p>Анонсы конкурсов и жизнь команды. Материалы авторов выходят на сайте.</p>" +
      "</div>" +
      '<ul class="footer-social__list">' + items + "</ul>" +
      "</div>";
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
      "<p>" + esc(SC.brand.tagline) + ". <span>Рассказываем истории из регионов и учим их делать.</span></p>" +
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
      '<li><a href="/verify">Проверка пресс-карты</a></li>' +
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
      footerSocial() +
      '<div class="footer-bottom">' +
      '<span>© ' + (SC.brand.year || new Date().getFullYear()) + " «Смена контента»</span>" +
      '<span class="footer-note">Медиа о молодёжи и регионах России. Участие авторов бесплатное.</span>' +
      '<span class="footer-build" data-no-i18n title="Версия сборки сайта">версия ' +
      esc((SC && SC.build) || "?") + "</span>" +
      '<span><a href="/assets/docs/politika-konfidencialnosti.pdf?v=2026-11-13-9" target="_blank" rel="noopener">Конфиденциальность</a>' +
      ' · <a href="/assets/docs/polzovatelskoe-soglashenie.pdf?v=2026-11-13-9" target="_blank" rel="noopener">Соглашение</a>' +
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

  /* Переходы по разделам главной (#map, #press-card).
     Разметка главной появляется после ответа сервера, а мобильное меню
     держит body под overflow:hidden — обычный переход по ссылке терялся.
     Поэтому клик обрабатываем сами: закрываем меню, снимаем блокировку
     прокрутки и ведём к разделу с учётом высоты шапки. */
  function scrollToHash(hash, smooth) {
    var id = String(hash || "").replace(/^#/, "");
    if (!id) return false;
    var el = document.getElementById(id);
    if (!el) return false;
    var header = $(".site-header");
    var offset = (header ? header.getBoundingClientRect().height : 0) + 14;
    var top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    try {
      window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    } catch (e) {
      window.scrollTo(0, Math.max(0, top));
    }
    return true;
  }

  function initAnchorNav() {
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var a = e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      var m = /^\/?#([A-Za-z0-9_-]+)$/.exec(href);
      if (!m) return;
      var onHome = (document.body.getAttribute("data-page") || "") === "home";
      if (!onHome) return; /* с других страниц пусть браузер откроет главную */
      var id = m[1];
      if (!document.getElementById(id)) return;
      e.preventDefault();
      var menu = $("[data-menu]");
      if (menu) menu.classList.remove("is-open");
      document.body.classList.remove("is-locked");
      try { history.replaceState(null, "", "#" + id); } catch (err) {}
      window.requestAnimationFrame(function () { scrollToHash("#" + id, true); });
    });

    /* первый заход с чужой страницы: ждём, пока раздел отрисуется */
    if (window.location.hash) {
      var tries = 0;
      var timer = window.setInterval(function () {
        tries += 1;
        if (scrollToHash(window.location.hash, false) || tries > 20) {
          window.clearInterval(timer);
        }
      }, 150);
    }
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
      /* Один наблюдатель на страницу. Контент кабинета и панели дорисовывается
         ПОСЛЕ загрузки (паспорт карты, очереди, кнопки) — без пересканирования
         он навсегда оставался бы с opacity:0 и выглядел «сломанным». Поэтому
         наблюдаем и за добавлением узлов: новые data-reveal тоже проявляются. */
      if (!initAnimations.io) {
        initAnimations.io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-in");
            if (entry.target.hasAttribute("data-count")) countUp(entry.target);
            $$("[data-count]", entry.target).forEach(countUp);
            initAnimations.io.unobserve(entry.target);
          });
        }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
        initAnimations.watch = new MutationObserver(function () {
          clearTimeout(initAnimations.timer);
          initAnimations.timer = setTimeout(observeReveals, 60);
        });
        initAnimations.watch.observe(document.body, { childList: true, subtree: true });
      }

      function observeReveals() {
        /* Первый скан — то, что было в HTML сразу (анимируем при прокрутке).
           Всё, что дорисовано ПОСЛЕ (кабинет, панель), показываем мгновенно:
           так новый контент виден всегда, даже если наблюдатель в конкретном
           браузере или вкладке промолчал. */
        var first = !initAnimations.scanned;
        initAnimations.scanned = true;
        $$("[data-reveal], [data-count]").forEach(function (el) {
          if (el.__revealed) return;
          el.__revealed = true;
          if (!first) { el.classList.add("is-in"); return; }
          initAnimations.io.observe(el);
        });
      }
      observeReveals();

      /* страховка: всё, что выше первого экрана, должно быть видно сразу,
         даже если наблюдатель не сработал в конкретном браузере */
      setTimeout(function () {
        $$("#main [data-reveal]").forEach(function (el) {
          var top = el.getBoundingClientRect().top;
          if (top >= 0 && top < window.innerHeight) el.classList.add("is-in");
        });
      }, 900);
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

  function cardStatusBadge(card) {
    var status = card && card.status;
    if (status === "pending") return '<span class="status status--pending">ждёт решения</span>';
    if (status === "issued") return '<span class="status status--pub">действует' +
      (card.number ? " · " + esc(card.number) : "") + "</span>";
    if (status === "expired") return '<span class="status status--rejected">срок истёк</span>';
    if (status === "revoked" || status === "annulled") return '<span class="status status--rejected">отозвана</span>';
    if (status === "rejected") return '<span class="status status--rejected">возвращена</span>';
    return '<span class="status status--draft">нет карты</span>';
  }

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
    if (askConfirm.activeSlot && askConfirm.activeSlot !== slot && askConfirm.activeSlot.isConnected) {
      askConfirm.activeSlot.innerHTML = "";
      askConfirm.activeSlot.style.display = "none";
    }
    if (askConfirm.listener) document.removeEventListener("smena:confirmed", askConfirm.listener);
    askConfirm.activeSlot = slot;
    slot.style.display = "";
    slot.innerHTML = confirmRowHtml();
    bindConfirmDelegation();
    if (noteEl) noteEl.textContent = "Подтвердите действие: пришлём шесть цифр на вашу почту.";
    var once = function () {
      document.removeEventListener("smena:confirmed", once);
      askConfirm.listener = null;
      askConfirm.activeSlot = null;
      slot.innerHTML = "";
      slot.style.display = "none";
      if (typeof retry === "function") retry();
    };
    askConfirm.listener = once;
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
    var isOwner = Store.can(user, "manage");
    function hasCap(cap) { return Store.can(user, cap); }

    /* Роль на сервере могла измениться (выдали или сняли права директора,
       сессия обновилась) — тогда локальная копия расходится с сервером и
       панель выглядит «сломанной»: у одних вкладок нет прав, у других лишние.
       Сверяемся с сервером и при расхождении один раз перезагружаем панель. */
    try {
      Store.whoami && Store.whoami().then(function (info) {
        var srv = info && info.user && (info.user.access || "Пользователь");
        var loc = user.access || "Пользователь";
        if (srv && srv !== loc) {
          var marked = false;
          try {
            if (!sessionStorage.getItem("smena-role-reload")) {
              sessionStorage.setItem("smena-role-reload", "1");
              marked = true;
            }
          } catch (e) { marked = false; }
          if (marked) window.location.reload();
        } else {
          try { sessionStorage.removeItem("smena-role-reload"); } catch (e) {}
        }
      }, function () {});
    } catch (e) {}


    if (!isOwner) {
      /* Понятный экран вместо «доступ только редакции»: кто вы для сервера,
         есть ли директор и что нажать, чтобы получить права. */
      host.innerHTML =
        '<section class="page-hero"><div class="wrap page-hero__grid"><div>' +
        '<span class="kicker">Служебное</span><h1>Нужны права<br>директора</h1></div>' +
        '<div class="page-hero__aside"><p class="lead">Вы вошли как «' + esc(user.name) +
        "», роль: <b>" + esc(user.access || "Пользователь") + "</b>. Панель открывается роли " +
        "«Директор» — её выдаёт владелец проекта паролем редакции.</p>" +
        '<p class="form__note">Если вы владелец и права раньше были, нажмите «Обновить права» — ' +
        "панель сверится с сервером. Первый директор проекта получает права кнопкой ниже.</p></div></div></section>" +
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

    function render() {
      settings = Store.getSettings();
      host.innerHTML =
        '<section class="page-hero"><div class="wrap page-hero__grid"><div>' +
        '<span class="kicker">Служебное</span><h1>Панель<br>проекта</h1></div>' +
        '<div class="page-hero__aside"><p class="lead">Люди, материалы, редакции, карты, ' +
        'почта и состояние сайта — по разделам, без длинной простыни.</p>' +
        '<p class="admin-note">Вы: «' + esc(user.name) + '» · ' + esc(user.access || "Пользователь") +
        ' · версия интерфейса ' + esc((SC && SC.build) || "—") + "</p></div></div></section>" +
        '<div class="admin-layout">' +
        '<nav class="admin-tabs" data-admin-tabs aria-label="Разделы панели"></nav>' +
        '<div class="admin-panels" data-admin-panels></div></div>';

      var panels = $("[data-admin-panels]", host);
      var TABS = [
        ["overview", "Обзор", hasCap("server.diag")],
        ["people", "Люди", hasCap("people.view") || hasCap("people.edit") || hasCap("consents.review")],
        ["hiring", "Приём на работу", hasCap("hiring.view")],
        ["school", "Медиашкола", hasCap("hiring.view")],
        ["content", "Материалы", hasCap("posts.review") || hasCap("portfolio.review")],
        ["editorials", "Редакции", hasCap("editorials.appoint")],
        ["cards", "Карты", hasCap("cards.view") || hasCap("cards.issue")],
        ["support", "Поддержка и почта", hasCap("support.answer") || hasCap("mail.use") || hasCap("mail.manage")],
        ["site", "Сайт", hasCap("site.manage")],
        ["server", "Сервер", hasCap("server.diag")],
      ].filter(function (t) { return t[2]; }).map(function (t) { return [t[0], t[1]]; });
      if (!TABS.length) TABS = [["people", "Люди"]];

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
      /* Каждый раздел изолирован: падение одного не должно ломать остальные. */
      function safeMount(name, el, fn) {
        try {
          fn();
        } catch (e) {
          if (el) el.innerHTML = '<div class="admin-broken"><b>Раздел «' + esc(name) + "» не открылся</b>" +
            "<p>Это сбой интерфейса, а не ваших данных. Обновите страницу — обычно помогает. " +
            "Если повторится, напишите в поддержку и назовите раздел: «" + esc(name) + "».</p>" +
            '<button class="btn btn--sm" type="button" onclick="window.location.reload()">Обновить панель</button></div>';
          if (window.console && console.error) console.error("Раздел панели не открылся:", name, e);
        }
      }
      if (hasCap("server.diag")) safeMount("Обзор", panel("overview"), function () { mountOverview(panel("overview")); });
      if (hasCap("people.view")) safeMount("Люди", panel("people"), function () { mountPeople(panel("people")); });
      if (hasCap("people.edit")) safeMount("Чат команды", panel("people"), function () { mountTeamChat(panel("people")); });
      if (hasCap("consents.review")) safeMount("Согласия", panel("people"), function () { mountConsentQueue(panel("people")); });
      if (hasCap("people.edit")) safeMount("Задачи", panel("people"), function () { mountTasksAdmin(panel("people")); });
      if (hasCap("posts.review")) safeMount("Материалы", panel("content"), function () { mountContent(panel("content")); });
      if (hasCap("portfolio.review")) safeMount("Портфолио", panel("content"), function () { mountPortfolioQueue(panel("content")); });
      if (hasCap("editorials.appoint")) safeMount("Редакции", panel("editorials"), function () { mountEditorialQueue(panel("editorials")); });
      if (hasCap("cards.view") || hasCap("cards.issue")) safeMount("Карты", panel("cards"), function () { mountCardQueue(panel("cards")); });
      if (hasCap("support.answer")) safeMount("Поддержка", panel("support"), function () { mountSupportQueue(panel("support")); });
      if (hasCap("mail.use")) safeMount("Почта", panel("support"), function () { mountMailClient(panel("support")); });
      if (hasCap("mail.manage")) safeMount("Настройки почты", panel("support"), function () { mountMailSettings(panel("support")); });
      if (hasCap("hiring.view")) safeMount("Приём на работу", panel("hiring"), function () { mountHiringAdmin(panel("hiring")); });
      if (hasCap("hiring.view")) safeMount("Медиашкола", panel("school"), function () { mountSchoolAdmin(panel("school")); });
      if (hasCap("site.manage")) safeMount("Сайт", panel("site"), function () { mountSite(panel("site")); });
      if (hasCap("site.manage")) safeMount("Показ авторов", panel("site"), function () { mountAuthorsShow(panel("site")); });
      if (hasCap("server.diag")) safeMount("Сервер", panel("server"), function () { mountDiag(panel("server")); });

      try { buildAdminTabs(host, TABS); } catch (e) {
        if (window.console && console.error) console.error("Вкладки панели не собрались:", e);
      }
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
                }, function (err) {
                  btn.disabled = false;
                  if (err && err.needConfirm) { askConfirm(slotEl, statusEl, sendReview); return; }
                  statusEl.textContent = (err && err.message) || "Не удалось сохранить решение.";
                });
              }
              sendReview();
            });
          });
        }, function (err) {
          statusEl.textContent = (err && err.message) || "Не удалось загрузить работы.";
          listEl.innerHTML = "";
        });
      }

      $("[data-pf-load]", section).addEventListener("click", load);
      load();
    }

    /* --- согласия на обработку ПД: проверка сканов ------------------------- */
    /* Обзор: одна цифра на каждый раздел и быстрые переходы. */
    /* «Пульт редакции»: что ждёт решения, последние действия и быстрые переходы.
       Одна страница вместо семи — редакция видит всю работу сразу. */
    function mountOverview(host) {
      var old = $("[data-admin-overview]");
      if (old) old.remove();

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-admin-overview", "");
      section.setAttribute("data-admin-block", "overview");
      var today = new Date().toLocaleDateString("ru-RU", {
        weekday: "long", day: "numeric", month: "long",
      });
      section.innerHTML =
        '<div class="pulse-head"><div><span class="kicker">Пульт редакции</span>' +
        "<h2>Здравствуйте, " + esc(user.name) + "</h2>" +
        '<p class="pulse-head__date">' + esc(today) + " · " + esc(user.access || "Пользователь") + "</p></div>" +
        '<div class="pulse-head__actions">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-go-tab="server">Проверить сервер</button>' +
        '<button class="btn btn--sm" type="button" data-maint-toggle>Режим работ…</button>' +
        "</div></div>" +
        '<div class="overview" data-overview-cards><p class="form__note">Считаем…</p></div>' +
        '<div class="pulse-cols">' +
        '<div class="pulse-card"><div class="pulse-card__head"><span class="kicker">Требуют решения</span>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-pulse-refresh>Обновить</button></div>' +
        '<div data-pulse-queues><p class="form__note">Загружаем очереди…</p></div></div>' +
        '<div class="pulse-card"><div class="pulse-card__head"><span class="kicker">Последние действия</span></div>' +
        '<div data-pulse-audit><p class="form__note">Загружаем журнал…</p></div></div>' +
        "</div>";
      host.appendChild(section);

      var cards = $("[data-overview-cards]", section);
      var queuesEl = $("[data-pulse-queues]", section);
      var auditEl = $("[data-pulse-audit]", section);

      function tile(tab, label, value, hint) {
        return '<button class="overview__tile" type="button" data-go-tab="' + tab + '">' +
          "<b>" + esc(String(value)) + "</b><span>" + esc(label) + "</span>" +
          (hint ? "<small>" + esc(hint) + "</small>" : "") + "</button>";
      }

      function queueRow(tab, icon, label, count, hint) {
        var n = Number(count) || 0;
        return '<div class="pulse-row' + (n ? "" : " is-empty") + '">' +
          '<span class="pulse-row__icon">' + (ICONS[icon] || "") + "</span>" +
          '<span class="pulse-row__text"><b>' + esc(label) + "</b>" +
          (hint ? "<small>" + esc(hint) + "</small>" : "") + "</span>" +
          '<span class="pulse-row__count">' + n + "</span>" +
          '<button class="btn btn--ghost btn--sm" type="button" data-go-tab="' + tab + '">' +
          (n ? "Разобрать" : "Открыть") + "</button></div>";
      }

      function goTabs() {
        $$("[data-go-tab]", section).forEach(function (b) {
          b.addEventListener("click", function () {
            var navBtn = $('[data-admin-tab="' + b.getAttribute("data-go-tab") + '"]');
            if (navBtn) navBtn.click();
          });
        });
      }

      function load() {
        Store.diag().then(function (d) {
          if (!d) {
            cards.innerHTML = '<p class="form__note">Сервер не отвечает — проверьте блок «Сервер».</p>';
            queuesEl.innerHTML = "";
            return;
          }
          (Store.usersList ? Store.usersList() : Promise.resolve({ users: [] })).then(function (res) {
            var people = res.users || [];
            var staff = people.filter(function (u) {
              return u.access && u.access !== "Пользователь";
            }).length;
            cards.innerHTML =
              tile("people", "участников", people.length, staff + " со служебной ролью") +
              tile("editorials", "редакций", d.editorials || 0, "в регионах") +
              tile("content", "материалов", d.posts || 0, "на сайте") +
              tile("cards", "заявок на карту", d.cards_pending || 0, "ждут решения") +
              tile("support", "обращений", d.support_open || 0, "открыты") +
              tile("hiring", "заявок на работу", d.hiring_open || 0, "ждут решения") +
              tile("school", "заявок в школу", d.school_open || 0, "ждут решения");

            var rows = [];
            var badges = {};
            var jobs = [];

            function addJob(cap, run, build) {
              if (!hasCap(cap)) return;
              jobs.push(Promise.resolve().then(run).then(build, function () { return null; }));
            }

            addJob("posts.review", function () { return Store.apiPendingQueue(); }, function (items) {
              var n = (items || []).length;
              badges.content = n;
              rows.push(queueRow("content", "doc", "Материалы на проверке", n, "публикация или возврат на правки"));
            });
            addJob("portfolio.review", function () { return Store.portfolioQueue(); }, function (res) {
              var n = ((res && res.items) || []).filter(function (i) { return i.status === "pending"; }).length;
              rows.push(queueRow("content", "star", "Работы в портфолио", n, "оценка и баллы авторам"));
            });
            addJob("consents.review", function () { return Store.consentQueue(""); }, function (res) {
              var n = ((res && res.consents) || []).filter(function (c) { return c.status === "pending"; }).length;
              rows.push(queueRow("people", "shield", "Согласия на проверку", n, "обработка и распространение ПД"));
            });
            if (hasCap("cards.view") || hasCap("cards.issue")) {
              badges.cards = d.cards_pending || 0;
              rows.push(queueRow("cards", "card", "Заявки на пресс-карту", d.cards_pending || 0, "выдача и проверка"));
            }
            if (hasCap("support.answer") || hasCap("mail.use")) {
              badges.support = d.support_open || 0;
              rows.push(queueRow("support", "inbox", "Обращения в поддержку", d.support_open || 0, "ответы и почта"));
            }
            if (hasCap("hiring.view")) {
              badges.hiring = d.hiring_open || 0;
              rows.push(queueRow("hiring", "mail", "Заявки на работу", d.hiring_open || 0, "приём в команду"));
            }
            if (hasCap("hiring.view")) {
              badges.school = d.school_open || 0;
              rows.push(queueRow("school", "school", "Заявки в медиашколу", d.school_open || 0, "обучение авторов"));
            }
            if (hasCap("people.view")) {
              rows.push(queueRow("people", "users", "Почты ждут подтверждения", d.pending_email || 0, "аккаунты без верификации"));
            }

            Promise.all(jobs).then(function () {
              setAdminBadges(badges);
              queuesEl.innerHTML = rows.length
                ? rows.join("")
                : '<p class="form__note">У вас нет очередей: все разделы, к которым есть доступ, пусты.</p>';
              goTabs();
            });

            var maintBtn = $("[data-maint-toggle]", section);
            if (maintBtn) {
              maintBtn.textContent = d.maintenance ? "Снять режим работ" : "Режим работ…";
              maintBtn.classList.toggle("btn--accent", !!d.maintenance);
              maintBtn.classList.toggle("btn--ghost", !d.maintenance);
              maintBtn.addEventListener("click", function () {
                var next = !d.maintenance;
                if (next && !window.confirm("Закрыть сайт для посетителей? Редакция продолжит работать в панели.")) return;
                maintBtn.disabled = true;
                Store.siteStatus().then(function (site) {
                  return Store.siteSave({
                    maintenance: next,
                    noticeOn: !!(site && site.noticeOn),
                    notice: (site && site.notice) || "",
                  });
                }).then(function () {
                  window.location.reload();
                }, function (err) {
                  maintBtn.disabled = false;
                  maintBtn.textContent = (err && err.message) || "Не сохранилось.";
                });
              });
            }
          });
        }, function () {
          cards.innerHTML = '<p class="form__note">Не удалось получить сводку.</p>';
        });

        if (Store.adminLog) {
          var auditAll = [];
          var auditFilter = "all";
          var AUDIT_CHIPS = [
            ["all", "Все"], ["posts", "Материалы"], ["cards", "Карты"], ["consents", "Согласия"],
            ["people", "Команда и школа"], ["site", "Почта и сайт"],
          ];
          function auditKind(action) {
            action = String(action || "").toLowerCase();
            if (/card|карт/.test(action)) return "cards";
            if (/consent|соглас/.test(action)) return "consents";
            if (/hiring|school|медиашкол|приём|команд|сотрудник|редакц/.test(action)) return "people";
            if (/mail|почт|site|сайт|support|поддержк|status|вход/.test(action)) return "site";
            return "posts";
          }
          function drawAudit() {
            var rows = auditAll.filter(function (e) {
              return auditFilter === "all" || auditKind(e.action) === auditFilter;
            }).slice(0, 8);
            auditEl.innerHTML =
              '<div class="audit-chips">' + AUDIT_CHIPS.map(function (c) {
                return '<button class="chip-sm' + (auditFilter === c[0] ? " is-on" : "") +
                  '" type="button" data-audit-chip="' + c[0] + '">' + c[1] + "</button>";
              }).join("") + "</div>" +
              (rows.length
                ? rows.map(function (e) {
                    return '<div class="pulse-audit__row"><span>' + esc(fmtWhen(e.at)) + " · " + esc(e.who) +
                      "</span><b>" + esc(e.action) + (e.details ? " — " + esc(e.details) : "") + "</b></div>";
                  }).join("")
                : '<p class="form__note">В этой категории действий пока нет.</p>');
            $$("[data-audit-chip]", auditEl).forEach(function (b) {
              b.addEventListener("click", function () {
                auditFilter = b.getAttribute("data-audit-chip");
                drawAudit();
              });
            });
          }
          Store.adminLog().then(function (res) {
            auditAll = ((res && res.entries) || []).slice(0, 60);
            drawAudit();
          }, function () {
            auditEl.innerHTML = '<p class="form__note">Журнал недоступен.</p>';
          });
        } else {
          auditEl.innerHTML = '<p class="form__note">Журнал недоступен.</p>';
        }
      }

      var refreshBtn = $("[data-pulse-refresh]", section);
      if (refreshBtn) refreshBtn.addEventListener("click", load);
      load();
    }

    /* Материалы: очередь и решения на сервере, с подтверждением кодом. */
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
        "Решение принимает редакция; для возврата на правки нужно замечание автору.</p></div></div>" +
        '<div class="panel"><div data-confirm-slot style="display:none"></div>' +
        '<p class="form__note" data-content-status>Загружаем очередь…</p></div>' +
        '<div data-admin-content-list></div>';
      host.appendChild(section);

      var listEl = $("[data-admin-content-list]", section);
      var statusEl = $("[data-content-status]", section);
      var slotEl = $("[data-confirm-slot]", section);

      function row(p) {
        var body = Array.isArray(p.body) ? p.body.join("\n\n") : String(p.body || "");
        return (
          '<div class="admin-review" data-review-row="' + esc(p.id) + '">' +
          '<div class="admin-review__top"><b>' + esc(p.title) + "</b>" +
          '<span class="status status--pending">на проверке</span></div>' +
          '<div class="admin-review__meta">' + esc(p.authorName || "Автор") + " · " + esc(p.format || "") +
          " · " + esc(regionName(p.region) || "регион не выбран") + " · " + esc(fmtDate(p.date)) + "</div>" +
          '<p class="admin-review__excerpt">' + esc(p.excerpt || "") + "</p>" +
          (body ? '<details class="admin-review__text"><summary>Читать материал</summary><div>' +
            body.split(/\n{2,}/).map(function (par) { return "<p>" + esc(par) + "</p>"; }).join("") +
            "</div></details>" : "") +
          '<div class="admin-review__actions">' +
          '<input class="admin-review__note" type="text" placeholder="Замечание автору (обязательно для возврата)" data-note="' + esc(p.id) + '">' +
          '<button class="btn btn--sm" type="button" data-approve="' + esc(p.id) + '">Опубликовать</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-reject="' + esc(p.id) + '">Вернуть на правки</button>' +
          "</div></div>"
        );
      }

      function load() {
        statusEl.textContent = "Загружаем очередь…";
        Store.apiPendingQueue().then(function (items) {
          items = items || [];
          statusEl.textContent = items.length ? "Ждут решения: " + items.length + "." : "Очередь пуста.";
          listEl.innerHTML = items.length
            ? items.map(row).join("")
            : '<div class="fill-note fill-note--flat"><b>Очередь пуста</b>' +
              "<p>Новые материалы появятся здесь сразу после отправки из редактора.</p></div>";

          $$("[data-approve], [data-reject]", listEl).forEach(function (btn) {
            btn.addEventListener("click", function () {
              var approve = btn.hasAttribute("data-approve");
              var id = btn.getAttribute("data-approve") || btn.getAttribute("data-reject");
              var noteEl = $('[data-note="' + id + '"]', listEl);
              var note = noteEl ? noteEl.value.trim() : "";
              if (!approve && note.length < 5) {
                statusEl.textContent = "Для возврата на правки напишите замечание — не короче пяти символов.";
                if (noteEl) noteEl.focus();
                return;
              }
              function sendReview() {
                btn.disabled = true;
                Store.apiReview("", id, approve ? "approve" : "reject", note).then(function (r) {
                  btn.disabled = false;
                  if (r && r.needConfirm) { askConfirm(slotEl, statusEl, sendReview); return; }
                  if (!r || !r.ok) {
                    statusEl.textContent = (r && r.error) || "Не удалось сохранить решение.";
                    return;
                  }
                  load();
                }, function (err) {
                  btn.disabled = false;
                  if (err && err.needConfirm) { askConfirm(slotEl, statusEl, sendReview); return; }
                  statusEl.textContent = (err && err.message) || "Не удалось сохранить решение.";
                });
              }
              sendReview();
            });
          });
        }, function () {
          statusEl.textContent = "Не удалось загрузить очередь. Проверьте связь и обновите страницу.";
          listEl.innerHTML = "";
        });
      }

      load();
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
    var TAB_ICONS = {
      overview: "chart", people: "users", hiring: "mail", school: "school", content: "doc",
      editorials: "map", cards: "card", support: "inbox", site: "settings", server: "shield",
    };

    /* Бейджи на вкладках: сколько ждёт решения. Обновляет «Пульт». */
    function setAdminBadges(counts) {
      Object.keys(counts || {}).forEach(function (id) {
        var badge = document.querySelector('[data-admin-badge="' + id + '"]');
        if (!badge) return;
        var n = Number(counts[id]) || 0;
        badge.hidden = n <= 0;
        badge.textContent = n > 99 ? "99+" : String(n);
      });
    }

    function buildAdminTabs(host, TABS) {
      var nav = $("[data-admin-tabs]", host);
      if (!nav) return;
      nav.innerHTML = TABS.map(function (t) {
        return '<button class="admin-tabs__btn" type="button" data-admin-tab="' + t[0] + '">' +
          (ICONS[TAB_ICONS[t[0]]] || "") +
          '<span class="admin-tabs__label">' + esc(t[1]) + "</span>" +
          '<b class="admin-tabs__badge" data-admin-badge="' + t[0] + '" hidden></b></button>';
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
      /* «Почта» раньше была отдельной вкладкой — теперь живёт внутри поддержки */
      if (saved === "mail") saved = "support";
      var exists = TABS.some(function (t) { return t[0] === saved; });
      show(exists ? saved : TABS[0][0]);
    }

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

    function mountPeople(host) {
      if (!Store.usersList) return;

      host.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Люди</span>' +
        "<h2>Участники проекта</h2>" +
        '<p class="sec-head__text">Нажмите на человека — откроется карточка: профиль, материалы, ' +
        "заявления, пресс-карта и переписка. Всё решается на одном экране.</p></div>" +
        '<div class="people-search"><input type="search" placeholder="Поиск: имя или почта" ' +
        'data-people-search aria-label="Поиск участника">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-people-csv>Скачать CSV</button></div></div>' +
        '<div class="people-cats" data-people-cats>' +
        '<button class="people-cat is-on" type="button" data-cat="all">Все</button>' +
        '<button class="people-cat" type="button" data-cat="team">Команда</button>' +
        '<button class="people-cat" type="button" data-cat="members">Участники</button>' +
        '<button class="people-cat" type="button" data-cat="requests">Заявки</button>' +
        "</div>" +
        '<div data-people-list><p class="form__note">Загружаем участников…</p></div>' +
        '<div data-person-card></div>';

      var listEl = $("[data-people-list]", host);
      var cardEl = $("[data-person-card]", host);
      var searchEl = $("[data-people-search]", host);
      var all = [];
      var csvBtn = $("[data-people-csv]", host);
      if (csvBtn) csvBtn.addEventListener("click", function () {
        if (!all.length) return;
        var head = "Имя;Почта;Роль;Доступ;Регион;Регистрация";
        var lines = all.map(function (u) {
          return [u.name, u.email, u.role || "", u.access || "Пользователь", u.region || "", u.createdAt || ""]
            .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";");
        });
        var blob = new Blob(["\uFEFF" + head + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "smena-lyudi.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      });
      var roles = Store.ACCESS || [];
      var openedId = "";
      var needScroll = false;
      var cat = "all";

      function chip(access) {
        var cls = access === "Директор" ? "status--pub"
          : access === "Пользователь" ? "status--draft" : "status--pending";
        return '<span class="status ' + cls + '">' + esc(access || "Пользователь") + "</span>";
      }

      function isStaff(u) {
        return !!u.access && u.access !== "Пользователь";
      }

      function draw() {
        var q = ((searchEl && searchEl.value) || "").trim().toLowerCase();
        var list = all.filter(function (u) {
          if (cat === "team" && !isStaff(u)) return false;
          if (cat === "members" && isStaff(u)) return false;
          if (cat === "requests" && !(u.hasRequests || u.recoveryOpen)) return false;
          if (!q) return true;
          return (u.name || "").toLowerCase().indexOf(q) !== -1 ||
            (u.email || "").toLowerCase().indexOf(q) !== -1;
        });

        var counts = {
          all: all.length,
          team: all.filter(isStaff).length,
          members: all.filter(function (u) { return !isStaff(u); }).length,
          requests: all.filter(function (u) { return u.hasRequests || u.recoveryOpen; }).length,
        };
        $$("[data-cat]", host).forEach(function (b) {
          var key = b.getAttribute("data-cat");
          b.classList.toggle("is-on", key === cat);
          var n = counts[key] || 0;
          b.textContent = { all: "Все", team: "Команда", members: "Участники", requests: "Заявки" }[key] +
            " · " + n;
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
          var docKind = c.kind === "distribution" ? "distribution" : "processing";
          var docTitle = docKind === "distribution"
            ? "Согласие на распространение ПД (конкурсы)"
            : "Согласие на обработку ПД";
          rows.push('<div class="pcard__line"><span>' + docTitle + "</span><small>" +
            esc(ED[c.status] || "ждёт решения") + "</small>" +
            (c.status !== "approved"
              ? '<span class="pcard__actions"><button class="btn btn--sm" type="button" ' +
                'data-consent-ok="' + docKind + '">Принять</button>' +
                '<button class="btn btn--ghost btn--sm" type="button" ' +
                'data-consent-no="' + docKind + '">Отклонить</button></span>'
              : "<span></span>") + "</div>");
        });

        (d.cards || []).forEach(function (c) {
          var label = c.status === "issued" ? "действует " + (c.number || "")
            : c.status === "pending" ? "заявка ждёт решения"
              : c.status === "expired" ? "срок истёк"
                : c.status === "revoked" || c.status === "annulled" ? "отозвана" : "возвращена";
          if (c.validUntil && (c.status === "issued" || c.status === "expired")) label += " · до " + fmtDate(c.validUntil);
          rows.push('<div class="pcard__line"><span>Пресс-карта</span><small>' + esc(label) + "</small><span></span></div>");
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
            esc(r.id) + '">Выдать код</button><button class="btn btn--ghost btn--sm" type="button" ' +
            'data-rc-close="' + esc(r.id) + '">Закрыть</button></span></div>');
        });

        return rows.length ? '<div class="pcard__list">' + rows.join("") + "</div>"
          : '<p class="form__note">Заявлений нет.</p>';
      }

      function renderCard(d) {
        var u = d.user;
        var cards = d.cards || [];
        var issued = cards.filter(function (c) { return c.status === "issued"; })[0];
        var pendingCard = cards.filter(function (c) { return c.status === "pending"; })[0];
        var lifeCard = issued || cards.filter(function (c) { return c.status === "expired"; })[0];
        var founded = (d.editorialsFounded || [])[0];

        cardEl.innerHTML =
          '<div class="pcard">' +
          '<div class="pcard__head"><div><h3>' + esc(u.name) + "</h3>" +
          '<p class="pcard__sub">' + esc(u.email) + " · " + esc(regionName(u.region) || "регион не указан") +
          " · с " + esc(fmtDate(u.createdAt)) + "</p></div>" +
          '<div class="pcard__badges"><button class="btn btn--ghost btn--sm" type="button" data-close-card>Свернуть</button>' +
          chip(u.access) +
          (u.emailVerified ? '<span class="status status--pub">почта подтверждена</span>'
            : '<span class="status status--draft">почта не подтверждена</span>') + "</div></div>" +

          '<div data-confirm-slot style="display:none"></div>' +
          '<div class="pcard__grid">' +
          '<div class="pcard__col"><span class="kicker">Профиль</span>' +
          '<div class="field"><label>Имя и фамилия</label><input type="text" data-pf-name value="' +
          esc(u.name) + '"></div>' +
          '<div class="field"><label>Почта для входа</label><input type="email" data-pf-email value="' +
          esc(u.email) + '" autocomplete="off">' +
          '<small class="form__note">После смены адреса человек подтвердит его кодом из письма.</small></div>' +
          '<div class="field"><label>Регион</label><select data-pf-region>' +
          regionOptions(u.region) + "</select></div>" +
          '<div class="field"><label>Роль (права)</label><select data-pf-access>' +
          roles.map(function (r) {
            return '<option' + (r === u.access ? " selected" : "") + ">" + esc(r) + "</option>";
          }).join("") + "</select></div>" +
          '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
          '<button class="btn btn--accent btn--sm" type="button" data-pf-save>Сохранить</button>' +
          '<span class="form__note" data-pf-note></span></div>' +
          "</div>" +

          '<div class="pcard__col"><span class="kicker">Итоги</span><div class="diag">' +
          '<div class="diag__row"><span>Опубликовано</span><b>' + (d.published || 0) + "</b></div>" +
          '<div class="diag__row"><span>Всего материалов</span><b>' + (d.posts || []).length + "</b></div>" +
          '<div class="diag__row"><span>Пресс-карта</span><b>' +
            (issued ? esc(issued.number) + " · до " + esc(fmtDate(issued.validUntil))
              : pendingCard ? "заявка ждёт" : lifeCard ? "срок истёк" : "нет") + "</b></div>" +
          '<div class="diag__row"><span>Редакция</span><b>' + (founded ? esc(founded.name) : "нет") + "</b></div>" +
          "</div>" +
          (!issued && !pendingCard && Store.can(user, "cards.issue") ? '<button class="btn btn--sm" type="button" data-card-grant style="margin-top:10px">' +
            "Выдать пресс-карту · " + esc(d.cardNumberNext || "") + "</button>" : "") +
          (lifeCard ? '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +
            '<input class="admin-review__note" type="text" placeholder="Основание решения" data-person-card-note>' +
            (Store.can(user, "cards.extend") ? '<input class="admin-review__points" type="number" min="1" max="24" value="12" data-person-card-months aria-label="Месяцев продления">' +
              '<button class="btn btn--sm" type="button" data-person-card-extend>Продлить</button>' : "") +
            (Store.can(user, "cards.revoke") ? '<button class="btn btn--sm btn--ghost" type="button" data-person-card-revoke>Отозвать</button>' : "") +
            "</div>" : "") +
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
          var noteEl = $("[data-pf-note]", cardEl);
          var nameVal = $("[data-pf-name]", cardEl).value.trim();
          if (nameVal.length < 2) {
            if (noteEl) noteEl.textContent = "Имя и фамилия — минимум два символа.";
            return;
          }
          var emailEl = $("[data-pf-email]", cardEl);
          var emailVal = emailEl ? (emailEl.value || "").trim() : "";
          if (emailVal && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailVal)) {
            if (noteEl) noteEl.textContent = "Почта выглядит неверно: нужен адрес вида name@mail.ru.";
            return;
          }
          var payload = {
            name: nameVal,
            region: $("[data-pf-region]", cardEl).value,
            access: $("[data-pf-access]", cardEl).value,
          };
          if (emailVal && emailVal.toLowerCase() !== String(u.email || "").toLowerCase()) {
            payload.email = emailVal;
          }
          if (noteEl) noteEl.textContent = "Сохраняем…";
          var save = Store.userUpdateFull || Store.userUpdate;
          save(u.id, payload).then(function (res) {
            var emailChanged = !!(res && res.emailChanged);
            return Store.usersList().then(function (fresh) {
              return { fresh: fresh, emailChanged: emailChanged };
            });
          }).then(function (out) {
            all = out.fresh.users || [];
            roles = out.fresh.roles || roles;
            draw();
            openCard(u.id);
            if (out.emailChanged) {
              var fresh2 = $("[data-pf-note]", cardEl);
              if (fresh2) fresh2.textContent = "Почта изменена. Человек подтвердит адрес кодом из письма.";
            }
          }, function (err) {
            if (noteEl) noteEl.textContent = (err && err.message) || "Профиль не сохранился.";
            else window.alert((err && err.message) || "Профиль не сохранился.");
          });
        });

        var grantBtn = $("[data-card-grant]", cardEl);
        if (grantBtn) {
          grantBtn.addEventListener("click", function () {
            function sendGrant() {
              grantBtn.disabled = true;
              Store.cardGrant(u.id).then(function (res) {
                window.alert("Карта выдана: " + res.number);
                openCard(u.id);
              }, function (err) {
                grantBtn.disabled = false;
                if (err && err.needConfirm && confirmSlot) {
                  askConfirm(confirmSlot, $("[data-card-note]", cardEl), sendGrant);
                  return;
                }
                window.alert((err && err.message) || "Карта не выдалась.");
              });
            }
            sendGrant();
          });
        }

        $$("[data-person-card-extend], [data-person-card-revoke]", cardEl).forEach(function (btn) {
          btn.addEventListener("click", function () {
            var extend = btn.hasAttribute("data-person-card-extend");
            var noteEl = $("[data-person-card-note]", cardEl);
            var monthsEl = $("[data-person-card-months]", cardEl);
            var note = noteEl ? noteEl.value.trim() : "";
            if (!extend && note.length < 5) {
              var n = $("[data-card-note]", cardEl);
              if (n) n.textContent = "Для отзыва нужно основание — не короче пяти символов.";
              return;
            }
            function sendLife() {
              btn.disabled = true;
              var call = extend
                ? Store.cardExtend(lifeCard.id, monthsEl ? Number(monthsEl.value) || 12 : 12, note)
                : Store.cardRevoke(lifeCard.id, note);
              call.then(function () { openCard(u.id); }, function (err) {
                btn.disabled = false;
                if (err && err.needConfirm && confirmSlot) {
                  askConfirm(confirmSlot, $("[data-card-note]", cardEl), sendLife);
                  return;
                }
                var n = $("[data-card-note]", cardEl);
                if (n) n.textContent = (err && err.message) || "Не удалось сохранить решение.";
              });
            }
            sendLife();
          });
        });

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

        var closeCard = $("[data-close-card]", cardEl);
        if (closeCard) closeCard.addEventListener("click", function () {
          openedId = "";
          cardEl.innerHTML = "";
          draw();
        });

        function after() { openCard(u.id); }
        var confirmSlot = $('[data-confirm-slot]', cardEl);
        function decision(fn, ok) {
          fn().then(ok, function (e) {
            if (e && e.needConfirm && confirmSlot) {
              askConfirm(confirmSlot, $('[data-pf-note]', cardEl), function () { decision(fn, ok); });
              return;
            }
            window.alert((e && e.message) || "Не удалось сохранить решение.");
          });
        }

        $$("[data-ed-ok]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var id = b.getAttribute("data-ed-ok");
            decision(function () { return Store.editorialReview(id, "approved", ""); }, after);
          });
        });
        $$("[data-ed-no]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var note = window.prompt("Основание отказа:", "");
            if (note === null) return;
            if (note.trim().length < 5) { window.alert("Нужно основание."); return; }
            var id = b.getAttribute("data-ed-no");
            decision(function () { return Store.editorialReview(id, "rejected", note.trim()); }, after);
          });
        });
        $$("[data-consent-ok]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var kind = b.getAttribute("data-consent-ok") || "processing";
            decision(function () { return Store.consentDecide(u.id, "approved", "", kind); }, after);
          });
        });
        $$("[data-consent-no]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var kind = b.getAttribute("data-consent-no") || "processing";
            var note = window.prompt("Почему не принято:", "");
            if (note === null) return;
            if (note.trim().length < 5) { window.alert("Напишите основание — не короче пяти символов."); return; }
            decision(function () { return Store.consentDecide(u.id, "rejected", note.trim(), kind); }, after);
          });
        });
        $$("[data-pf-item-ok]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var points = window.prompt("Баллы за работу (0–50):", "5");
            if (points === null) return;
            var id = b.getAttribute("data-pf-item-ok");
            decision(function () { return Store.portfolioDecide(id, "approved", "", Number(points) || 0); }, after);
          });
        });
        $$("[data-pf-item-no]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var note = window.prompt("Основание отказа:", "");
            if (note === null) return;
            var id = b.getAttribute("data-pf-item-no");
            decision(function () { return Store.portfolioDecide(id, "rejected", note.trim(), 0); }, after);
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
        $$("[data-rc-close]", cardEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var reason = window.prompt("Причина закрытия заявки:", "");
            if (reason === null) return;
            if (reason.trim().length < 5) {
              window.alert("Причина — минимум пять символов.");
              return;
            }
            Store.recoveryClose(b.getAttribute("data-rc-close"), reason.trim())
              .then(after, function (e) { window.alert(e.message); });
          });
        });
      }

      if (searchEl) searchEl.addEventListener("input", draw);
      $$("[data-cat]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          cat = b.getAttribute("data-cat");
          draw();
        });
      });

      Store.usersList().then(function (res) {
        all = res.users || [];
        roles = res.roles || roles;
        draw();
      }, function () {
        all = [];
        draw();
      });
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
            row("Подтверждение действий", "код на почту") +
            row("Материалов", d.posts) +
            row("Запись данных", d.data_writable ? "разрешена" : "запрещена", !!d.data_writable) +
            row("Загрузка медиа", d.uploads_writable ? "разрешена" : "запрещена", !!d.uploads_writable) +
            row("Почта", d.mail_configured ? "настроена" : "не настроена", !!d.mail_configured) +
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

    /* --- Медиашкола: заявки и решения -------------------------------------- */
    function mountSchoolAdmin(host) {
      if (!Store.schoolList) return;
      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:8px");
      section.setAttribute("data-school-admin", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Медиашкола</span>' +
        "<h2>Заявки на обучение</h2>" +
        '<p class="sec-head__text">Человек выбирает направление и пишет о себе. Решение простое: ' +
        "принять или отказать с объяснением — ответ уходит заявителю на почту.</p></div></div>" +
        '<div class="panel" style="padding:20px"><div data-school-banner class="fill-note fill-note--flat">' +
        "Загружаем заявки…</div><div data-school-list></div></div>";
      host.appendChild(section);
      var banner = $("[data-school-banner]", section);
      var listEl = $("[data-school-list]", section);

      var SCHOOL_STATUS = { pending: "на рассмотрении", accepted: "принят", rejected: "отказ" };

      function draw(apps, canDecide) {
        if (!apps.length) {
          banner.textContent = "Заявок пока нет. Они появятся здесь сразу после подачи.";
          listEl.innerHTML = "";
          return;
        }
        banner.textContent = "Заявок: " + apps.length + ". Письмо заявителю уходит автоматически.";
        listEl.innerHTML = apps.map(function (a) {
          return '<div class="hiring-row" data-school-app="' + esc(a.id) + '">' +
            '<div class="hiring-row__main"><b>' + esc(a.name) + "</b> · " + esc(a.direction) +
            '<br><span class="form__note">' + esc(a.email) + " · " + schDate(a.createdAt) +
            " · статус: " + esc(SCHOOL_STATUS[a.status] || a.status) + "</span>" +
            (a.motivation ? '<p class="form__note" style="margin:8px 0 0">' + esc(a.motivation) + "</p>" : "") +
            (a.note ? '<p class="form__note" style="margin:6px 0 0">Решение: ' + esc(a.note) + "</p>" : "") +
            "</div>" +
            '<div class="hiring-row__side">' +
            (canDecide && a.status === "pending"
              ? '<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">' +
                '<button class="btn btn--accent btn--sm" type="button" data-approve>Принять в школу</button>' +
                '<input type="text" data-reason placeholder="причина отказа" style="max-width:180px">' +
                '<button class="btn btn--ghost btn--sm" type="button" data-reject>Отказать</button>' +
                "</div>"
              : "") +
            "</div></div>";
        }).join("");

        $$("[data-school-app]", listEl).forEach(function (row) {
          var id = row.getAttribute("data-school-app");
          var appr = $("[data-approve]", row);
          if (appr) appr.addEventListener("click", function () {
            if (!window.confirm("Принять человека в медиашколу?")) return;
            appr.disabled = true;
            Store.schoolDecide(id, "approve", "").then(refresh, function (err) {
              appr.disabled = false;
              banner.textContent = err.message;
            });
          });
          var rej = $("[data-reject]", row);
          if (rej) rej.addEventListener("click", function () {
            var reason = ($("[data-reason]", row) || {}).value || "";
            if (reason.trim().length < 5) { banner.textContent = "Напишите причину отказа — человек должен её увидеть."; return; }
            rej.disabled = true;
            Store.schoolDecide(id, "reject", reason).then(refresh, function (err) {
              rej.disabled = false;
              banner.textContent = err.message;
            });
          });
        });
      }

      function refresh() {
        Store.schoolList().then(function (res) {
          draw(res.applications || [], res.canDecide);
        }, function () {
          section.remove();
        });
      }
      refresh();
    }

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
        '<div class="panel"><div data-confirm-slot style="display:none"></div>' +
        '<p class="form__note" data-editorial-admin-status></p></div>' +
        '<div data-editorial-admin-list><p class="form__note">Загружаем…</p></div>';
      host.appendChild(section);

      var listEl = $("[data-editorial-admin-list]", section);
      var statusEl = $("[data-editorial-admin-status]", section);
      var slotEl = $("[data-confirm-slot]", section);

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

        function sendDecision(id, decision, note, btn) {
          btn.disabled = true;
          Store.editorialReview(id, decision, note).then(function () {
            btn.disabled = false;
            return Store.editorialQueue().then(draw);
          }, function (e) {
            btn.disabled = false;
            if (e && e.needConfirm) {
              askConfirm(slotEl, statusEl, function () { sendDecision(id, decision, note, btn); });
              return;
            }
            statusEl.textContent = (e && e.message) || "Не удалось сохранить решение.";
          });
        }
        $$("[data-edc-ok]", listEl).forEach(function (b) {
          b.addEventListener("click", function () {
            sendDecision(b.getAttribute("data-edc-ok"), "approved", "", b);
          });
        });
        $$("[data-edc-no]", listEl).forEach(function (b) {
          b.addEventListener("click", function () {
            var note = window.prompt("Основание отказа:", "");
            if (note === null) return;
            if (note.trim().length < 5) { statusEl.textContent = "Основание — минимум 5 символов."; return; }
            sendDecision(b.getAttribute("data-edc-no"), "rejected", note.trim(), b);
          });
        });
      }

      Store.editorialQueue().then(draw, function (err) {
        statusEl.textContent = (err && err.message) || "Не удалось загрузить заявки.";
        listEl.innerHTML = "";
      });
    }

    function mountConsentQueue(host) {
      var old = $("[data-consent-queue]");
      if (old) old.remove();
      if (!Store.consentQueue) return;

      var section = document.createElement("section");
      section.className = "section wrap";
      section.setAttribute("style", "padding-top:0");
      section.setAttribute("data-consent-queue", "");
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Согласия</span>' +
        "<h2>Сканы согласий: обработка и распространение</h2>" +
        '<p class="sec-head__text">Автор подписывает документ от руки и загружает фото. ' +
        "Согласие на обработку открывает публикацию на сайте. Согласие на распространение " +
        "нужно только для конкурсов в открытых площадках. Для отказа нужно основание.</p></div></div>" +
        '<div class="panel"><div class="row" style="align-items:flex-end">' +
        '<div data-confirm-slot style="display:none"></div>' +
        '<label class="form__note">Документ ' +
        '<select data-consent-kind style="margin-left:8px">' +
        '<option value="">все</option>' +
        '<option value="processing">обработка данных</option>' +
        '<option value="distribution">распространение (конкурсы)</option>' +
        "</select></label>" +
        '<button class="btn btn--sm" type="button" data-consent-load>Показать согласия</button></div>' +
        '<p class="form__note" data-consent-status></p></div><div data-consent-list></div>';
      host.appendChild(section);

            var statusEl = $("[data-consent-status]", section);
      var listEl = $("[data-consent-list]", section);
      var slotEl = $("[data-confirm-slot]", section);

      var LABEL = {
        pending: '<span class="status status--pending">на проверке</span>',
        approved: '<span class="status status--pub">одобрено</span>',
        rejected: '<span class="status status--rejected">отклонено</span>',
      };

      function row(c) {
        var badge = LABEL[c.status] || LABEL.pending;
        var docLabel = c.kind === "distribution"
          ? "Распространение данных · конкурсы"
          : "Обработка данных · работа на сайте";
        return (
          '<div class="admin-review"><div class="admin-review__top"><b>' +
          esc(c.name || "Автор") + "</b>" + badge + "</div>" +
          '<div class="admin-review__meta">' + esc(docLabel) + "</div>" +
          (c.purpose ? '<div class="admin-review__meta">Конкурс: ' + esc(c.purpose) + "</div>" : "") +
          '<div class="admin-review__meta">' + esc(c.email || "") +
          (c.userRegion ? " · " + esc(regionName(c.userRegion)) : "") +
          " · " + esc(fmtDate(c.createdAt)) + "</div>" +
          (c.scan
            ? '<a class="consent-thumb" href="' + esc(c.scan) + '" target="_blank" rel="noopener">' +
              '<img src="' + esc(c.scan) + '" alt="Скан согласия"></a>'
            : "") +
          (c.note ? '<p class="admin-review__excerpt">Основание: ' + esc(c.note) + "</p>" : "") +
          (c.status === "pending"
            ? '<div class="admin-review__actions">' +
              '<input class="admin-review__note" type="text" placeholder="Основание (обязательно для отказа)" ' +
              'data-consent-note="' + esc(c.id) + '">' +
              '<button class="btn btn--sm" type="button" data-consent-approve="' + esc(c.id) + '">Одобрить</button>' +
              '<button class="btn btn--sm btn--ghost" type="button" data-consent-reject="' +
              esc(c.id) + '">Отклонить</button></div>'
            : "") +
          "</div>"
        );
      }

      function load() {
        statusEl.textContent = "Загружаем…";
        var kindEl = $("[data-consent-kind]", section);
        Store.consentQueue(kindEl ? kindEl.value : "").then(function (res) {
          if (!res || !res.ok) {
            statusEl.textContent = (res && res.error) || "Сервер не ответил.";
            return;
          }
          var list = res.consents || [];
          var waiting = list.filter(function (c) { return c.status === "pending"; }).length;
          statusEl.textContent = "Согласий всего: " + list.length + ", ждут проверки: " + waiting + ".";
          listEl.innerHTML = list.length
            ? list.map(row).join("")
            : '<div class="empty"><h3>Согласий пока нет</h3><p>Автор загружает скан в личном ' +
              "кабинете, в блоке «Согласие на обработку персональных данных».</p></div>";

          $$("[data-consent-approve], [data-consent-reject]", listEl).forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = btn.getAttribute("data-consent-approve") || btn.getAttribute("data-consent-reject");
              var approve = btn.hasAttribute("data-consent-approve");
              var noteEl = $('[data-consent-note="' + id + '"]', listEl);
              var note = noteEl ? noteEl.value.trim() : "";
              if (!approve && note.length < 5) {
                statusEl.textContent = "Чтобы отклонить, напишите основание — не короче пяти символов.";
                return;
              }
              function sendReview() {
                btn.disabled = true;
                Store.consentReview(id, approve ? "approved" : "rejected", note).then(function (r) {
                  btn.disabled = false;
                  if (r && r.needConfirm) { askConfirm(slotEl, statusEl, sendReview); return; }
                  if (!r || !r.ok) {
                    statusEl.textContent = (r && r.error) || "Не удалось сохранить решение.";
                    return;
                  }
                  load();
                }, function (err) {
                  btn.disabled = false;
                  if (err && err.needConfirm) { askConfirm(slotEl, statusEl, sendReview); return; }
                  statusEl.textContent = (err && err.message) || "Не удалось сохранить решение.";
                });
              }
              sendReview();
            });
          });
        }, function (err) {
          statusEl.textContent = (err && err.message) || "Не удалось загрузить согласия.";
          listEl.innerHTML = "";
        });
      }

      $("[data-consent-load]", section).addEventListener("click", load);
      load();
    }

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
        '<p class="sec-head__text">Автор подаёт заявку из кабинета и сразу выбирает, как получить ' +
        "карту: лично в Москве или почтой. Выдача присваивает номер, автор видит его у себя.</p></div></div>" +
        '<div class="panel"><div class="row" style="align-items:flex-end">' +
        '<div data-confirm-slot style="display:none"></div>' +
        '<button class="btn btn--sm" type="button" data-card-load>Показать заявки</button></div>' +
        '<p class="form__note" data-card-status></p></div><div data-card-list></div>';
      host.appendChild(section);

            var statusEl = $("[data-card-status]", section);
      var listEl = $("[data-card-list]", section);
      var slotEl = $("[data-confirm-slot]", section);

      function row(card) {
        var posts = (card.posts || [])
          .map(function (p) {
            return "№ " + String(p.number || 0).padStart(4, "0") + " " + p.title;
          })
          .join(" · ");
        var badge = cardStatusBadge(card);
        return (
          '<div class="admin-review"><div class="admin-review__top"><b>' + esc(card.authorName || "Автор") +
          "</b>" + badge + "</div>" +
          '<div class="admin-review__meta">' +
          (card.byRole ? "Заявка по должности · " : "") +
          "Материалов в заявке: " + (card.posts || []).length +
          " · " + esc(fmtDate(card.createdAt)) + "</div>" +
          '<p class="admin-review__excerpt">' + esc(posts) + "</p>" +
          deliveryHtml(card) +
          (card.note ? '<p class="admin-review__excerpt">Основание: ' + esc(card.note) + "</p>" : "") +
          (card.status === "pending" && hasCap("cards.issue")
            ? '<div class="admin-review__actions">' +
              '<input class="admin-review__note" type="text" placeholder="Комментарий автору (для отказа — обязательно)" data-card-note="' + esc(card.id) + '">' +
              '<button class="btn btn--sm" type="button" data-card-approve="' + esc(card.id) + '">Выдать карту</button>' +
              '<button class="btn btn--sm btn--ghost" type="button" data-card-reject="' + esc(card.id) + '">Вернуть</button>' +
              "</div>"
            : (card.status === "issued" || card.status === "expired") && (hasCap("cards.extend") || hasCap("cards.revoke"))
              ? '<div class="admin-review__actions">' +
                '<input class="admin-review__note" type="text" placeholder="Основание решения" data-card-life-note="' + esc(card.id) + '">' +
                (hasCap("cards.extend")
                  ? '<input class="admin-review__points" type="number" min="1" max="24" value="12" data-card-months="' + esc(card.id) + '" aria-label="Месяцев продления">' +
                    '<button class="btn btn--sm" type="button" data-card-extend="' + esc(card.id) + '">Продлить</button>'
                  : "") +
                (hasCap("cards.revoke")
                  ? '<button class="btn btn--sm btn--ghost" type="button" data-card-revoke="' + esc(card.id) + '">Отозвать</button>'
                  : "") +
                (card.status === "issued" && hasCap("cards.issue") && (!card.delivery || card.delivery.method === "post")
                  ? '<button class="btn btn--sm btn--ghost" type="button" data-card-dispatch="' + esc(card.id) + '">Отметить отправку</button>'
                  : "") +
                (card.status === "issued" && card.number && card.verifyCode
                  ? '<a class="btn btn--sm btn--ghost" href="' + esc(cardPrintUrl(card)) + '" target="_blank" rel="noopener">Печать</a>' +
                    '<button class="btn btn--sm" type="button" data-card-pdf="' + esc(card.id) + '">Скачать PDF</button>'
                  : "") +
                "</div>"
              : "") +
          "</div>"
        );
      }

      function deliveryHtml(card) {
        var d = card.delivery;
        if (!d) {
          return '<p class="admin-review__meta">Способ получения не указан — заявка старая, ' +
            "договоритесь с автором вручную.</p>";
        }
        var head = d.method === "post" ? "Почтой России" : "Лично в Москве";
        var lines = [
          "<b>Как получить:</b> " + esc(head),
          "<b>Фамилия и имя:</b> " + esc(d.fullName || ""),
          "<b>Телефон:</b> " + esc(d.phone || ""),
        ];
        if (d.method === "post") {
          lines.push("<b>Индекс:</b> " + esc(d.index || ""));
          lines.push("<b>Адрес:</b> " + esc(d.address || ""));
        }
        if (card.issuedAt) lines.push("<b>Выдана:</b> " + esc(fmtDate(card.issuedAt)));
        if (card.validUntil) lines.push("<b>Действует до:</b> " + esc(fmtDate(card.validUntil)));
        if (card.revokedAt) lines.push("<b>Отозвана:</b> " + esc(fmtDate(card.revokedAt)));
        if (card.issuePlace) lines.push("<b>Где:</b> " + esc(card.issuePlace));
        if (card.dispatch && (card.dispatch.tracking || card.dispatch.sentAt)) {
          lines.push("<b>Отправлена:</b> " + esc(fmtDate(card.dispatch.sentAt)) +
            (card.dispatch.tracking ? " · трек " + esc(card.dispatch.tracking) : ""));
        }
        return '<div class="pcard__list" style="margin:10px 0">' + lines.map(function (l) {
          return '<div class="pcard__line"><span>' + l + "</span><span></span><span></span></div>";
        }).join("") + "</div>";
      }

      function load() {
        statusEl.textContent = "Загружаем…";
        Store.apiCardQueue("").then(function (res) {
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
              var note = noteEl ? noteEl.value.trim() : "";
              if (!approve && note.length < 5) {
                statusEl.textContent = "Для отказа нужно основание — не короче пяти символов.";
                return;
              }
              var place = "";
              var tracking = "";
              if (approve) {
                place = window.prompt(
                  "Где и когда выдали карту? Например: Москва, редакция, 12 ноября, 18:00 " +
                  "или «Отправлено почтой, трек 1234»:",
                  "Москва, лично из рук в руки"
                );
                if (place === null) return;
                tracking = window.prompt("Трек-номер почты (если отправляли письмом). Можно пропустить:", "") || "";
              }
              function sendReview() {
                btn.disabled = true;
                Store.apiCardReview("", id, approve ? "approve" : "reject", note, place, tracking)
                  .then(function (r) {
                    btn.disabled = false;
                    if (r && r.needConfirm) { askConfirm(slotEl, statusEl, sendReview); return; }
                    if (!r || !r.ok) {
                      statusEl.textContent = (r && r.error) || "Не удалось сохранить решение.";
                      return;
                    }
                    load();
                  }, function (err) {
                    btn.disabled = false;
                    statusEl.textContent = (err && err.message) || "Не удалось сохранить решение.";
                  });
              }
              sendReview();
            });
          });

          $$("[data-card-pdf]", listEl).forEach(function (btn) {
            btn.addEventListener("click", function () {
              downloadCardPdf(btn.getAttribute("data-card-pdf"), btn, statusEl);
            });
          });
          $$("[data-card-dispatch]", listEl).forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = btn.getAttribute("data-card-dispatch");
              var tracking = window.prompt("Трек-номер почты (можно оставить пустым):", "");
              if (tracking === null) return;
              btn.disabled = true;
              Store.cardDispatch(id, tracking.trim()).then(function () {
                btn.disabled = false;
                load();
              }, function (err) {
                btn.disabled = false;
                statusEl.textContent = (err && err.message) || "Не удалось сохранить отметку об отправке.";
              });
            });
          });
          $$("[data-card-revoke], [data-card-extend]", listEl).forEach(function (btn) {
            btn.addEventListener("click", function () {
              var extend = btn.hasAttribute("data-card-extend");
              var id = btn.getAttribute("data-card-extend") || btn.getAttribute("data-card-revoke");
              var noteEl = $('[data-card-life-note="' + id + '"]', listEl);
              var monthsEl = $('[data-card-months="' + id + '"]', listEl);
              var note = noteEl ? noteEl.value.trim() : "";
              if (!extend && note.length < 5) {
                statusEl.textContent = "Для отзыва нужно основание — не короче пяти символов.";
                return;
              }
              var months = monthsEl ? Number(monthsEl.value) || 12 : 12;
              function sendLife() {
                btn.disabled = true;
                var call = extend ? Store.cardExtend(id, months, note) : Store.cardRevoke(id, note);
                call.then(function () {
                  btn.disabled = false;
                  load();
                }, function (err) {
                  btn.disabled = false;
                  if (err && err.needConfirm) { askConfirm(slotEl, statusEl, sendLife); return; }
                  statusEl.textContent = (err && err.message) || "Не удалось сохранить решение.";
                });
              }
              sendLife();
            });
          });
        }, function (err) {
          statusEl.textContent = (err && err.message) || "Не удалось загрузить заявки.";
          listEl.innerHTML = "";
        });
      }

      $("[data-card-load]", section).addEventListener("click", load);
      load();
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
      '<a class="btn btn--sm" href="/assets/docs/press-kit.pdf?v=2026-11-13-9" target="_blank" rel="noopener">Пресс-кит (PDF)</a>' +
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
              '<a class="btn btn--sm btn--ghost" href="/assets/docs/pamyatka-avtoru.pdf?v=2026-11-13-9" target="_blank" rel="noopener">Памятка автору</a></div></div>');

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
      '<li><a href="/assets/docs/pamyatka-avtoru.pdf?v=2026-11-13-9" target="_blank" rel="noopener">Памятка автору (PDF)</a></li>' +
      '<li><a href="/assets/docs/polozhenie-o-redakcii.pdf?v=2026-11-13-9" target="_blank" rel="noopener">Кодекс редакции (PDF)</a></li>' +
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
      '<p class="sec-head__text">Основатель редакции набирает штат сам: смотрит заявление, ' +
      "портфолио и материалы на сайте. Если решения нет семь дней, заявка уходит в центральную " +
      "комиссию — отказ или молчание без основания не допускаются.</p></div></div>" +
      '<div class="path-choice" data-path-choice>' +
      '<button class="path-choice__card" type="button" data-path-pick="individual">' +
      '<b>Писать индивидуально</b><span>Свой аккаунт, свои темы, проверка редакции. ' +
      "Пресс-карта — после пяти публикаций.</span></button>" +
      '<button class="path-choice__card" type="button" data-path-pick="editorial">' +
      '<b>Вступить в редакцию региона</b><span>Заявление основателю, штат, редакционная ' +
      "пресс-карта после трёх постов и общие проекты.</span></button></div>" +
      '<p class="form__note" data-path-note></p>' +
      '<div class="editorial-list" data-editorial-list><p class="media-empty">Загружаем редакции…</p></div>' +
      (user
        ? '<div class="editorial-actions">' +
          '<button class="btn btn--accent btn--sm" type="button" data-editorial-join>Подать заявление в редакцию</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-editorial-new>Создать свою редакцию</button>' +
          "</div>" +
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
          '<span class="form__note" data-editorial-note></span></div></form>' +
          '<form class="editorial-form is-hidden" data-editorial-create>' +
          '<div class="field"><label for="ed-name">Название редакции</label>' +
          '<input id="ed-name" name="name" type="text" maxlength="120" placeholder="Например, «Смена. Поволжье»"></div>' +
          '<div class="field"><label for="ed-about">Чем будет заниматься</label>' +
          '<textarea id="ed-about" name="about" rows="3" maxlength="600"></textarea></div>' +
          '<div class="row"><button class="btn" type="submit">Создать редакцию</button>' +
          '<span class="form__note" data-editorial-create-note></span></div></form>'
        : '<div class="editorial-actions"><a class="btn btn--accent btn--sm" href="/join?next=profile">' +
          "Войдите, чтобы вступить в редакцию</a></div>");

    var listEl = $("[data-editorial-list]", host);
    var applyForm = $("[data-editorial-apply]", host);
    var createForm = $("[data-editorial-create]", host);
    var targetSelect = $("[data-editorial-target]", host);

    function drawList(items) {
      if (!items.length) {
        listEl.innerHTML =
          '<div class="fill-note fill-note--flat"><b>В этом регионе редакции пока нет</b>' +
          "<p>Вы можете создать её первым: заявление на имя основателя, набор штата и работа " +
          "с авторами региона.</p></div>";
        if (targetSelect) targetSelect.innerHTML = '<option value="">Редакций нет</option>';
        return;
      }
      listEl.innerHTML = items
        .map(function (e) {
          return '<div class="editorial-card"><div class="editorial-card__top"><b>' + esc(e.name) +
            "</b><span>" + (e.members || 0) + " в штате</span></div>" +
            (e.about ? "<p>" + esc(e.about) + "</p>" : "") +
            '<div class="editorial-card__meta">Основатель: ' + esc(e.founderName) +
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
        if (chosen === "editorial" && applyForm && loaded.length) {
          applyForm.classList.remove("is-hidden");
          createForm.classList.add("is-hidden");
          applyForm.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
    paintPath();

    var loaded = [];
    Store.editorialList(slug).then(function (items) {
      loaded = items;
      drawList(items);
    });

    if (!user) return;

    var joinBtn = $("[data-editorial-join]", host);
    var newBtn = $("[data-editorial-new]", host);
    if (joinBtn && applyForm) {
      joinBtn.addEventListener("click", function () {
        if (!loaded.length) {
          window.alert("В этом регионе пока нет редакций. Создайте свою.");
          return;
        }
        applyForm.classList.toggle("is-hidden");
        createForm.classList.add("is-hidden");
      });
    }
    if (newBtn && createForm) {
      newBtn.addEventListener("click", function () {
        createForm.classList.toggle("is-hidden");
        applyForm.classList.add("is-hidden");
      });
    }

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
          noteEl.textContent = "Заявление отправлено. Основатель редакции увидит его в кабинете.";
          applyForm.reset();
        }, function (err) {
          noteEl.textContent = (err && err.message) || "Не удалось отправить заявление.";
        });
      });
    }

    if (createForm) {
      createForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var noteEl = $("[data-editorial-create-note]", host);
        var name = createForm.querySelector('[name="name"]').value.trim();
        var about = createForm.querySelector('[name="about"]').value.trim();
        if (name.length < 3) { noteEl.textContent = "Название — хотя бы три символа."; return; }
        if (about.length < 20) { noteEl.textContent = "Опишите редакцию: минимум 20 символов."; return; }
        noteEl.textContent = "Создаём…";
        Store.editorialCreate({ region: slug, name: name, about: about }).then(function (created) {
          noteEl.textContent = "Редакция создана. Вы её основатель.";
          loaded.unshift(created);
          drawList(loaded);
          createForm.reset();
        }, function (err) {
          noteEl.textContent = (err && err.message) || "Редакция не создалась.";
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
  function mountMyEditorial(user) {
    var host = $("[data-my-editorial]");
    if (!host || !user) return;

    var STATUS_ED = {
      pending: "на рассмотрении",
      approved: "приняли",
      rejected: "отказ",
    };

    function draw(data) {
      var html = '<div class="sec-head" style="margin:10px 0 8px"><div class="sec-head__left">' +
        '<span class="kicker">Редакции</span><h2 style="font-size:1.35rem">Моя редакция</h2></div></div>' +
        '<div data-ed-confirm style="display:none"></div><p class="form__note" data-ed-note></p>';

      if (data.applications.length) {
        html += '<div class="editorial-list">' + data.applications.map(function (a) {
          var esc2 = esc;
          return '<div class="editorial-card"><div class="editorial-card__top"><b>Заявка ' +
            esc2(fmtDate(a.createdAt)) + "</b><span>" + esc2(STATUS_ED[a.status] || a.status) +
            "</span></div>" +
            (a.note ? "<p>Основание: " + esc2(a.note) + "</p>" : "") +
            (a.escalated && a.status === "pending"
              ? "<p>Семь дней без решения — заявка передана в центральную комиссию.</p>"
              : "") +
            "</div>";
        }).join("") + "</div>";
      } else if (!data.editorial) {
        html += '<div class="fill-note fill-note--flat"><b>Вы пока вне редакции</b><p>' +
          "Можно писать индивидуально или вступить в редакцию своего региона — выбор за вами.</p>" +
          '<p><a class="link-accent" href="/region?r=' + esc(Store.currentUser().region || "moskva") +
          '">Выбрать редакцию региона →</a></p></div>';
      }

      if (data.editorial) {
        html += '<div class="editorial-card"><div class="editorial-card__top"><b>' +
          esc(data.editorial.name) + "</b><span>вы основатель</span></div>" +
          "<p>" + esc(data.editorial.about || "") + "</p>" +
          '<div class="editorial-card__meta">' + (data.editorial.members || 0) +
          " в штате</div></div>";

        if (data.incoming.length) {
          html += '<div class="editorial-queue">' + data.incoming.map(function (a) {
            var body = '<div class="editorial-card"><div class="editorial-card__top"><b>' +
              esc(a.name) + "</b><span>" + esc(STATUS_ED[a.status] || a.status) + "</span></div>" +
              '<div class="editorial-card__meta">' + esc(a.birthDate) + " · " + esc(a.email) + "</div>" +
              "<p>" + esc(a.why) + "</p>" +
              (a.sitePosts && a.sitePosts.length
                ? '<div class="editorial-card__meta">На сайте: ' +
                  a.sitePosts.map(function (t) { return esc(t); }).join(" · ") + "</div>"
                : "") +
              (a.portfolio && a.portfolio.length
                ? '<div class="editorial-card__meta">Портфолио: ' + a.portfolio.length + " файл(а)</div>"
                : "");
            if (a.status === "pending") {
              body += '<div class="row" style="margin-top:10px">' +
                '<button class="btn btn--accent btn--sm" type="button" data-ed-ok="' + esc(a.id) + '">Принять</button>' +
                '<button class="btn btn--ghost btn--sm" type="button" data-ed-no="' + esc(a.id) + '">Отказать</button>' +
                "</div>";
            }
            if (a.escalated && a.status === "pending") {
              body += '<p class="form__note">Семь дней прошло — решает центральная комиссия.</p>';
            }
            return body + "</div>";
          }).join("") + "</div>";
        } else {
          html += '<p class="form__note">Заявлений в редакцию пока нет. Ссылку на страницу ' +
            "региона можно отправлять авторам.</p>";
        }
      }

      host.innerHTML = html;

      function review(id, decision, note) {
        var slot = $('[data-ed-confirm]', host);
        var noteEl = $('[data-ed-note]', host);
        var buttons = $$('[data-ed-ok], [data-ed-no]', host);
        buttons.forEach(function (b) { b.disabled = true; });
        if (noteEl) noteEl.textContent = 'Отправляем решение…';
        Store.editorialReview(id, decision, note).then(function () {
          return Store.editorialMine();
        }).then(draw, function (err) {
          buttons.forEach(function (b) { b.disabled = false; });
          if (err && err.needConfirm) {
            askConfirm(slot, noteEl, function () { review(id, decision, note); });
            return;
          }
          if (noteEl) noteEl.textContent = (err && err.message) || 'Решение не сохранилось.';
        });
      }
      $$("[data-ed-ok]", host).forEach(function (btn) {
        btn.addEventListener("click", function () { review(btn.getAttribute("data-ed-ok"), "approved", ""); });
      });
      $$("[data-ed-no]", host).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var note = window.prompt("Основание отказа (его увидит автор):", "");
          if (note === null) return;
          if (note.trim().length < 5) {
            var noteEl = $('[data-ed-note]', host);
            if (noteEl) noteEl.textContent = "Отказ без основания недопустим: напишите хотя бы 5 символов.";
            return;
          }
          review(btn.getAttribute("data-ed-no"), "rejected", note.trim());
        });
      });
    }

    Store.editorialMine().then(draw, function (err) {
      host.innerHTML = '<p class="form__note">' + esc((err && err.message) || "Не удалось загрузить данные редакции.") + '</p>';
    });
  }

  /* Разделы кабинета: одна панель на экране, адрес и выбор запоминаются.
     Все блоки остаются в разметке —данные и обработчики не теряются. */
  function buildCabinetTabs(host, tabs) {
    var nav = $("[data-cab-nav]", host);
    if (!nav) return;

    function show(id, scroll) {
      var known = tabs.some(function (t) { return t[0] === id; });
      if (!known) id = tabs[0][0];
      $$("[data-cab-panel]", host).forEach(function (p) {
        p.hidden = p.getAttribute("data-cab-panel") !== id;
      });
      $$("[data-cab-tab]", nav).forEach(function (b) {
        var on = b.getAttribute("data-cab-tab") === id;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      try { window.localStorage.setItem("smena_cab_tab", id); } catch (e) {}
      try { history.replaceState(null, "", "#" + id); } catch (e) {}
      if (scroll) {
        var top = host.getBoundingClientRect().top + window.pageYOffset - 90;
        try { window.scrollTo({ top: Math.max(0, top), behavior: "smooth" }); }
        catch (e) { window.scrollTo(0, Math.max(0, top)); }
      }
    }

    nav.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-cab-tab]");
      if (btn) show(btn.getAttribute("data-cab-tab"), true);
    });
    host.addEventListener("click", function (e) {
      var go = e.target.closest("[data-cab-go]");
      if (go) show(go.getAttribute("data-cab-go"), true);
    });

    var initial = String(window.location.hash || "").replace(/^#/, "");
    if (!initial || !tabs.some(function (t) { return t[0] === initial; })) {
      try { initial = window.localStorage.getItem("smena_cab_tab") || ""; } catch (e) { initial = ""; }
    }
    show(initial, false);
    host.setAttribute("data-cabinet-ready", "1");
  }

  /* Фильтр материалов по статусу: работает без сервера, ничего не перезагружает. */
  function bindPostFilters(host) {
    var bar = $("[data-post-filters]", host);
    var list = $("[data-post-list]", host);
    if (!bar || !list) return;
    bar.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-post-filter]");
      if (!btn) return;
      var value = btn.getAttribute("data-post-filter");
      $$("[data-post-filter]", bar).forEach(function (b) { b.classList.toggle("is-on", b === btn); });
      var shown = 0;
      $$("[data-post-status]", list).forEach(function (row) {
        var ok = !value || row.getAttribute("data-post-status") === value;
        row.hidden = !ok;
        if (ok) shown += 1;
      });
      var empty = $("[data-filter-empty]", list);
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "form__note";
        empty.setAttribute("data-filter-empty", "");
        list.appendChild(empty);
      }
      empty.textContent = shown ? "" : "В этом статусе материалов нет.";
    });
  }

  /* 12. Личный кабинет ===================================================== */

  /* Два документа для подписи. Оба идут одним путём: скачал форму → подписал
     от руки → загрузил скан → комиссия проверила. Разница в том, что они
     разрешают: обработка открывает работу на сайте, распространение нужно
     только для конкурсов, которые выходят в открытые площадки проекта. */
  var CONSENT_DOCS = {
    processing: {
      kicker: "Документ для подписи",
      title: "Согласие на обработку персональных данных",
      file: "/assets/docs/soglasie-na-obrabotku-pd.pdf?v=2026-11-13-9",
      none: "черновики и публикация закрыты",
      intro: "Распечатайте форму, подпишите от руки, сфотографируйте лист целиком и загрузите " +
        "фото. Комиссия проверит документ и откроет публикацию.",
      wait: "Обычно проверка занимает до двух дней. Пока решение не принято, " +
        "черновики, файлы и заявки закрыты.",
      ok: "Согласие принято. Публиковать материалы на сайте можно без ограничений.",
    },
    distribution: {
      kicker: "Второй документ для подписи",
      title: "Согласие на распространение персональных данных",
      file: "/assets/docs/soglasie-na-rasprostranenie-pd.pdf?v=2026-11-13-9",
      none: "без него материалы не публикуются",
      intro: "Имя автора, фотография и работа на сайте видны всем посетителям — по закону " +
        "это распространение персональных данных, и разрешение на него оформляется " +
        "отдельным документом. В форме вы отмечаете, что можно показывать. Площадки " +
        "проекта (Max, Telegram, ВКонтакте, ТДС Чат) — отдельная отметка, она нужна " +
        "только для конкурсов; без неё материалы выходят только на сайте.",
      wait: "Комиссия проверяет документ. Пока решения нет, материалы не публикуются.",
      ok: "Согласие принято. Имя и работы могут выходить на сайте. В площадках проекта — " +
        "только если вы отметили это в форме.",
    },
  };

  function consentBlockHtml(status, consent, kind) {
    var key = kind === "distribution" ? "distribution" : "processing";
    var doc = CONSENT_DOCS[key];
    var info = consent || {};
    var head =
      '<div class="consent-card__head"><span class="kicker">' + esc(doc.kicker) + "</span>" +
      "<h3>" + esc(doc.title) + "</h3></div>";

    var body;
    if (status === "approved") {
      body =
        '<div class="consent-card__state consent-card__state--ok">' +
        '<b>Проверено комиссией</b><span>' +
        (info.decidedAt ? fmtDate(info.decidedAt) : "") + "</span></div>" +
        "<p>" + esc(doc.ok) + "</p>";
    } else if (status === "pending") {
      body =
        '<div class="consent-card__state consent-card__state--wait">' +
        "<b>На проверке у комиссии</b><span>" +
        (info.createdAt ? fmtDate(info.createdAt) : "") + "</span></div>" +
        "<p>" + esc(doc.wait) + "</p>";
    } else if (status === "rejected") {
      body =
        '<div class="consent-card__state consent-card__state--bad">' +
        "<b>Нужно исправить</b><span>" + (info.decidedAt ? fmtDate(info.decidedAt) : "") +
        "</span></div>" +
        (info.note ? '<p class="consent-card__note">Основание: ' + esc(info.note) + "</p>" : "") +
        "<p>Скачайте форму заново, подпишите, сфотографируйте целиком и загрузите ещё раз.</p>";
    } else {
      body =
        '<div class="consent-card__state">' +
        "<b>Пока не отправлено</b><span>" + esc(doc.none) + "</span></div>" +
        "<p>" + esc(doc.intro) + "</p>";
    }

    if (key === "distribution" && info.purpose) {
      body += '<p class="form__note">Конкурс: ' + esc(info.purpose) + "</p>";
    }

    var fieldId = "consent-file-" + key;
    var actions =
      '<div class="consent-card__actions">' +
      '<a class="btn btn--sm btn--ghost" href="' + esc(doc.file) + '" ' +
      'target="_blank" rel="noopener">Скачать форму (PDF)</a>' +
      (status === "approved"
        ? ""
        : '<label class="btn btn--sm btn--accent" for="' + fieldId + '">Загрузить согласие</label>' +
          '<input id="' + fieldId + '" type="file" accept="image/*" class="visually-hidden" ' +
          'data-consent-file="' + key + '">') +
      "</div>" +
      (key === "distribution" && status !== "approved"
        ? '<input class="input" type="text" maxlength="160" data-consent-purpose ' +
          'placeholder="Конкурс, если согласие оформляется для конкурса (необязательно)" style="margin-top:10px">'
        : "") +
      '<p class="form__note" data-consent-note="' + key + '"></p>';

    return '<div class="consent-card consent-card--' + esc(status) + '" data-consent-card="' + key + '">' +
      head + body + actions + "</div>";
  }

  function taskBadge(t) {
    var cls = t.priority === "urgent" ? " task-badge--urgent" : t.priority === "high" ? " task-badge--high" : "";
    return '<span class="task-badge' + cls + '">' + esc(t.priorityLabel || "Обычная") + "</span>";
  }

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

  /* ------------------------------------------------------------------
     МЕДИАШКОЛА: одна заявка на человека. Блок рисуется и в кабинете,
     и на странице /media-school — состояние приходит с сервера.
     ------------------------------------------------------------------ */
  var SCHOOL_DIRS = ["Текст и работа с фактурой", "Интервью", "Фотография",
    "Видео и монтаж", "Соцсети и дизайн", "Проверка информации"];

  function schDate(iso) {
    try { return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }
    catch (e) { return ""; }
  }

  function schoolStateHtml(app) {
    var dir = app.direction ? "Направление: " + esc(app.direction) + ". " : "";
    if (app.status === "accepted") {
      return '<div class="fill-note fill-note--ok" data-school-state><b>Вы приняты в медиашколу</b>' +
        "<p>" + dir + "Следующий шаг — первое задание: напишите материал, редактор разберёт его до публикации.</p>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<a class="btn btn--accent btn--sm" href="/write">Написать материал</a>' +
        '<a class="btn btn--ghost btn--sm" href="/school">Страница школы: статус и задания</a></div></div>';
    }
    return '<div class="fill-note fill-note--flat" data-school-state><b>Заявка на рассмотрении</b>' +
      "<p>" + dir + "Подана " + schDate(app.createdAt) +
      ". Статус виден на <a href=\"/school\">странице медиашколы</a>, письмо придёт на почту.</p></div>";
  }

  function schoolFormHtml(app) {
    var again = app && app.status === "rejected";
    return '<div class="panel" style="padding:20px">' +
      "<h3>" + (again ? "Подать заявку снова" : "Подать заявку в медиашколу") + "</h3>" +
      (again ? '<p class="form__note">Причина отказа: ' + esc(app.note || "не указана") +
        ". Попробуйте ещё раз — расскажите подробнее о себе и своих материалах.</p>" : "") +
      '<form data-school-form>' +
      '<div class="field"><label for="sch-dir">Направление</label><select id="sch-dir" name="direction">' +
      SCHOOL_DIRS.map(function (d) {
        return "<option" + (app && app.direction === d ? " selected" : "") + ">" + esc(d) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="field"><label for="sch-mot">Почему именно вы</label>' +
      '<textarea id="sch-mot" name="motivation" rows="4" maxlength="1500" required ' +
      'placeholder="Один материал — свой, школьный или просто для себя: текст, фото или видео. О чём хотите рассказывать и сколько времени готовы уделять"></textarea>' +
      '<p class="field__hint">От 40 символов. Мы читаем каждую заявку: честность важнее идеального слога.</p></div>' +
      '<div class="row"><button class="btn btn--accent" type="submit">Отправить заявку</button>' +
      '<span class="form__note" data-school-note></span></div></form></div>';
  }

  function mountSchoolBlock(host) {
    if (!host || !Store.schoolMine) return;
    host.innerHTML = '<p class="form__note">Проверяем заявки…</p>';
    Store.schoolMine().then(function (res) {
      var app = res.application;
      if (app && (app.status === "accepted" || app.status === "pending")) {
        host.innerHTML = schoolStateHtml(app);
        return;
      }
      host.innerHTML = schoolFormHtml(app);
      var form = $("[data-school-form]", host);
      var dirSel = $('[name="direction"]', form);
      var motEl = $('[name="motivation"]', form);
      var note = $("[data-school-note]", host);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        note.textContent = "Отправляем…";
        Store.schoolApply({
          direction: dirSel ? dirSel.value : "",
          motivation: motEl ? motEl.value : "",
        }).then(function () {
          mountSchoolBlock(host);
        }, function (err) {
          note.textContent = err && err.needConsent
            ? "Сначала подпишите оба согласия — раздел «Документы» в кабинете."
            : (err.message || "Не удалось отправить заявку. Попробуйте ещё раз.");
        });
      });
    }, function () {
      host.innerHTML = '<div class="fill-note fill-note--flat"><b>Сервер не отвечает</b>' +
        "<p>Не удалось спросить сервер о заявке. Проверьте связь и обновите страницу.</p></div>";
    });
  }

  /* Кабинет: блок медиашколы в обзоре. */
  function mountSchoolApp() {
    var host = $('[data-cab-panel="overview"] [data-school-host]');
    if (host) mountSchoolBlock(host);
  }

  /* Стартовое задание по направлению — для страницы /school и для принятых. */
  function schoolTask(dir) {
    var tasks = {
      "Текст и работа с фактурой": "напишите 3–5 абзацев об одном человеке из вашего двора, школы или района — так, чтобы дочитал незнакомый человек",
      "Интервью": "задайте пять вопросов герою, запишите ответы дословно и отберите три лучшие цитаты",
      "Фотография": "снимите серию из 10 кадров об одном месте и выберите три, которые расскажут историю без подписи",
      "Видео и монтаж": "снимите на телефон минутный сюжет: одна мысль, один герой, чистый звук",
      "Соцсети и дизайн": "сделайте обложку и подпись из двух строк для материала, уже вышедшего на сайте",
      "Проверка информации": "возьмите новость дня, найдите первоисточник и напишите справку: что подтвердилось, а что нет",
    };
    return tasks[dir] || "выберите тему рядом с собой и сделайте первый материал — редактор подскажет, как его усилить";
  }

  /* Отдельная страница медиашколы /school: статус, заявка, учёба. */
  function initSchoolHub() {
    var statusHost = $("[data-school-status]");
    var applyHost = $("[data-school-apply]");
    if (!statusHost && !applyHost) return;

    function chips(dir) {
      return '<div class="school-dir-chips">' + SCHOOL_DIRS.map(function (d) {
        return '<label class="' + (d === dir ? "is-on" : "") + '"><input type="radio" name="direction" value="' +
          esc(d) + '"' + (d === dir ? " checked" : "") + ">" + esc(d) + "</label>";
      }).join("") + "</div>";
    }
    function bindChips(host) {
      $$("[data-school-form] .school-dir-chips input", host).forEach(function (input) {
        input.addEventListener("change", function () {
          $$(".school-dir-chips label", host).forEach(function (l) { l.classList.remove("is-on"); });
          input.closest("label").classList.add("is-on");
        });
      });
    }
    function bindForm(host, noteEl, done) {
      var form = $("[data-school-form]", host);
      if (!form) return;
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var checked = form.querySelector('[name="direction"]:checked');
        var dir = checked ? checked.value : "";
        var mot = ($('[name="motivation"]', form) || {}).value || "";
        if (noteEl) noteEl.textContent = "Отправляем…";
        Store.schoolApply({ direction: dir, motivation: mot }).then(function () {
          done();
        }, function (err) {
          if (noteEl) noteEl.textContent = err && err.needConsent
            ? "Сначала подпишите оба согласия — это можно сделать прямо здесь, раздел «Документы» в кабинете."
            : (err.message || "Не удалось отправить заявку. Попробуйте ещё раз.");
        });
      });
    }

    function drawPending(app, kind) {
      var dir = app.direction ? "Направление: <b>" + esc(app.direction) + "</b>. " : "";
      return '<div class="fill-note fill-note--flat" data-school-state><b>' + kind + "</b>" +
        "<p>" + dir + "Подана " + schDate(app.createdAt) + ". Редакция читает заявки по мере поступления: " +
        "статус сменится здесь же, письмо придёт на почту аккаунта.</p>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<a class="btn btn--ghost btn--sm" href="/media-school">Программа школы</a>' +
        '<a class="btn btn--ghost btn--sm" href="#ucheba">Посмотреть первые задания</a></div></div>';
    }

    function drawAccepted(app) {
      return '<div class="fill-note fill-note--ok" data-school-state><b>Вы приняты в медиашколу</b>' +
        "<p>" + (app.direction ? "Направление: <b>" + esc(app.direction) + "</b>. " : "") +
        "Первое задание: " + schoolTask(app.direction) + ". Сделайте материал — редактор разберёт его до публикации.</p>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<a class="btn btn--accent btn--sm" href="/write">Сделать первый материал</a>' +
        '<a class="btn btn--ghost btn--sm" href="#ucheba">Дорожная карта ученика</a></div></div>';
    }

    function drawRejected(app) {
      return '<div class="fill-note" data-school-state style="border-color:rgba(214,78,58,.4);background:rgba(214,78,58,.06)">' +
        "<b>Заявку вернули</b><p>Основание: " + esc(app.note || "не указано") +
        ". Это не запрет: можно подать заявку снова и рассказать о себе подробнее.</p></div>";
    }

    var user = Store.currentUser();
    if (!user) {
      if (statusHost) statusHost.innerHTML =
        '<div class="fill-note fill-note--flat"><b>Заявка — после регистрации</b>' +
        "<p>Создайте аккаунт: почта, код из письма, пароль — минута. После входа на этой странице " +
        "появятся статус заявки и форма.</p>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<a class="btn btn--accent btn--sm" href="/join?next=/school">Создать аккаунт</a>' +
        '<a class="btn btn--ghost btn--sm" href="/join#login">У меня есть аккаунт</a></div></div>';
      if (applyHost) applyHost.innerHTML = "";
      return;
    }

    function load() {
      Store.schoolMine().then(function (res) {
        var app = res.application || null;
        var processing = (Store.consent() || {}).status === "approved";
        var distributionOk = (Store.consent("distribution") || {}).status === "approved";
        var consentsOk = processing && distributionOk;
        var steps = [
          ["Аккаунт создан", true],
          ["Оба согласия подписаны", consentsOk],
          ["Заявка подана", !!(app && app.status !== "rejected")],
          ["Решение редакции", !!(app && app.status === "accepted")],
        ];
        var stepsHtml = '<ol class="pcard-steps">' + steps.map(function (s, i) {
          return '<li class="pcard-steps__item' + (s[1] ? " is-done" : "") + '"><span class="pcard-steps__mark">' +
            (s[1] ? ICONS.check : i + 1) + "</span><span>" + esc(s[0]) + "</span></li>";
        }).join("") + "</ol>";
        if (statusHost) {
          statusHost.innerHTML = '<div class="panel" style="padding:20px">' +
            '<div class="panel__head"><h3>Статус заявки</h3>' +
            (app ? '<span class="panel__tag">' + esc(app.status === "accepted" ? "приняты" : app.status === "pending" ? "на проверке" : "требует внимания") + "</span>"
              : '<span class="panel__tag">заявки ещё нет</span>') + "</div>" +
            stepsHtml +
            (!consentsOk ? '<p class="form__note">Для заявки нужны два подписанных согласия — ' +
              '<a href="/profile">подписать в кабинете</a>.</p>' : "") +
            "</div>";
        }
        if (applyHost) {
          if (app && app.status === "accepted") applyHost.innerHTML = drawAccepted(app);
          else if (app && app.status === "pending") applyHost.innerHTML = drawPending(app, "Заявка на рассмотрении");
          else {
            applyHost.innerHTML =
              '<div class="panel" style="padding:20px">' +
              (app && app.status === "rejected" ? drawRejected(app) : "") +
              "<h3>" + (app && app.status === "rejected" ? "Подать заявку снова" : "Заявка в медиашколу") + "</h3>" +
              '<form data-school-form>' +
              '<label style="display:block;margin-bottom:6px">Направление</label>' + chips(app && app.direction) +
              '<div class="field"><label for="sh-mot">Почему именно вы</label>' +
              '<textarea id="sh-mot" name="motivation" rows="4" maxlength="1500" required ' +
              'placeholder="Один материал — свой, школьный или просто для себя. О чём хотите рассказывать и сколько времени готовы уделять"></textarea>' +
              '<p class="field__hint">От 40 символов. Каждую заявку читает редактор.</p></div>' +
              '<div class="row"><button class="btn btn--accent" type="submit">Отправить заявку</button>' +
              '<span class="form__note" data-school-note></span></div></form></div>';
            bindChips(applyHost);
            bindForm(applyHost, $("[data-school-note]", applyHost), function () {
              applyHost.innerHTML = '<div class="fill-note fill-note--ok"><b>Заявка отправлена</b>' +
                "<p>Статус появится в разделе «Мой статус» на этой странице — обновите её через пару секунд.</p></div>";
              setTimeout(load, 1200);
            });
          }
        }
      }, function () {
        if (statusHost) statusHost.innerHTML = '<p class="form__note">Сервер не отвечает — обновите страницу позже.</p>';
        if (applyHost) applyHost.innerHTML = "";
      });
    }
    if (Store.refreshConsent) Store.refreshConsent().catch(function () {});
    load();
  }

  /* Страница /media-school: заявка для вошедших, приглашение для остальных. */
  function initSchool() {
    var cta = document.querySelector(".cta");
    if (!cta) return;
    var section = document.createElement("section");
    section.className = "section wrap";
    section.id = "apply";
    section.setAttribute("data-school-page", "");
    section.innerHTML =
      '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Первый набор</span>' +
      "<h2>Подать заявку</h2>" +
      '<p class="sec-head__text">Нужен аккаунт и два подписанных согласия — остальное решает ваша мотивация. ' +
      'Заявка, её статус и учёба живут на <a href="/school">отдельной странице медиашколы</a>.</p></div></div>' +
      '<div data-school-host><p class="form__note">Проверяем аккаунт…</p></div>';
    cta.parentNode.insertBefore(section, cta);
    var host = $("[data-school-host]", section);
    var user = Store.currentUser();
    if (!user) {
      host.innerHTML =
        '<div class="fill-note fill-note--flat"><b>Чтобы подать заявку, нужен аккаунт</b>' +
        "<p>Регистрация занимает минуту: почта, код из письма, пароль. " +
        "Вернитесь на эту страницу — форма откроется сама.</p>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<a class="btn btn--accent btn--sm" href="/join">Создать аккаунт</a>' +
        '<a class="btn btn--ghost btn--sm" href="/join#login">У меня есть аккаунт</a></div></div>';
      return;
    }
    mountSchoolBlock(host);
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
      var consent = Store.consent();
      var consentStatus = (consent && consent.status) || "none";
      var distribution = Store.consent("distribution");
      var distributionStatus = (distribution && distribution.status) || "none";
      /* Писать материалы можно только с принятым согласием на обработку ПД:
         до этого кнопка не ведёт в редактор, а показывает, чего не хватает. */
      var canWrite = consentStatus === "approved" && distributionStatus === "approved";
      var published = Store.listPosts({ authorId: user.id, status: "published" });
      var drafts = Store.listPosts({ authorId: user.id, status: "draft" });
      var pending = Store.listPosts({ authorId: user.id, status: "pending" });
      var rejected = Store.listPosts({ authorId: user.id, status: "rejected" });
      var mine = drafts.concat(pending, rejected, published);
      document.title = user.name + " — личный кабинет";

      /* Баллы и пресс-карта приходят с сервера: локальных сумм и ПИНов больше нет. */
      var portfolioItems = Store.portfolio();

      var portfolioRows = portfolioItems.length
        ? portfolioItems
            .map(function (item) {
              var badge =
                item.status === "approved"
                  ? '<span class="status status--pub">одобрено · +' + (item.points || 0) + "</span>"
                  : item.status === "rejected"
                    ? '<span class="status status--rejected">не принято</span>'
                    : '<span class="status status--pending">на рассмотрении</span>';
              var preview = (item.files || [])
                .filter(function (u) { return /\.(jpg|jpeg|png|webp)$/i.test(u); })
                .slice(0, 3)
                .map(function (u) {
                  return '<a class="portfolio-thumb" href="' + esc(u) + '" target="_blank" rel="noopener">' +
                    '<img src="' + esc(u) + '" alt="' + esc(item.title) + '" loading="lazy"></a>';
                })
                .join("");
              return '<div class="portfolio-row"><div class="portfolio-row__main">' +
                '<div class="portfolio-row__top"><b>' + esc(item.title) + "</b>" + badge + "</div>" +
                '<p class="portfolio-row__about">' + esc(item.about) + "</p>" +
                (preview ? '<div class="portfolio-row__files">' + preview + "</div>" : "") +
                (item.note
                  ? '<p class="portfolio-row__note">Основание комиссии: ' + esc(item.note) + "</p>"
                  : "") +
                '<div class="portfolio-row__meta">' +
                (item.publish ? "на странице аккаунта" : "только для баллов") +
                " · " + esc(fmtDate(item.createdAt)) + "</div></div></div>";
            })
            .join("")
        : '<div class="fill-note fill-note--flat"><b>Портфолио пока пустое</b><p>Добавьте работу, ' +
          "которая ещё не публиковалась на сайте: фотосерию, видео, подкаст. Комиссия посмотрит " +
          "и начислит баллы, а вы решите — показывать её на странице аккаунта или оставить " +
          "только для баллов.</p></div>";

      var portfolioBlock =
        '<div class="profile-posts portfolio" style="margin-top:44px">' +
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Портфолио</span>' +
        "<h2>Свои материалы вне сайта</h2>" +
        '<p class="sec-head__text">Работы, которые вы делали раньше: фотосерии, видео, подкасты. ' +
        "Комиссия решает, интересны ли они проекту, и начисляет баллы.</p></div>" +
        '<button class="btn btn--accent btn--sm" type="button" data-portfolio-open>' +
        "Добавить свои материалы</button></div>" +
        '<form class="portfolio-form is-hidden" data-portfolio-form>' +
        '<div class="field"><label for="pf-title">Название работы</label>' +
        '<input id="pf-title" name="title" type="text" maxlength="160" required ' +
        'placeholder="Например: серия о ночных дворах"></div>' +
        '<div class="field"><label for="pf-about">Что это и почему интересно</label>' +
        '<textarea id="pf-about" name="about" rows="4" maxlength="1200" required ' +
        'placeholder="Коротко: тема, где снимали, что получилось"></textarea></div>' +
        '<div class="field"><label for="pf-files">Файлы (до трёх: фото, видео или аудио)</label>' +
        '<input id="pf-files" type="file" accept="image/*,video/*,audio/*" multiple data-portfolio-files>' +
        '<p class="field__hint" data-portfolio-files-note>Файлы хранятся на платформе, до 8 МБ каждый.</p></div>' +
        '<label class="check-line"><input type="checkbox" name="publish" value="1">' +
        "<span>Показать работу на странице моего аккаунта, если комиссия её одобрит</span></label>" +
        '<div class="row"><button class="btn" type="submit">Отправить комиссии</button>' +
        '<span class="form__note" data-portfolio-note></span></div></form>' +
        '<div class="portfolio-list">' + portfolioRows + "</div></div>";

      var pointsBlock =
        '<div class="profile-posts points" style="margin-top:44px" data-profile-points>' +
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Баллы</span>' +
        "<h2>Журнал начислений</h2></div></div>" +
        '<p class="form__note">Загружаем журнал с сервера…</p></div>';

      var STATUS = {
        draft: {
          label: "не выложен · черновик",
          cls: "status--draft",
          hint: "Виден только вам. Нажмите «Отправить на проверку», когда будет готово.",
        },
        pending: {
          label: "не выложен · на проверке",
          cls: "status--pending",
          hint: "Материал у редакции. После одобрения он появится в ленте и на карте региона.",
        },
        rejected: {
          label: "не выложен · нужны правки",
          cls: "status--rejected",
          hint: "Редакция вернула материал с замечанием — исправьте и отправьте снова.",
        },
        published: {
          label: "выложен на сайт",
          cls: "status--pub",
          hint: "Материал опубликован: его видят все посетители сайта.",
        },
      };

      var postRow = function (p) {
        var st = STATUS[p.status] || STATUS.draft;
        var action = "";
        if (p.status === "draft" || p.status === "rejected") {
          action =
            '<button class="btn btn--sm btn--accent" type="button" data-submit="' + p.id + '">' +
            "Отправить на проверку</button>";
        } else if (p.status === "pending") {
          action = '<span class="post-row__wait">Ждёт редактора</span>';
        } else {
          action = '<a class="btn btn--sm btn--accent" href="/article?id=' +
            encodeURIComponent("u:" + p.id) + '">Открыть на сайте</a>';
        }
        return (
          '<div class="post-row" data-post-status="' + esc(p.status) + '">' +
          '<div class="post-row__main">' +
          '<div class="post-row__meta"><span class="status ' + st.cls + '">' + st.label +
          "</span><span>" + fmtDate(p.updatedAt || p.date) + "</span><span>" + esc(p.format) +
          " · " + esc(regionName(p.region)) + "</span></div>" +
          '<div class="post-row__title">' + esc(p.title) + "</div>" +
          '<div class="post-row__hint">' + esc(st.hint) + "</div>" +
          (p.status === "rejected" && p.reviewNote
            ? '<div class="post-row__note">Замечание редактора: ' + esc(p.reviewNote) + "</div>"
            : "") +
          "</div>" +
          '<div class="post-row__actions">' + action +
          (p.status === "published"
            ? '<a class="btn btn--sm btn--ghost" href="/support">Снять с публикации</a>'
            : '<a class="btn btn--sm btn--ghost" href="/write?id=' + p.id + '">Изменить</a>' +
              '<button class="btn btn--sm btn--ghost" type="button" data-delete="' + p.id + '">Удалить</button>') +
          '<span class="form__note" data-delete-note="' + p.id + '"></span>' +
          "</div></div>"
        );
      };

      var teamBlock =
        '<div class="panel panel--team" data-profile-editorial>' +
        '<h3>Редакция</h3><p class="form__note">Загружаем с сервера…</p></div>';

      var cabTabs = [
        ["overview", "Обзор", ICONS.grid],
        ["posts", "Мои материалы", ICONS.doc],
        ["card", "Пресс-карта", ICONS.card],
        ["progress", "Баллы и портфолио", ICONS.star],
        ["team", "Редакция и задачи", ICONS.users],
        ["mail", "Почта", ICONS.mail],
        ["settings", "Профиль и безопасность", ICONS.settings],
      ];

      /* Следующий шаг: кабинет сразу говорит, что делать дальше, а не
         заставляет искать нужную карточку в длинной странице. */
      var nextStep;
      if (!canWrite) {
        nextStep = {
          tone: "wait",
          title: "Подпишите два согласия",
          text: "Согласие на обработку данных и согласие на распространение — оба нужны, " +
            "чтобы редакция могла опубликовать материал с вашим именем.",
          action: '<button class="btn btn--sm btn--accent" type="button" data-cab-go="overview">К документам</button>',
        };
      } else if (published.length < 5) {
        nextStep = {
          tone: "go",
          title: "До пресс-карты осталось " + (5 - published.length) + " " +
            plural(5 - published.length, ["публикация", "публикации", "публикаций"]),
          text: "Считаются только опубликованные материалы: черновики и проверка в зачёт не идут.",
          action: '<a class="btn btn--sm btn--accent" href="/write">Написать материал</a>' +
            '<button class="btn btn--sm btn--ghost" type="button" data-cab-go="card">Условия карты</button>',
        };
      } else {
        nextStep = {
          tone: "ready",
          title: "Можно подавать заявку на пресс-карту",
          text: "Опубликовано материалов: " + published.length + ". Заявление рассматривает редакция.",
          action: '<button class="btn btn--sm btn--accent" type="button" data-cab-go="card">Открыть раздел карты</button>',
        };
      }

      host.innerHTML =
        '<section class="profile-hero cabinet-hero"><div class="wrap">' +
        '<div class="profile-hero__grid">' +
        '<div class="profile-id">' +
        '<button class="profile-ava" type="button" data-avatar-open ' +
        'aria-label="Изменить фотографию профиля">' +
        (user.avatar
          ? '<img src="' + esc(user.avatar) + '" alt="Фото профиля">'
          : '<span class="profile-id__ava">' + esc(Store.initials(user.name)) + "</span>") +
        '<span class="profile-ava__hint">сменить</span></button>' +
        '<input type="file" accept="image/*" data-avatar-input hidden>' +
        (user.avatar
          ? '<button class="profile-ava__clear" type="button" data-avatar-clear>убрать фото</button>'
          : "") +
        "<div><h1>" + esc(user.name) + "</h1>" +
        '<p class="profile-id__role"><span class="status-badge">' + esc(user.access || "Пользователь") +
        "</span>" + esc(user.role) +
        (user.region ? " · " + esc(regionName(user.region)) : "") + "</p>" +
        '<p class="profile-id__since">На проекте с ' + fmtDate(user.createdAt) +
        " · сборка " + esc((SC && SC.build) || "—") + "</p></div>" +
        "</div>" +
        '<div class="profile-hero__actions">' +
        (canWrite
          ? '<a class="btn btn--accent" href="/write">Написать материал</a>'
          : '<span class="btn btn--accent is-locked" aria-disabled="true" ' +
            'title="Откроется после того, как редакция примет оба согласия">Написать материал</span>') +
        (Store.can(user, "manage") || Store.can(user, "posts.review")
          ? '<a class="btn btn--ghost" href="/admin">Панель проекта</a>' : "") +
        '<button class="btn btn--ghost" type="button" data-logout>Выйти</button>' +
        "</div></div></div></section>" +

        '<section class="cabinet"><div class="wrap cabinet__in">' +
        '<nav class="cabinet__nav" data-cab-nav role="tablist" aria-label="Разделы кабинета">' +
        cabTabs.map(function (t) {
          return '<button class="cabinet__tab" type="button" role="tab" data-cab-tab="' + t[0] + '" ' +
            'aria-selected="false">' + t[2] + "<span>" + t[1] + "</span></button>";
        }).join("") +
        "</nav>" +
        '<div class="cabinet__main">' +

        /* ---- Обзор ------------------------------------------------------ */
        '<section class="cab-panel" data-cab-panel="overview" role="tabpanel" aria-label="Обзор">' +
        (param("new")
          ? '<div class="welcome"><b>Аккаунт создан.</b> Сначала загрузите оба согласия: на обработку данных и на распространение. ' +
            "После пяти опубликованных материалов можно подать заявку на пресс-карту.</div>"
          : "") +
        '<div class="next-step next-step--' + nextStep.tone + '">' +
        '<div class="next-step__text"><span class="kicker">Следующий шаг</span>' +
        "<h2>" + esc(nextStep.title) + "</h2><p>" + esc(nextStep.text) + "</p></div>" +
        '<div class="next-step__actions">' + nextStep.action + "</div></div>" +
        '<div class="cab-kpi">' +
        '<button class="cab-kpi__item" type="button" data-cab-go="posts">' +
        "<b>" + published.length + "</b><span>опубликовано</span></button>" +
        '<button class="cab-kpi__item" type="button" data-cab-go="posts">' +
        "<b>" + pending.length + "</b><span>на проверке</span></button>" +
        '<button class="cab-kpi__item" type="button" data-cab-go="posts">' +
        "<b>" + drafts.length + "</b><span>черновиков</span></button>" +
        '<button class="cab-kpi__item" type="button" data-cab-go="card">' +
        "<b>" + Math.min(published.length, 5) + " из 5</b><span>к пресс-карте</span></button>" +
        "</div>" +
        '<div class="cab-head"><span class="kicker">Документы</span>' +
        "<h2>Согласия на данные</h2>" +
        "<p>Без обоих документов редакция не может публиковать материалы с именем автора.</p></div>" +
        '<div class="cab-consents">' +
        consentBlockHtml(consentStatus, consent) +
        consentBlockHtml(distributionStatus, distribution, "distribution") +
        "</div>" +
        '<div data-school-host style="margin-top:18px"></div>' +
        '<div class="cab-cols">' + teamBlock +
        "</div></section>" +

        /* ---- Материалы -------------------------------------------------- */
        '<section class="cab-panel" data-cab-panel="posts" role="tabpanel" aria-label="Мои материалы" hidden>' +
        '<div class="cab-head cab-head--row"><div><span class="kicker">Мои материалы</span>' +
        "<h2>Материалы и статусы</h2>" +
        "<p>Выложено на сайт: <b>" + published.length + "</b>. Не выложено: <b>" +
        (mine.length - published.length) + "</b> — черновики, проверка и правки.</p></div>" +
        (canWrite
          ? '<a class="btn btn--sm btn--accent" href="/write">Новый материал</a>'
          : '<span class="btn btn--sm btn--accent is-locked" aria-disabled="true">Новый материал</span>') +
        "</div>" +
        '<div class="cab-filters" data-post-filters>' +
        [["", "Все", mine.length], ["published", "На сайте", published.length],
         ["pending", "На проверке", pending.length], ["draft", "Черновики", drafts.length],
         ["rejected", "Нужны правки", rejected.length]].map(function (f, i) {
          return '<button class="chip-sm' + (i === 0 ? " is-on" : "") + '" type="button" data-post-filter="' +
            f[0] + '">' + f[1] + "<span>" + f[2] + "</span></button>";
        }).join("") +
        "</div>" +
        '<div class="profile-posts" data-post-list>' +
        (mine.length
          ? mine.map(postRow).join("")
          : '<div class="empty"><h3>Пока ничего не опубликовано</h3>' +
            "<p>Начните с простого: история из вашего двора, района или вуза. " +
            "Памятка автору подскажет, с чего начать.</p>" +
            '<div class="empty__actions">' +
            (canWrite
              ? '<a class="btn btn--accent" href="/write">Написать материал</a>'
              : '<span class="btn btn--accent is-locked" aria-disabled="true">Написать материал</span>') +
            '<a class="btn btn--ghost" href="/assets/docs/pamyatka-avtoru.pdf?v=2026-11-13-9" target="_blank" rel="noopener">Памятка автору</a></div></div>') +
        "</div></section>" +

        /* ---- Пресс-карта ------------------------------------------------ */
        '<section class="cab-panel" data-cab-panel="card" role="tabpanel" aria-label="Пресс-карта" hidden>' +
        '<div class="cab-head"><span class="kicker">Пресс-карта автора</span>' +
        "<h2>Карта, заявка и печать</h2>" +
        "<p>Статус, номер и срок действия приходят с сервера. Печатная карта — 85,6 × 54 мм, " +
        "проверить её можно на странице /verify.</p></div>" +
        '<div data-profile-card><p class="form__note">Загружаем пресс-карту…</p></div>' +
        '<div data-card-app-host></div>' +
        "</section>" +

        /* ---- Баллы и портфолио ------------------------------------------ */
        '<section class="cab-panel" data-cab-panel="progress" role="tabpanel" aria-label="Баллы и портфолио" hidden>' +
        pointsBlock + portfolioBlock + "</section>" +

        /* ---- Редакция и задачи ------------------------------------------ */
        '<section class="cab-panel" data-cab-panel="team" role="tabpanel" aria-label="Редакция и задачи" hidden>' +
        '<div class="cab-head"><span class="kicker">Команда</span><h2>Редакция, вакансии и задачи</h2>' +
        "<p>Своя редакция, заявления в штат и поручения от редакции проекта.</p></div>" +
        '<div data-my-editorial></div>' +
        '<div data-hiring-cabinet style="margin-top:18px"></div>' +
        '<div data-tasks-cabinet style="margin-top:18px"></div>' +
        "</section>" +

        /* ---- Почта ------------------------------------------------------ */
        '<section class="cab-panel" data-cab-panel="mail" role="tabpanel" aria-label="Почта" hidden>' +
        '<div class="cab-head"><span class="kicker">Почта</span><h2>Письма проекта</h2>' +
        "<p>Входящие письма ящика, к которому у вас есть доступ.</p></div>" +
        '<div data-inbox></div></section>' +

        /* ---- Профиль и безопасность ------------------------------------- */
        '<section class="cab-panel" data-cab-panel="settings" role="tabpanel" aria-label="Профиль и безопасность" hidden>' +
        '<div class="cab-head"><span class="kicker">Настройки</span><h2>Профиль автора</h2>' +
        "<p>Имя, регион и темы. Почта меняется только через поддержку.</p></div>" +
        '<div class="profile-settings">' +
        '<form class="form" data-profile-form>' +
        '<div class="field"><label for="p-name">Имя</label>' +
        '<input id="p-name" name="name" type="text" value="' + esc(user.name) + '"></div>' +
        '<div class="field"><label>Почта</label><input type="text" value="' +
        esc(user.email) + '" disabled></div>' +
        '<div class="field"><label>Роль</label><input type="text" value="' +
        esc(user.role || "") + '" disabled></div>' +
        '<div class="field"><label for="p-region">Регион</label><select id="p-region" name="region">' +
        '<option value="">Не выбран</option>' + regionOptions(user.region) + "</select></div>" +
        '<div class="field form__full"><label for="p-bio">О себе</label>' +
        '<textarea id="p-bio" name="bio" placeholder="Пара предложений: о чём хотите рассказывать">' +
        esc(user.bio || "") + "</textarea></div>" +
        '<div class="form__full"><h3 class="cab-sub">Смена пароля</h3>' +
        '<div class="pass-change">' +
        '<div class="field"><label for="p-old">Текущий пароль</label>' +
        '<input id="p-old" name="oldPass" type="password" autocomplete="current-password"></div>' +
        '<div class="field"><label for="p-new">Новый пароль</label>' +
        '<input id="p-new" name="newPass" type="password" placeholder="От 8 символов" ' +
        'autocomplete="new-password"></div>' +
        "</div>" +
        '<div class="row" style="gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-pass-change>Сменить пароль</button>' +
        '<span class="form__note" data-pass-note></span></div></div>' +
        '<div class="form__full"><h3 class="cab-sub">Оформление</h3>' +
        '<p class="form__note" style="margin:0">Цвет и тему меняйте кнопкой палитры в шапке — выбор запоминается.</p></div>' +
        '<div class="form__full row"><button class="btn" type="submit">Сохранить</button>' +
        '<span class="form__note" data-profile-status>' + esc(savedNote) + "</span></div>" +
        "</form></div>" +
        '<details class="cab-extra"><summary>Двухфакторный вход и коды восстановления</summary>' +
        '<div data-twofa-card style="margin-top:12px"></div>' +
        '<div data-recovery-card style="margin-top:12px"></div></details>' +
        '<div data-danger-zone style="margin-top:18px"></div>' +
        "</section>" +

        "</div></div></section>";

      buildCabinetTabs(host, cabTabs);
      bindPostFilters(host);

      initAnimations();
      mountProfileCard();
      mountProfilePoints();
      mountProfileEditorial();
      mountCardApplication();
      mountMyEditorial(user);
      warnLocalOnly();
      mountInbox();
      mountHiringCabinet(user);
      mountSchoolApp();
      mountTasksCabinet(user);
      mountTwofaCard(user);
      mountDangerZone(user);
      mountRecoveryCard();
      syncSwatches(readAccent());
      Store.refreshPortfolio();
      Store.refreshConsent().then(function (fresh) {
        var before = (consent && consent.status) || "none";
        var freshDistribution = Store.consent("distribution");
        var changed = (fresh && fresh.status && fresh.status !== before) ||
          (freshDistribution && freshDistribution.status !== distributionStatus);
        if (changed && host.isConnected !== false) render();
      }, function () {
        var note = $('[data-consent-note="processing"]', host);
        if (note) note.textContent = "Не удалось спросить сервер о статусе согласия. Показаны сохранённые данные.";
      });

      var form = $("[data-profile-form]", host);
      if (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var d = new FormData(form);
          var btn = form.querySelector('button[type="submit"]');
          var note = $("[data-profile-status]", form);
          if (btn) btn.disabled = true;
          if (note) note.textContent = "Сохраняем…";
          Store.saveProfile({
            name: d.get("name"),
            role: d.get("role"),
            region: d.get("region"),
            bio: d.get("bio"),
          }).then(function (res) {
            if (btn) btn.disabled = false;
            if (res && res.ok === false) {
              savedNote = "";
              if (note) note.textContent = res.error || "Не сохранилось.";
              return;
            }
            savedNote = "Сохранено";
            render();
          });
        });
      }
      var avatarBtn = $("[data-avatar-open]", host);
      var avatarInput = $("[data-avatar-input]", host);
      if (avatarBtn && avatarInput) {
        avatarBtn.addEventListener("click", function () { avatarInput.click(); });
        avatarInput.addEventListener("change", function () {
          var file = avatarInput.files && avatarInput.files[0];
          avatarInput.value = "";
          if (!file) return;
          if (!/^image\//.test(file.type)) {
            window.alert("Нужна фотография: jpg, png или webp.");
            return;
          }
          avatarBtn.classList.add("is-busy");
          avatarToSquare(file)
            .then(function (dataUrl) { return Store.saveProfile({ avatar: dataUrl }); })
            .then(function (res) {
              avatarBtn.classList.remove("is-busy");
              if (res && res.ok === false) {
                window.alert(res.error || "Фото не сохранилось.");
                return;
              }
              render();
            }, function (err) {
              avatarBtn.classList.remove("is-busy");
              window.alert((err && err.message) || "Не удалось загрузить фотографию.");
            });
        });
      }

      var avatarClearBtn = $("[data-avatar-clear]", host);
      if (avatarClearBtn) {
        avatarClearBtn.addEventListener("click", function () {
          if (!window.confirm("Убрать фотографию из профиля?")) return;
          Store.saveProfile({ avatarClear: true }).then(function () { render(); }, function (err) {
            window.alert((err && err.message) || "Не удалось убрать фото.");
          });
        });
      }

      $$("[data-consent-file]", host).forEach(function (consentFile) {
        var kind = consentFile.getAttribute("data-consent-file") || "processing";
        consentFile.addEventListener("change", function () {
          var file = consentFile.files && consentFile.files[0];
          if (!file) return;
          var purposeEl = $('[data-consent-purpose]', host);
          var purpose = kind === "distribution" && purposeEl ? purposeEl.value.trim() : "";
          var noteEl = $('[data-consent-note="' + kind + '"]', host);
          if (noteEl) noteEl.textContent = "Загружаем скан…";
          /* скан уходит прямо в закрытое хранилище вместе с заявкой */
          fileToDataUrl(file)
            .then(function (dataUrl) { return Store.sendConsent(dataUrl, kind, purpose); })
            .then(function () {
              render();
              var fresh = $('[data-consent-note="' + kind + '"]', host);
              if (fresh) fresh.textContent = "Согласие отправлено на проверку.";
            }, function (err) {
              var fresh = $('[data-consent-note="' + kind + '"]', host);
              if (fresh) fresh.textContent = (err && err.message) || "Не удалось отправить согласие.";
            });
        });
      });

      /* «Добавить свои материалы» */
      var pfOpen = $("[data-portfolio-open]", host);
      var pfForm = $("[data-portfolio-form]", host);
      if (pfOpen && pfForm) {
        pfOpen.addEventListener("click", function () {
          pfForm.classList.toggle("is-hidden");
          if (!pfForm.classList.contains("is-hidden")) pfForm.scrollIntoView({ behavior: "smooth", block: "center" });
        });

        pfForm.addEventListener("submit", function (e) {
          e.preventDefault();
          var noteEl = $("[data-portfolio-note]", pfForm);
          var title = pfForm.querySelector('[name="title"]').value.trim();
          var about = pfForm.querySelector('[name="about"]').value.trim();
          var publish = !!pfForm.querySelector('[name="publish"]').checked;
          var input = $("[data-portfolio-files]", pfForm);
          var files = Array.prototype.slice.call((input && input.files) || []).slice(0, 3);

          if (title.length < 5) { noteEl.textContent = "Название — хотя бы пять символов."; return; }
          if (about.length < 30) { noteEl.textContent = "Расскажите о работе: минимум 30 символов."; return; }
          if (!files.length) { noteEl.textContent = "Приложите хотя бы один файл."; return; }

          noteEl.textContent = "Загружаем файлы…";
          files
            .reduce(function (chain, file) {
              return chain.then(function (acc) {
                return fileToDataUrl(file).then(function (dataUrl) {
                  acc.push(dataUrl);
                  return acc;
                });
              });
            }, Promise.resolve([]))
            .then(function (dataUrls) {
              noteEl.textContent = "Отправляем комиссии…";
              return Store.portfolioSend({ title: title, about: about, files: dataUrls, publish: publish });
            })
            .then(function () {
              render();
            }, function (err) {
              noteEl.textContent = (err && err.message) || "Не удалось отправить работу.";
            });
        });
      }

      var passBtn = $("[data-pass-change]", host);
      if (passBtn) {
        passBtn.addEventListener("click", function () {
          var form = $("[data-profile-form]", host);
          var noteEl = $("[data-pass-note]", host);
          var oldPass = form.querySelector('[name="oldPass"]').value;
          var newPass = form.querySelector('[name="newPass"]').value;
          if (newPass.length < 8) {
            noteEl.textContent = "Новый пароль — не короче восьми символов.";
            return;
          }
          passBtn.disabled = true;
          noteEl.textContent = "Меняем пароль…";
          Store.changePassword(oldPass, newPass).then(
            function () {
              passBtn.disabled = false;
              noteEl.textContent = "Пароль изменён. Войдите с новым паролем на других устройствах.";
              form.querySelector('[name="oldPass"]').value = "";
              form.querySelector('[name="newPass"]').value = "";
            },
            function (err) {
              passBtn.disabled = false;
              noteEl.textContent = (err && err.message) || "Не удалось сменить пароль.";
            }
          );
        });
      }

      $$("[data-logout]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          Store.logout();
          window.location.href = "/";
        });
      });

      $$("[data-submit]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          b.disabled = true;
          Store.submitPost(b.getAttribute("data-submit")).then(function (res) {
            b.disabled = false;
            if (!res.ok) {
              window.alert(res.error || "Не удалось отправить материал.");
              return;
            }
            render();
          }, function (err) {
            b.disabled = false;
            window.alert((err && err.message) || "Не удалось отправить материал.");
          });
        });
      });

      $$("[data-delete]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          if (!window.confirm("Удалить материал? Действие необратимо.")) return;
          var id = b.getAttribute("data-delete");
          var note = $('[data-delete-note="' + id + '"]', host);
          b.disabled = true;
          if (note) note.textContent = "Удаляем…";
          Store.deletePost(id).then(function (res) {
            b.disabled = false;
            if (!res || !res.ok) {
              if (note) note.textContent = (res && res.error) || "Не удалось удалить материал.";
              return;
            }
            render();
          }, function (err) {
            b.disabled = false;
            if (note) note.textContent = (err && err.message) || "Не удалось удалить материал.";
          });
        });
      });
    }

    function mountProfileCard() {
      var box = $("[data-profile-card]", host);
      if (!box || !Store.apiCardStatus) return;
      function draw(status) {
        var current = status.current || null;
        var st = current ? current.status : "none";
        var published = Number(status.published) || 0;
        var need = Number(status.minPosts) || 5;
        var percent = Math.min(100, Math.round((published / need) * 100));
        var head = '<div class="pcard__top"><span class="kicker">Пресс-карта автора</span>' + cardStatusBadge(current || {}) + "</div>";

        /* Макет карты в натуральных пропорциях (85,6 × 54 мм): автор видит,
           что именно получит, ещё до выдачи. Данные — только с сервера. */
        var visual =
          '<div class="pcard-visual pcard-visual--' + esc(st) + '" aria-hidden="true">' +
          '<div class="pcard-visual__head">' +
          '<img class="pcard-visual__logo" src="/assets/img/logo.png" alt="" width="120" height="22">' +
          '<span class="pcard-visual__kind">ПРЕСС-КАРТА</span>' +
          "</div>" +
          '<div class="pcard-visual__num">' +
          (st === "issued" && current ? esc(current.number || "") : "СК-····-····") + "</div>" +
          '<div class="pcard-visual__name">' +
          esc((current && current.authorName) || (Store.currentUser() || {}).name || "Автор проекта") + "</div>" +
          '<div class="pcard-visual__foot">' +
          "<span>" + esc(regionName((current && current.authorRegion) || (Store.currentUser() || {}).region) || "регион не указан") + "</span>" +
          "<span>" + (st === "issued" && current ? "до " + esc(fmtDate(current.validUntil)) : "не выдана") + "</span>" +
          "</div>" +
          (st === "issued" ? "" : '<span class="pcard-visual__stamp">образец</span>') +
          "</div>";

        /* Шаги к карте: что уже сделано, а что осталось. */
        var processing = (Store.consent() || {}).status === "approved";
        var distributionOk = (Store.consent("distribution") || {}).status === "approved";
        var steps = [
          ["Оба согласия приняты", processing && distributionOk, "processing"],
          ["Опубликовано " + published + " из " + need, published >= need || !!status.byRole, "posts"],
          ["Заявка подана", st === "pending" || st === "issued", "card"],
          ["Карта выдана", st === "issued", "card"],
        ];
        var stepsHtml =
          '<ol class="pcard-steps">' + steps.map(function (s, i) {
            return '<li class="pcard-steps__item' + (s[1] ? " is-done" : "") + '">' +
              '<span class="pcard-steps__mark">' + (s[1] ? ICONS.check : i + 1) + "</span>" +
              "<span>" + esc(s[0]) + "</span></li>";
          }).join("") + "</ol>";
        var body = "";
        if (st === "issued" && current) {
          body =
            '<div class="pcard__name">' + esc(current.number || "") + "</div>" +
            '<div class="pcard__role">' + esc(current.authorName || "") + " · " +
            esc(regionName(current.authorRegion) || current.authorRegion || "регион не указан") + "</div>" +
            '<div class="pcard__row">' +
            "<span><b>Выдана</b>" + esc(fmtDate(current.issuedAt)) + "</span>" +
            "<span><b>Действует до</b>" + esc(fmtDate(current.validUntil)) + "</span>" +
            "<span><b>Публикаций</b>" + published + "</span>" +
            "</div>" +
            (current.issuePlace ? '<p class="pcard__note">Выдача: ' + esc(current.issuePlace) + "</p>" : "") +
            (current.dispatch && (current.dispatch.tracking || current.dispatch.sentAt)
              ? '<p class="pcard__note">Отправлена: ' + esc(fmtDate(current.dispatch.sentAt)) +
                (current.dispatch.tracking ? " · трек-номер " + esc(current.dispatch.tracking) : "") + "</p>"
              : "");
        } else if (st === "pending") {
          body = '<p class="pcard__note">Заявка отправлена ' + esc(fmtDate(current.createdAt)) +
            " и ждёт решения редакции. Номер и срок появятся здесь после выдачи.</p>";
        } else {
          var note = st === "expired" ? "Срок действия карты истёк. Можно подать новую заявку."
            : st === "revoked" ? "Карта отозвана редакцией." + (current && current.note ? " Основание: " + esc(current.note) : "")
            : st === "rejected" ? "Заявку вернули." + (current && current.note ? " Основание: " + esc(current.note) : "")
            : status.byRole ? "Вы в команде проекта: карту можно получить по должности."
            : "Карта выдаётся по заявке после " + need + " опубликованных материалов.";
          body =
            '<p class="pcard__note">' + note + "</p>" +
            '<div class="pcard__progress"><b>' + published + " из " + need + "</b>" +
            "<span>опубликовано материалов</span></div>" +
            '<div class="pcard__bar"><i style="width:' + percent + '%"></i></div>' +
            '<ol class="pcard__steps">' +
            "<li>Подпишите оба согласия: на обработку и на распространение данных — без них материалы не публикуются.</li>" +
            "<li>Опубликуйте материалы: черновик и проверка не считаются.</li>" +
            "<li>Подайте заявление ниже — решение принимает редакция.</li>" +
            "</ol>";
        }
        var canPrint = st === "issued" && current && current.number && current.verifyCode;
        var printLink = canPrint
          ? '<a class="btn btn--ghost btn--sm" href="' + esc(cardPrintUrl(current)) +
            '" target="_blank" rel="noopener">Печать карты</a>' +
            '<button class="btn btn--accent btn--sm" type="button" data-card-pdf>Карта (PDF)</button>' +
            '<button class="btn btn--sm" type="button" data-card-act>Акт выдачи (PDF)</button>' +
            '<span class="form__note" data-card-pdf-note role="status" aria-live="polite"></span>'
          : "";
        var verifyLink = canPrint
          ? '<a class="btn btn--ghost btn--sm" href="/verify#n=' + encodeURIComponent(current.number) +
            "&c=" + encodeURIComponent(current.verifyCode) + '" target="_blank" rel="noopener">Проверить карту</a>'
          : '<a class="btn btn--ghost btn--sm" href="/verify">Как проверяют карту</a>';
        /* Паспорт карты: показываем всегда — и до выдачи тоже, чтобы было
           видно, что известно редакции, а что появится после решения. */
        var delivery = current && current.dispatch && (current.dispatch.tracking || current.dispatch.sentAt)
          ? "Почтой России" + (current.dispatch.tracking ? " · трек " + esc(current.dispatch.tracking) : "")
          : (current && current.issuePlace ? "Лично: " + esc(current.issuePlace) : "уточняется");
        var basis = status.byRole ? "должность в редакции"
          : st === "issued" ? "заявка автора"
          : st === "pending" ? "заявка на проверке"
          : st === "expired" || st === "revoked" ? "карта была выдана"
          : "заявка ещё не подана";
        var dataRows =
          '<dl class="pcard-data">' +
          "<div><dt>Статус</dt><dd>" + esc(cardStatusText(st)) + "</dd></div>" +
          "<div><dt>Номер карты</dt><dd>" + (current && current.number ? esc(current.number) : "— после выдачи") + "</dd></div>" +
          "<div><dt>Владелец</dt><dd>" + esc((current && current.authorName) || (Store.currentUser() || {}).name || "") + "</dd></div>" +
          "<div><dt>Регион</dt><dd>" + esc(regionName((current && current.authorRegion) || (Store.currentUser() || {}).region) || "не указан") + "</dd></div>" +
          "<div><dt>Выдана</dt><dd>" + (st === "issued" && current ? esc(fmtDate(current.issuedAt)) : "—") + "</dd></div>" +
          "<div><dt>Действует до</dt><dd>" + (st === "issued" && current ? esc(fmtDate(current.validUntil)) : "—") + "</dd></div>" +
          "<div><dt>Основание</dt><dd>" + esc(basis) + "</dd></div>" +
          "<div><dt>Получение</dt><dd>" + delivery + "</dd></div>" +
          "</dl>";
        var actNote = canPrint
          ? '<p class="form__note" style="margin-top:10px">Акт выдачи — документ с подписями основателей ' +
            "Сирика Н. С. и Ильина Б. П.: в нём указано, кто и какую карту получил. Он создаётся для каждой " +
            "выданной карты и хранится в редакции.</p>"
          : "";
        box.innerHTML =
          '<div class="pcard pcard--' + esc(st) + '" data-reveal>' + head +
          '<div class="pcard-layout">' +
          '<div class="pcard-layout__visual">' + visual + stepsHtml + "</div>" +
          '<div class="pcard-layout__info">' + dataRows + body +
          '<div class="pcard__actions">' + printLink + verifyLink +
          '<a class="btn btn--ghost btn--sm" href="#card-application">Заявка и статус</a>' +
          '<a class="btn btn--ghost btn--sm" href="/support">Спросить о карте</a></div>' +
          actNote +
          "</div></div>" +
          '<div class="pcard-faq">' +
          "<h3>Что можно уточнить о пресс-карте</h3>" +
          "<details><summary>Что даёт карта и что она не даёт</summary>" +
          "<p>Карта подтверждает, что вы публикуетесь в проекте «Смена контента», и по договорённости " +
          "с организаторами помогает посещать открытые мероприятия. Она не заменяет удостоверение " +
          "зарегистрированного СМИ и не даёт права требовать доступ на закрытые события.</p></details>" +
          "<details><summary>Как проверяют карту</summary>" +
          "<p>На странице /verify по номеру и коду с оборота: любой человек видит статус карты — " +
          "действует, просрочена или отозвана. Данные владельца при проверке не показываются.</p></details>" +
          "<details><summary>Сколько действует и как продлить</summary>" +
          "<p>Карта действует двенадцать месяцев. Продление решает редакция: напишите в поддержку " +
          "за пару недель до конца срока.</p></details>" +
          "<details><summary>Если карту отозвали или вы её потеряли</summary>" +
          "<p>Отзыв происходит только с основанием, которое видно в этом разделе. Потерянную карту " +
          "перевыпускают через поддержку: старая гасится, номер меняется.</p></details>" +
          "</div></div>";
        var pdfBtn = $("[data-card-pdf]", box);
        if (pdfBtn) pdfBtn.addEventListener("click", function () {
          downloadCardPdf(current.id, pdfBtn, $('[data-card-pdf-note]', box));
        });
        var actBtn = $("[data-card-act]", box);
        if (actBtn) actBtn.addEventListener("click", function () {
          downloadCardAct(current.id, actBtn, $('[data-card-pdf-note]', box));
        });
      }
      function failNote(text) {
        box.innerHTML = '<p class="form__note is-error">' + esc(text) +
          ' <button class="btn btn--sm btn--ghost" type="button" data-card-retry>Повторить</button></p>';
        var retry = $("[data-card-retry]", box);
        if (retry) retry.addEventListener("click", function () { load(); });
      }
      function load() {
        Store.apiCardStatus().then(function (status) {
          if (!status || !status.ok) {
            failNote((status && status.error) || "Не удалось загрузить пресс-карту.");
            return;
          }
          try {
            draw(status);
          } catch (e) {
            failNote("Карта не отрисовалась: " + ((e && e.message) || "сбой интерфейса") + ".");
          }
        }, function (err) {
          failNote((err && err.message) || "Не удалось загрузить пресс-карту.");
        });
        /* если ответ не пришёл за 12 секунд — показываем это словами,
           а не пустым разделом */
        setTimeout(function () {
          if (!box.firstChild) failNote("Сервер не отвечает дольше 12 секунд.");
        }, 12000);
      }
      load();
    }

    function mountProfilePoints() {
      var box = $("[data-profile-points]", host);
      if (!box || !Store.pointsHistory) return;
      function load() {
        Promise.all([Store.pointsHistory(), Store.pointsRules ? Store.pointsRules() : Promise.resolve([])]).then(function (res) {
          var journal = res[0];
          var rules = res[1] || [];
          var labels = {};
          rules.forEach(function (r) { labels[r.key] = r.label || r.key; });
          var entries = journal.entries || [];
          var rows = entries.map(function (e) {
            var delta = Number(e.delta) || 0;
            return "<tr><td>" + esc(fmtDate(e.at)) + "</td><td>" + esc(labels[e.reason] || e.reason || "Операция") +
              (e.note ? "<br><small>" + esc(e.note) + "</small>" : "") + "</td><td>" +
              (delta > 0 ? "+" : "") + delta + "</td><td>" + esc(String(e.balanceAfter != null ? e.balanceAfter : "")) + "</td></tr>";
          }).join("");
          box.innerHTML =
            '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Баллы</span>' +
            "<h2>Журнал начислений</h2></div></div>" +
            '<div class="kpi" style="margin-bottom:18px"><div class="kpi__item"><b class="points__total">' +
            esc(String(journal.balance != null ? journal.balance : 0)) + "</b><span>баллов всего</span></div></div>" +
            '<p class="muted" style="max-width:640px">Баллы начисляет сервер за опубликованные материалы, портфолио и пресс-карту. ' +
            "Здесь видна каждая операция; локального подсчёта в браузере нет.</p>" +
            (rows ? '<table class="points__table"><thead><tr><th>Дата</th><th>Основание</th><th>Баллы</th><th>Баланс</th></tr></thead><tbody>' +
              rows + "</tbody></table>" : '<div class="fill-note fill-note--flat"><b>Начислений пока нет</b><p>Операции появятся после решения редакции.</p></div>');
        }, function (err) {
          box.innerHTML = '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Баллы</span><h2>Журнал начислений</h2></div></div>' +
            '<p class="form__note is-error">' + esc((err && err.message) || "Не удалось загрузить журнал.") +
            ' <button class="btn btn--sm btn--ghost" type="button" data-points-retry>Повторить</button></p>';
          var retry = $("[data-points-retry]", box);
          if (retry) retry.addEventListener("click", load);
        });
      }
      load();
    }

    function mountProfileEditorial() {
      var box = $("[data-profile-editorial]", host);
      if (!box || !Store.editorialMine) return;
      Store.editorialMine().then(function (data) {
        var me = Store.currentUser() || {};
        var ed = data.membership || data.editorial;
        if (ed) {
          box.innerHTML = '<div class="panel__head"><h3>' + esc(ed.name) + '</h3><span class="panel__tag">' +
            (data.editorial && !data.membership ? "вы основатель" : "ваша редакция") + "</span></div>" +
            "<p>" + esc(ed.about || "Редакция проекта.") + "</p>" +
            '<p class="form__note">Регион: ' + esc(regionName(ed.region) || ed.region || "не указан") +
            " · участников: " + esc(String(ed.members || 0)) + "</p>" +
            '<a class="link-accent" href="/region?r=' + esc(ed.region || me.region || "moskva") + '">Страница редакции →</a>';
          return;
        }
        var pending = (data.applications || []).filter(function (a) { return a.status === "pending"; })[0];
        box.innerHTML = "<h3>Вы вне редакции</h3>" +
          (pending ? "<p>Заявка в редакцию на рассмотрении. Решение появится в разделе «Моя редакция» ниже.</p>"
            : "<p>Можно писать индивидуально или подать заявление в редакцию своего региона.</p>") +
          '<a class="link-accent" href="/region?r=' + esc(me.region || "moskva") + '">Выбрать редакцию региона →</a>';
      }, function () {
        box.innerHTML = '<h3>Редакция</h3><p class="form__note is-error">Не удалось загрузить редакцию. Обновите страницу.</p>';
      });
    }

    /* --- заявка на пресс-карту: карта выдаётся не сама, а по заявке --------- */
    function mountCardApplication() {
      var old = $("[data-card-app]");
      if (old) old.remove();
      if (!Store.apiCardStatus) return;

      var section = document.createElement("section");
      section.className = "card-app";
      section.setAttribute("data-card-app", "");
      section.id = "card-application";
      section.innerHTML =
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Пресс-карта</span>' +
        "<h2>Заявка на карту автора</h2>" +
        '<p class="sec-head__text">Карта не выдаётся автоматически: заявление рассматривает редакция. ' +
        "Статус, номер и срок действия приходят с сервера.</p></div></div>" +
        '<div data-card-body><p class="no-data">Проверяем заявку…</p></div>';
      /* заявка живёт в разделе «Пресс-карта», а не в конце страницы */
      var cardHost = $("[data-card-app-host]", host);
      (cardHost || host).appendChild(section);
      var body = $("[data-card-body]", section);

      function load() {
        Promise.all([Store.apiMyPosts(), Store.apiCardStatus()]).then(function (res) {
          var posts = (res[0] || []).filter(function (p) { return p.status === "published"; });
          var status = res[1];
          if (!status || !status.ok) {
            body.innerHTML = '<p class="form__note is-error">' + esc((status && status.error) || "Не удалось загрузить статус карты.") +
              ' <button class="btn btn--sm btn--ghost" type="button" data-card-app-retry>Повторить</button></p>';
            var retry = $("[data-card-app-retry]", body);
            if (retry) retry.addEventListener("click", load);
            return;
          }
          var current = status.current || null;
          var last = (status.requests || [])[0] || current;
          var byRole = !!status.byRole;
          var need = Number(status.minPosts) || 5;

          if (current && (current.status === "issued" || current.status === "pending")) {
            body.innerHTML =
              '<div class="panel"><h3>' + (current.status === "issued" ? "Пресс-карта выдана" : "Заявка отправлена") + "</h3>" +
              (current.status === "issued"
                ? '<p class="presscard__code" style="font-size:1.1rem">' + esc(current.number || "") + "</p>" +
                  "<p>Действует до " + esc(fmtDate(current.validUntil)) + ". Продление и отзыв — решение редакции.</p>"
                : "<p>Материалов в заявке: " + (current.posts || []).length + ". Редакция рассмотрит её, статус появится здесь.</p>") +
              (current.issuePlace ? '<p class="form__note">Выдача: ' + esc(current.issuePlace) + "</p>" : "") +
              (current.dispatch && (current.dispatch.tracking || current.dispatch.sentAt)
                ? '<p class="form__note">Отправлена: ' + esc(fmtDate(current.dispatch.sentAt)) +
                  (current.dispatch.tracking ? " · трек-номер " + esc(current.dispatch.tracking) : "") + "</p>"
                : "") +
              '<p class="form__note">Обновлено: ' + esc(fmtDate(current.decidedAt || current.createdAt)) + "</p></div>";
            return;
          }
          if (!status.canApply) {
            body.innerHTML = '<div class="panel"><p>Новую заявку сейчас подать нельзя. Статус карты: ' +
              esc((current && current.status) || "неизвестно") + ".</p></div>";
            return;
          }

          var head =
            (last && last.status === "rejected"
              ? '<div class="panel" style="margin-bottom:18px"><h3>Заявку вернули</h3><p>' + esc(last.note || "Редакция не указала причину.") + "</p></div>"
              : last && last.status === "expired"
                ? '<div class="panel" style="margin-bottom:18px"><h3>Срок карты истёк</h3><p>Можно подать новую заявку.</p></div>'
                : last && last.status === "revoked"
                  ? '<div class="panel" style="margin-bottom:18px"><h3>Карта отозвана</h3><p>' + esc(last.note || "") + "</p></div>"
                  : "") +
            (byRole
              ? "<p>Вы в команде проекта, поэтому карту можно получить по должности. Опубликовано материалов: <b>" + posts.length + "</b>.</p>"
              : "<p>Опубликовано материалов: <b>" + posts.length + "</b>. Для заявки нужно не меньше " + need + ".</p>");

          if (!byRole && posts.length < need) {
            body.innerHTML = head +
              '<div class="empty"><h3>Нужны опубликованные материалы</h3>' +
              "<p>После проверки редакцией у материала появляется номер, и он войдёт в заявку. Нужно " + need + ", сейчас " + posts.length + ".</p>" +
              '<div class="empty__actions">' +
              (((Store.consent() || {}).status === "approved")
                ? '<a class="btn btn--sm" href="/write">Написать материал</a>'
                : '<span class="btn btn--sm is-locked" aria-disabled="true">Написать материал</span>') +
              "</div></div>";
            return;
          }

          var rows = posts.map(function (p) {
            return '<div class="check-line"><span><b>№ ' + String(p.number || 0).padStart(4, "0") + "</b> · " + esc(p.title) +
              '<small style="display:block;color:var(--muted)">' + esc(regionName(p.region) || "регион не выбран") +
              " · " + esc(fmtDate(p.date)) + "</small></span></div>";
          }).join("");

          body.innerHTML = head +
            '<div class="panel"><div class="stack">' +
            (rows || '<p class="form__note" style="margin:0">Материалов пока нет — заявка уйдёт по должности.</p>') +
            "</div>" +
            '<div class="pcard__section" style="margin-top:18px">' +
            '<span class="kicker">Как получить карту</span>' +
            '<label class="check-line"><input type="radio" name="card-method" value="personal" checked data-card-method>' +
            "<span><b>Лично в Москве</b></span></label>" +
            '<label class="check-line"><input type="radio" name="card-method" value="post" data-card-method>' +
            "<span><b>Почтой России</b></span></label>" +
            '<div class="field"><label for="card-fullname">Фамилия и имя полностью</label>' +
            '<input id="card-fullname" type="text" data-card-fullname autocomplete="name"></div>' +
            '<div class="field"><label for="card-phone">Телефон</label>' +
            '<input id="card-phone" type="tel" data-card-phone autocomplete="tel"></div>' +
            '<div data-card-post-fields hidden>' +
            '<div class="field"><label for="card-index">Индекс</label>' +
            '<input id="card-index" type="text" inputmode="numeric" maxlength="6" data-card-index></div>' +
            '<div class="field"><label for="card-address">Адрес</label>' +
            '<input id="card-address" type="text" data-card-address autocomplete="street-address"></div></div>' +
            '<label class="check-line"><input type="checkbox" data-card-agree>' +
            "<span>Согласен на обработку персональных данных для выдачи и отправки карты.</span></label>" +
            '<div class="row" style="margin-top:6px">' +
            '<button class="btn" type="button" data-card-send>Подать заявку</button>' +
            '<span class="form__note" data-card-note></span></div></div></div>';

          var send = $("[data-card-send]", section);
          var note = $("[data-card-note]", section);
          var postFields = $("[data-card-post-fields]", section);
          var nameEl = $("[data-card-fullname]", section);
          var phoneEl = $("[data-card-phone]", section);
          var indexEl = $("[data-card-index]", section);
          var addressEl = $("[data-card-address]", section);
          var agreeEl = $("[data-card-agree]", section);
          var me = Store.currentUser();
          if (me && nameEl) nameEl.value = me.name || "";

          function methodNow() {
            var picked = $$("[data-card-method]", section).filter(function (el) { return el.checked; })[0];
            return picked ? picked.value : "personal";
          }
          function syncMethod() { if (postFields) postFields.hidden = methodNow() !== "post"; }
          $$("[data-card-method]", section).forEach(function (el) { el.addEventListener("change", syncMethod); });
          syncMethod();

          send.addEventListener("click", function () {
            var method = methodNow();
            var fullName = (nameEl.value || "").trim();
            var phone = (phoneEl.value || "").trim();
            if (fullName.length < 5) { note.textContent = "Напишите фамилию и имя полностью."; return; }
            if (phone.replace(/[^0-9]/g, "").length < 10) { note.textContent = "Нужен телефон для связи."; return; }
            if (!agreeEl.checked) { note.textContent = "Нужно согласие на обработку данных."; return; }
            if (method === "post") {
              if ((indexEl.value || "").replace(/[^0-9]/g, "").length !== 6) { note.textContent = "Индекс — шесть цифр."; return; }
              if ((addressEl.value || "").trim().length < 12) { note.textContent = "Напишите адрес полностью."; return; }
            }
            send.disabled = true;
            note.textContent = "Отправляем…";
            Store.cardApply({
              delivery: method,
              fullName: fullName,
              phone: phone,
              index: method === "post" ? indexEl.value : "",
              address: method === "post" ? addressEl.value : "",
              agree: true,
            }).then(function () {
              note.textContent = "Заявка отправлена. Редакция рассмотрит её и обновит статус.";
              render();
            }, function (err) {
              send.disabled = false;
              note.textContent = (err && err.message) || "Не удалось отправить заявку.";
            });
          });
        }, function () {
          body.innerHTML = '<p class="form__note is-error">Нет связи с сервером. <button class="btn btn--sm btn--ghost" type="button" data-card-app-retry>Повторить</button></p>';
          var retry = $("[data-card-app-retry]", body);
          if (retry) retry.addEventListener("click", load);
        });
      }
      load();
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

  /* Ссылка на печать: номер и код с карты. Код — это возможность проверить
     карту, поэтому в списке участников и в открытых данных его нет. */
  function cardPrintUrl(card) {
    /* Фрагмент (#) не уходит на сервер и не попадает в Referer: код проверки
       знает только браузер владельца и сама страница /verify. */
    return "/verify#n=" + encodeURIComponent(card.number || "") +
      "&c=" + encodeURIComponent(card.verifyCode || "");
  }

  function cardStatusText(st) {
    return {
      issued: "действует", pending: "заявка на проверке", expired: "срок истёк",
      revoked: "отозвана", rejected: "заявка отклонена", none: "не выдана",
    }[st] || st;
  }

  function downloadCardAct(cardId, btn, noteEl) {
    if (!Store.cardActPdf) return;
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Готовим PDF…";
    if (noteEl) noteEl.textContent = "";
    Store.cardActPdf(cardId).then(function (file) {
      var url = URL.createObjectURL(file.blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      btn.disabled = false;
      btn.textContent = label;
      if (noteEl) noteEl.textContent = "Акт сохранён.";
    }, function (err) {
      btn.disabled = false;
      btn.textContent = label;
      if (noteEl) noteEl.textContent = (err && err.message) || "Не удалось скачать акт.";
    });
  }

  function downloadCardPdf(cardId, btn, noteEl) {
    if (!Store.cardPdf) return;
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Готовим PDF…";
    if (noteEl) noteEl.textContent = "";
    Store.cardPdf(cardId).then(function (file) {
      var url = URL.createObjectURL(file.blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      btn.disabled = false;
      btn.textContent = label;
      if (noteEl) noteEl.textContent = "PDF сохранён.";
    }, function (err) {
      btn.disabled = false;
      btn.textContent = label;
      var message = (err && err.message) || "Не удалось скачать PDF карты.";
      if (noteEl) noteEl.textContent = message;
      else window.alert(message);
    });
  }

  /* 6b. Проверка и печать пресс-карты ====================================== */

  function initVerify() {
    var form = $("[data-verify-form]");
    var box = $("[data-verify-result]");
    if (!form || !box || !Store.cardVerify) return;
    var numberEl = $("#verify-number");
    var codeEl = $("#verify-code");
    var statusEl = $("[data-verify-status]");
    var submit = $("[data-verify-submit]");

    var STATUS = {
      issued: { label: "Действует", cls: "ok", text: "Карта действует. Данные ниже совпадают с тем, что напечатано на карте." },
      expired: { label: "Срок истёк", cls: "bad", text: "Срок действия карты закончился. Владелец может подать новую заявку в кабинете." },
      revoked: { label: "Отозвана", cls: "bad", text: "Карта отозвана редакцией и больше не подтверждает сотрудничество с проектом." },
      pending: { label: "Заявка на проверке", cls: "wait", text: "Карта ещё не выдана: заявка ждёт решения редакции." },
      rejected: { label: "Отказано", cls: "bad", text: "По заявке на карту отказано, карта не выдавалась." },
    };

    function face(card, code) {
      return '<div class="pcard-print">' +
        '<div class="pcard-print__side pcard-print__face">' +
        '<div class="pcard-print__brand">Смена контента</div>' +
        '<div class="pcard-print__kind">Пресс-карта автора</div>' +
        '<div class="pcard-print__name">' + esc(card.authorName || "") + "</div>" +
        '<div class="pcard-print__meta">' +
        esc(regionName(card.authorRegion) || card.authorRegion || "") +
        (card.authorRole ? " · " + esc(card.authorRole) : "") + "</div>" +
        '<div class="pcard-print__foot"><span>№ ' + esc(card.number || "") + "</span>" +
        "<span>до " + esc(fmtDate(card.validUntil)) + "</span></div>" +
        "</div>" +
        '<div class="pcard-print__side pcard-print__back">' +
        "<p>Карта подтверждает сотрудничество с проектом «Смена контента». " +
        "Не является удостоверением журналиста зарегистрированного СМИ и не даёт " +
        "права на доступ на закрытые мероприятия.</p>" +
        "<p><b>Проверка:</b> smenakontenta.ru/verify<br>" +
        "<b>Номер:</b> " + esc(card.number || "") + "<br>" +
        "<b>Код:</b> " + esc(code || "") + "</p>" +
        "<p><b>Выдана:</b> " + esc(fmtDate(card.issuedAt)) +
        " · <b>Действует до:</b> " + esc(fmtDate(card.validUntil)) + "</p>" +
        "</div></div>";
    }

    function draw(card, code) {
      var state = STATUS[card.status] || { label: card.status || "неизвестно", cls: "wait", text: "" };
      var head = '<div class="verify-result verify-result--' + esc(state.cls) + ' no-print">' +
        '<div><span class="kicker">Результат проверки</span><h2>' + esc(state.label) + "</h2>" +
        "<p>" + esc(state.text) + "</p></div>" +
        '<div class="verify-result__meta">' +
        "<span><b>Номер</b>" + esc(card.number || "") + "</span>" +
        "<span><b>Имя на карте</b>" + esc(card.authorName || "") + "</span>" +
        "<span><b>Регион</b>" + esc(regionName(card.authorRegion) || card.authorRegion || "—") + "</span>" +
        "<span><b>Действует до</b>" + esc(fmtDate(card.validUntil)) + "</span>" +
        (card.revokedAt ? "<span><b>Отозвана</b>" + esc(fmtDate(card.revokedAt)) + "</span>" : "") +
        "</div></div>";
      var printable = card.status === "issued"
        ? face(card, code) +
          '<div class="verify-actions no-print">' +
          '<button class="btn btn--accent" type="button" data-verify-print>Печать карты</button>' +
          '<p class="form__note">Печатайте в масштабе 100 % на плотной бумаге и вырежьте ' +
          "обе стороны. Если принтер предлагает «по размеру страницы» — отключите это.</p></div>"
        : '<p class="form__note no-print">Печать доступна только для действующей карты.</p>';
      box.hidden = false;
      box.innerHTML = head + printable;
      var printBtn = $("[data-verify-print]", box);
      if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
    }

    function check(number, code) {
      statusEl.textContent = "Проверяем…";
      submit.disabled = true;
      Store.cardVerify(number, code).then(function (res) {
        submit.disabled = false;
        if (!res.found) {
          box.hidden = true;
          box.innerHTML = "";
          statusEl.textContent = res.error || "Карта не найдена.";
          return;
        }
        statusEl.textContent = "Проверено только что.";
        draw(res.card || {}, code);
      }, function (err) {
        submit.disabled = false;
        box.hidden = true;
        box.innerHTML = "";
        statusEl.textContent = (err && err.message) || "Не удалось проверить карту. Попробуйте ещё раз.";
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var number = (numberEl.value || "").trim();
      var code = (codeEl.value || "").trim();
      if (!number || !code) {
        statusEl.textContent = "Нужны и номер, и код с обратной стороны карты.";
        return;
      }
      check(number, code);
    });

    var hash = window.location.hash.replace(/^#/, "");
    var n = "";
    var c = "";
    hash.split("&").forEach(function (part) {
      var kv = part.split("=");
      try {
        if (kv[0] === "n") n = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
        if (kv[0] === "c") c = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
      } catch (e) { /* повреждённый фрагмент не должен ломать страницу */ }
    });
    if (n) numberEl.value = n;
    if (c) codeEl.value = c;
    if (n && c) check(n, c);
  }

  function initWrite() {
    var host = $("[data-write]");
    if (!host) return;
    var user = Store ? Store.currentUser() : null;
    if (!user) {
      window.location.replace("/join?next=write#login");
      return;
    }

    /* Писать можно только с двумя принятыми согласиями: иначе редактор
       открывается, а отправка ломается на сервере. Честнее не открывать. */
    function consentsOk() {
      var p = (Store.consent && (Store.consent() || {}).status) || "none";
      var d = (Store.consent && (Store.consent("distribution") || {}).status) || "none";
      return p === "approved" && d === "approved";
    }

    function buildEditor() {
    if (Store.refreshConsent) Store.refreshConsent().catch(function () {});

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
      '<p class="lead">Пишите так, как рассказали бы другу. Черновики и отправка материалов ' +
      "доступны после принятого согласия на обработку данных.</p></div>" +
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
      '<button class="btn btn--accent btn--block" type="submit" data-action="submit">Отправить на проверку</button>' +
      '<p class="form__note">Материал проверит редакция — обычно в течение дня. ' +
      'Публикация возможна только после принятого согласия на обработку данных.</p>' +
      "</div>" +
      '<div class="write-side__box write-side__box--muted">' +
      "<h3>Перед публикацией</h3><ul class=\"check-list\">" +
      "<li>Проверьте факты и имена</li>" +
      "<li>Спросите героев о согласии</li>" +
      "<li>Укажите автора фотографии</li>" +
      '<li><a href="/assets/docs/pamyatka-avtoru.pdf?v=2026-11-13-9" target="_blank" rel="noopener">Памятка автору (PDF)</a></li>' +
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

      var consentState = Store.consent();
      if (!consentState || consentState.status !== "approved") {
        return setStatus(
          "Черновики, файлы и отправка материалов закрыты, пока комиссия не проверит согласие " +
          "на обработку персональных данных. Скачать форму и загрузить скан можно в личном кабинете.",
          true
        );
      }
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
        var buttons = $$("button[type=submit]", form);
        buttons.forEach(function (b) { b.disabled = true; });
        setStatus("Отправляем материал редакции…");
        Store.submitPost(res.post.id).then(function (sent) {
          buttons.forEach(function (b) { b.disabled = false; });
          if (!sent.ok) return setStatus(sent.error || "Не удалось отправить материал.", true);
          setStatus(sent.message || "Материал отправлен на проверку.");
          setTimeout(function () { window.location.href = "/profile"; }, 600);
        }, function (err) {
          buttons.forEach(function (b) { b.disabled = false; });
          setStatus((err && err.message) || "Не удалось отправить материал.", true);
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

    if (consentsOk()) {
      buildEditor();
      return;
    }
    host.innerHTML =
      '<section class="section wrap"><div class="write-gate fill-note">' +
      "<b>Сначала — два подписанных согласия</b>" +
      "<p>Редактор откроется после принятого согласия на обработку персональных данных " +
      "и согласия на распространение. Без этих документов редакция не может публиковать " +
      "материалы с именем автора: так требует закон о персональных данных.</p>" +
      '<div class="row" style="gap:10px;flex-wrap:wrap">' +
      '<a class="btn btn--accent" href="/profile">Подписать в кабинете</a>' +
      '<a class="btn btn--ghost" href="/docs">Как это работает</a></div>' +
      '<p class="form__note" data-write-gate-note>Проверяем статус согласий…</p></div></section>';
    if (Store.refreshConsent) {
      Store.refreshConsent().then(function () {
        if (consentsOk()) { buildEditor(); return; }
        var note = $("[data-write-gate-note]", host);
        if (note) note.textContent =
          "Согласия пока не приняты: редакция проверяет сканы. Как только оба будут приняты, откройте эту страницу снова.";
      }, function () {
        var note = $("[data-write-gate-note]", host);
        if (note) note.textContent =
          "Не удалось спросить сервер о согласиях. Откройте кабинет — там виден статус документов.";
      });
    }
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
        el.textContent = "Написать в поддержку";
        el.setAttribute("href", "/support");
        el.classList.remove("is-pending");
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

  /* Основатели: текст лежит в data.js, фотографии и город — на сервере.
     Опрашиваем сервер на любой странице, где есть блок основателей,
     и перерисовываем оба варианта карточек. */
  function refreshFounders() {
    var hasBlock = $("[data-founders]") || $("[data-founders-page]");
    if (!hasBlock || !Store || !Store.founders) return;
    Store.founders().then(function (list) {
      if (!list || !list.length) return;
      SC.founders = list;
      initFounders();
      initFoundersPage();
    }, function () {});
  }

  /* Экранная диагностика: если интерфейс упал, человек видит причину и может
     одним нажатием сбросить сохранённые данные сайта — вместо немого «сломано».
     Панель ?debug=1 показывает сборку, наличие входа и ответ сервера. */
  function showErrorBanner(title, detail, opts) {
    opts = opts || {};
    if (document.getElementById("smena-error-banner")) return;
    var bar = document.createElement("div");
    bar.id = "smena-error-banner";
    bar.setAttribute("data-no-i18n", "");
    bar.innerHTML =
      '<div class="errbar__text"><b>' + esc(title) + "</b>" +
      (detail ? '<span class="errbar__detail">' + esc(String(detail).slice(0, 300)) + "</span>" : "") +
      "</div>" +
      '<div class="errbar__actions"></div>';
    var actions = bar.querySelector(".errbar__actions");
    function addButton(label, fn, accent) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn--sm" + (accent ? " btn--accent" : " btn--ghost");
      b.textContent = label;
      b.addEventListener("click", fn);
      actions.appendChild(b);
    }
    if (opts.href) {
      var link = document.createElement("a");
      link.className = "btn btn--sm btn--accent";
      link.href = opts.href;
      link.textContent = opts.hrefLabel || "Продолжить";
      actions.appendChild(link);
    }
    addButton("Сбросить сохранённые данные сайта", function () {
      try {
        var stale = [];
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf("smena_") === 0) stale.push(k);
        }
        stale.forEach(function (k) { window.localStorage.removeItem(k); });
      } catch (e) {}
      window.location.reload();
    });
    addButton("Перезагрузить", function () { window.location.reload(); });
    addButton("Скрыть", function () { bar.remove(); });
    document.body.appendChild(bar);
  }

  function showSessionBanner() {
    if (document.getElementById("smena-error-banner")) return;
    showErrorBanner(
      "Ваш вход устарел — нужен повторный вход",
      "Аккаунт цел, но сервер просит войти заново: так устроена защита. " +
        "Нажмите «Войти заново» и введите почту с паролем — данные на месте.",
      { href: "/join#login", hrefLabel: "Войти заново" }
    );
  }

  function initDebugPanel() {
    if (!/[?&]debug=1/.test(window.location.search)) return;
    var panel = document.createElement("div");
    panel.id = "smena-debug";
    panel.setAttribute("data-no-i18n", "");
    panel.innerHTML = '<b>Диагностика · сборка ' + esc((SC && SC.build) || "?") + "</b>" +
      '<div data-debug-lines>собираем…</div>';
    document.body.appendChild(panel);
    var lines = panel.querySelector("[data-debug-lines]");
    var token = Store && Store.hasToken && Store.hasToken() ? "есть" : "нет";
    var cached = Store && Store.currentUser ? Store.currentUser() : null;
    var html = "<div>токен: " + esc(token) + "</div>" +
      "<div>кэш пользователя: " +
      (cached ? esc(cached.name || "?") + " · " + esc(cached.access || "Пользователь") : "нет") + "</div>";
    lines.innerHTML = html;
    if (token === "есть") {
      var t = "";
      try { t = window.localStorage.getItem("smena_token_v1") || ""; } catch (e) {}
      window.fetch("/api/index.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "me", token: t }),
      }).then(function (r) { return r.json(); }).then(function (res) {
        var div = document.createElement("div");
        div.textContent = "сервер (me): " + (res && res.ok
          ? "ok, " + ((res.user && res.user.access) || "")
          : "код " + ((res && res.code) || "?") + " · " + ((res && res.error) || ""));
        lines.appendChild(div);
      }, function () {
        var div = document.createElement("div");
        div.textContent = "сервер (me): нет связи";
        lines.appendChild(div);
      });
    }
  }

  function boot() {
    initTheme();
    initAccent();
    initOnboard();
    initAnchorNav();
    initFounders();
    initPartners();
    mountHeader();
    mountFooter();
    mountSearch();
    initPageBits();
    applySiteState();

    /* Каждая страница изолирована: сбой одной не глушит остальные,
       а причина остаётся на экране — её можно прислать в поддержку. */
    function safePage(name, fn) {
      try {
        fn();
      } catch (e) {
        showErrorBanner("Страница «" + name + "» не открылась: сбой интерфейса",
          (e && e.message) || String(e));
        if (window.console && console.error) console.error(e);
      }
    }

    var page = document.body.getAttribute("data-page");
    if (page === "home") safePage("Главная", initHome);
    if (page === "news") safePage("Лента", initNews);
    if (page === "article") safePage("Материал", initArticle);
    if (page === "region") safePage("Регион", initRegion);
    if (page === "auth") safePage("Регистрация", initAuth);
    if (page === "profile") safePage("Кабинет", initProfile);
    if (page === "write") safePage("Редактор", initWrite);
    if (page === "docs") safePage("Документы", initDocs);
    if (page === "school") safePage("Медиашкола", initSchool);
    if (page === "school-hub") safePage("Медиашкола: кабинет", initSchoolHub);
    if (page === "admin") safePage("Панель", initAdmin);
    if (page === "founders") {
      /* карточки показываем сразу из данных проекта, а после ответа сервера
         дополняем их фотографиями и городом: иначе при медленном сервере
         блок пустой, пока не придёт ответ */
      safePage("Основатели", initFoundersPage);
    }
    if (page === "support") safePage("Поддержка", initSupport);
    if (page === "verify") safePage("Проверка карты", initVerify);

    initDebugPanel();
    refreshFounders();
    initAnimations();
    initHeroParallax();
  }

  /* страницы ждут короткой проверки сервера: так материалы, одобренные
     редакцией, появляются в ленте сразу при загрузке страницы */
  window.addEventListener("smena:unauthorized", function () {
    showSessionBanner();
  });
  window.addEventListener("error", function (e) {
    if (e && e.message && !/Script error/i.test(e.message)) {
      showErrorBanner("Сбой интерфейса", e.message);
    }
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var msg = r && (r.message || r.error) ? String(r.message || r.error) : "";
    if (msg && !/Сервер недоступен|Нет связи/.test(msg)) {
      showErrorBanner("Сбой интерфейса", msg);
    }
  });

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
