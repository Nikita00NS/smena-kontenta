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
    return "article.html?id=" + encodeURIComponent(id);
  }

  function regionUrl(slug) {
    return "region.html?r=" + encodeURIComponent(slug);
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
  };

  var LOGO =
    '<svg class="logo__mark" viewBox="0 0 32 32" aria-hidden="true">' +
    '<rect x="0" y="0" width="32" height="32" fill="#14130f"/>' +
    '<rect x="5" y="7" width="22" height="4" fill="#ff3d14"/>' +
    '<rect x="9" y="14" width="18" height="4" fill="#f7f5ef"/>' +
    '<rect x="5" y="21" width="13" height="4" fill="#f7f5ef"/>' +
    "</svg>";

  /* 2. Шапка и подвал ====================================================== */

  var NAV = [
    { href: "news.html", label: "Материалы", key: "news" },
    { href: "index.html#map", label: "Регионы", key: "region" },
    { href: "media-school.html", label: "Медиашкола", key: "school" },
    { href: "docs.html", label: "Документы", key: "docs" },
    { href: "about.html", label: "О проекте", key: "about" },
    { href: "partners.html", label: "Партнёрам", key: "partners" },
  ];

  function brandLine() {
    return '<span class="logo__name">Смена</span><span class="logo__sub">контента</span>';
  }

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
      ? '<a class="user-chip" href="profile.html" aria-label="Личный кабинет">' +
        '<span class="user-chip__ava">' + esc(Store.initials(user.name)) + "</span>" +
        '<span class="user-chip__name">' + esc(user.name.split(" ")[0]) + "</span></a>"
      : '<a class="btn btn--sm btn--ghost login-link" href="join.html#login">Войти</a>' +
        '<a class="btn btn--sm" href="join.html">Регистрация</a>';

    host.className = "site-header";
    host.innerHTML =
      '<div class="topbar"><div class="wrap topbar__in">' +
      '<div class="topbar__left">' +
      '<span class="badge-live">Медиа в разработке</span>' +
      "<span>" + dateLine + "</span>" +
      "</div>" +
      '<div class="topbar__right">' +
      '<a href="write.html">Опубликовать материал</a>' +
      '<a href="docs.html">Документы</a>' +
      '<a href="https://t.me/' + String(SC.brand.telegram).replace(/^@/, "") +
      '" target="_blank" rel="noopener">Telegram</a>' +
      "</div></div></div>" +
      '<div class="wrap"><div class="masthead">' +
      '<a class="logo" href="index.html" aria-label="Смена контента — на главную">' +
      LOGO + '<span class="logo__type">' + brandLine() + "</span></a>" +
      '<nav class="nav" aria-label="Основная навигация">' + navHtml + "</nav>" +
      '<div class="header-actions">' +
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
      '<a class="logo" href="index.html">' + LOGO + '<span class="logo__type">' +
      brandLine() + "</span></a>" +
      '<button class="icon-btn" type="button" data-menu-close aria-label="Закрыть меню">' +
      ICONS.close + "</button></div>" +
      NAV.map(function (n, i) {
        return (
          '<a class="mobile-menu__link" href="' + n.href + '">' + n.label +
          "<span>0" + (i + 1) + "</span></a>"
        );
      }).join("") +
      (user
        ? '<a class="mobile-menu__link" href="profile.html">Личный кабинет<span>' +
          esc(Store.initials(user.name)) + "</span></a>"
        : '<a class="mobile-menu__link" href="join.html">Регистрация<span>+</span></a>') +
      '<div class="mobile-menu__foot">' +
      '<a class="btn btn--block" href="write.html">Опубликовать материал</a>' +
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
      '<div class="logo__name">Смена контента</div>' +
      "<p>" + esc(SC.brand.tagline) + ". Медиа, медиашкола и сообщество авторов из регионов России.</p>" +
      '<p class="footer-status"><span class="dot"></span>Проект готовится к запуску: собираем команду и первые материалы.</p>' +
      "</div>" +
      '<div class="footer-col"><h3>Редакция</h3><ul>' +
      '<li><a href="news.html">Все материалы</a></li>' +
      '<li><a href="index.html#map">Регионы</a></li>' +
      '<li><a href="write.html">Опубликовать материал</a></li>' +
      '<li><a href="media-school.html">Медиашкола</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h3>Проект</h3><ul>' +
      '<li><a href="about.html">О проекте</a></li>' +
      '<li><a href="docs.html">Документы и пресс-кит</a></li>' +
      '<li><a href="partners.html">Партнёрам</a></li>' +
      '<li><a href="about.html#roadmap">План развития</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h3>' + (user ? "Аккаунт" : "Участие") + "</h3><ul>" +
      (user
        ? '<li><a href="profile.html">Личный кабинет</a></li>' +
          '<li><a href="write.html">Новый материал</a></li>' +
          '<li><a href="docs.html">Памятка автору</a></li>'
        : '<li><a href="join.html">Регистрация</a></li>' +
          '<li><a href="join.html#login">Вход</a></li>' +
          '<li><a href="docs.html">Памятка автору</a></li>') +
      '<li><a href="mailto:' + esc(SC.brand.email) + '">' + esc(SC.brand.email) + "</a></li>" +
      "</ul></div></div>" +
      '<div class="footer-bottom">' +
      '<span>© ' + (SC.brand.year || new Date().getFullYear()) + " «Смена контента»</span>" +
      '<span class="footer-note">Медиа о молодёжи и регионах. Сайт работает на статических файлах — без серверов и подписок.</span>' +
      '<span><a href="docs.html">Документы</a> · <a href="partners.html">Партнёрам</a></span>' +
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
            : h.article.topic + " · " + (regionName(h.article.region) || "Регион");
          return (
            '<a class="search-hit' + (i === activeIndex ? " is-active" : "") +
            '" href="' + h.url + '"><div><div class="search-hit__t">' + esc(h.title) +
            '</div><div class="search-hit__s">' + esc(sub) + "</div></div></a>"
          );
        })
        .join("");
    }

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
          window.location.href = "news.html?q=" + encodeURIComponent(input.value.trim());
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
      "<div><b data-count=\"" + totalRegions + "\">0</b><span>регионов на карте</span></div>" +
      "<div><b data-count=\"" + regionsWithContent + "\">0</b><span>уже с материалами</span></div>" +
      "<div><b data-count=\"" + totalArticles + "\">0</b><span>публикаций</span></div>" +
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
    var start = performance.now();
    var dur = 900;
    function step(now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
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

  /* 7. Главная ============================================================= */

  function pressCardBlock() {
    var all = allArticles();
    var stats = [
      { n: MAP.regions.length, l: "регионов на карте" },
      { n: (SC.formats || []).length - 1, l: "форматов материалов" },
      { n: 5, l: "документов проекта" },
      { n: all.length, l: "публикаций" },
    ];
    return (
      '<section class="section--tight wrap presscard-wrap">' +
      '<div class="presscard" data-reveal>' +
      '<div class="presscard__main">' +
      '<div class="presscard__top">' +
      '<span class="presscard__label">Пресс-карта проекта</span>' +
      '<span class="presscard__code">СК-2026-000</span>' +
      "</div>" +
      '<div class="presscard__name">Смена контента</div>' +
      '<div class="presscard__desc">Молодёжное медиа · Медиашкола · Сообщество авторов. ' +
      "Рассказываем истории из регионов России и учим их делать.</div>" +
      '<div class="presscard__row">' +
      '<span><b>Основан</b>2026</span>' +
      '<span><b>Регион запуска</b>выбирается</span>' +
      '<span><b>Статус</b>набор команды</span>' +
      '<span><b>Формат</b>онлайн-медиа</span>' +
      "</div>" +
      "</div>" +
      '<div class="presscard__side">' +
      '<div class="presscard__stats">' +
      stats.map(function (s) {
        return '<div><b data-count="' + s.n + '">0</b><span>' + s.l + "</span></div>";
      }).join("") +
      "</div>" +
      '<div class="presscard__actions">' +
      '<a class="btn btn--sm" href="assets/docs/press-kit.pdf" target="_blank" rel="noopener">Пресс-кит (PDF)</a>' +
      '<a class="btn btn--sm btn--ghost" href="docs.html">Документы</a>' +
      "</div>" +
      '<div class="presscard__stamp" aria-hidden="true">смена<br>контента<br><span>2026</span></div>' +
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
        '<a href="join.html">Зарегистрироваться</a></div>' +
        "</aside></div></div>";
    }

    var ticker = $("[data-ticker]");
    if (ticker) {
      var items = all.slice(0, 8).map(function (a) {
        return '<a class="ticker__item" href="' + articleUrl(a.id) + '"><time>' +
          fmtTime(a.date) + "</time>" + esc(a.title) + "</a>";
      }).join("");
      ticker.innerHTML =
        '<div class="ticker__inner">' +
        '<div class="ticker__label"><span>Лента</span></div>' +
        '<div class="ticker__viewport"><div class="ticker__track">' +
        items + items + "</div></div></div>";
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
        return '<a class="format" href="news.html?format=' + encodeURIComponent(f.name) + '">' +
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
      authorsHost.innerHTML = (SC.authors || [])
        .slice(0, 8)
        .map(function (a, i) {
          return '<div class="author-card" data-reveal data-delay="' + (i % 4) + '">' +
            '<span class="author-card__ava">' + esc(a.initials) + "</span>" +
            '<div><div class="author-card__name">' + esc(a.name) + "</div>" +
            '<div class="author-card__role">' + esc(a.role) + "</div></div></div>";
        })
        .join("");
    }

    // возможности
    var oppHost = $("[data-opportunities]");
    if (oppHost) {
      var opp = all.filter(function (a) { return a.topic === "Возможности"; }).slice(0, 3);
      var fallback = all.slice(0, 3);
      oppHost.innerHTML = (opp.length ? opp : fallback)
        .map(function (a) { return card(a); })
        .join("");
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
        : '<div class="empty"><h3>Ничего не нашлось</h3>' +
          "<p>Попробуйте убрать фильтры или поискать по другому слову. " +
          "А если вы знаете историю, которой ещё нет на сайте, — опубликуйте её сами.</p>" +
          '<div class="empty__actions"><a class="btn btn--sm" href="news.html">Сбросить фильтры</a>' +
          '<a class="btn btn--sm btn--ghost" href="write.html">Написать материал</a></div></div>';

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
        '<div class="empty__actions"><a class="btn" href="news.html">К ленте материалов</a></div>' +
        "</div></div>";
      return;
    }

    var au = authorOf(a);
    var bodyHtml = (a.body || []).map(function (p) {
      if (p.indexOf("> ") === 0) return "<blockquote>" + esc(p.slice(2)) + "</blockquote>";
      if (p.indexOf("## ") === 0) return "<h2>" + esc(p.slice(3)) + "</h2>";
      return "<p>" + esc(p) + "</p>";
    }).join("");

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
      '<a href="news.html">Материалы</a><span>/</span>' +
      '<a href="' + regionUrl(a.region) + '">' + esc(regionName(a.region)) + "</a>" +
      "<span>/</span><span>" + esc(a.format) + "</span></div>" +
      '<span class="kicker">' + esc(a.topic) + " · " + esc(a.format) +
      (a.isUserPost ? ' · <span class="kicker-flag">автор проекта</span>' : "") + "</span>" +
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
        ? '<a class="btn btn--sm btn--ghost" href="write.html?id=' + encodeURIComponent(id.slice(2)) +
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
      '<a class="tag" href="news.html?topic=' + encodeURIComponent(a.topic) + '">' + esc(a.topic) + "</a>" +
      '<a class="tag" href="news.html?format=' + encodeURIComponent(a.format) + '">' + esc(a.format) + "</a>" +
      '<a class="tag" href="news.html?region=' + encodeURIComponent(a.region) + '">' +
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
      '<a class="tag" href="https://t.me/share/url?url=' + encodeURIComponent(window.location.href) +
      "&text=" + encodeURIComponent(a.title) + '" target="_blank" rel="noopener">Telegram</a>' +
      "</div></div>" +
      '<div class="aside-box"><h3>Свежие материалы</h3><ul>' +
      latest.map(function (x) {
        return '<li><a href="' + articleUrl(x.id) + '">' + esc(x.title) + "</a></li>";
      }).join("") +
      "</ul></div>" +
      '<div class="aside-box"><h3>Написать своё</h3>' +
      '<p style="font-size:.88rem;color:var(--ink-soft);margin-bottom:12px">Любой ' +
      "зарегистрированный автор может опубликовать материал на сайте.</p>" +
      '<a class="btn btn--sm btn--accent btn--block" href="write.html">Опубликовать материал</a>' +
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
        '<div class="empty__actions"><a class="btn" href="index.html#map">К карте регионов</a></div>' +
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
      '<a href="index.html">Главная</a><span>/</span>' +
      '<a href="index.html#map">Регионы</a><span>/</span><span>' + esc(r.district || "") + "</span></div>" +
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
      '<a class="btn btn--paper btn--sm" href="write.html">Опубликовать материал</a>' +
      '<a class="btn btn--outline-paper btn--sm" href="index.html#map">Другая карта</a></div>' +
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
          '<a class="btn btn--accent" href="write.html">Опубликовать материал</a>' +
          '<a class="btn btn--ghost" href="join.html">Создать аккаунт</a>' +
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
      '<a class="btn btn--sm btn--block" href="join.html">Зарегистрироваться</a></div>' +
      '<div class="aside-box"><h3>Документы</h3><ul>' +
      '<li><a href="assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору (PDF)</a></li>' +
      '<li><a href="assets/docs/polozhenie-o-redakcii.pdf" target="_blank" rel="noopener">Положение о редакции (PDF)</a></li>' +
      '<li><a href="docs.html">Все документы</a></li>' +
      "</ul></div>" +
      '<div class="aside-box"><h3>На карте</h3>' +
      '<a class="btn btn--sm btn--ghost btn--block" href="index.html#map">Открыть всю карту</a></div>' +
      "</aside></div></div>";
  }

  /* 11. Регистрация и вход ================================================= */

  function initAuth() {
    var box = $("[data-auth]");
    if (!box) return;
    var user = Store ? Store.currentUser() : null;
    var next = param("next") === "write" ? "write.html" : "profile.html";
    if (user) {
      window.location.replace(next);
      return;
    }

    var regionSelect = $("[data-auth-region]", box);
    if (regionSelect) {
      regionSelect.innerHTML = '<option value="">Выберите регион</option>' + regionOptions("");
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
        window.location.href = next === "write.html" ? next : "profile.html?new=1";
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

  function initProfile() {
    var host = $("[data-profile]");
    if (!host) return;
    var user = Store ? Store.currentUser() : null;
    if (!user) {
      window.location.replace("join.html?next=write#login");
      return;
    }

    var savedNote = "";

    function render() {
      var user = Store.currentUser();
      var card = Store.pressCard();
      var published = Store.listPosts({ authorId: user.id, status: "published" });
      var drafts = Store.listPosts({ authorId: user.id, status: "draft" });
      document.title = user.name + " — личный кабинет";

      var postRow = function (p) {
        var isDraft = p.status === "draft";
        return (
          '<div class="post-row">' +
          '<div class="post-row__main">' +
          '<div class="post-row__meta"><span class="status ' + (isDraft ? "status--draft" : "status--pub") +
          '">' + (isDraft ? "черновик" : "опубликовано") + "</span><span>" +
          fmtDate(p.updatedAt || p.date) + "</span><span>" + esc(p.format) + " · " +
          esc(regionName(p.region)) + "</span></div>" +
          '<div class="post-row__title">' + esc(p.title) + "</div>" +
          "</div>" +
          '<div class="post-row__actions">' +
          (isDraft
            ? '<button class="btn btn--sm btn--accent" type="button" data-publish="' + p.id + '">Опубликовать</button>'
            : '<a class="btn btn--sm btn--ghost" href="article.html?id=' +
              encodeURIComponent("u:" + p.id) + '">Открыть</a>') +
          '<a class="btn btn--sm btn--ghost" href="write.html?id=' + p.id + '">Изменить</a>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-delete="' + p.id + '">Удалить</button>' +
          "</div></div>"
        );
      };

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
        '<a class="btn btn--accent" href="write.html">Написать материал</a>' +
        '<button class="btn btn--ghost" type="button" data-logout>Выйти</button>' +
        "</div></div></div></section>" +

        '<section class="section wrap">' +
        (param("new")
          ? '<div class="welcome"><b>Аккаунт создан.</b> Ваша пресс-карта ниже. ' +
            "Можно сразу писать первый материал — черновик сохраняется автоматически.</div>"
          : "") +
        '<div class="profile-grid">' +

        // пресс-карта
        '<div class="presscard presscard--personal" data-reveal>' +
        '<div class="presscard__main">' +
        '<div class="presscard__top"><span class="presscard__label">Пресс-карта автора</span>' +
        '<span class="presscard__code">' + esc(card.number) + "</span></div>" +
        '<div class="presscard__name">' + esc(card.name) + "</div>" +
        '<div class="presscard__desc">' + esc(card.role) + " · " + esc(card.region) + "</div>" +
        '<div class="presscard__row">' +
        "<span><b>Выдана</b>" + fmtDate(card.since) + "</span>" +
        "<span><b>Публикаций</b>" + card.posts + "</span>" +
        "<span><b>Статус</b>" + (card.posts ? "действующий автор" : "автор проекта") + "</span>" +
        "</div></div>" +
        '<div class="presscard__side">' +
        '<div class="presscard__stamp">смена<br>контента<br><span>2026</span></div>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-print>Печать</button>' +
        "</div></div>" +

        // статистика
        '<div class="profile-side">' +
        '<div class="kpi kpi--stack">' +
        '<div class="kpi__item"><b>' + published.length + "</b><span>публикаций</span></div>" +
        '<div class="kpi__item"><b>' + drafts.length + "</b><span>черновиков</span></div>" +
        '<div class="kpi__item"><b>' + (user.region ? esc(regionName(user.region).split(" ")[0]) : "—") +
        "</b><span>ваш регион</span></div>" +
        "</div>" +
        '<div class="panel"><h3>Как это работает</h3>' +
        '<p>Материал, который вы публикуете, сразу появляется в ленте сайта и на странице ' +
        "своего региона. Черновики видите только вы.</p></div>" +
        "</div></div>" +

        // материалы
        '<div class="profile-posts" style="margin-top:44px">' +
        '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Мои материалы</span>' +
        "<h2>Публикации и черновики</h2></div>" +
        '<a class="sec-link" href="write.html">Новый материал <span aria-hidden="true">→</span></a></div>' +
        (published.length || drafts.length
          ? drafts.map(postRow).join("") + published.map(postRow).join("")
          : '<div class="empty"><h3>Пока ничего не опубликовано</h3>' +
            "<p>Начните с простого: история из вашего двора, района или вуза. " +
            "Памятка автору подскажет, с чего начать.</p>" +
            '<div class="empty__actions"><a class="btn btn--accent" href="write.html">Написать материал</a>' +
            '<a class="btn btn--ghost" href="assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору</a></div></div>') +
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
        '<div class="storage-note">Аккаунт и материалы хранятся в этом браузере. ' +
        "Чтобы авторы видели работы друг друга с разных устройств, понадобится бесплатный " +
        "сервер (например, Supabase) — это следующий шаг проекта.</div>" +
        "</div>" +
        "</section>";

      initAnimations();

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
          window.location.href = "index.html";
        });
      });

      $$("[data-publish]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          var res = Store.publishPost(b.getAttribute("data-publish"));
          if (res.ok) window.location.href = "article.html?id=" + encodeURIComponent("u:" + res.post.id);
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

    render();
  }

  /* 13. Редактор материала ================================================= */

  function initWrite() {
    var host = $("[data-write]");
    if (!host) return;
    var user = Store ? Store.currentUser() : null;
    if (!user) {
      window.location.replace("join.html?next=write#login");
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
      '<a class="btn btn--sm btn--ghost" href="profile.html">← В кабинет</a>' +
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
      '<textarea id="w-body" name="body" rows="16" placeholder="Абзацы разделяйте пустой строкой. Цитату начните со знака «>». Подзаголовок — с «##».">' +
      esc(existing ? existing.body.join("\n\n") : "") + "</textarea>" +
      '<p class="field__hint">Абзацы — через пустую строку. «&gt;» в начале абзаца станет цитатой, «##» — подзаголовком.</p></div>' +
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
      '<button class="btn btn--accent btn--block" type="submit" data-action="publish">Опубликовать</button>' +
      '<p class="form__note">Публикация сразу появится в ленте сайта с вашим именем.</p>' +
      "</div>" +
      '<div class="write-side__box write-side__box--muted">' +
      "<h3>Перед публикацией</h3><ul class=\"check-list\">" +
      "<li>Проверьте факты и имена</li>" +
      "<li>Спросите героев о согласии</li>" +
      "<li>Укажите автора фотографии</li>" +
      '<li><a href="assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору (PDF)</a></li>' +
      "</ul></div>" +
      "</div></form></section>";

    var form = $("[data-write-form]", host);
    var statusEl = $("[data-write-status]", host);
    var preview = $("[data-cover-preview]", host);
    var fileInput = $("[data-cover-file]", host);
    var urlInput = $("[data-cover-url]", host);
    var action = "draft";

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

      if (action === "publish") {
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
          status: action === "publish" ? "published" : "draft",
        },
        existing ? existing.id : null
      );

      if (!res.ok) return setStatus(res.error || "Не удалось сохранить.", true);

      if (action === "publish") {
        window.location.href = "article.html?id=" + encodeURIComponent("u:" + res.post.id);
      } else {
        setStatus("Черновик сохранён");
        if (!existing) {
          existing = res.post;
          window.history.replaceState({}, "", "write.html?id=" + res.post.id);
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

  function initPageBits() {
    $$("[data-brand-name]").forEach(function (el) { el.textContent = SC.brand.name; });
    $$("[data-brand-email]").forEach(function (el) {
      el.textContent = SC.brand.email;
      el.setAttribute("href", "mailto:" + SC.brand.email);
    });
    $$("[data-brand-telegram]").forEach(function (el) {
      el.textContent = SC.brand.telegram;
      el.setAttribute("href", "https://t.me/" + String(SC.brand.telegram).replace(/^@/, ""));
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
      $$('a[href="write.html"]').forEach(function (a) {
        if (!a.hasAttribute("data-keep")) {
          a.setAttribute("href", "join.html?next=write");
        }
      });
    }
  }

  function boot() {
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

    initAnimations();
    initHeroParallax();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
