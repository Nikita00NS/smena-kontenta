/* ============================================================================
   СМЕНА КОНТЕНТА — логика сайта
   ----------------------------------------------------------------------------
   Файл небольшой и без сборки: подключён на каждой странице и сам решает,
   что отрисовать, глядя на атрибут <body data-page="...">.

   Блоки:
     1. Утилиты
     2. Шапка и подвал (вставляются на каждую страницу)
     3. Поиск по сайту
     4. Карточки материалов
     5. Карта регионов
     6. Главная
     7. Материалы (лента с фильтрами)
     8. Страница материала
     9. Страница региона
    10. Вспомогательные страницы
   ========================================================================== */

(function () {
  "use strict";

  var SC = window.SC || { articles: [], authors: [], topics: [], formats: [] };
  var MAP = window.RU_MAP || { regions: [], viewBox: "0 0 1000 540" };

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

  function toDate(iso) {
    return new Date(iso);
  }

  function fmtDate(iso) {
    var d = toDate(iso);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function fmtTime(iso) {
    var d = toDate(iso);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function fmtWhen(iso) {
    var d = toDate(iso);
    var now = new Date();
    var day = 24 * 60 * 60 * 1000;
    var diff = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
      new Date(d.getFullYear(), d.getMonth(), d.getDate())) / day);
    if (diff === 0) return "сегодня, " + fmtTime(iso);
    if (diff === 1) return "вчера, " + fmtTime(iso);
    return fmtDate(iso);
  }

  function thumb(src) {
    if (!src) return "";
    return src.replace("/img/", "/img/thumb/");
  }

  function author(id) {
    var list = SC.authors || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { name: "Редакция", role: "", initials: "СК" };
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

  function articlesByRegion(slug) {
    return sortedArticles().filter(function (a) {
      return a.region === slug;
    });
  }

  function countByRegion(slug) {
    return (SC.articles || []).filter(function (a) {
      return a.region === slug;
    }).length;
  }

  function sortedArticles() {
    return (SC.articles || []).slice().sort(function (a, b) {
      return toDate(b.date) - toDate(a.date);
    });
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
    { href: "index.html#map", label: "Регионы", key: "map" },
    { href: "media-school.html", label: "Медиашкола", key: "school" },
    { href: "about.html", label: "О проекте", key: "about" },
    { href: "partners.html", label: "Партнёрам", key: "partners" },
  ];

  function brandLine() {
    return (
      '<span class="logo__name">Смена</span>' +
      '<span class="logo__sub">контента</span>'
    );
  }

  function mountHeader() {
    var host = $("[data-header]");
    if (!host) return;
    var active = document.body.getAttribute("data-page") || "";
    var today = new Date();
    var dateLine =
      today.getDate() + " " + MONTHS[today.getMonth()] + " " + today.getFullYear();

    var navHtml = NAV.map(function (n) {
      var isActive =
        (n.key === "school" && active === "school") ||
        (n.key === "about" && active === "about") ||
        (n.key === "partners" && active === "partners") ||
        (n.key === "news" && active === "news") ||
        (n.key === "map" && active === "region");
      return (
        '<a class="nav__link" href="' + n.href + '"' +
        (isActive ? ' aria-current="page"' : "") + ">" + n.label + "</a>"
      );
    }).join("");

    host.className = "site-header";
    host.innerHTML =
      '<div class="topbar"><div class="wrap topbar__in">' +
      '<div class="topbar__left">' +
      '<span class="badge-demo">Прототип · демо-материалы</span>' +
      "<span>" + dateLine + "</span>" +
      "</div>" +
      '<div class="topbar__right">' +
      '<a href="join.html">Стать автором</a>' +
      '<a href="partners.html">Партнёрам</a>' +
      '<a href="https://t.me/' + String(SC.brand.telegram).replace(/^@/, "") + '" target="_blank" rel="noopener">' +
      "Telegram</a>" +
      "</div></div></div>" +
      '<div class="wrap"><div class="masthead">' +
      '<a class="logo" href="index.html" aria-label="Смена контента — на главную">' +
      LOGO + '<span class="logo__type">' + brandLine() + "</span></a>" +
      '<nav class="nav" aria-label="Основная навигация">' + navHtml + "</nav>" +
      '<div class="header-actions">' +
      '<button class="icon-btn" type="button" data-search-open aria-label="Поиск по сайту">' +
      ICONS.search + "</button>" +
      '<a class="btn btn--sm" href="join.html">Присоединиться</a>' +
      '<button class="icon-btn burger" type="button" data-menu-open aria-label="Открыть меню">' +
      ICONS.menu + "</button>" +
      "</div></div></div>";

    // мобильное меню
    var menu = document.createElement("div");
    menu.className = "mobile-menu";
    menu.setAttribute("data-menu", "");
    menu.innerHTML =
      '<div class="mobile-menu__head">' +
      '<a class="logo" href="index.html">' + LOGO +
      '<span class="logo__type">' + brandLine() + "</span></a>" +
      '<button class="icon-btn" type="button" data-menu-close aria-label="Закрыть меню">' +
      ICONS.close + "</button></div>" +
      '<a class="mobile-menu__link" href="news.html">Материалы<span>01</span></a>' +
      '<a class="mobile-menu__link" href="index.html#map">Регионы<span>02</span></a>' +
      '<a class="mobile-menu__link" href="media-school.html">Медиашкола<span>03</span></a>' +
      '<a class="mobile-menu__link" href="about.html">О проекте<span>04</span></a>' +
      '<a class="mobile-menu__link" href="partners.html">Партнёрам<span>05</span></a>' +
      '<a class="mobile-menu__link" href="join.html">Присоединиться<span>06</span></a>' +
      '<div class="mobile-menu__foot">' +
      '<button class="btn btn--block" type="button" data-search-open>Поиск по сайту</button>' +
      '<p class="mono" style="color:var(--muted);margin:0">' +
      esc(SC.brand.email) + "</p></div>";
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
    host.className = "site-footer";
    host.innerHTML =
      '<div class="wrap">' +
      '<div class="footer-top">' +
      '<div class="footer-brand">' +
      '<div class="logo__name">Смена контента</div>' +
      "<p>" + esc(SC.brand.tagline) + ". Проект на стадии запуска: собираем команду, " +
      "делаем сайт и готовим первые материалы.</p>" +
      "</div>" +
      '<div class="footer-col"><h3>Редакция</h3><ul>' +
      '<li><a href="news.html">Все материалы</a></li>' +
      '<li><a href="index.html#map">Регионы</a></li>' +
      '<li><a href="media-school.html">Медиашкола</a></li>' +
      '<li><a href="join.html">Стать автором</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h3>Проект</h3><ul>' +
      '<li><a href="about.html">О проекте</a></li>' +
      '<li><a href="partners.html">Партнёрам</a></li>' +
      '<li><a href="about.html#team">Команда и роли</a></li>' +
      '<li><a href="about.html#roadmap">План развития</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h3>Связь</h3><ul>' +
      '<li><a href="mailto:' + esc(SC.brand.email) + '">' + esc(SC.brand.email) + "</a></li>" +
      '<li><a href="https://t.me/' + esc(String(SC.brand.telegram).replace(/^@/, "")) +
      '" target="_blank" rel="noopener">Telegram</a></li>' +
      '<li><a href="join.html">Предложить материал</a></li>' +
      "</ul></div></div>" +
      '<div class="footer-bottom">' +
      '<span>© ' + (SC.brand.year || new Date().getFullYear()) + " «Смена контента»</span>" +
      '<span class="footer-note">Демонстрационная версия сайта: материалы, имена и фотографии ' +
      "являются примерами и не описывают реальные события.</span>" +
      '<span><a href="about.html">О проекте</a> · <a href="partners.html">Партнёрам</a></span>' +
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
            ? (h.region.district || "Регион") + " · " + h.count + " мат."
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
      if (q.length < 2) {
        hits = sortedArticles()
          .slice(0, 5)
          .map(function (a) {
            return { kind: "article", article: a, title: a.title, url: articleUrl(a.id) };
          });
        activeIndex = -1;
        renderItems();
        return;
      }
      var found = [];
      sortedArticles().forEach(function (a) {
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
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
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

  function metaLine(a) {
    return (
      '<div class="meta"><span>' + esc(regionName(a.region) || "Россия") + "</span>" +
      '<span class="meta__dot"></span><span>' + fmtDate(a.date) + "</span>" +
      '<span class="meta__dot"></span><span>' + (a.read || 4) + " мин</span></div>"
    );
  }

  function card(a, variant) {
    var v = variant || "default";
    var img = a.image
      ? '<div class="card__media"><img src="' + thumb(a.image) + '" alt="' +
        esc(a.imageAlt || a.title) + '" loading="lazy" decoding="async">' +
        '<span class="card__tag">' + esc(a.format) + "</span></div>"
      : "";
    var kicker = a.image
      ? ""
      : '<span class="kicker">' + esc(a.format) + " · " + esc(a.topic) + "</span>";

    return (
      '<a class="card card--' + v + (a.image ? "" : " card--text") + '" href="' +
      articleUrl(a.id) + '">' + img +
      '<div class="card__body">' + kicker +
      '<h3 class="card__title">' + esc(a.title) + "</h3>" +
      (v === "feature" ? '<p class="card__excerpt">' + esc(a.excerpt) + "</p>" : "") +
      '<div class="card__foot"><div class="meta"><span>' +
      esc(regionName(a.region) || "Россия") + '</span><span class="meta__dot"></span><span>' +
      fmtDate(a.date) + "</span></div><span class=\"mono\" style=\"color:var(--muted)\">" +
      (a.read || 4) + " мин</span></div></div></a>"
    );
  }

  function cardRow(a) {
    var img = a.image
      ? '<div class="card__media"><img src="' + thumb(a.image) + '" alt="' +
        esc(a.imageAlt || a.title) + '" loading="lazy" decoding="async"></div>'
      : '<div class="card__media" style="display:grid;place-items:center;background:var(--paper-3)">' +
        '<span class="mono" style="color:var(--muted)">' + esc(a.format) + "</span></div>";
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
      regions.map(function (r) {
        var n = countByRegion(r.slug);
        return (
          '<path class="map-region' + (n > 0 ? " has-content" : "") + '" d="' + r.d +
          '" data-slug="' + r.slug + '" tabindex="0" role="button" ' +
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
    var bypass = false;

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

    function toViewBox(clientX, clientY) {
      var box = svg.getBoundingClientRect();
      return {
        x: ((clientX - box.left) / box.width) * vbW,
        y: ((clientY - box.top) / box.height) * vbH,
      };
    }

    // перетаскивание
    var drag = null, moved = false;
    var canPan = !window.matchMedia || window.matchMedia("(min-width: 721px)").matches;
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

    function hideTip() {
      tip.classList.remove("is-on");
    }

    function showTip(r, clientX, clientY) {
      if (!tip) return;
      var n = countByRegion(r.slug);
      tip.innerHTML = "<b>" + esc(r.name) + "</b><span>" + esc(r.district || "") +
        (n ? " · " + n + " мат." : " · публикаций пока нет") + "</span>";
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

    paths.forEach(function (p) {
      var r = regionBySlug(p.getAttribute("data-slug"));
      if (!r) return;
      p.addEventListener("mouseenter", function (e) { showTip(r, e.clientX, e.clientY); });
      p.addEventListener("mousemove", function (e) { showTip(r, e.clientX, e.clientY); });
      p.addEventListener("mouseleave", hideTip);
      p.addEventListener("focus", function () {
        if (opts.onHover) opts.onHover(r);
      });
      p.addEventListener("blur", hideTip);
      p.addEventListener("click", function () {
        if (moved || bypass) return;
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

    function highlight(slug) {
      paths.forEach(function (p) {
        p.classList.toggle("is-selected", p.getAttribute("data-slug") === slug);
      });
    }

    return {
      node: host,
      highlight: highlight,
      dimDistrict: dimDistrict,
      toViewBox: toViewBox,
      reset: function () { state = { s: 1, tx: 0, ty: 0 }; apply(); },
    };
  }

  function mountMapSection() {
    var section = $("[data-map-section]");
    if (!section) return;

    var totalRegions = MAP.regions.length;
    var totalArticles = (SC.articles || []).length;
    var regionsWithContent = (SC.articles || []).reduce(function (acc, a) {
      if (acc.indexOf(a.region) === -1) acc.push(a.region);
      return acc;
    }, []).length;

    section.innerHTML =
      '<div class="wrap">' +
      '<div class="map-head">' +
      '<div><span class="kicker">01 — Главная особенность</span>' +
      '<h2>Выберите <em>свой регион</em> на карте</h2></div>' +
      '<div><p class="map-head__sub">Нажмите на регион, чтобы открыть его страницу: ' +
      "там будут материалы местных авторов. Если публикаций пока нет — мы честно об этом " +
      "скажем и предложим прислать историю.</p>" +
      '<div class="map-counter">' +
      "<div><b>" + totalRegions + "</b><span>региона на карте</span></div>" +
      "<div><b>" + regionsWithContent + "</b><span>уже с материалами</span></div>" +
      "<div><b>" + totalArticles + "</b><span>публикации</span></div>" +
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
      "Показать список регионов<span data-toggle-mark>+</span></button>" +
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
          : "Публикаций из этого региона пока нет. Вы можете предложить историю или стать автором проекта.") +
        "</div>" +
        '<a class="btn btn--sm ' + (n ? "btn--paper" : "btn--accent") + '" href="' + regionUrl(r.slug) +
        '">Открыть регион <span class="btn__arrow">' + ICONS.arrow + "</span></a>";
    }

    var map = mountMap($("[data-map-host]", section), {
      onHover: renderPick,
      onSelect: function (r) { window.location.href = regionUrl(r.slug); },
    });

    // список регионов
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

    // фильтр по округам
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

    // поиск региона по названию
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

  /* 6. Главная ============================================================= */

  function initHome() {
    var all = sortedArticles();
    var lead = all[0];
    var heroHost = $("[data-hero]");

    if (heroHost && lead) {
      var liveItems = all.slice(1, 5);
      var sideCard = all.find(function (a) { return a.image && a.id !== lead.id; }) || all[1];

      heroHost.innerHTML =
        '<div class="wrap"><div class="hero__grid">' +
        '<div><a class="hero__lead" href="' + articleUrl(lead.id) + '">' +
        '<div class="hero__media"><img src="' + thumb(lead.image || "") + '" alt="' +
        esc(lead.imageAlt || lead.title) + '"><span class="hero__flag">Главное</span></div>' +
        '<div class="hero__text">' +
        '<span class="kicker">' + esc(lead.format) + " · " + esc(regionName(lead.region)) + "</span>" +
        '<h1 class="hero__title">' + esc(lead.title) + "</h1>" +
        '<p class="hero__excerpt">' + esc(lead.excerpt) + "</p>" +
        '<div class="meta"><span>' + esc(author(lead.author).name) + "</span>" +
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
        (sideCard ? '<a class="side-card" href="' + articleUrl(sideCard.id) + '">' +
        (sideCard.image ? '<img src="' + thumb(sideCard.image) + '" alt="' +
          esc(sideCard.imageAlt || sideCard.title) + '" loading="lazy">' : "") +
        '<div class="meta"><span>' + esc(sideCard.format) + '</span><span class="meta__dot"></span><span>' +
        esc(regionName(sideCard.region)) + "</span></div>" +
        '<h3>' + esc(sideCard.title) + "</h3></a>" : "") +
        '<div class="side-note"><b>Проект на стадии запуска.</b> Мы собираем редакцию, ' +
        "авторов и наставников. Хотите участвовать — начните с раздела " +
        '<a href="join.html" style="border-bottom:1px solid var(--accent)">«Присоединиться»</a>.</div>' +
        "</aside></div></div>";
    }

    // бегущая строка
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
          ? shown.map(function (a) { return card(a); }).join("")
          : '<div class="no-data">По этой теме материалов пока нет.</div>';
        var more = $("[data-feed-more]");
        if (more) more.classList.toggle("is-hidden", list.length <= state.limit);
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

    // форматы
    var formatsHost = $("[data-formats]");
    if (formatsHost) {
      formatsHost.innerHTML = (SC.formats || []).slice(0, 6).map(function (f, i) {
        return '<a class="format" href="news.html?format=' + encodeURIComponent(f.name) + '">' +
          '<span class="format__n">0' + (i + 1) + "</span>" +
          '<span class="format__name">' + esc(f.name) + "</span>" +
          '<span class="format__desc">' + esc(f.desc) + "</span></a>";
      }).join("");
    }

    // свежие материалы по регионам (вторая лента)
    var regionalHost = $("[data-regional]");
    if (regionalHost) {
      regionalHost.innerHTML = all
        .slice(5, 11)
        .map(function (a) { return cardRow(a); })
        .join("");
    }
  }

  /* 7. Лента материалов ==================================================== */

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
      regionSelect.innerHTML = '<option value="">Все регионы</option>' +
        MAP.regions.slice().sort(function (a, b) {
          return a.name.localeCompare(b.name, "ru");
        }).map(function (r) {
          return '<option value="' + r.slug + '"' + (state.region === r.slug ? " selected" : "") +
            ">" + esc(r.name) + "</option>";
        }).join("");
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
        ? list.map(function (a) { return card(a); }).join("")
        : '<div class="empty"><h3>Ничего не нашлось</h3>' +
          "<p>Попробуйте убрать фильтры или поискать по другому слову. " +
          "А если вы знаете историю, которой ещё нет на сайте, — присылайте её нам.</p>" +
          '<div class="empty__actions"><a class="btn btn--sm" href="news.html">Сбросить фильтры</a>' +
          '<a class="btn btn--sm btn--ghost" href="join.html">Предложить материал</a></div></div>';

      if (countHost) {
        countHost.textContent = "Найдено материалов: " + list.length;
      }
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

  /* 8. Страница материала ================================================== */

  function initArticle() {
    var host = $("[data-article]");
    if (!host) return;
    var id = param("id");
    var a = (SC.articles || []).find(function (x) { return x.id === id; });

    if (!a) {
      host.innerHTML =
        '<div class="wrap section"><div class="empty"><h3>Материал не найден</h3>' +
        "<p>Скорее всего, ссылка устарела. Посмотрите все материалы в ленте.</p>" +
        '<div class="empty__actions"><a class="btn" href="news.html">К ленте материалов</a></div>' +
        "</div></div>";
      return;
    }

    var r = regionBySlug(a.region);
    var au = author(a.author);
    var bodyHtml = (a.body || []).map(function (p) {
      if (p.indexOf("> ") === 0) return "<blockquote>" + esc(p.slice(2)) + "</blockquote>";
      if (p.indexOf("## ") === 0) return "<h2>" + esc(p.slice(3)) + "</h2>";
      return "<p>" + esc(p) + "</p>";
    }).join("");

    var relatedTitle = "Ещё из этого региона";
    var related = (SC.articles || [])
      .filter(function (x) { return x.id !== a.id && x.region === a.region; })
      .slice(0, 3);
    if (!related.length) {
      var myRegion = regionBySlug(a.region);
      relatedTitle = "Из того же федерального округа";
      related = (SC.articles || [])
        .filter(function (x) {
          var rr = regionBySlug(x.region);
          return x.id !== a.id && rr && myRegion && rr.district === myRegion.district;
        })
        .slice(0, 3);
    }
    var latest = sortedArticles().filter(function (x) { return x.id !== a.id; }).slice(0, 4);

    document.title = a.title + " — Смена контента";

    host.innerHTML =
      '<article><div class="wrap article-head">' +
      '<div class="breadcrumbs">' +
      '<a href="news.html">Материалы</a><span>/</span>' +
      '<a href="' + regionUrl(a.region) + '">' + esc(regionName(a.region)) + "</a>" +
      "<span>/</span><span>" + esc(a.format) + "</span></div>" +
      '<span class="kicker">' + esc(a.topic) + " · " + esc(a.format) + "</span>" +
      '<h1 class="article-title">' + esc(a.title) + "</h1>" +
      '<p class="article-lead">' + esc(a.excerpt) + "</p>" +
      '<div class="article-meta">' +
      '<div class="author"><span class="author__ava">' + esc(au.initials) + "</span>" +
      '<div><div class="author__name">' + esc(au.name) + "</div>" +
      '<div class="author__role">' + esc(au.role) + "</div></div></div>" +
      '<div class="meta"><span>' + fmtDate(a.date) + "</span>" +
      '<span class="meta__dot"></span><span>' + (a.read || 4) + " мин чтения</span>" +
      '<span class="meta__dot"></span><a href="' + regionUrl(a.region) + '" style="color:inherit">' +
      esc(regionName(a.region)) + "</a></div></div>" +
      (a.image
        ? '<img class="article-cover" src="' + a.image + '" alt="' + esc(a.imageAlt || a.title) + '">' +
          '<div class="article-cover-caption"><span>Иллюстрация: демонстрационное изображение</span>' +
          "<span>" + esc(regionName(a.region)) + "</span></div>"
        : "") +
      "</div>" +
      '<div class="wrap"><div class="article-layout">' +
      '<div><div class="prose">' + bodyHtml + "</div>" +
      '<div class="article-tags">' +
      '<a class="tag" href="news.html?topic=' + encodeURIComponent(a.topic) + '">' + esc(a.topic) + "</a>" +
      '<a class="tag" href="news.html?format=' + encodeURIComponent(a.format) + '">' + esc(a.format) + "</a>" +
      '<a class="tag" href="news.html?region=' + encodeURIComponent(a.region) + '">' +
      esc(regionName(a.region)) + "</a></div>" +
      '<div class="demo-note"><span>⚑</span><div><b>Это демонстрационный материал.</b> ' +
      "Текст написан как пример оформления публикации. Перед запуском сайта он будет " +
      "заменён настоящим материалом автора проекта.</div></div>" +
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
      "</ul></div></aside></div></div></article>" +
      (related.length
        ? '<div class="wrap section"><div class="sec-head"><div class="sec-head__left">' +
          '<span class="kicker">' + esc(relatedTitle) + '</span>' +
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
  }

  /* 9. Страница региона ==================================================== */

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
      if (acc.indexOf(a.author) === -1) acc.push(a.author);
      return acc;
    }, []);
    document.title = r.name + " — Смена контента";

    var miniMap = '<svg viewBox="' + MAP.viewBox + '" role="img" aria-label="' +
      esc(r.name) + ' на карте России">' +
      MAP.regions.map(function (x) {
        return '<path class="map-region' + (x.slug === slug ? " is-selected" : "") +
          '" d="' + x.d + '"></path>';
      }).join("") + "</svg>";

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
      "<div><b>" + list.length + "</b><span>материалов</span></div>" +
      "<div><b>" + authorsHere.length + "</b><span>авторов</span></div>" +
      '<div><b style="font-size:1rem;font-family:var(--font-mono);letter-spacing:0">' +
      esc((r.district || "—").replace(" ФО", "")) + "</b><span>федеральный округ</span></div>" +
      "</div></div>" +
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
          "<p>Вы можете предложить историю или стать автором проекта. Мы помогаем с темой, " +
          "редактурой и публикацией — от вас нужна история, которая происходит рядом.</p>" +
          '<div class="empty__actions">' +
          '<a class="btn btn--accent" href="join.html">Предложить историю</a>' +
          '<a class="btn btn--ghost" href="media-school.html">Узнать о медиашколе</a>' +
          "</div></div>") +
      "</div>" +
      '<aside class="article-aside">' +
      '<div class="aside-box"><h3>Хотите писать отсюда?</h3>' +
      '<p style="font-size:.9rem;color:var(--ink-soft);margin-bottom:12px">Мы ищем авторов, ' +
      "фотографов и видеографов в каждом регионе. Опыт публикаций не обязателен.</p>" +
      '<a class="btn btn--sm btn--block" href="join.html">Стать автором</a></div>' +
      '<div class="aside-box"><h3>Другие регионы</h3><ul>' +
      (MAP.regions
        .filter(function (x) { return x.district === r.district && x.slug !== slug; })
        .slice(0, 6)
        .map(function (x) {
          var n = countByRegion(x.slug);
          return '<li><a href="' + regionUrl(x.slug) + '">' + esc(x.name) +
            (n ? " · " + n : "") + "</a></li>";
        })
        .join("")) +
      "</ul></div>" +
      '<div class="aside-box"><h3>На карте</h3>' +
      '<a class="btn btn--sm btn--ghost btn--block" href="index.html#map">Открыть всю карту</a></div>' +
      "</aside></div></div>";
  }

  /* 10. Вспомогательные страницы =========================================== */

  function initJoin() {
    var form = $("[data-join-form]");
    if (!form) return;

    var rolesHost = $("[data-roles]");
    if (rolesHost) {
      var roles = [
        { n: "Автор", d: "Пишет тексты, ищет темы и героев в своём городе." },
        { n: "Фотограф", d: "Снимает репортажи, портреты и фотоистории." },
        { n: "Видеограф", d: "Делает сюжеты, короткие видео и монтирует." },
        { n: "Редактор", d: "Помогает авторам довести материал до публикации." },
        { n: "Наставник", d: "Делится опытом и разбирает работы участников." },
        { n: "Партнёр", d: "Вуз, молодёжный центр, СМИ или медиашкола." },
      ];
      rolesHost.innerHTML = roles.map(function (r, i) {
        return '<div class="role"><span class="role__n">0' + (i + 1) + "</span>" +
          "<h3>" + r.n + "</h3><p>" + r.d + "</p></div>";
      }).join("");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = new FormData(form);
      var lines = [
        "Имя: " + (data.get("name") || ""),
        "Город / регион: " + (data.get("city") || ""),
        "Роль: " + (data.get("role") || ""),
        "Ссылка на работы: " + (data.get("link") || ""),
        "",
        "О себе:",
        data.get("about") || "",
      ].join("\n");
      var mailto = "mailto:" + SC.brand.email +
        "?subject=" + encodeURIComponent("Заявка в «Смену контента»") +
        "&body=" + encodeURIComponent(lines);
      window.location.href = mailto;
      var note = $("[data-form-status]", form.parentNode);
      if (note) {
        note.textContent =
          "Открываем почтовую программу с готовым письмом. Если она не открылась — " +
          "напишите нам на " + SC.brand.email + ".";
      }
    });
  }

  function initPageBits() {
    // подстановка названия проекта и почты в текст страниц
    $$("[data-brand-name]").forEach(function (el) { el.textContent = SC.brand.name; });
    $$("[data-brand-email]").forEach(function (el) {
      el.textContent = SC.brand.email;
      el.setAttribute("href", "mailto:" + SC.brand.email);
    });
    $$("[data-brand-telegram]").forEach(function (el) {
      el.textContent = SC.brand.telegram;
      el.setAttribute("href", "https://t.me/" + String(SC.brand.telegram).replace(/^@/, ""));
    });
    // счётчик материалов в шапке новостей
    $$("[data-total-articles]").forEach(function (el) {
      el.textContent = (SC.articles || []).length;
    });
    $$("[data-total-regions]").forEach(function (el) {
      el.textContent = (MAP.regions || []).length;
    });
  }

  /* запуск ================================================================== */

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
    if (page === "join") initJoin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
