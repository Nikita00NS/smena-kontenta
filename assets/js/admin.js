/* ============================================================================
   ПАНЕЛЬ ПРОЕКТА (/admin)

   Кто что видит, решает сервер: вкладки строятся по списку полномочий и по
   сводке staff-summary. Названия ролей здесь не проверяются вовсе — новая
   роль на сервере сразу получает свои разделы.

   Руководитель редакции и региональный администратор видят только свою зону:
   сервер сам отдаёт им только своих людей и материалы.

   Действия, для которых нужен код из письма (публикация, решения по
   согласиям и картам, открытие редакции), сервер отклоняет ответом
   needConfirm — тогда на месте появляется строка подтверждения, и действие
   повторяется само.

   Файл подключается перед app.js; разделы прежней панели (почта, задачи,
   приём в команду, поддержка, настройки сайта) приходят параметром legacy.
   ========================================================================== */
(function () {
  "use strict";

  var CARD_STATE = {
    none: ["нет", "status--draft"],
    pending: ["заявка", "status--pending"],
    issued: ["действует", "status--pub"],
    suspended: ["приостановлена", "status--bad"],
    revoked: ["отозвана", "status--bad"],
    expired: ["истекла", "status--bad"],
    rejected: ["отказано", "status--draft"],
    annulled: ["заменена", "status--draft"],
  };

  var CONSENT_PILL = {
    none: ["нет", "status--draft"],
    pending: ["на проверке", "status--pending"],
    approved: ["принято", "status--pub"],
    rejected: ["отклонено", "status--bad"],
    withdrawn: ["отозвано", "status--draft"],
    exempt: ["не требуется", "status--pub"],
  };

  var OPEN_STATE = {
    awaiting: ["ждём подписанный скан", "status--pending"],
    review: ["ждёт решения директора", "status--pending"],
    approved: ["редакция открыта", "status--pub"],
    rejected: ["отказано", "status--bad"],
    withdrawn: ["отозвано заявителем", "status--draft"],
  };

  window.SCAdmin = function (root, ui, legacy, confirmKit) {
    var $ = ui.$, $$ = ui.$$, esc = ui.esc, Store = ui.Store, SC = ui.SC;
    var user = Store.currentUser();
    var summary = {};
    var scoped = false;
    var mounted = {};
    var tabs = [];

    function cap(name) { return Store.hasCap(name, user); }
    function anyCap(list) { return Store.anyCap(list, user); }
    function pill(pair) { return '<span class="status ' + pair[1] + '">' + esc(pair[0]) + "</span>"; }
    function when(iso) { return iso ? ui.fmtWhen(iso) : "—"; }
    function day(iso) { return iso ? ui.fmtDate(iso) : "—"; }
    function waitText(iso) {
      if (!iso) return "";
      var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
      if (d <= 0) return "сегодня";
      return d + " " + ui.plural(d, ["день", "дня", "дней"]) + " ждёт";
    }
    function emptyNote(text) { return '<div class="adm-empty">' + esc(text) + "</div>"; }
    function region(slug) { return ui.regionName(slug) || slug || "регион не указан"; }

    /* ------------------------------------------------------------- вход */
    if (!Store.isStaff(user)) {
      /* права могли выдать только что — один раз спрашиваем сервер */
      root.innerHTML = '<section class="section wrap"><p class="no-data">Проверяем права…</p></section>';
      Store.refreshMe().then(function () {
        user = Store.currentUser() || user;
        if (Store.isStaff(user)) start(); else drawGate();
      }, drawGate);
    } else {
      start();
    }

    function drawGate() {
      root.innerHTML =
        '<section class="page-hero"><div class="wrap page-hero__grid"><div>' +
        '<span class="kicker">Служебное</span><h1>Панель<br>редакции</h1></div>' +
        '<div class="page-hero__aside"><p class="lead">Вы вошли как «' + esc(user.name) + "», роль: <b>" +
        esc(user.access || "Пользователь") + "</b>. Панель открыта сотрудникам редакции — роль выдаёт руководство проекта.</p></div></div></section>" +
        '<section class="section wrap"><div class="panel" style="padding:24px">' +
        '<div class="diag" data-gate-list><p class="form__note">Проверяем сервер…</p></div>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:16px">' +
        '<button class="btn btn--accent btn--sm" type="button" data-gate-claim hidden>Получить права директора</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-gate-refresh>Обновить права</button>' +
        '<a class="btn btn--ghost btn--sm" href="/profile">В кабинет</a>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-gate-logout>Выйти</button></div>' +
        '<div data-gate-confirm style="margin:12px 0 0"></div>' +
        '<p class="form__note" data-gate-status></p>' +
        '<p class="form__note">Версия интерфейса: ' + esc((SC && SC.build) || "—") + "</p></div></section>";

      var list = $("[data-gate-list]", root);
      var status = $("[data-gate-status]", root);
      var claim = $("[data-gate-claim]", root);

      function draw(info) {
        if (!info) { list.innerHTML = '<p class="form__note">Сервер не отвечает. Проверьте связь и обновите страницу.</p>'; return; }
        list.innerHTML =
          '<div class="diag__row"><span>Ваша роль на сервере</span><b>' + esc((info.user && info.user.access) || "нет данных") + "</b></div>" +
          '<div class="diag__row"><span>Руководитель проекта</span><b>' +
          (info.directorExists ? esc(info.directorName || "назначен") : "не назначен") + "</b></div>";
        if (info.canClaimDirector) {
          claim.hidden = false;
          var holder = $("[data-gate-confirm]", root);
          if (!holder.firstChild) { holder.innerHTML = confirmKit.rowHtml(); confirmKit.bind(); }
          status.textContent = "На сервере пока один аккаунт и нет руководителя: вы можете забрать роль директора по коду из письма.";
        }
      }
      Store.whoami().then(draw, function () { draw(null); });

      claim.addEventListener("click", function () {
        if (!confirmKit.ready(status)) return;
        claim.disabled = true;
        Store.claimDirector().then(function () {
          status.textContent = "Права директора выданы. Открываем панель…";
          window.location.reload();
        }, function (err) {
          claim.disabled = false;
          status.textContent = (err && err.message) || "Не получилось.";
        });
      });
      $("[data-gate-refresh]", root).addEventListener("click", function () {
        status.textContent = "Обновляем…";
        Store.refreshMe().then(function () {
          user = Store.currentUser() || user;
          if (Store.isStaff(user)) { start(); return; }
          status.textContent = "Права не изменились: роль на сервере — " + (user.access || "Пользователь") + ".";
        });
      });
      $("[data-gate-logout]", root).addEventListener("click", function () {
        Store.logout();
        window.location.replace("/join#login");
      });
    }

    /* ---------------------------------------------------------- каркас */
    function start() {
      root.innerHTML =
        '<section class="adm-hero"><div class="wrap adm-hero__in"><div><span class="kicker">Служебное</span>' +
        "<h1>Панель проекта</h1></div>" +
        '<p class="adm-hero__who">' + esc(user.name) + " · " + esc(user.access || "") +
        '<span data-adm-scope></span> · версия ' + esc((SC && SC.build) || "—") + "</p></div></section>" +
        '<nav class="adm-tabs" aria-label="Разделы панели"><div class="wrap adm-tabs__in" data-adm-tabs>' +
        '<span class="form__note">Загружаем разделы…</span></div></nav>' +
        '<div class="adm-panels" data-adm-panels></div>';

      Store.staffSummary().then(function (res) {
        if (res && res.ok) {
          summary = res.summary || {};
          scoped = !!res.scoped;
          /* права в браузере могли устареть — берём серверные */
          if (res.caps) user = Object.assign({}, user, { caps: res.caps, access: res.role });
        }
        build();
      }, build);
    }

    function has(key) { return summary[key] !== undefined; }

    function build() {
      var scopeNote = $("[data-adm-scope]", root);
      if (scopeNote && scoped) scopeNote.textContent = " · вы видите свою редакцию или регион";

      var all = [
        ["overview", "Обзор", true, function () { return 0; }],
        ["queue", "Материалы", cap("posts.review"), function () { return (summary.posts || 0) + (summary.portfolio || 0); }],
        ["consents", "Согласия", cap("consents.review"), function () { return summary.consents || 0; }],
        ["cards", "Карты", anyCap(["cards.view", "cards.issue"]), function () { return summary.cards || 0; }],
        ["editorials", "Редакции", has("editorialOpen") || has("editorialApps") || has("reports"),
          function () { return (summary.editorialOpen || 0) + (summary.editorialApps || 0) + (summary.reports || 0); }],
        ["school", "Медиашкола", anyCap(["school.manage", "school.teach", "school.review"]) && !!(window.SCSchool && window.SCSchool.admin),
          function () { return summary.school || 0; }],
        ["people", "Люди", cap("people.view"), function () { return 0; }],
        ["hiring", "Команда", has("hiring"), function () { return summary.hiring || 0; }],
        ["support", "Поддержка и почта", has("support") || has("recovery") || !!user.canUseMail || cap("mail.manage"),
          function () { return (summary.support || 0) + (summary.recovery || 0); }],
        ["site", "Сайт", cap("site.manage"), function () { return summary.site || 0; }],
        ["server", cap("server.diag") ? "Сервер" : "Журнал", anyCap(["server.diag", "audit.view"]), function () { return 0; }],
      ];
      tabs = all.filter(function (t) { return t[2]; });

      var panels = $("[data-adm-panels]", root);
      panels.innerHTML = tabs.map(function (t) {
        return '<div class="adm-panel" data-adm-panel="' + t[0] + '" hidden></div>';
      }).join("");
      drawTabs();
      open(currentTab());
      window.addEventListener("hashchange", function () { open(currentTab()); });
    }

    function currentTab() {
      var hash = String(window.location.hash || "").replace(/^#/, "");
      if (!hash) { try { hash = window.sessionStorage.getItem("smena_admin_tab") || ""; } catch (e) {} }
      for (var i = 0; i < tabs.length; i++) if (tabs[i][0] === hash) return hash;
      return "overview";
    }

    function drawTabs() {
      var nav = $("[data-adm-tabs]", root);
      var active = currentTab();
      nav.innerHTML = tabs.map(function (t) {
        var n = t[3]();
        return '<a class="adm-tab' + (t[0] === active ? " is-on" : "") + '" href="#' + t[0] + '" data-adm-tab="' + t[0] + '"' +
          (t[0] === active ? ' aria-current="page"' : "") + ">" + esc(t[1]) +
          (n ? '<span class="adm-tab__badge" data-adm-badge>' + n + "</span>" : "") + "</a>";
      }).join("");
    }

    var MOUNT = {
      overview: mountOverview,
      queue: mountQueueTab,
      consents: mountConsentQueue,
      cards: mountCardQueue,
      editorials: mountEditorialsTab,
      school: function (panel) { window.SCSchool.admin(panel, user, ui, kit()); },
      people: mountPeople,
      hiring: function (panel) { legacy.hiring(panel); },
      support: mountSupportTab,
      site: mountSiteTab,
      server: mountServerTab,
    };

    function open(name) {
      try { window.sessionStorage.setItem("smena_admin_tab", name); } catch (e) {}
      $$("[data-adm-panel]", root).forEach(function (p) { p.hidden = p.getAttribute("data-adm-panel") !== name; });
      drawTabs();
      if (!mounted[name] && MOUNT[name]) {
        mounted[name] = true;
        var panel = $('[data-adm-panel="' + name + '"]', root);
        try { MOUNT[name](panel); } catch (e) {
          panel.innerHTML = '<section class="section wrap"><p class="no-data">Раздел не открылся: ' + esc(e.message) + "</p></section>";
        }
      }
    }

    function refreshSummary() {
      Store.staffSummary().then(function (res) {
        if (res && res.ok) { summary = res.summary || {}; drawTabs(); }
      });
    }

    /* Раздел: заголовок, строка состояния, место для подтверждения, тело. */
    function section(panel, key, kicker, title, text) {
      var el = document.createElement("section");
      el.className = "adm-sec wrap";
      el.setAttribute("data-adm", key);
      el.innerHTML =
        '<header class="adm-sec__head"><div><span class="kicker">' + esc(kicker) + "</span><h2>" + esc(title) + "</h2>" +
        (text ? '<p class="adm-sec__text">' + text + "</p>" : "") + "</div>" +
        '<div class="adm-sec__tools" data-adm-tools></div></header>' +
        '<div data-confirm-slot style="display:none"></div>' +
        '<p class="form__note adm-sec__status" data-adm-status role="status"></p>' +
        '<div class="adm-sec__body" data-adm-body></div>';
      panel.appendChild(el);
      return {
        el: el,
        body: $("[data-adm-body]", el),
        status: $("[data-adm-status]", el),
        tools: $("[data-adm-tools]", el),
        slot: $("[data-confirm-slot]", el),
      };
    }

    /* Действие сотрудника. needConfirm → строка с кодом → повтор без нового нажатия. */
    function act(sec, action, payload, done, btn) {
      if (btn) btn.disabled = true;
      sec.status.textContent = "Сохраняем…";
      Store.callStaff(action, payload).then(function (res) {
        if (btn) btn.disabled = false;
        if (res && res.ok) {
          sec.status.textContent = "";
          done(res);
          refreshSummary();
          return;
        }
        if (res && res.needConfirm) {
          confirmKit.ask(sec.slot, sec.status, function () { act(sec, action, payload, done, btn); });
          try { sec.slot.scrollIntoView({ block: "center" }); } catch (e) {}
          return;
        }
        sec.status.textContent = (res && res.error) || "Не получилось. Попробуйте ещё раз.";
      });
    }

    function load(sec, action, payload, draw) {
      sec.body.innerHTML = '<p class="no-data">Загружаем…</p>';
      Store.callStaff(action, payload || {}).then(function (res) {
        if (res && res.ok) { draw(res); return; }
        sec.body.innerHTML = emptyNote((res && res.error) || "Не удалось загрузить.");
      });
    }

    function openFile(sec, action, payload) {
      sec.status.textContent = "Открываем файл…";
      Store.callStaff(action, payload).then(function (res) {
        if (!res || !res.ok) { sec.status.textContent = (res && res.error) || "Файл не открылся."; return; }
        var url = ui.dataUrlToBlobUrl(res.data);
        sec.status.textContent = url ? "" : "Не удалось открыть файл.";
        if (url) window.open(url, "_blank", "noopener");
      });
    }

    function kit() {
      return { section: section, act: act, load: load, pill: pill, emptyNote: emptyNote, refreshSummary: refreshSummary, cap: cap, when: when, day: day };
    }

    function facts(rows) {
      return '<dl class="adm-facts">' + rows.filter(function (r) { return r && r[1] !== "" && r[1] != null; }).map(function (r) {
        return "<div><dt>" + esc(r[0]) + "</dt><dd>" + (r[2] ? r[1] : esc(r[1])) + "</dd></div>";
      }).join("") + "</dl>";
    }

    function history(list) {
      if (!list || !list.length) return "";
      var NAMES = { sent: "отправлено", approved: "принято", rejected: "отклонено", applied: "заявка", issued: "выдана",
        suspended: "приостановлена", restored: "возобновлена", revoked: "отозвана", extended: "продлена", annulled: "заменена",
        submitted: "заявление сформировано", received: "документ получен", returned: "возвращено на доработку", withdrawn: "отозвано" };
      return '<details class="adm-history"><summary>История: ' + list.length + "</summary><ul>" + list.slice().reverse().map(function (h) {
        return "<li>" + esc(day(h.at)) + " · " + esc(NAMES[h.action] || h.action) + " · " + esc(h.by || "") +
          (h.note ? " · " + esc(h.note) : "") + "</li>";
      }).join("") + "</ul></details>";
    }

    /* ------------------------------------------------------------- обзор */
    function mountOverview(panel) {
      var sec = section(panel, "overview", "Сегодня", "Что ждёт решения",
        scoped ? "Вы видите материалы и людей своей редакции или региона." : "Очереди по всему проекту. Цифра — сколько ждёт.");
      var tiles = [
        ["posts", "Материалы на проверке", "queue"],
        ["portfolio", "Работы в портфолио", "queue"],
        ["consents", "Согласия на проверке", "consents"],
        ["cards", "Заявки на пресс-карту", "cards"],
        ["editorialOpen", cap("editorials.open") ? "Заявления на открытие редакции: ждут решения" : "Заявления на открытие редакции", "editorials"],
        ["editorialApps", "Заявки в редакции", "editorials"],
        ["reports", "Отчёты редакций", "editorials"],
        ["school", "Задания медиашколы на проверке", "school"],
        ["support", "Обращения в поддержку", "support"],
        ["recovery", "Заявки на восстановление доступа", "support"],
        ["hiring", "Кандидаты в команду на согласовании", "hiring"],
      ].filter(function (t) { return has(t[0]); });

      function draw() {
        sec.body.innerHTML =
          (tiles.length
            ? '<div class="adm-tiles">' + tiles.map(function (t) {
                var n = summary[t[0]] || 0;
                return '<a class="adm-tile' + (n ? " is-hot" : "") + '" href="#' + t[2] + '"><b>' + n + "</b><span>" + esc(t[1]) + "</span></a>";
              }).join("") + "</div>"
            : emptyNote("У вашей роли нет очередей.")) +
          (has("people") ? '<p class="adm-sec__text">Людей в вашей зоне: <b>' + summary.people + '</b>. <a class="link-accent" href="#people">Открыть список →</a></p>' : "") +
          (summary.site ? '<p class="gate"><b>Сайт закрыт на техработы.</b> <a class="link-accent" href="#site">Открыть настройки сайта →</a></p>' : "");
      }
      draw();
      sec.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-refresh>Обновить</button>';
      $("[data-refresh]", sec.tools).addEventListener("click", function () {
        Store.staffSummary().then(function (res) {
          if (res && res.ok) { summary = res.summary || {}; drawTabs(); draw(); }
        });
      });
      if (cap("people.edit")) { legacy.teamChat(panel); legacy.tasks(panel); }
    }

    /* --------------------------------------------------------- материалы */
    function mountQueueTab(panel) {
      mountPostsQueue(panel);
      if (has("portfolio")) legacy.portfolio(panel);
      if (cap("posts.remove")) mountPublished(panel);
    }

    function mountPostsQueue(panel) {
      var sec = section(panel, "posts", "Очередь", "Материалы на проверке",
        "От старых к новым. Вернуть на доработку можно только с замечанием — автор увидит его в кабинете и получит письмом.");
      sec.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
      $("[data-reload]", sec.tools).addEventListener("click", reload);

      function row(p) {
        var media = [];
        if (p.image) media.push('<a class="link-accent" href="' + esc(p.image) + '" target="_blank" rel="noopener">обложка</a>');
        (p.gallery || []).forEach(function (g, i) { media.push('<a class="link-accent" href="' + esc(g) + '" target="_blank" rel="noopener">фото ' + (i + 1) + "</a>"); });
        if (p.video) media.push('<a class="link-accent" href="' + esc(p.video) + '" target="_blank" rel="noopener">видео</a>');
        if (p.audio) media.push('<a class="link-accent" href="' + esc(p.audio) + '" target="_blank" rel="noopener">аудио</a>');
        var body = String(p.body || "").split(/\n{2,}/).map(function (part) { return "<p>" + ui.inlineMd(part.trim()) + "</p>"; }).join("");
        return '<article class="adm-item" data-post="' + esc(p.id) + '">' +
          '<div class="adm-item__top"><h3>' + esc(p.title) + "</h3>" +
          (p.revision > 1 ? pill(["исправленная версия " + p.revision, "status--pending"]) : "") +
          (p.own ? pill(["ваш материал", "status--draft"]) : "") + "</div>" +
          '<p class="adm-item__meta">№ ' + (p.number || "—") + " · " + esc(p.authorName) +
          (p.authorNumber ? " (участник № " + p.authorNumber + ")" : "") +
          (p.authorEmail ? " · " + esc(p.authorEmail) : "") + " · " + esc(p.format || "материал") + " · " + esc(region(p.region)) +
          " · " + esc(when(p.submittedAt)) + (waitText(p.submittedAt) ? " · " + esc(waitText(p.submittedAt)) : "") + "</p>" +
          '<p class="adm-item__lead">' + esc(p.excerpt || "") + "</p>" +
          '<details class="adm-text"><summary>Читать текст' + (media.length ? " и файлы" : "") + "</summary>" +
          (media.length ? '<p class="adm-item__meta">Файлы: ' + media.join(" · ") + "</p>" : "") + body + "</details>" +
          '<div class="adm-item__actions">' +
          '<input type="text" class="adm-input" placeholder="Замечание автору — обязательно, если возвращаете" data-note maxlength="600" aria-label="Замечание автору">' +
          '<button class="btn btn--sm btn--accent" type="button" data-approve' +
          (p.own && !cap("posts.publish") ? ' disabled title="Свой материал проверяет другой редактор"' : "") + ">Опубликовать</button>" +
          '<button class="btn btn--sm btn--ghost" type="button" data-reject>Вернуть на доработку</button>' +
          (p.authorId && cap("people.view") ? '<a class="btn btn--sm btn--ghost" href="#people" data-person="' + esc(p.authorId) + '">Автор</a>' : "") +
          "</div></article>";
      }

      function reload() {
        load(sec, "posts-queue", {}, function (res) {
          var list = res.posts || [];
          sec.body.innerHTML = list.length ? list.map(row).join("") : emptyNote("Очередь пуста: все материалы разобраны.");
          $$("[data-post]", sec.body).forEach(function (el) {
            var id = el.getAttribute("data-post");
            var note = $("[data-note]", el);
            $("[data-approve]", el).addEventListener("click", function (e) {
              act(sec, "review", { id: id, decision: "approve", note: note.value.trim() }, function () {
                el.remove();
                sec.status.textContent = "Материал опубликован, автор получил уведомление.";
                if (!$("[data-post]", sec.body)) sec.body.innerHTML = emptyNote("Очередь пуста: все материалы разобраны.");
              }, e.currentTarget);
            });
            $("[data-reject]", el).addEventListener("click", function (e) {
              if (note.value.trim().length < 5) { sec.status.textContent = "Напишите автору, что исправить."; note.focus(); return; }
              act(sec, "review", { id: id, decision: "reject", note: note.value.trim() }, function () {
                el.remove();
                sec.status.textContent = "Материал возвращён автору с замечанием.";
                if (!$("[data-post]", sec.body)) sec.body.innerHTML = emptyNote("Очередь пуста: все материалы разобраны.");
              }, e.currentTarget);
            });
          });
          bindPersonLinks(sec.body);
        });
      }
      reload();
    }

    /* опубликованное: снять материал с сайта */
    function mountPublished(panel) {
      var sec = section(panel, "published", "На сайте", "Опубликованные материалы",
        "Снять материал с сайта можно только под код из письма: запись удаляется.");
      var list = Store.remoteArticles().slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); }).slice(0, 60);
      sec.body.innerHTML = list.length
        ? '<div class="adm-table">' + list.map(function (a) {
            return '<div class="adm-row" data-pub="' + esc(a.remoteId) + '"><div><b>' + esc(a.title) + "</b><small>№ " + (a.number || "—") + " · " +
              esc(a.author.name) + " · " + esc(day(a.date)) + '</small></div><div class="adm-row__actions">' +
              '<a class="btn btn--sm btn--ghost" href="' + esc(ui.articleUrl(a.id)) + '" target="_blank" rel="noopener">Открыть</a>' +
              '<button class="btn btn--sm btn--ghost" type="button" data-remove>Снять с сайта</button></div></div>';
          }).join("") + "</div>"
        : emptyNote("Опубликованных материалов пока нет.");
      $$("[data-pub]", sec.body).forEach(function (el) {
        var btn = $("[data-remove]", el);
        btn.addEventListener("click", function () {
          if (btn.getAttribute("data-sure") !== "1") { btn.setAttribute("data-sure", "1"); btn.textContent = "Точно снять?"; return; }
          act(sec, "remove", { id: el.getAttribute("data-pub") }, function () {
            el.remove();
            sec.status.textContent = "Материал снят с сайта.";
          }, btn);
        });
      });
    }

    /* ---------------------------------------------------------- согласия */
    function mountConsentQueue(panel) {
      var sec = section(panel, "consents", "Персональные данные", "Согласия на обработку данных",
        "В сканах паспорт и адрес. Файлы лежат в закрытой папке, каждый просмотр записывается в журнал. " +
        "Проверьте: ФИО совпадает с аккаунтом; есть оба листа — на обработку и на распространение; стоят подпись и дата; " +
        "если человеку меньше 18 лет — подпись родителя или опекуна. Если в листе на распространение заполнена строка " +
        "запретов, напишите человеку и не публикуйте то, что он запретил.");
      sec.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
      $("[data-reload]", sec.tools).addEventListener("click", reload);

      function pages(c) {
        var out = "";
        for (var i = 1; i <= (c.pages || 0); i++) {
          out += '<button class="btn btn--sm btn--ghost" type="button" data-page="' + i + '">Лист ' + i + "</button>";
        }
        return out || '<span class="form__note">файла нет</span>';
      }

      function item(c) {
        var pending = c.status === "pending";
        return '<article class="adm-item" data-consent="' + esc(c.id) + '">' +
          '<div class="adm-item__top"><h3>' + esc(c.name || "Без имени") + "</h3>" + pill(CONSENT_PILL[c.status] || CONSENT_PILL.none) + "</div>" +
          '<p class="adm-item__meta">' + (c.userNumber ? "участник № " + c.userNumber + " · " : "") + esc(c.email || "") + " · " + esc(region(c.userRegion)) +
          " · отправлено " + esc(when(c.createdAt)) + (pending && waitText(c.createdAt) ? " · " + esc(waitText(c.createdAt)) : "") +
          (!pending && c.decidedBy ? " · решение: " + esc(c.decidedBy) + ", " + esc(day(c.decidedAt)) : "") + "</p>" +
          (c.note ? '<p class="adm-item__lead">Причина: ' + esc(c.note) + "</p>" : "") +
          '<div class="adm-item__actions">' + pages(c) + "</div>" +
          '<div class="adm-item__actions">' +
          (c.status !== "approved" && c.status !== "withdrawn"
            ? '<input type="text" class="adm-input" placeholder="Причина отказа — человек увидит её в кабинете" data-note maxlength="400" aria-label="Причина отказа">' : "") +
          (pending ? '<button class="btn btn--sm btn--accent" type="button" data-decide="approved">Принять</button>' +
            '<button class="btn btn--sm btn--ghost" type="button" data-decide="rejected">Отклонить</button>' : "") +
          (c.status === "approved" ? '<input type="text" class="adm-input" placeholder="Почему решение отменяется" data-note maxlength="400" aria-label="Причина отмены">' +
            '<button class="btn btn--sm btn--ghost" type="button" data-change="rejected">Отменить решение</button>' : "") +
          (c.status === "rejected" ? '<button class="btn btn--sm btn--ghost" type="button" data-change="approved">Всё-таки принять</button>' : "") +
          (c.userId && cap("people.view") ? '<a class="btn btn--sm btn--ghost" href="#people" data-person="' + esc(c.userId) + '">Карточка человека</a>' : "") +
          "</div>" + history(c.history) + "</article>";
      }

      function reload() {
        load(sec, "consent-queue", {}, function (res) {
          var list = res.consents || [];
          var waiting = list.filter(function (c) { return c.status === "pending"; });
          var done = list.filter(function (c) { return c.status !== "pending"; });
          sec.body.innerHTML =
            (waiting.length ? waiting.map(item).join("") : emptyNote("Новых согласий нет.")) +
            (done.length
              ? '<details class="adm-more"><summary>Разобранные: ' + done.length + "</summary>" + done.map(item).join("") + "</details>"
              : "");
          $$("[data-consent]", sec.body).forEach(function (el) {
            var id = el.getAttribute("data-consent");
            var note = $("[data-note]", el);
            $$("[data-page]", el).forEach(function (b) {
              b.addEventListener("click", function () { openFile(sec, "consent-file", { id: id, page: Number(b.getAttribute("data-page")) }); });
            });
            var decide = function (action, decision, btn) {
              var text = note ? note.value.trim() : "";
              if (decision === "rejected" && text.length < 5) { sec.status.textContent = "Напишите причину: человек увидит её в кабинете."; if (note) note.focus(); return; }
              act(sec, action, { id: id, decision: decision, note: text }, function () {
                sec.status.textContent = decision === "approved" ? "Согласие принято, человек получил уведомление." : "Согласие отклонено, человек получил причину.";
                reload();
              }, btn);
            };
            $$("[data-decide]", el).forEach(function (b) {
              b.addEventListener("click", function () { decide("consent-review", b.getAttribute("data-decide"), b); });
            });
            $$("[data-change]", el).forEach(function (b) {
              b.addEventListener("click", function () { decide("consent-decide", b.getAttribute("data-change"), b); });
            });
          });
          bindPersonLinks(sec.body);
        });
      }
      reload();
    }

    /* -------------------------------------------------------------- карты */
    function mountCardQueue(panel) {
      var sec = section(panel, "cards", "Пресс-карты", "Заявки и выданные карты",
        "Карта действует год. Пластик не печатается: у автора в кабинете документ о присвоении, подлинность проверяется по номеру на странице «Проверка карты».");
      sec.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
      $("[data-reload]", sec.tools).addEventListener("click", reload);

      function requestItem(c, can) {
        return '<article class="adm-item" data-card="' + esc(c.id) + '">' +
          '<div class="adm-item__top"><h3>' + esc(c.name) + "</h3>" + pill(CARD_STATE.pending) +
          (c.renewal ? pill(["продление", "status--draft"]) : "") + (c.byRole ? pill(["по должности", "status--draft"]) : "") + "</div>" +
          '<p class="adm-item__meta">' + (c.userNumber ? "участник № " + c.userNumber + " · " : "") + esc(c.email || "") + " · " + esc(c.craft || "") +
          " · " + esc(region(c.region)) + (c.access && c.access !== "Пользователь" ? " · " + esc(c.access) : "") +
          " · заявка " + esc(when(c.createdAt)) + (waitText(c.createdAt) ? " · " + esc(waitText(c.createdAt)) : "") + "</p>" +
          '<p class="adm-item__meta">Согласие на обработку данных: ' + pill(CONSENT_PILL[c.consent] || CONSENT_PILL.none) + "</p>" +
          (c.posts && c.posts.length
            ? '<details class="adm-text"><summary>Опубликованные материалы: ' + c.posts.length + "</summary><ul>" + c.posts.map(function (p) {
                return '<li><a class="link-accent" href="/article?id=' + encodeURIComponent("s:" + p.id) + '" target="_blank" rel="noopener">№ ' +
                  (p.number || "—") + " · " + esc(p.title) + "</a> · " + esc(day(p.date)) + "</li>";
              }).join("") + "</ul></details>"
            : "") +
          (can.issue
            ? '<div class="adm-item__actions">' +
              '<input type="text" class="adm-input" placeholder="Причина отказа — автор увидит её в кабинете" data-note maxlength="600" aria-label="Причина отказа">' +
              '<button class="btn btn--sm btn--accent" type="button" data-review="approve"' +
              (c.consent === "none" ? ' disabled title="Нет принятого согласия"' : "") + ">Выдать карту</button>" +
              '<button class="btn btn--sm btn--ghost" type="button" data-review="reject">Отказать</button>' +
              (cap("people.view") ? '<a class="btn btn--sm btn--ghost" href="#people" data-person="' + esc(c.userId) + '">Карточка человека</a>' : "") + "</div>"
            : "") + "</article>";
      }

      function cardRow(c, can) {
        var live = c.state === "issued";
        return '<article class="adm-item adm-item--row" data-card="' + esc(c.id) + '">' +
          '<div class="adm-item__top"><h3>' + esc(c.number) + " · " + esc(c.name) + "</h3>" + pill(CARD_STATE[c.state] || CARD_STATE.none) + "</div>" +
          '<p class="adm-item__meta">' + esc(region(c.region)) + " · выдана " + esc(day(c.issuedAt)) + (c.issuedBy ? " (" + esc(c.issuedBy) + ")" : "") +
          " · до " + esc(day(c.validUntil)) + (c.note && !live ? " · " + esc(c.note) : "") + "</p>" +
          '<div class="adm-item__actions">' +
          '<a class="btn btn--sm btn--ghost" href="/card-doc?id=' + encodeURIComponent(c.id) + '" target="_blank" rel="noopener">Документ</a>' +
          ((can.revoke && (live || c.state === "suspended" || c.state === "expired")) || (can.revoke && live)
            ? '<input type="text" class="adm-input" placeholder="Причина — для приостановки и отзыва" data-note maxlength="400" aria-label="Причина">' : "") +
          (can.revoke && live ? '<button class="btn btn--sm btn--ghost" type="button" data-do="card-suspend">Приостановить</button>' : "") +
          (can.revoke && c.state === "suspended" ? '<button class="btn btn--sm btn--ghost" type="button" data-do="card-restore">Возобновить</button>' : "") +
          (can.extend && (live || c.state === "expired") ? '<button class="btn btn--sm btn--ghost" type="button" data-do="card-extend">Продлить на год</button>' : "") +
          (can.revoke && (live || c.state === "suspended" || c.state === "expired") ? '<button class="btn btn--sm btn--ghost" type="button" data-do="card-revoke">Отозвать</button>' : "") +
          "</div>" + history(c.history) + "</article>";
      }

      function reload() {
        load(sec, "card-queue", {}, function (res) {
          var can = res.can || {};
          var list = res.requests || [];
          var waiting = list.filter(function (c) { return c.state === "pending"; });
          var cards = list.filter(function (c) { return c.number; });
          var active = cards.filter(function (c) { return c.state === "issued" || c.state === "suspended" || c.state === "expired"; });
          var closed = cards.filter(function (c) { return active.indexOf(c) === -1; });
          sec.body.innerHTML =
            (waiting.length ? waiting.map(function (c) { return requestItem(c, can); }).join("") : emptyNote("Новых заявок на карту нет.")) +
            '<h3 class="adm-sub">Выданные карты: ' + active.length + "</h3>" +
            (active.length ? active.map(function (c) { return cardRow(c, can); }).join("") : emptyNote("Действующих карт пока нет.")) +
            (closed.length
              ? '<details class="adm-more"><summary>Отозванные и заменённые: ' + closed.length + "</summary>" +
                closed.map(function (c) { return cardRow(c, can); }).join("") + "</details>"
              : "");
          $$("[data-card]", sec.body).forEach(function (el) {
            var id = el.getAttribute("data-card");
            var note = $("[data-note]", el);
            $$("[data-review]", el).forEach(function (b) {
              b.addEventListener("click", function () {
                var decision = b.getAttribute("data-review");
                var text = note ? note.value.trim() : "";
                if (decision === "reject" && text.length < 5) { sec.status.textContent = "Напишите причину отказа."; note.focus(); return; }
                act(sec, "card-review", { id: id, decision: decision, note: text }, function (r) {
                  sec.status.textContent = decision === "approve" ? "Карта выдана: " + r.request.number + ". Автор получил уведомление." : "В заявке отказано, автор получил причину.";
                  reload();
                }, b);
              });
            });
            $$("[data-do]", el).forEach(function (b) {
              b.addEventListener("click", function () {
                var action = b.getAttribute("data-do");
                var text = note ? note.value.trim() : "";
                if ((action === "card-suspend" || action === "card-revoke") && text.length < 5) {
                  sec.status.textContent = "Напишите причину: владелец карты увидит её в кабинете."; if (note) note.focus(); return;
                }
                if (action === "card-revoke" && b.getAttribute("data-sure") !== "1") { b.setAttribute("data-sure", "1"); b.textContent = "Точно отозвать?"; return; }
                act(sec, action, { id: id, note: text }, function () { sec.status.textContent = "Готово, владелец карты получил уведомление."; reload(); }, b);
              });
            });
          });
          bindPersonLinks(sec.body);
        });
      }
      reload();
    }

    /* ------------------------------------------------------------ редакции */
    function mountEditorialsTab(panel) {
      if (has("editorialOpen")) mountEditorialOpenQueue(panel);
      if (has("reports") && window.SCReports && window.SCReports.admin) window.SCReports.admin(panel, user, ui, kit());
      if (has("editorialApps")) legacy.editorialApps(panel);
      if (cap("editorials.open") || has("editorialApps")) mountEditorialsAll(panel);
    }

    /* Действующие редакции: штат, смена руководителя, закрытие. Решения — у директора. */
    function mountEditorialsAll(panel) {
      var sec = section(panel, "editorial-all", "Редакции", "Действующие редакции",
        "Сменить руководителя или закрыть редакцию может директор проекта. Новым руководителем становится участник этой редакции; " +
        "при закрытии люди остаются авторами проекта, а их материалы проверяет центральная редакция.");
      sec.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
      $("[data-reload]", sec.tools).addEventListener("click", reload);

      function reload() {
        load(sec, "editorial-all", {}, function (res) {
          var list = res.editorials || [];
          sec.body.innerHTML = list.length ? list.map(function (e) {
            var others = e.roster.filter(function (m) { return !m.head; });
            return '<article class="adm-item" data-ed="' + esc(e.id) + '">' +
              '<div class="adm-item__top"><h3>' + esc(e.name) + "</h3>" +
              (e.headId ? "" : '<span class="status status--bad">без руководителя</span>') + "</div>" +
              '<p class="adm-item__meta">' + esc(region(e.region)) + " · руководитель — " + esc(e.headName || "не назначен") +
              " · в штате " + e.roster.length + " · открыта " + esc(day(e.createdAt)) + "</p>" +
              '<p class="adm-item__meta">Штат: ' + (e.roster.length ? e.roster.map(function (m) { return esc(m.name) + (m.head ? " (руководитель)" : ""); }).join(", ") : "никого") + "</p>" +
              (res.canDecide
                ? '<div class="adm-item__actions">' +
                  (others.length
                    ? '<select class="adm-input" data-new-head aria-label="Новый руководитель">' + others.map(function (m) {
                        return '<option value="' + esc(m.id) + '">' + esc(m.name) + "</option>";
                      }).join("") + '</select><button class="btn btn--sm" type="button" data-set-head>Назначить руководителем</button>'
                    : '<span class="form__note">Сменить руководителя можно, когда в редакции есть другие участники.</span>') +
                  "</div>" +
                  '<div class="adm-item__actions"><input type="text" class="adm-input" placeholder="Причина закрытия — участники получат её в уведомлении" data-close-note maxlength="400" aria-label="Причина закрытия">' +
                  '<button class="btn btn--sm btn--ghost" type="button" data-close>Закрыть редакцию</button></div>'
                : "") +
              "</article>";
          }).join("") : emptyNote("Действующих редакций пока нет.");
          $$("[data-ed]", sec.body).forEach(function (el) {
            var id = el.getAttribute("data-ed");
            var setHead = $("[data-set-head]", el);
            if (setHead) setHead.addEventListener("click", function () {
              act(sec, "editorial-head", { id: id, userId: $("[data-new-head]", el).value }, function (r) {
                sec.status.textContent = "Руководитель редакции — " + r.headName + ". Оба человека получили уведомления.";
                reload();
              }, setHead);
            });
            var close = $("[data-close]", el);
            if (close) close.addEventListener("click", function () {
              var note = $("[data-close-note]", el).value.trim();
              if (note.length < 5) { sec.status.textContent = "Напишите причину закрытия: участники получат её в уведомлении."; $("[data-close-note]", el).focus(); return; }
              if (close.getAttribute("data-sure") !== "1") {
                close.setAttribute("data-sure", "1");
                close.textContent = "Точно закрыть?";
                sec.status.textContent = "Редакция уйдёт в архив, участники останутся авторами проекта. Нажмите ещё раз, чтобы закрыть.";
                return;
              }
              act(sec, "editorial-close", { id: id, note: note }, function () {
                sec.status.textContent = "Редакция закрыта, участники получили уведомление.";
                reload();
              }, close);
            });
          });
        });
      }
      reload();
    }

    function mountEditorialOpenQueue(panel) {
      var sec = section(panel, "editorial-open", "Новые редакции", "Заявления на открытие редакции",
        "Руководитель заполняет анкету, печатает заявление, подписывает и присылает скан на почту. " +
        "Когда письмо пришло — отметьте «Документ получен». Решение принимает только директор.");
      sec.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
      $("[data-reload]", sec.tools).addEventListener("click", reload);

      function item(a, res) {
        var f = a.form || {};
        var open = a.status === "awaiting" || a.status === "review";
        return '<article class="adm-item" data-open="' + esc(a.id) + '">' +
          '<div class="adm-item__top"><h3>' + esc(a.number) + " · " + esc(f.name || "без названия") + "</h3>" + pill(OPEN_STATE[a.status] || ["—", "status--draft"]) + "</div>" +
          facts([
            ["Регион", region(f.region) + (f.city ? ", " + f.city : "")],
            ["База", ((res.bases || {})[f.base] || "") + (f.baseName ? ": " + f.baseName : "")],
            ["Руководитель", f.headName + (f.headBirth ? ", род. " + day(f.headBirth) : "")],
            ["Аккаунт", a.applicant.name + " · " + a.applicant.email],
            ["Телефон", f.headPhone],
            ["Куратор", f.curator && f.curator.name ? f.curator.name + ", " + f.curator.role + ", " + f.curator.phone : ""],
            ["Команда", (f.team || []).length + " чел.: " + (f.team || []).map(function (m) { return m.name + " (" + (m.role || "участник") + ", " + m.age + ")"; }).join("; ")],
            ["Подано", when(a.submittedAt)],
            ["Документ получен", a.receivedAt ? when(a.receivedAt) + (a.receivedBy ? ", " + a.receivedBy : "") : ""],
            ["Решение", a.decidedAt ? day(a.decidedAt) + ", " + (a.decidedBy || "") + (a.note ? ": " + a.note : "") : ""],
          ]) +
          '<details class="adm-text"><summary>О редакции</summary><p>' + esc(f.about || "") + "</p>" +
          (f.plan ? "<p><b>План выпуска:</b> " + esc(f.plan) + "</p>" : "") + (f.links ? "<p><b>Ссылки:</b> " + esc(f.links) + "</p>" : "") + "</details>" +
          '<div class="adm-item__actions">' +
          '<a class="btn btn--sm btn--ghost" href="/editorial-doc?id=' + encodeURIComponent(a.id) + '" target="_blank" rel="noopener">Открыть заявление</a>' +
          (open ? '<input type="text" class="adm-input" placeholder="Что исправить или причина отказа" data-note maxlength="600" aria-label="Замечание или причина">' : "") +
          (a.status === "awaiting" ? '<button class="btn btn--sm btn--accent" type="button" data-do="editorial-open-received">Документ получен</button>' : "") +
          (open ? '<button class="btn btn--sm btn--ghost" type="button" data-do="editorial-open-return">Вернуть на доработку</button>' : "") +
          (a.status === "review" && res.canDecide
            ? '<button class="btn btn--sm btn--accent" type="button" data-decide="approved">Открыть редакцию</button>' +
              '<button class="btn btn--sm btn--ghost" type="button" data-decide="rejected">Отказать</button>'
            : "") +
          (a.status === "review" && !res.canDecide ? '<span class="form__note">Ждёт решения директора.</span>' : "") +
          "</div>" + history(a.history) + "</article>";
      }

      function reload() {
        load(sec, "editorial-open-queue", {}, function (res) {
          var list = res.applications || [];
          var live = list.filter(function (a) { return a.status === "awaiting" || a.status === "review"; });
          var done = list.filter(function (a) { return live.indexOf(a) === -1; });
          sec.body.innerHTML =
            '<p class="adm-sec__text">Почта для подписанных заявлений: <b>' + esc(res.mailTo) + "</b></p>" +
            (live.length ? live.map(function (a) { return item(a, res); }).join("") : emptyNote("Новых заявлений нет.")) +
            (done.length ? '<details class="adm-more"><summary>Решённые: ' + done.length + "</summary>" + done.map(function (a) { return item(a, res); }).join("") + "</details>" : "");
          $$("[data-open]", sec.body).forEach(function (el) {
            var id = el.getAttribute("data-open");
            var note = $("[data-note]", el);
            $$("[data-do]", el).forEach(function (b) {
              b.addEventListener("click", function () {
                var action = b.getAttribute("data-do");
                var text = note ? note.value.trim() : "";
                if (action === "editorial-open-return" && text.length < 5) { sec.status.textContent = "Напишите, что исправить."; note.focus(); return; }
                act(sec, action, { id: id, note: text }, function () {
                  sec.status.textContent = action === "editorial-open-received" ? "Отмечено. Заявление передано директору." : "Заявление возвращено заявителю.";
                  reload();
                }, b);
              });
            });
            $$("[data-decide]", el).forEach(function (b) {
              b.addEventListener("click", function () {
                var decision = b.getAttribute("data-decide");
                var text = note ? note.value.trim() : "";
                if (decision === "rejected" && text.length < 5) { sec.status.textContent = "Напишите причину отказа."; note.focus(); return; }
                act(sec, "editorial-open-decide", { id: id, decision: decision, note: text }, function () {
                  sec.status.textContent = decision === "approved" ? "Редакция открыта, руководитель получил роль и уведомление." : "В открытии отказано, заявитель получил причину.";
                  reload();
                }, b);
              });
            });
          });
        });
      }
      reload();
    }

    /* ---------------------------------------------------------------- люди */
    var openPerson = null;

    function bindPersonLinks(scope) {
      $$("[data-person]", scope).forEach(function (a) {
        if (a.getAttribute("data-bound")) return;
        a.setAttribute("data-bound", "1");
        a.addEventListener("click", function () {
          var id = a.getAttribute("data-person");
          try { window.sessionStorage.setItem("smena_admin_person", id); } catch (e) {}
          if (mounted.people && openPerson) setTimeout(function () { openPerson(id); }, 30);
        });
      });
    }

    function mountPeople(panel) {
      var sec = section(panel, "people", "Участники", scoped ? "Люди вашей редакции" : "Люди проекта",
        scoped ? "Вы видите только своих людей: участников вашей редакции или региона."
               : "Поиск по имени, почте и номеру. Нажмите на строку, чтобы открыть карточку человека.");
      var card = document.createElement("section");
      card.className = "adm-sec wrap adm-person";
      card.setAttribute("data-adm", "person");
      card.hidden = true;
      panel.insertBefore(card, sec.el);

      var users = [];
      var roles = [];
      var myLevel = 0;

      sec.tools.innerHTML =
        '<input type="search" class="adm-input" placeholder="Имя, почта или №" data-search aria-label="Поиск по людям">' +
        '<select class="adm-input" data-filter aria-label="Фильтр">' +
        '<option value="">Все</option><option value="staff">Сотрудники</option><option value="consent-pending">Согласие на проверке</option>' +
        '<option value="consent-none">Без согласия</option><option value="card">С картой</option><option value="suspended">Приостановленные</option>' +
        '<option value="unverified">Почта не подтверждена</option></select>';
      $("[data-search]", sec.tools).addEventListener("input", draw);
      $("[data-filter]", sec.tools).addEventListener("change", draw);

      function draw() {
        var q = $("[data-search]", sec.tools).value.trim().toLowerCase();
        var f = $("[data-filter]", sec.tools).value;
        var list = users.filter(function (u) {
          if (q && (u.name + " " + u.email + " " + u.number).toLowerCase().indexOf(q) === -1) return false;
          if (f === "staff") return u.level > 5;
          if (f === "consent-pending") return u.consent === "pending";
          if (f === "consent-none") return u.consent === "none" || u.consent === "rejected";
          if (f === "card") return u.cardStatus === "issued";
          if (f === "suspended") return u.status === "suspended";
          if (f === "unverified") return !u.emailVerified;
          return true;
        });
        sec.body.innerHTML =
          '<p class="adm-sec__text">Показано: ' + list.length + " из " + users.length + "</p>" +
          (list.length
            ? '<div class="adm-table adm-table--people">' + list.slice(0, 300).map(function (u) {
                return '<button class="adm-row adm-row--btn" type="button" data-user="' + esc(u.id) + '">' +
                  "<div><b>" + esc(u.name) + "</b><small>№ " + u.number + " · " + esc(u.email || "почта скрыта") + " · " + esc(region(u.region)) +
                  (u.editorialName ? " · " + esc(u.editorialName) : "") + "</small></div>" +
                  '<div class="adm-row__pills">' +
                  (u.access !== "Пользователь" ? pill([u.access, "status--pub"]) : "") +
                  (u.status === "suspended" ? pill(["приостановлен", "status--bad"]) : "") +
                  (!u.emailVerified ? pill(["почта не подтверждена", "status--draft"]) : "") +
                  '<span class="adm-row__kv">согласие ' + pill(CONSENT_PILL[u.consent] || CONSENT_PILL.none) + "</span>" +
                  '<span class="adm-row__kv">карта ' + pill(CARD_STATE[u.cardStatus] || CARD_STATE.none) + "</span>" +
                  '<span class="adm-row__kv">' + u.points + " б.</span></div></button>";
              }).join("") + "</div>"
            : emptyNote("Никого не нашлось."));
        $$("[data-user]", sec.body).forEach(function (b) {
          b.addEventListener("click", function () { openPerson(b.getAttribute("data-user")); });
        });
      }

      function reload(then) {
        load(sec, "users", {}, function (res) {
          users = (res.users || []).slice().reverse();
          roles = res.roles || [];
          myLevel = res.myLevel || 0;
          draw();
          if (then) then();
        });
      }

      /* ---- карточка человека ---- */
      openPerson = function (id) {
        card.hidden = false;
        card.innerHTML = '<p class="no-data">Открываем карточку…</p>';
        try { card.scrollIntoView({ block: "start" }); } catch (e) {}
        Store.callStaff("user-card", { id: id }).then(function (res) {
          if (!res || !res.ok) { card.innerHTML = emptyNote((res && res.error) || "Карточка не открылась."); return; }
          drawPerson(res);
        });
      };

      function drawPerson(d) {
        var u = d.user;
        var self = u.id === user.id;
        var lower = (u.level || 0) < myLevel || myLevel >= 100;
        var c = d.card;
        var consent = d.consent || { status: "none" };
        var consentKey = consent.exempt ? "exempt" : consent.status;
        var roleOptions = roles.filter(function (r) { return true; }).map(function (r) {
          return "<option" + (r === u.access ? " selected" : "") + ">" + esc(r) + "</option>";
        }).join("");

        var html =
          '<header class="adm-sec__head"><div><span class="kicker">Карточка человека</span><h2>' + esc(u.name) + "</h2>" +
          '<p class="adm-sec__text">№ ' + u.number + " · " + esc(u.access) + (d.status === "suspended" ? " · " + pill(["приостановлен", "status--bad"]) : "") + "</p></div>" +
          '<div class="adm-sec__tools"><button class="btn btn--sm btn--ghost" type="button" data-close>Закрыть</button></div></header>' +
          '<div data-confirm-slot style="display:none"></div><p class="form__note adm-sec__status" data-adm-status role="status"></p>' +
          '<div class="adm-person__grid"><div>' +
          facts([
            ["Почта", (u.email || "—") + (u.emailVerified ? "" : " (не подтверждена)")],
            ["Регион", region(u.region)],
            ["Направление", u.role],
            ["Редакция", d.editorial ? d.editorial.name : ""],
            ["Регистрация", day(u.createdAt)],
            ["Был на сайте", d.lastSeen ? when(d.lastSeen) : "нет данных"],
            ["Материалы", d.published + " опубликовано из " + d.posts.length],
            ["Баллы", String(d.points)],
            ["Причина приостановки", d.status === "suspended" ? d.statusReason : ""],
          ]) +

          /* согласие */
          '<div class="adm-box"><h3>Согласие на обработку данных ' + pill(CONSENT_PILL[consentKey] || CONSENT_PILL.none) + "</h3>" +
          (consent.createdAt ? '<p class="adm-item__meta">Отправлено ' + esc(day(consent.createdAt)) +
            (consent.decidedBy ? " · решение: " + esc(consent.decidedBy) + ", " + esc(day(consent.decidedAt)) : "") + "</p>" : "") +
          (consent.note ? '<p class="adm-item__meta">Причина: ' + esc(consent.note) + "</p>" : "") +
          (cap("consents.review") && consent.id && !self
            ? '<div class="adm-item__actions">' + pagesButtons(consent) +
              (consent.status !== "withdrawn" ? '<input type="text" class="adm-input" placeholder="Причина — для отказа или отмены решения" data-consent-note maxlength="400" aria-label="Причина">' : "") +
              (consent.status === "pending" || consent.status === "rejected" ? '<button class="btn btn--sm btn--accent" type="button" data-consent-decide="approved">Принять</button>' : "") +
              (consent.status === "pending" ? '<button class="btn btn--sm btn--ghost" type="button" data-consent-decide="rejected">Отклонить</button>' : "") +
              (consent.status === "approved" ? '<button class="btn btn--sm btn--ghost" type="button" data-consent-decide="rejected">Отменить решение</button>' : "") + "</div>"
            : "") + "</div>" +

          /* карта */
          '<div class="adm-box"><h3>Пресс-карта ' + pill(CARD_STATE[d.cardState] || CARD_STATE.none) + "</h3>" +
          (c && c.number ? '<p class="adm-item__meta">' + esc(c.number) + " · выдана " + esc(day(c.issuedAt)) + " · до " + esc(day(c.validUntil)) +
            (c.note && d.cardState !== "issued" ? " · " + esc(c.note) : "") + "</p>" : "") +
          '<div class="adm-item__actions">' +
          (c && c.number ? '<a class="btn btn--sm btn--ghost" href="/card-doc?id=' + encodeURIComponent(c.id) + '" target="_blank" rel="noopener">Документ</a>' : "") +
          (cap("cards.issue") && !self && d.cardState !== "issued" && d.cardState !== "suspended"
            ? '<button class="btn btn--sm btn--accent" type="button" data-card-grant' +
              (consentKey !== "approved" && consentKey !== "exempt" ? ' disabled title="Нет принятого согласия"' : "") + ">Выдать карту по должности</button>" : "") +
          (c && c.number && !self && (cap("cards.revoke") || cap("cards.extend")) ? '<a class="btn btn--sm btn--ghost" href="#cards">Приостановить, продлить, отозвать →</a>' : "") +
          "</div></div>" +
          "</div><div>" +

          /* действия */
          (d.canMessage
            ? '<div class="adm-box"><h3>Написать человеку</h3><textarea class="adm-input" rows="3" maxlength="2000" data-msg placeholder="Сообщение придёт в кабинет и на почту" aria-label="Сообщение"></textarea>' +
              '<div class="adm-item__actions"><button class="btn btn--sm" type="button" data-msg-send>Отправить</button></div></div>'
            : "") +
          (cap("people.access") && !self && lower
            ? '<div class="adm-box"><h3>Роль</h3><div class="adm-item__actions"><select class="adm-input" data-role aria-label="Роль">' + roleOptions + "</select>" +
              '<button class="btn btn--sm" type="button" data-role-save>Сохранить роль</button></div>' +
              '<p class="form__note">Выдать можно роль не выше своей. Человеку нужно войти заново, чтобы права обновились.</p></div>'
            : "") +
          (cap("people.block") && !self && lower
            ? '<div class="adm-box"><h3>Доступ</h3><div class="adm-item__actions">' +
              (d.status === "suspended"
                ? '<button class="btn btn--sm" type="button" data-status="active">Восстановить аккаунт</button>'
                : '<input type="text" class="adm-input" placeholder="Причина приостановки" data-status-reason maxlength="300" aria-label="Причина приостановки">' +
                  '<button class="btn btn--sm btn--ghost" type="button" data-status="suspended">Приостановить</button>') + "</div></div>"
            : "") +
          (cap("points.award")
            ? '<div class="adm-box"><h3>Баллы</h3><div class="adm-item__actions">' +
              '<input type="number" class="adm-input adm-input--num" placeholder="+10 или −5" data-points aria-label="Сколько баллов">' +
              '<input type="text" class="adm-input" placeholder="За что (для списания обязательно)" data-points-note maxlength="300" aria-label="Основание">' +
              '<button class="btn btn--sm" type="button" data-points-add>Начислить</button></div></div>'
            : "") +
          (cap("people.edit") && !self && lower
            ? '<div class="adm-box"><h3>Профиль</h3><div class="adm-item__actions">' +
              '<input type="text" class="adm-input" value="' + esc(u.name) + '" data-edit-name maxlength="80" aria-label="Имя">' +
              (d.contacts ? '<input type="email" class="adm-input" value="' + esc(u.email) + '" data-edit-email aria-label="Почта">' : "") +
              '<button class="btn btn--sm btn--ghost" type="button" data-edit-save>Сохранить</button></div>' +
              '<p class="form__note">Если изменить почту, человеку придётся подтвердить новый адрес кодом из письма.</p></div>'
            : "") +
          (cap("people.note")
            ? '<div class="adm-box"><h3>Заметки редакции</h3>' +
              (d.notes.length ? "<ul class=\"adm-notes\">" + d.notes.map(function (n) {
                return "<li>" + esc(n.text) + " <small>" + esc(n.by) + ", " + esc(day(n.at)) + "</small></li>";
              }).join("") + "</ul>" : '<p class="form__note">Заметок нет. Человек их не видит.</p>') +
              '<div class="adm-item__actions"><input type="text" class="adm-input" placeholder="Новая заметка" data-note-text maxlength="1000" aria-label="Заметка">' +
              '<button class="btn btn--sm btn--ghost" type="button" data-note-add>Добавить</button></div></div>'
            : "") +
          "</div></div>" +

          '<details class="adm-more"><summary>Материалы: ' + d.posts.length + "</summary>" +
          (d.posts.length ? '<ul class="adm-notes">' + d.posts.map(function (p) {
            return "<li>№ " + (p.number || "—") + " · " + esc(p.title) + " · " + esc(p.status) + " · " + esc(day(p.date)) + "</li>";
          }).join("") + "</ul>" : '<p class="form__note">Материалов нет.</p>') + "</details>" +
          '<details class="adm-more"><summary>Хронология</summary><ul class="adm-notes">' +
          (d.timeline || []).slice(0, 40).map(function (e) { return "<li>" + esc(day(e.at)) + " · " + esc(e.text) + "</li>"; }).join("") + "</ul></details>";

        card.innerHTML = html;
        var psec = { el: card, body: card, status: $("[data-adm-status]", card), slot: $("[data-confirm-slot]", card) };
        var again = function (text) { return function () { openPerson(u.id); reload(); setTimeout(function () { var s = $("[data-adm-status]", card); if (s) s.textContent = text; }, 400); }; };

        $("[data-close]", card).addEventListener("click", function () { card.hidden = true; card.innerHTML = ""; });
        $$("[data-page]", card).forEach(function (b) {
          b.addEventListener("click", function () { openFile(psec, "consent-file", { id: consent.id, page: Number(b.getAttribute("data-page")) }); });
        });
        $$("[data-consent-decide]", card).forEach(function (b) {
          b.addEventListener("click", function () {
            var decision = b.getAttribute("data-consent-decide");
            var note = $("[data-consent-note]", card);
            var text = note ? note.value.trim() : "";
            if (decision === "rejected" && text.length < 5) { psec.status.textContent = "Напишите причину: человек увидит её в кабинете."; note.focus(); return; }
            act(psec, "consent-decide", { userId: u.id, decision: decision, note: text }, again("Решение по согласию сохранено."), b);
          });
        });
        bindOne("[data-card-grant]", function (b) { act(psec, "card-grant", { id: u.id }, again("Карта выдана."), b); });
        bindOne("[data-msg-send]", function (b) {
          var text = $("[data-msg]", card).value.trim();
          if (text.length < 3) { psec.status.textContent = "Напишите сообщение."; return; }
          act(psec, "user-message", { id: u.id, text: text }, again("Сообщение отправлено."), b);
        });
        bindOne("[data-role-save]", function (b) {
          act(psec, "user-access", { id: u.id, access: $("[data-role]", card).value }, again("Роль сохранена."), b);
        });
        $$("[data-status]", card).forEach(function (b) {
          b.addEventListener("click", function () {
            var status = b.getAttribute("data-status");
            var reason = $("[data-status-reason]", card);
            if (status === "suspended" && (!reason || reason.value.trim().length < 5)) { psec.status.textContent = "Напишите причину приостановки."; if (reason) reason.focus(); return; }
            act(psec, "person-status", { userId: u.id, status: status, reason: reason ? reason.value.trim() : "" },
              again(status === "suspended" ? "Аккаунт приостановлен, все его сессии закрыты." : "Аккаунт восстановлен."), b);
          });
        });
        bindOne("[data-points-add]", function (b) {
          var delta = Number($("[data-points]", card).value) || 0;
          if (!delta) { psec.status.textContent = "Укажите число баллов: со знаком минус — списание."; return; }
          act(psec, "points-add", { userId: u.id, delta: delta, reason: "manual", note: $("[data-points-note]", card).value.trim() }, again("Баллы изменены."), b);
        });
        bindOne("[data-edit-save]", function (b) {
          var payload = { id: u.id, name: $("[data-edit-name]", card).value.trim() };
          var email = $("[data-edit-email]", card);
          if (email && email.value.trim() && email.value.trim() !== u.email) payload.email = email.value.trim();
          act(psec, "user-update", payload, again("Профиль сохранён."), b);
        });
        bindOne("[data-note-add]", function (b) {
          var text = $("[data-note-text]", card).value.trim();
          if (text.length < 5) { psec.status.textContent = "Заметка слишком короткая."; return; }
          act(psec, "person-note", { userId: u.id, text: text }, again("Заметка добавлена."), b);
        });

        function bindOne(sel, fn) {
          var b = $(sel, card);
          if (b) b.addEventListener("click", function () { fn(b); });
        }
      }

      function pagesButtons(c) {
        var out = "";
        for (var i = 1; i <= (c.pages || 0); i++) out += '<button class="btn btn--sm btn--ghost" type="button" data-page="' + i + '">Лист ' + i + "</button>";
        return out;
      }

      /* выдать доступ по почте: человеку, которого ещё нет в списке */
      if (cap("people.access")) {
        var grant = section(panel, "grant", "Команда", "Выдать доступ по почте",
          "Если аккаунта с такой почтой ещё нет, он создаётся, а человеку уходит письмо с временным паролем.");
        grant.body.innerHTML =
          '<div class="adm-item__actions"><input type="email" class="adm-input" placeholder="Почта" data-grant-email aria-label="Почта">' +
          '<select class="adm-input" data-grant-role aria-label="Роль"><option value="">Роль</option>' +
          ["Сотрудник", "Модератор", "Главный редактор", "Технический администратор", "Администратор", "Администрация", "Главный администратор", "Директор"]
            .map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select>" +
          '<button class="btn btn--sm" type="button" data-grant-go>Выдать доступ</button></div>';
        $("[data-grant-go]", grant.body).addEventListener("click", function (e) {
          var email = $("[data-grant-email]", grant.body).value.trim();
          var role = $("[data-grant-role]", grant.body).value;
          if (!email || !role) { grant.status.textContent = "Укажите почту и роль."; return; }
          act(grant, "boss-grant", { email: email, access: role }, function (res) {
            grant.status.textContent = res.note || "Доступ выдан.";
            reload();
          }, e.currentTarget);
        });
      }

      reload(function () {
        var want = "";
        try { want = window.sessionStorage.getItem("smena_admin_person") || ""; window.sessionStorage.removeItem("smena_admin_person"); } catch (e) {}
        if (want) openPerson(want);
      });
    }

    /* ------------------------------------------------- поддержка и почта */
    function mountSupportTab(panel) {
      if (has("support")) legacy.support(panel);
      if (has("recovery")) mountRecovery(panel);
      if (user.canUseMail) legacy.mail(panel);
      if (cap("mail.manage")) legacy.mailSettings(panel);
    }

    function mountRecovery(panel) {
      var sec = section(panel, "recovery", "Доступ", "Заявки на восстановление доступа",
        "Человек потерял пароль и код восстановления. Новый код уходит ему письмом; если почта не настроена, код покажется здесь — передайте его лично.");
      function reload() {
        load(sec, "recovery-queue", {}, function (res) {
          var list = res.requests || [];
          sec.body.innerHTML = list.length
            ? list.map(function (r) {
                return '<article class="adm-item" data-rec="' + esc(r.id) + '"><div class="adm-item__top"><h3>' + esc(r.email) + "</h3></div>" +
                  '<p class="adm-item__meta">' + esc(when(r.createdAt)) + (r.note ? " · " + esc(r.note) : "") + "</p>" +
                  '<div class="adm-item__actions"><button class="btn btn--sm btn--accent" type="button" data-issue>Выдать новый код</button>' +
                  '<input type="text" class="adm-input" placeholder="Почему закрываем без кода" data-note maxlength="300" aria-label="Причина">' +
                  '<button class="btn btn--sm btn--ghost" type="button" data-close>Закрыть</button></div></article>';
              }).join("")
            : emptyNote("Заявок нет.");
          $$("[data-rec]", sec.body).forEach(function (el) {
            var id = el.getAttribute("data-rec");
            $("[data-issue]", el).addEventListener("click", function (e) {
              act(sec, "recovery-issue", { id: id }, function (r) {
                reload();
                setTimeout(function () {
                  sec.status.textContent = r.mailed ? "Новый код отправлен на " + r.email + "." : "Почта не отправилась. Код для " + r.email + ": " + r.code;
                }, 300);
              }, e.currentTarget);
            });
            $("[data-close]", el).addEventListener("click", function (e) {
              act(sec, "recovery-close", { id: id, note: $("[data-note]", el).value.trim() }, function () { reload(); }, e.currentTarget);
            });
          });
        });
      }
      reload();
    }

    /* ---------------------------------------------------------------- сайт */
    function mountSiteTab(panel) {
      legacy.site(panel);
      legacy.authorsShow(panel);
      mountFoundersEditor(panel);
    }

    function mountFoundersEditor(panel) {
      var sec = section(panel, "founders", "О проекте", "Основатели",
        "Карточки на страницах «О проекте» и «Основатели». Пустое поле не затирает текст, зашитый в сайт.");
      function field(label, name, value, extra) {
        return '<div class="field"><label>' + esc(label) + '</label><input type="text" data-f="' + name + '" value="' + esc(value || "") + '" ' + (extra || "") + "></div>";
      }
      function draw() {
        var list = (SC.founders || []).slice(0, 4);
        sec.body.innerHTML = list.map(function (f, i) {
          return '<div class="adm-box" data-founder="' + esc(f.id || "f" + (i + 1)) + '"><h3>' + esc(f.name || "Основатель " + (i + 1)) + "</h3>" +
            '<div class="form">' + field("ФИО", "name", f.name, 'maxlength="120"') + field("Роль в проекте", "role", f.role, 'maxlength="120"') +
            field("Город", "city", f.city, 'maxlength="60"') + field("На проекте с", "since", f.since, 'maxlength="40"') +
            field("Фото: ссылка", "photo", f.photo, 'maxlength="400" placeholder="/api/index.php?action=media&id=… или https://…"') +
            field("Второе фото (при наведении)", "photoAlt", f.photoAlt, 'maxlength="400"') +
            '<div class="field form__full"><label>Биография (абзацы — через пустую строку)</label><textarea data-f="bio" rows="6" maxlength="3000">' +
            esc(f.bio || "") + "</textarea></div>" +
            '<div class="form__full adm-item__actions"><input type="file" accept="image/*" data-photo-file aria-label="Загрузить фото">' +
            '<span class="form__note" data-photo-note></span></div></div></div>';
        }).join("") +
          '<div class="adm-item__actions"><button class="btn" type="button" data-save>Сохранить основателей</button></div>';
        $$("[data-founder]", sec.body).forEach(function (box) {
          var file = $("[data-photo-file]", box);
          file.addEventListener("change", function () {
            var note = $("[data-photo-note]", box);
            if (!file.files[0]) return;
            note.textContent = "Загружаем фото…";
            Store.uploadMedia(file.files[0]).then(function (url) {
              $('[data-f="photo"]', box).value = url;
              note.textContent = "Фото загружено. Не забудьте сохранить.";
            }, function (err) { note.textContent = (err && err.message) || "Фото не загрузилось."; });
          });
        });
        $("[data-save]", sec.body).addEventListener("click", function (e) {
          var payload = $$("[data-founder]", sec.body).map(function (box) {
            var row = { id: box.getAttribute("data-founder") };
            $$("[data-f]", box).forEach(function (el) { row[el.getAttribute("data-f")] = el.value.trim(); });
            return row;
          });
          act(sec, "founders-save", { founders: payload }, function (res) {
            sec.status.textContent = "Сохранено. Страницы «О проекте» и «Основатели» покажут новый текст.";
            SC.founders = (res.founders || []).map(function (f) { return f; });
          }, e.currentTarget);
        });
      }
      /* показываем то же, что видит посетитель: зашитый текст + сохранённое в панели */
      Store.founders().then(function (remote) {
        var base = (SC.founders || []).slice();
        (remote || []).forEach(function (r, i) {
          var target = null;
          base.forEach(function (b, j) { if (!target && (b.id === r.id || b.name === r.name || (j === i && /^f\d+$/.test(String(r.id))))) target = b; });
          if (!target) return;
          Object.keys(r).forEach(function (k) {
            var text = k === "role" || k === "bio" || k === "name" || k === "since";
            if (String(r[k] == null ? "" : r[k]).trim() === "") return;
            if (text && !r.edited && String(target[k] || "").trim()) return;
            if (k !== "id") target[k] = r[k];
          });
        });
        SC.founders = base;
        draw();
      }, draw);
    }

    /* -------------------------------------------------------------- сервер */
    function mountServerTab(panel) {
      if (cap("server.diag")) { mountServerState(panel); mountBackups(panel); }
      if (cap("audit.view")) mountAuditLog(panel);
    }

    function mountServerState(panel) {
      var sec = section(panel, "server", "Состояние", "Сервер", "Что настроено и что требует внимания. Секретов здесь нет.");
      sec.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-reload>Проверить</button>';
      function reload() {
        load(sec, "diag", {}, function (d) {
          var yes = function (v, good, bad) { return '<b class="' + (v ? "is-good" : "is-bad") + '">' + esc(v ? good : bad) + "</b>"; };
          var rows = [
            ["Версия PHP", "<b>" + esc(d.php) + "</b>"],
            ["Данные лежат вне сайта", yes(d.data_mode === "outside_public", "да", "нет — папка внутри public_html")],
            ["Папка данных доступна для записи", yes(d.data_writable, "да", "нет")],
            ["Папка файлов доступна для записи", yes(d.uploads_writable, "да", "нет")],
            ["Почта для писем настроена", yes(d.mail_configured, d.mail_from || "да", "нет — регистрация закрыта")],
            ["Ящики домена подключены", "<b>" + d.mailboxes_ready + " из " + d.mailboxes_total + "</b>"],
            ["Стандартный пароль редакции", yes(!d.editor_default_password, "не используется", "используется — смените")],
            ["Техработы на сайте", yes(!d.maintenance, "выключены", "включены")],
            ["Аккаунтов", "<b>" + d.accounts + "</b>"],
            ["Почта не подтверждена", "<b>" + d.pending_email + "</b>"],
            ["Материалов на сервере", "<b>" + d.posts + "</b>"],
            ["Редакций", "<b>" + d.editorials + "</b>"],
            ["Время сервера", "<b>" + esc(when(d.server_time)) + "</b>"],
          ];
          sec.body.innerHTML = '<div class="diag">' + rows.map(function (r) {
            return '<div class="diag__row"><span>' + esc(r[0]) + "</span>" + r[1] + "</div>";
          }).join("") + "</div>";
        });
      }
      $("[data-reload]", sec.tools).addEventListener("click", reload);
      reload();
    }

    function mountBackups(panel) {
      var sec = section(panel, "backups", "Данные", "Резервные копии", "Копия данных делается раз в сутки сама. Перед важной правкой можно сделать ещё одну.");
      sec.tools.innerHTML = '<button class="btn btn--sm" type="button" data-now>Сделать копию сейчас</button>';
      function draw(res) {
        var list = res.copies || [];
        sec.body.innerHTML = list.length
          ? '<div class="adm-table">' + list.slice(0, 14).map(function (c) {
              return '<div class="adm-row"><div><b>' + esc(c.date) + "</b><small>файлов: " + c.files + " · " + Math.round(c.bytes / 1024) + " КБ</small></div></div>";
            }).join("") + "</div>"
          : emptyNote("Копий пока нет.");
      }
      load(sec, "backups", {}, draw);
      $("[data-now]", sec.tools).addEventListener("click", function (e) {
        act(sec, "backup-now", {}, function (res) { draw(res); sec.status.textContent = "Копия сделана."; }, e.currentTarget);
      });
    }

    function mountAuditLog(panel) {
      var sec = section(panel, "audit", "Журнал", "Кто что сделал", "Последние 120 действий сотрудников: решения, роли, просмотры сканов согласий.");
      sec.tools.innerHTML = '<input type="search" class="adm-input" placeholder="Поиск по журналу" data-search aria-label="Поиск по журналу">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
      var entries = [];
      function draw() {
        var q = $("[data-search]", sec.tools).value.trim().toLowerCase();
        var list = entries.filter(function (e) { return !q || (e.who + " " + e.action + " " + e.details).toLowerCase().indexOf(q) !== -1; });
        sec.body.innerHTML = list.length
          ? '<div class="adm-table">' + list.map(function (e) {
              return '<div class="adm-row"><div><b>' + esc(e.action) + "</b><small>" + esc(e.details || "") + '</small></div><div class="adm-row__kv">' +
                esc(e.who) + "<br>" + esc(when(e.at)) + "</div></div>";
            }).join("") + "</div>"
          : emptyNote("Записей нет.");
      }
      function reload() { load(sec, "admin-log", {}, function (res) { entries = res.entries || []; draw(); }); }
      $("[data-search]", sec.tools).addEventListener("input", draw);
      $("[data-reload]", sec.tools).addEventListener("click", reload);
      reload();
    }
  };
})();
