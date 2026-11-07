/* ============================================================================
   «Смена контента в поиске» — сцена, курсор, вкладки, фильтры, карточки.
   Всё завёрнуто в проверки: если разметки нет или браузер не даёт canvas,
   страница остаётся рабочей и ничего не падает.
   ========================================================================== */
(function () {
  "use strict";

  var DATA = window.SC_SEARCH || { items: [], types: [], dirs: [], sources: [] };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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

  /* ----------------------------------------------------------------- cursor */
  (function cursor() {
    var cur = $("#ps-cur");
    if (!cur || !window.matchMedia || !window.matchMedia("(pointer: fine)").matches) return;

    var dot = $(".ps-cur__dot", cur), ring = $(".ps-cur__ring", cur);
    var mx = window.innerWidth / 2, my = window.innerHeight / 2, rx = mx, ry = my, raf = 0;

    document.body.classList.add("cursor-on");

    function move(e) {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = "translate(" + mx + "px," + my + "px) translate(-50%,-50%)";
      if (!raf) raf = requestAnimationFrame(loop);
    }
    function loop() {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = "translate(" + rx + "px," + ry + "px) translate(-50%,-50%)";
      raf = (Math.abs(mx - rx) > 0.4 || Math.abs(my - ry) > 0.4) ? requestAnimationFrame(loop) : 0;
    }
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerdown", function () { cur.classList.add("is-press"); });
    document.addEventListener("pointerup", function () { cur.classList.remove("is-press"); });
    document.addEventListener("pointerover", function (e) {
      var t = e.target;
      var hit = t.closest && t.closest("a,button,.ps-card,.ps-chip,.ps-src,input,.ps-range");
      cur.classList.toggle("is-hover", !!hit);
    });
  })();

  /* ------------------------------------------------------------------- scene */
  (function scene() {
    var cv = $("#ps-scene");
    if (!cv || !cv.getContext) { return; }
    if (reduced) { cv.style.display = "none"; return; }

    var ctx = null;
    try { ctx = cv.getContext("2d"); } catch (err) { ctx = null; }
    if (!ctx) { cv.style.display = "none"; return; }

    var W = 0, H = 0, dpr = 1, R = 260, pts = [], stars = [];
    var tilt = { x: 0, y: 0 }, tgt = { x: 0, y: 0 }, spin = 0, scroll = 0;
    var drag = { on: false, x: 0, y: 0, spin: 0 };
    var ripples = [];

    function make() {
      pts = [];
      var LAT = 40, LON = 60;
      for (var i = 0; i <= LAT; i++) {
        var phi = (i / LAT) * Math.PI;
        for (var j = 0; j < LON; j++) {
          var theta = (j / LON) * Math.PI * 2;
          pts.push({
            x: Math.sin(phi) * Math.cos(theta),
            y: Math.cos(phi),
            z: Math.sin(phi) * Math.sin(theta)
          });
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

      /* звёзды */
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
      var ax = tilt.x, ay = tilt.y;
      var proj = [];
      for (var k = 0; k < pts.length; k++) proj.push(project(pts[k], ang, ax, ay));

      /* каркас */
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

      /* точки */
      for (var b = 0; b < proj.length; b++) {
        var q = proj[b];
        if (q.z < -0.05) continue;
        var alpha = (1 - q.z) * 0.85;
        var r = Math.max(0.4, 1.5 * q.s);
        ctx.globalAlpha = alpha * 0.75;
        ctx.fillStyle = q.z > 0.35 ? "#f472b6" : "#8fdcff";
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* волны от клика */
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
      if (e.target.closest && e.target.closest("a,button,input,.ps-modal,.ps-hud")) return;
      drag.on = true; drag.x = e.clientX; drag.y = e.clientY; drag.base = drag.spin;
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

  /* -------------------------------------------------------------------- tabs */
  (function tabs() {
    var btns = $$(".ps-hud__nav button");
    if (!btns.length) return;
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-tab");
        btns.forEach(function (x) { x.classList.toggle("is-on", x === b); });
        $$(".ps-view").forEach(function (v) {
          v.classList.toggle("is-on", v.id === "ps-view-" + id);
        });
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      });
    });
  })();

  /* ----------------------------------------------------------------- filters */
  var state = { age: 35, type: "", dir: "", q: "", free: false };
  var cardsBox = $("#ps-cards"), resEl = $("#ps-count");

  function matches(it) {
    if (state.type && it.type !== state.type) return false;
    if (state.dir && it.dir !== state.dir) return false;
    if (state.free && !it.free) return false;
    /* ползунок на максимуме — «возраст не важен», иначе отсекаем по вилке */
    if (state.age < 35 && (state.age < it.ageMin || state.age > it.ageMax)) return false;
    if (state.q) {
      var hay = (it.title + " " + it.desc + " " + it.dir + " " + it.type + " " + it.src).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function card(it) {
    var free = it.free ? '<span class="ps-tag ps-tag--dim" data-t="свободно">бесплатно</span>' : "";
    return '' +
      '<article class="ps-card" data-id="' + it.id + '">' +
        '<div class="ps-tags">' +
          '<span class="ps-tag" data-t="' + esc(it.type) + '">' + esc(it.type) + '</span>' +
          '<span class="ps-tag ps-tag--dim">' + esc(it.dir) + '</span>' +
          free +
        '</div>' +
        '<h3>' + esc(it.title) + '</h3>' +
        '<p>' + esc(it.desc) + '</p>' +
        '<div class="ps-meta">' +
          '<span>возраст <b>' + it.ageMin + '–' + it.ageMax + '</b></span>' +
          '<span>дедлайн <b>' + esc(it.deadline) + '</b></span>' +
        '</div>' +
        '<div class="ps-actions">' +
          '<button class="ps-btn--ghost" data-act="more">Подробнее</button>' +
          '<a class="ps-btn--solid" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">К организатору</a>' +
        '</div>' +
      '</article>';
  }

  function render() {
    if (!cardsBox) return;
    var list = (DATA.items || []).filter(matches);
    if (resEl) resEl.innerHTML = "найдено <b>" + list.length + "</b> из " + (DATA.items || []).length;

    cardsBox.innerHTML = list.length
      ? list.map(card).join("")
      : '<div class="ps-empty">Под эти фильтры ничего не нашлось. Сдвиньте возраст или сбросьте чипсы.</div>';

    $$(".ps-card", cardsBox).forEach(function (el, idx) {
      setTimeout(function () { el.classList.add("is-in"); }, reduced ? 0 : idx * 45);
    });
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
    var freeChip = $("#ps-free");
    if (freeChip) freeChip.classList.remove("is-on");
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

    if (cardsBox) {
      cardsBox.addEventListener("click", function (e) {
        var btn = e.target.closest('[data-act="more"]');
        if (!btn) return;
        var art = btn.closest(".ps-card");
        var it = (DATA.items || []).filter(function (x) { return String(x.id) === art.getAttribute("data-id"); })[0];
        if (it) openModal(it);
      });
    }
  })();

  /* ------------------------------------------------------------------- modal */
  var overlay = $("#ps-overlay");

  function openModal(it) {
    if (!overlay) { window.open(it.link, "_blank", "noopener"); return; }
    var body = $("#ps-modal-body");
    if (body) {
      body.innerHTML = '' +
        '<div class="ps-tags">' +
          '<span class="ps-tag" data-t="' + esc(it.type) + '">' + esc(it.type) + '</span>' +
          '<span class="ps-tag ps-tag--dim">' + esc(it.dir) + '</span>' +
        '</div>' +
        '<h2>' + esc(it.title) + '</h2>' +
        '<p class="ps-modal__sub">' + esc(it.desc) + '</p>' +
        '<div class="ps-modal__meta">' +
          '<span class="ps-kv">возраст <b>' + it.ageMin + '–' + it.ageMax + '</b></span>' +
          '<span class="ps-kv">дедлайн <b>' + esc(it.deadline) + '</b></span>' +
          '<span class="ps-kv">приз <b>' + esc(it.prize) + '</b></span>' +
          '<span class="ps-kv">источник <b>' + esc(it.src) + '</b></span>' +
        '</div>' +
        '<div class="ps-modal__actions">' +
          '<a class="ps-btn ps-btn--solid" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">Открыть у организатора</a>' +
          '<button class="ps-btn ps-btn--ghost" data-copy="' + esc(it.link) + '">Скопировать ссылку</button>' +
        '</div>' +
        '<div class="ps-modal__foot">Условия, сроки и правила отбора — на стороне организатора. Мы показываем ссылку и краткое описание, приём заявок ведёт организатор.</div>';
    }
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
      var copy = e.target.closest("[data-copy]");
      if (copy) {
        var val = copy.getAttribute("data-copy");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val).then(function () { toast("Ссылка скопирована"); });
        } else {
          toast(val);
        }
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  var closeBtn = $("#ps-close");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  /* ---------------------------------------------------------------- sources */
  (function sources() {
    var box = $("#ps-sources");
    if (!box) return;
    box.innerHTML = (DATA.sources || []).map(function (s) {
      return '<a class="ps-src" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + '</a>';
    }).join("");
  })();

  /* -------------------------------------------------------------- first run */
  render();
})();
