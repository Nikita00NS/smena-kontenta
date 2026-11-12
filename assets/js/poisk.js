/* ============================================================================
   «Смена контента в поиске» — сцена, курсор, вкладки, фильтры, карточки
   и страница возможности на весь экран.
   Всё завёрнуто в проверки: если разметки нет или браузер не даёт canvas,
   страница остаётся рабочей и ничего не падает.
   ========================================================================== */
(function () {
  "use strict";

  var DATA = window.SC_SEARCH || { items: [], types: [], dirs: [], sources: [] };
  var ITEMS = DATA.items || [];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var LINK_LABEL = {
    "конкурс": "Страница конкурса",
    "олимпиада": "Страница олимпиады",
    "грант": "Страница гранта",
    "смена": "Страница смены",
    "школа": "Страница школы"
  };
  function linkLabel(it) { return LINK_LABEL[it.type] || "Открыть у организатора"; }

  var LINK_GEN = { "конкурс": "конкурса", "олимпиада": "олимпиады", "грант": "гранта", "смена": "смены", "школа": "школы" };
  function linkGenitive(it) { return LINK_GEN[it.type] || "возможности"; }

  function host(url) {
    try { return new URL(url, location.origin).host.replace(/^www\./, ""); } catch (e) { return url; }
  }

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ toast */
  var toastEl = $("#ps-toast"), toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2400);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Ссылка скопирована"); },
        function () { toast(text); });
    } else {
      toast(text);
    }
  }

  /* --------------------------------------------------------- появление в кадре */
  function watch(nodes, root, step) {
    if (!nodes.length) return;
    if (reduced || !("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var i = Number(el.getAttribute("data-i") || 0);
        el.style.transitionDelay = Math.min(i, 8) * (step || 55) + "ms";
        el.classList.add("is-in");
        io.unobserve(el);
      });
    }, { root: root || null, rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ----------------------------------------------------------------- cursor */
  (function cursor() {
    var cur = $("#ps-cur");
    if (!cur || !window.matchMedia || !window.matchMedia("(pointer: fine)").matches) return;

    var dot = $(".ps-cur__dot", cur), ring = $(".ps-cur__ring", cur);
    var mx = window.innerWidth / 2, my = window.innerHeight / 2, rx = mx, ry = my, raf = 0;

    document.body.classList.add("cursor-on");

    document.addEventListener("pointermove", function (e) {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = "translate(" + mx + "px," + my + "px) translate(-50%,-50%)";
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });

    function loop() {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = "translate(" + rx + "px," + ry + "px) translate(-50%,-50%)";
      raf = (Math.abs(mx - rx) > 0.4 || Math.abs(my - ry) > 0.4) ? requestAnimationFrame(loop) : 0;
    }

    document.addEventListener("pointerdown", function () { cur.classList.add("is-press"); });
    document.addEventListener("pointerup", function () { cur.classList.remove("is-press"); });
    document.addEventListener("pointerover", function (e) {
      var t = e.target;
      var hit = t.closest && t.closest("a,button,.ps-card,.ps-chip,.ps-src,input,.ps-range,.ps-detail__back");
      cur.classList.toggle("is-hover", !!hit);
    });
  })();

  /* ------------------------------------------------------------------- scene */
  (function scene() {
    var cv = $("#ps-scene");
    if (!cv || !cv.getContext) return;
    if (reduced || window.innerWidth < 760) { cv.style.display = "none"; return; }

    var ctx = null;
    try { ctx = cv.getContext("2d"); } catch (err) { ctx = null; }
    if (!ctx) { cv.style.display = "none"; return; }

    var W = 0, H = 0, dpr = 1, R = 260, pts = [], stars = [];
    var tilt = { x: 0, y: 0 }, tgt = { x: 0, y: 0 }, spin = 0, scroll = 0;
    var drag = { on: false, x: 0, base: 0, spin: 0 };
    var ripples = [];

    function make() {
      pts = [];
      var LAT = 40, LON = 60;
      for (var i = 0; i <= LAT; i++) {
        var phi = (i / LAT) * Math.PI;
        for (var j = 0; j < LON; j++) {
          var theta = (j / LON) * Math.PI * 2;
          pts.push({ x: Math.sin(phi) * Math.cos(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(theta) });
        }
      }
      stars = [];
      for (var s = 0; s < 150; s++) {
        stars.push({ x: Math.random(), y: Math.random(), z: Math.random(), r: Math.random() * 1.3 + 0.2 });
      }
    }

    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth || window.innerWidth;
      H = cv.clientHeight || window.innerHeight;
      cv.width = Math.floor(W * dpr);
      cv.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      R = Math.min(W, H) * 0.3;
    }

    function project(p, ang, ax, ay) {
      var cs = Math.cos(ang), sn = Math.sin(ang);
      var x = p.x * cs - p.z * sn;
      var z = p.x * sn + p.z * cs;
      var y = p.y;

      var cy = Math.cos(ay), sy = Math.sin(ay);
      var x2 = x * cy - y * sy, y2 = x * sy + y * cy;

      var cx = Math.cos(ax), sx = Math.sin(ax);
      var y3 = y2 * cx - z * sx, z3 = y2 * sx + z * cx;

      var persp = 1.9 / (1.9 + z3 * 0.7);
      return { x: W / 2 + x2 * R * persp, y: H / 2 + y3 * R * persp, z: z3, s: persp };
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        var tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(performance.now() / 900 + st.z * 10));
        ctx.globalAlpha = tw * 0.7;
        ctx.fillStyle = st.z > 0.7 ? "#a78bfa" : "#6ee7ff";
        ctx.beginPath();
        ctx.arc(st.x * W, (st.y * H + scroll * (0.15 + st.z * 0.2)) % H, st.r, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      var ang = spin + drag.spin;
      var proj = [];
      for (var k = 0; k < pts.length; k++) proj.push(project(pts[k], ang, tilt.x, tilt.y));

      var LON_N = 60;
      ctx.lineWidth = 0.35;
      for (var a = 0; a < proj.length; a++) {
        var p = proj[a];
        if (p.z < -0.15) continue;
        ctx.globalAlpha = 0.05 + (1 - Math.abs(p.z)) * 0.22;
        ctx.strokeStyle = p.z > 0.3 ? "#a78bfa" : "#6ee7ff";
        if (a % LON_N !== LON_N - 1) {
          var n = proj[a + 1];
          if (n) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(n.x, n.y); ctx.stroke(); }
        }
      }

      for (var b = 0; b < proj.length; b++) {
        var q = proj[b];
        if (q.z < -0.05) continue;
        ctx.globalAlpha = (1 - q.z) * 0.6;
        ctx.fillStyle = q.z > 0.35 ? "#f472b6" : "#8fdcff";
        ctx.beginPath();
        ctx.arc(q.x, q.y, Math.max(0.4, 1.5 * q.s), 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (var w = 0; w < ripples.length; w++) {
        var rp = ripples[w];
        rp.r += 5;
        rp.life -= 0.014;
        if (rp.life <= 0) { ripples.splice(w, 1); w--; continue; }
        ctx.globalAlpha = rp.life * 0.5;
        ctx.strokeStyle = "#6ee7ff";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, 7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function frame() {
      spin += 0.0022;
      scroll = window.pageYOffset || 0;
      tilt.x += (tgt.x - tilt.x) * 0.06;
      tilt.y += (tgt.y - tilt.y) * 0.06;
      if (!drag.on) drag.spin += (0 - drag.spin) * 0.02;
      draw();
      requestAnimationFrame(frame);
    }

    window.addEventListener("pointermove", function (e) {
      if (drag.on || window.innerWidth < 760) return;
      tgt.y = (e.clientX / window.innerWidth - 0.5) * 1.2;
      tgt.x = -(e.clientY / window.innerHeight - 0.5) * 1.0;
    }, { passive: true });

    document.addEventListener("pointerdown", function (e) {
      if (window.innerWidth < 760) return;
      if (e.target.closest && e.target.closest("a,button,input,.ps-detail,.ps-hud")) return;
      drag.on = true; drag.x = e.clientX; drag.base = drag.spin;
      ripples.push({ x: e.clientX, y: e.clientY, r: 2, life: 1 });
    });
    document.addEventListener("pointermove", function (e) {
      if (!drag.on) return;
      drag.spin = drag.base + (e.clientX - drag.x) * 0.008;
    }, { passive: true });
    document.addEventListener("pointerup", function () { drag.on = false; });

    window.addEventListener("resize", size);
    size();
    make();
    requestAnimationFrame(frame);
  })();

  /* --------------------------------------------------------------- hero typing */
  (function typing() {
    var h1 = $("#ps-hero-title");
    if (!h1) return;
    var full = h1.getAttribute("data-text") || h1.textContent;
    h1.setAttribute("data-text", full);
    if (reduced) { h1.innerHTML = full; return; }

    var chars = Array.prototype.slice.call(full);
    h1.innerHTML = "";
    var caret = document.createElement("i");
    caret.className = "ps-caret";
    h1.appendChild(caret);

    var i = 0;
    function step() {
      if (i >= chars.length) return;
      var ch = chars[i++];
      caret.insertAdjacentText("beforebegin", ch);
      setTimeout(step, ch === " " ? 34 : 26 + Math.random() * 34);
    }
    setTimeout(step, 420);
  })();

  /* -------------------------------------------------------------- hero parallax */
  (function heroParallax() {
    var hero = $(".ps-hero");
    if (!hero || reduced) return;
    var inner = hero.firstElementChild;
    if (!inner) return;
    var raf = 0;
    window.addEventListener("scroll", function () {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var y = window.pageYOffset || 0;
        var k = Math.min(y / 700, 1);
        inner.style.transform = "translateY(" + y * 0.18 + "px) scale(" + (1 - k * 0.06) + ")";
        inner.style.opacity = String(1 - k * 0.9);
      });
    }, { passive: true });
  })();

  /* -------------------------------------------------------------------- tabs */
  (function tabs() {
    var btns = $$(".ps-hud__nav button");
    if (!btns.length) return;
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-tab");
        btns.forEach(function (x) { x.classList.toggle("is-on", x === b); });
        $$(".ps-view").forEach(function (v) { v.classList.toggle("is-on", v.id === "ps-view-" + id); });
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
        $$(".ps-view.is-on .rv").forEach(function (el) { el.classList.remove("is-in"); });
        watch($$(".ps-view.is-on .rv"), null, 60);
      });
    });
  })();

  /* ----------------------------------------------------------------- filters */
  var state = { age: 35, type: "", dir: "", q: "", free: false };
  var cardsBox = $("#ps-cards"), resEl = $("#ps-count");

  function matches(it) {
    if (state.type && it.type !== state.type) return false;
    if (state.dir && it.dir !== state.dir) return false;
    if (state.free && it.free === false) return false;
    /* ползунок на максимуме — «возраст не важен», иначе отсекаем по вилке */
    if (state.age < 35 && (state.age < it.ageMin || state.age > it.ageMax)) return false;
    if (state.q) {
      var hay = (it.title + " " + it.desc + " " + it.org + " " + it.dir + " " + it.type).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function card(it, idx) {
    return '' +
      '<article class="ps-card rv" data-id="' + it.id + '" data-i="' + (idx || 0) + '" tabindex="0" role="button" aria-label="' + esc(it.title) + '">' +
        '<div class="ps-tags">' +
          '<span class="ps-tag" data-t="' + esc(it.type) + '">' + esc(it.type) + '</span>' +
          '<span class="ps-tag ps-tag--dim">' + esc(it.dir) + '</span>' +
        '</div>' +
        '<h3>' + esc(it.title) + '</h3>' +
        '<p class="ps-card__org">' + esc(it.org) + '</p>' +
        '<p>' + esc(it.desc) + '</p>' +
        '<div class="ps-meta">' +
          '<span>возраст <b>' + it.ageMin + '–' + it.ageMax + '</b></span>' +
          '<span>сроки <b>' + esc(it.deadline) + '</b></span>' +
        '</div>' +
        '<div class="ps-actions">' +
          '<button class="ps-btn--ghost" data-act="more" type="button">Подробнее</button>' +
          '<a class="ps-btn--solid" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">' + linkLabel(it) + '</a>' +
        '</div>' +
      '</article>';
  }

  function render() {
    if (!cardsBox) return;
    var list = ITEMS.filter(matches);
    if (resEl) resEl.innerHTML = "найдено <b>" + list.length + "</b> из " + ITEMS.length;

    cardsBox.innerHTML = list.length
      ? list.map(card).join("")
      : '<div class="ps-empty">Под эти фильтры ничего не нашлось. Сдвиньте возраст или сбросьте чипсы.</div>';

    watch($$(".ps-card", cardsBox), null, 60);
  }

  function reset() {
    state = { age: 35, type: "", dir: "", q: "", free: false };
    var r = $("#ps-age");
    if (r) r.value = 35;
    var lbl = $("#ps-age-val");
    if (lbl) lbl.textContent = "до 35 лет";
    var q = $("#ps-q");
    if (q) q.value = "";
    $$(".ps-chip[data-type],.ps-chip[data-dir],#ps-free").forEach(function (c) { c.classList.remove("is-on"); });
    render();
  }

  (function wire() {
    var r = $("#ps-age");
    if (r) {
      r.addEventListener("input", function () {
        state.age = Number(r.value) || 0;
        var lbl = $("#ps-age-val");
        if (lbl) lbl.textContent = state.age >= 35 ? "от 35 лет" : "до " + state.age + " лет";
        render();
      });
    }

    $$(".ps-chip[data-type]").forEach(function (c) {
      c.addEventListener("click", function () {
        var v = c.getAttribute("data-type");
        var on = c.classList.contains("is-on");
        $$(".ps-chip[data-type]").forEach(function (x) { x.classList.remove("is-on"); });
        state.type = on ? "" : v;
        if (!on) c.classList.add("is-on");
        render();
      });
    });

    $$(".ps-chip[data-dir]").forEach(function (c) {
      c.addEventListener("click", function () {
        var v = c.getAttribute("data-dir");
        var on = c.classList.contains("is-on");
        $$(".ps-chip[data-dir]").forEach(function (x) { x.classList.remove("is-on"); });
        state.dir = on ? "" : v;
        if (!on) c.classList.add("is-on");
        render();
      });
    });

    var q = $("#ps-q");
    if (q) {
      q.addEventListener("input", function () {
        state.q = q.value.trim().toLowerCase();
        render();
      });
    }

    var freeChip = $("#ps-free");
    if (freeChip) {
      freeChip.addEventListener("click", function () {
        state.free = !state.free;
        freeChip.classList.toggle("is-on", state.free);
        render();
      });
    }

    var resetBtn = $("#ps-reset");
    if (resetBtn) resetBtn.addEventListener("click", reset);

    /* на телефоне направление, условия и сброс прячутся под кнопкой */
    var moreBtn = $("#ps-more-toggle");
    var moreBox = $("#ps-more");
    if (moreBtn && moreBox) {
      moreBtn.addEventListener("click", function () {
        var open = moreBox.classList.toggle("is-open");
        moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
        moreBtn.innerHTML = open ? "Свернуть фильтры <span>−</span>" : "Ещё фильтры <span>+</span>";
      });
    }

    if (cardsBox) {
      var open = function (target) {
        var art = target.closest && target.closest(".ps-card");
        if (!art) return;
        var it = ITEMS.filter(function (x) { return String(x.id) === art.getAttribute("data-id"); })[0];
        if (it) openDetail(it);
      };
      cardsBox.addEventListener("click", function (e) {
        if (e.target.closest("a")) return;
        open(e.target);
      });
      cardsBox.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest("a")) return;
        e.preventDefault();
        open(e.target);
      });
    }
  })();

  /* --------------------------------------------- страница возможности целиком */
  var detail = $("#ps-detail");

  function section(num, title, body) {
    return '<section class="ps-sec rv" data-i="0">' +
      '<h2><span>' + num + '</span>' + title + '</h2>' +
      '<div class="ps-sec__body">' + body + '</div>' +
    '</section>';
  }

  function similar(it) {
    var same = ITEMS.filter(function (x) {
      return x.id !== it.id && (x.type === it.type || x.dir === it.dir);
    });
    var sameType = same.filter(function (x) { return x.type === it.type; });
    var sameDir = same.filter(function (x) { return x.dir === it.dir && x.type !== it.type; });
    return sameType.concat(sameDir).slice(0, 3);
  }

  function detailHtml(it) {
    var steps = (it.steps || []).map(function (s, i) {
      return '<li class="ps-step-item rv" data-i="' + i + '">' +
        '<span class="ps-step-item__n">' + (i + 1) + '</span>' +
        '<span class="ps-step-item__t">' + esc(s) + '</span>' +
      '</li>';
    }).join("");

    var need = (it.need || []).map(function (s, i) {
      return '<li class="rv" data-i="' + i + '">' + esc(s) + '</li>';
    }).join("");

    var sim = similar(it).map(function (x, i) {
      return '<a class="ps-sim rv" data-i="' + i + '" href="#" data-id="' + x.id + '">' +
        '<span class="ps-sim__type">' + esc(x.type) + '</span>' +
        '<b>' + esc(x.title) + '</b>' +
        '<span class="ps-sim__org">' + esc(x.org) + '</span>' +
        '<span class="ps-sim__meta">' + x.ageMin + '–' + x.ageMax + ' лет · ' + esc(x.deadline) + '</span>' +
      '</a>';
    }).join("");

    return '' +
      '<div class="ps-detail__bar"><i></i></div>' +
      '<button type="button" class="ps-detail__close" data-close aria-label="Закрыть">×</button>' +
      '<header class="ps-detail__head">' +
        '<button type="button" class="ps-detail__back" data-close>← Ко всем возможностям</button>' +
        '<div class="ps-tags ps-detail__tags">' +
          '<span class="ps-tag" data-t="' + esc(it.type) + '">' + esc(it.type) + '</span>' +
          '<span class="ps-tag ps-tag--dim">' + esc(it.dir) + '</span>' +
        '</div>' +
        '<h1>' + esc(it.title) + '</h1>' +
        '<p class="ps-detail__org">' + esc(it.org) + ' · <span>' + esc(host(it.link)) + '</span></p>' +
        '<p class="ps-detail__lead">' + esc(it.desc) + '</p>' +
        '<div class="ps-detail__meta">' +
          '<div class="ps-kv"><span>возраст</span><b>' + it.ageMin + '–' + it.ageMax + ' лет</b></div>' +
          '<div class="ps-kv"><span>сроки</span><b>' + esc(it.deadline) + '</b></div>' +
          '<div class="ps-kv"><span>участие</span><b>бесплатно</b></div>' +
          '<div class="ps-kv"><span>что получает</span><b>' + esc(it.prize) + '</b></div>' +
        '</div>' +
        '<div class="ps-detail__cta">' +
          '<a class="ps-btn ps-btn--solid" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">Открыть страницу ' + esc(linkGenitive(it)) + ' у организатора</a>' +
          '<button type="button" class="ps-btn ps-btn--ghost" data-copy="' + esc(it.link) + '">Скопировать ссылку</button>' +
        '</div>' +
      '</header>' +
      '<div class="ps-detail__body">' +
        section("01", "Что нужно сделать", '<ol class="ps-step-list">' + steps + '</ol>') +
        section("02", "Что понадобится", '<ul class="ps-check">' + need + '</ul>') +
        section("03", "Кто может участвовать", '<p class="ps-text">' + esc(it.who) + '</p>') +
        section("04", "Сроки и результат",
          '<div class="ps-two">' +
            '<div class="ps-info"><b>Сроки</b><p>' + esc(it.deadline) + '. Точные даты приёма заявок и этапов организатор публикует на своём сайте.</p></div>' +
            '<div class="ps-info"><b>Что получает участник</b><p>' + esc(it.prize) + '</p></div>' +
          '</div>' +
          '<p class="ps-warn">Приём заявок, правила отбора и согласия на обработку данных оформляет организатор. Мы показываем только ссылку и краткое описание — участие ничем не отличается от прямого обращения к организатору.</p>') +
        (sim ? section("05", "Похожие возможности", '<div class="ps-sims">' + sim + '</div>') : "") +
      '</div>';
  }

  function openDetail(it) {
    if (!detail) { window.open(it.link, "_blank", "noopener"); return; }
    detail.innerHTML = detailHtml(it);
    detail.scrollTop = 0;
    detail.classList.add("is-open");
    document.body.classList.add("ps-locked");

    if (window.history && history.replaceState) {
      try { history.replaceState({ psId: it.id }, "", "#" + it.id); } catch (e) {}
    }

    /* шапка собирается по очереди, блоки — по мере прокрутки */
    var head = $$(".ps-detail__head > *", detail);
    head.forEach(function (el, i) {
      el.style.transitionDelay = reduced ? "0ms" : 90 + i * 70 + "ms";
    });
    requestAnimationFrame(function () {
      head.forEach(function (el) { el.classList.add("is-in"); });
    });

    watch($$(".rv", detail), detail, 60);
    bindDetail(it);
  }

  function closeDetail() {
    if (!detail || !detail.classList.contains("is-open")) return;
    detail.classList.remove("is-open");
    document.body.classList.remove("ps-locked");
    if (window.history && history.replaceState) {
      try { history.replaceState({}, "", location.pathname + location.search); } catch (e) {}
    }
    setTimeout(function () {
      if (!detail.classList.contains("is-open")) detail.innerHTML = "";
    }, 480);
  }

  function bindDetail(current) {
    $$("[data-copy]", detail).forEach(function (b) {
      b.addEventListener("click", function () { copy(b.getAttribute("data-copy")); });
    });
    $$("[data-close]", detail).forEach(function (b) {
      b.addEventListener("click", closeDetail);
    });
    $$(".ps-sim", detail).forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var it = ITEMS.filter(function (x) { return String(x.id) === a.getAttribute("data-id"); })[0];
        if (it) openDetail(it);
      });
    });

  }

  /* полоса прогресса — один слушатель на всё время жизни страницы */
  if (detail) {
    detail.addEventListener("scroll", function () {
      var bar = $(".ps-detail__bar i", detail);
      if (!bar) return;
      var max = detail.scrollHeight - detail.clientHeight;
      var p = max > 0 ? detail.scrollTop / max : 0;
      bar.style.transform = "scaleX(" + Math.min(p, 1) + ")";
    }, { passive: true });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDetail();
  });

  /* ------------------------------------------------------- соцсети проекта */
  /* Адреса и логотипы не дублируем: берём из SC.brand.social (assets/js/data.js). */
  (function social() {
    var box = $("#ps-social");
    if (!box) return;
    var list = (window.SC && window.SC.brand && window.SC.brand.social) || [];
    if (!list.length) return;
    box.innerHTML = '<span class="ps-foot__caption">Социальные сети</span>' +
      '<span class="ps-foot__links">' + list.map(function (item) {
        if (!item || !item.url) return "";
        var label = item.title || item.url;
        return '<a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer"' +
          ' title="' + esc(item.hint || label) + '"' +
          ' aria-label="' + esc(item.hint || label) + ' (откроется в новой вкладке)">' +
          (item.icon ? '<img src="' + esc(item.icon) + '" alt="" width="20" height="20" loading="lazy">' : "") +
          '<span>' + esc(label) + '</span></a>';
      }).join("") + '</span>';
  })();

  /* ---------------------------------------------------------------- sources */
  (function sources() {
    var box = $("#ps-sources");
    if (!box) return;
    box.innerHTML = (DATA.sources || []).map(function (s, i) {
      return '<a class="ps-src rv" data-i="' + (i % 12) + '" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + '</a>';
    }).join("");
  })();

  /* -------------------------------------------------------------- first run */
  render();
  watch($$(".ps-view .rv"), null, 70);

  /* прямая ссылка на возможность: /poisk#12 */
  (function deepLink() {
    var id = (location.hash || "").replace("#", "");
    if (!id) return;
    var it = ITEMS.filter(function (x) { return String(x.id) === id; })[0];
    if (it) setTimeout(function () { openDetail(it); }, 500);
  })();
})();
