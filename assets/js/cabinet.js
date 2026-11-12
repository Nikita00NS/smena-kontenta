/* ============================================================================
   ЛИЧНЫЙ КАБИНЕТ (/profile)

   Вкладки вместо одной длинной страницы. Адрес вкладки — в «решётке»:
   /profile#docs открывает документы, ссылкой можно поделиться.

   Всё, что здесь показано как статус (согласие, материалы, пресс-карта,
   редакция), приходит с сервера. В браузере только черновики.

   Файл подключается перед app.js и получает от него общие помощники (ui).
   ========================================================================== */
(function () {
  "use strict";

  window.SCPages = window.SCPages || {};

  var TABS = [
    ["overview", "Обзор"],
    ["posts", "Материалы"],
    ["docs", "Документы"],
    ["card", "Пресс-карта"],
    ["editorial", "Редакция"],
    ["school", "Медиашкола"],
    ["messages", "Сообщения"],
    ["settings", "Профиль"],
  ];

  var POST_STATUS = {
    draft: ["черновик", "status--draft"],
    pending: ["на проверке", "status--pending"],
    rejected: ["нужны правки", "status--bad"],
    published: ["опубликован", "status--pub"],
  };

  var CONSENT_TEXT = {
    none: ["не загружено", "status--draft"],
    pending: ["на проверке", "status--pending"],
    approved: ["принято", "status--pub"],
    rejected: ["не принято", "status--bad"],
    withdrawn: ["отозвано", "status--draft"],
    exempt: ["не требуется", "status--pub"],
  };

  var CARD_TEXT = {
    none: ["нет", "status--draft"],
    pending: ["на рассмотрении", "status--pending"],
    issued: ["действует", "status--pub"],
    suspended: ["приостановлена", "status--bad"],
    revoked: ["отозвана", "status--bad"],
    expired: ["срок истёк", "status--bad"],
    rejected: ["отказано", "status--bad"],
    annulled: ["заменена", "status--draft"],
  };

  function pill(pair) {
    return '<span class="status ' + pair[1] + '">' + pair[0] + "</span>";
  }

  window.SCPages.profile = function (ui) {
    var $ = ui.$, $$ = ui.$$, esc = ui.esc, Store = ui.Store, SC = ui.SC;
    var host = $("[data-profile]");
    if (!host) return;
    var user = Store ? Store.currentUser() : null;
    if (!user || !Store.hasToken()) {
      window.location.replace("/join?next=profile#login");
      return;
    }

    /* состояние с сервера; до ответа — последняя сохранённая копия */
    var state = {
      consent: Store.consent(),
      card: Store.card(),
      editorial: null,
      open: null,
      points: null,
      messages: [],
      flash: "",
    };

    function consentKey() {
      if (state.consent && state.consent.exempt) return "exempt";
      return (state.consent && state.consent.status) || "none";
    }

    function consentOk() {
      return !!(state.consent && (state.consent.granted || state.consent.exempt || state.consent.status === "approved"));
    }

    function cardKey() {
      var c = state.card;
      if (!c) return "none";
      if (c.card) return c.card.state;
      if (c.request) return c.request.state;
      return "none";
    }

    function myPosts() {
      var me = Store.currentUser() || user;
      return Store.listPosts({ authorId: me.id });
    }

    function currentTab() {
      var hash = String(window.location.hash || "").replace(/^#/, "");
      for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === hash) return hash;
      return "overview";
    }

    function setTab(name) {
      if (currentTab() === name) { drawTab(); return; }
      window.location.hash = name;
    }

    /* ------------------------------------------------------------- каркас */
    function drawShell() {
      user = Store.currentUser() || user;
      document.title = user.name + " — личный кабинет";
      var avatar = user.avatar
        ? '<img class="cab-ava" src="' + esc(user.avatar) + '" alt="">'
        : '<span class="cab-ava cab-ava--mono">' + esc(Store.initials(user.name)) + "</span>";
      host.innerHTML =
        '<section class="cab-head"><div class="wrap cab-head__in">' + avatar +
        '<div class="cab-head__text"><span class="kicker">Личный кабинет</span>' +
        "<h1>" + esc(user.name) + "</h1>" +
        '<p class="cab-head__meta">' + esc(user.role || "Автор") +
        (user.region ? " · " + esc(ui.regionName(user.region)) : "") +
        (user.access && user.access !== "Пользователь" ? " · " + esc(user.access) : "") + "</p></div>" +
        '<div class="cab-head__actions">' +
        (Store.isStaff(user) ? '<a class="btn btn--sm" href="/admin">Панель проекта</a>' : "") +
        '<button class="btn btn--sm btn--ghost" type="button" data-logout>Выйти</button></div>' +
        "</div></section>" +
        '<nav class="cab-tabs" aria-label="Разделы кабинета"><div class="wrap cab-tabs__in" data-cab-tabs></div></nav>' +
        '<section class="wrap cab-body" data-cab-body></section>';
      drawTabs();
      bindCommon(host);
    }

    function badgeFor(name) {
      /* знак — только когда от человека что-то нужно; «на проверке» ждёт редакцию */
      if (name === "docs" && !consentOk() && consentKey() !== "pending") return "!";
      if (name === "posts") {
        var n = myPosts().filter(function (p) { return p.status === "rejected"; }).length;
        return n ? String(n) : "";
      }
      if (name === "messages") {
        var unread = state.messages.filter(function (m) { return !m.read; }).length;
        return unread ? String(unread) : "";
      }
      return "";
    }

    function drawTabs() {
      var nav = $("[data-cab-tabs]", host);
      if (!nav) return;
      var active = currentTab();
      nav.innerHTML = TABS.map(function (t) {
        var badge = badgeFor(t[0]);
        return '<a class="cab-tab' + (t[0] === active ? " is-on" : "") + '" href="#' + t[0] + '" data-cab-tab="' + t[0] + '"' +
          (t[0] === active ? ' aria-current="page"' : "") + ">" + t[1] +
          (badge ? '<span class="cab-tab__badge">' + esc(badge) + "</span>" : "") + "</a>";
      }).join("");
      var on = $(".cab-tab.is-on", nav);
      if (on && on.scrollIntoView && nav.scrollWidth > nav.clientWidth) {
        try { on.scrollIntoView({ block: "nearest", inline: "center" }); } catch (e) {}
      }
    }

    function bindCommon(root) {
      $$("[data-go]", root).forEach(function (b) {
        if (b.getAttribute("data-bound")) return;
        b.setAttribute("data-bound", "1");
        b.addEventListener("click", function () { setTab(b.getAttribute("data-go")); });
      });
      $$("[data-logout]", root).forEach(function (b) {
        if (b.getAttribute("data-bound")) return;
        b.setAttribute("data-bound", "1");
        b.addEventListener("click", function () {
          Store.logout();
          window.location.href = "/";
        });
      });
    }

    function drawTab() {
      var body = $("[data-cab-body]", host);
      if (!body) return;
      drawTabs();
      var name = currentTab();
      var flash = state.flash ? '<div class="cab-flash" role="status">' + esc(state.flash) + "</div>" : "";
      state.flash = "";
      body.setAttribute("data-tab", name);
      if (name === "overview") drawOverview(body, flash);
      if (name === "posts") drawPosts(body, flash);
      if (name === "docs") drawDocs(body, flash);
      if (name === "card") drawCard(body, flash);
      if (name === "editorial") drawEditorial(body, flash);
      if (name === "school") drawSchool(body, flash);
      if (name === "messages") drawMessages(body, flash);
      if (name === "settings") drawSettings(body, flash);
      bindCommon(body);
    }

    /* значение поля по имени: form.name — это ещё и имя самой формы */
    function fieldValue(form, name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? String(el.value || "") : "";
    }

    function head(kicker, title, text) {
      return '<div class="cab-sec"><span class="kicker">' + esc(kicker) + "</span><h2>" + esc(title) + "</h2>" +
        (text ? '<p class="cab-sec__text">' + text + "</p>" : "") + "</div>";
    }

    /* --------------------------------------------------------------- обзор */
    function nextStep() {
      var posts = myPosts();
      var key = consentKey();
      if (!user.emailVerified) {
        return ["Подтвердите почту", "Без этого нельзя отправлять материалы и заявки. Код придёт письмом.", "settings", "Подтвердить"];
      }
      if (key === "none" || key === "withdrawn") {
        return ["Загрузите согласие на обработку данных", "Скачайте бланк, подпишите и загрузите фотографию. После проверки откроются материалы, пресс-карта и редакции.", "docs", "К документам"];
      }
      if (key === "rejected") {
        return ["Согласие не принято", (state.consent.note ? "Причина: " + state.consent.note + ". " : "") + "Загрузите исправленный документ.", "docs", "К документам"];
      }
      if (key === "pending") {
        return ["Согласие на проверке", "Обычно это занимает один-два дня. Пока можно подготовить черновик материала.", "posts", "К материалам"];
      }
      if (posts.some(function (p) { return p.status === "rejected"; })) {
        return ["Материал вернули на доработку", "Откройте замечание редакции, исправьте текст и отправьте заново.", "posts", "К материалам"];
      }
      if (!posts.length) {
        return ["Напишите первый материал", "История из вашей школы, двора или города. Редакция проверит и опубликует.", "write", "Написать"];
      }
      if (state.card && state.card.canApply) {
        return [state.card.renewal ? "Продлите пресс-карту" : "Можно подать заявку на пресс-карту",
          "Условия выполнены: заявка отправляется одной кнопкой.", "card", "К пресс-карте"];
      }
      return null;
    }

    function drawOverview(body, flash) {
      var posts = myPosts();
      var count = function (st) { return posts.filter(function (p) { return p.status === st; }).length; };
      var step = nextStep();
      var c = state.card || {};
      var cardLine = "Заявка открывается после " + (c.minPosts || 5) + " опубликованных материалов.";
      if (c.card && c.card.number) {
        cardLine = "№ " + c.card.number + (c.card.validUntil ? " · до " + ui.fmtDate(c.card.validUntil) : "");
      } else if (c.request && c.request.state === "pending") {
        cardLine = "Заявка от " + ui.fmtDate(c.request.createdAt) + " ждёт решения.";
      } else if (c.published != null) {
        cardLine = "Опубликовано " + c.published + " из " + (c.minPosts || 5) + ".";
      }
      var ed = state.editorial;
      var edLine = "Вы пока не в редакции.";
      var edPill = pill(["нет", "status--draft"]);
      if (ed && ed.editorial) { edLine = "Вы руководитель: «" + ed.editorial.name + "»."; edPill = pill(["руководитель", "status--pub"]); }
      else if (user.editorialId) { edLine = "Вы участник редакции."; edPill = pill(["участник", "status--pub"]); }
      else if (state.open && state.open.application) {
        var st = state.open.application.status;
        edLine = st === "draft" ? "Анкета на открытие редакции — черновик."
          : st === "awaiting" ? "Заявление ждёт подписанного скана."
          : "Заявление у директора на решении.";
        edPill = pill([st === "draft" ? "черновик" : "заявление", "status--pending"]);
      }

      body.innerHTML = flash +
        (step
          ? '<div class="cab-next"><div><span class="kicker">Следующий шаг</span><h2>' + esc(step[0]) + "</h2><p>" + esc(step[1]) + "</p></div>" +
            (step[2] === "write"
              ? '<a class="btn btn--accent" href="/write">' + esc(step[3]) + "</a>"
              : '<button class="btn btn--accent" type="button" data-go="' + step[2] + '">' + esc(step[3]) + "</button>") + "</div>"
          : '<div class="cab-next cab-next--ok"><div><span class="kicker">Всё в порядке</span><h2>Можно работать</h2>' +
            "<p>Документы приняты, материалы отправляются. Новые решения редакции появятся здесь и придут на почту.</p></div>" +
            '<a class="btn btn--accent" href="/write">Написать материал</a></div>') +
        '<div class="cab-grid">' +
        tile("Почта", user.emailVerified ? pill(["подтверждена", "status--pub"]) : pill(["не подтверждена", "status--bad"]),
          esc(user.email), "settings", "Профиль") +
        tile("Согласие на обработку данных", pill(CONSENT_TEXT[consentKey()] || CONSENT_TEXT.none),
          consentKey() === "exempt" ? "Руководству проекта согласие не требуется."
            : consentKey() === "approved" ? "Принято " + (state.consent.decidedAt ? ui.fmtDate(state.consent.decidedAt) : "") + "."
            : consentKey() === "pending" ? "Отправлено " + (state.consent.createdAt ? ui.fmtDate(state.consent.createdAt) : "") + ", проверяется."
            : "Без согласия закрыты материалы, пресс-карта и редакции.", "docs", "Документы") +
        tile("Материалы", '<b class="cab-tile__num">' + count("published") + "</b>",
          "опубликовано · на проверке " + count("pending") + " · черновиков " + count("draft") +
          (count("rejected") ? " · на доработке " + count("rejected") : ""), "posts", "Материалы") +
        tile("Пресс-карта", pill(CARD_TEXT[cardKey()] || CARD_TEXT.none), esc(cardLine), "card", "Пресс-карта") +
        tile("Редакция", edPill, esc(edLine), "editorial", "Редакция") +
        tile("Баллы", '<b class="cab-tile__num">' + (state.points == null ? "…" : state.points) + "</b>",
          "Начисляются за опубликованные материалы и принятые работы.", "posts", "Материалы") +
        "</div>" +
        '<div data-inbox class="cab-block"></div>' +
        '<div data-tasks-cabinet class="cab-block"></div>';
      ui.mounts.inbox();
      ui.mounts.tasks(user);
    }

    function tile(title, value, text, tab, linkText) {
      return '<article class="cab-tile"><h3>' + esc(title) + '</h3><div class="cab-tile__value">' + value + "</div>" +
        '<p class="cab-tile__text">' + text + "</p>" +
        '<button class="link-btn" type="button" data-go="' + tab + '">' + esc(linkText) + " →</button></article>";
    }

    /* ----------------------------------------------------------- материалы */
    function postRow(p) {
      var st = POST_STATUS[p.status] || POST_STATUS.draft;
      var actions = "";
      if (p.status === "draft") {
        actions = '<a class="btn btn--sm btn--ghost" href="/write?id=' + encodeURIComponent(p.id) + '">Редактировать</a>' +
          '<button class="btn btn--sm" type="button" data-submit="' + esc(p.id) + '">Отправить на проверку</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-delete="' + esc(p.id) + '">Удалить</button>';
      } else if (p.status === "rejected") {
        actions = '<a class="btn btn--sm" href="/write?id=' + encodeURIComponent(p.id) + '">Исправить</a>' +
          (p.edited ? '<button class="btn btn--sm btn--ghost" type="button" data-submit="' + esc(p.id) + '">Отправить заново</button>' : "");
      } else if (p.status === "pending") {
        actions = '<a class="btn btn--sm btn--ghost" href="/write?id=' + encodeURIComponent(p.id) + '">Открыть</a>' +
          (p.edited ? '<button class="btn btn--sm" type="button" data-submit="' + esc(p.id) + '">Отправить исправленную версию</button>' : "");
      } else if (p.status === "published" && p.remoteId) {
        actions = '<a class="btn btn--sm btn--ghost" href="/article?id=' + encodeURIComponent("s:" + p.remoteId) + '">Открыть на сайте</a>';
      }
      return '<article class="cab-post" data-post="' + esc(p.id) + '">' +
        '<div class="cab-post__top"><h3>' + esc(p.title || "Без названия") + "</h3>" + pill(st) + "</div>" +
        '<p class="cab-post__meta">' + (p.number ? "№ " + p.number + " · " : "") + esc(p.format || "Материал") +
        (p.region ? " · " + esc(ui.regionName(p.region)) : "") + " · " + esc(ui.fmtDate(p.updatedAt || p.date)) + "</p>" +
        (p.status === "rejected" && p.reviewNote
          ? '<p class="cab-post__note"><b>Замечание редакции:</b> ' + esc(p.reviewNote) + "</p>" : "") +
        (p.remoteError ? '<p class="cab-post__note cab-post__note--err">Не отправлено: ' + esc(p.remoteError) + "</p>" : "") +
        '<div class="cab-post__actions">' + actions + '<span class="form__note" data-post-note></span></div></article>';
    }

    function drawPosts(body, flash) {
      var posts = myPosts();
      var order = { rejected: 0, draft: 1, pending: 2, published: 3 };
      posts.sort(function (a, b) {
        var d = (order[a.status] || 0) - (order[b.status] || 0);
        return d !== 0 ? d : new Date(b.updatedAt || b.date) - new Date(a.updatedAt || a.date);
      });
      var ok = consentOk() && user.emailVerified;
      var portfolio = Store.portfolio();
      body.innerHTML = flash +
        '<div class="cab-row">' +
        head("Мои материалы", "Материалы и статусы",
          "Черновик видите только вы. После отправки материал проверяет редакция: «на проверке» → «опубликован» или «нужны правки» с замечанием.") +
        (ok ? '<a class="btn btn--accent" href="/write">Написать материал</a>'
            : '<button class="btn btn--accent btn--waiting" type="button" data-go="' + (user.emailVerified ? "docs" : "settings") + '">Написать материал</button>') +
        "</div>" +
        (ok ? "" : gateHtml()) +
        (posts.length
          ? '<div class="cab-posts">' + posts.map(postRow).join("") + "</div>"
          : '<div class="empty"><h3>Материалов пока нет</h3><p>Начните с простого: история из вашей школы, двора или города. ' +
            'Памятка автору подскажет, с чего начать.</p><div class="empty__actions">' +
            '<a class="btn btn--ghost" href="/assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору</a></div></div>') +
        '<div class="cab-block">' +
        head("Портфолио", "Работы вне сайта",
          "Фото, аудио или видео, которые вы сделали не для сайта. Комиссия посмотрит и начислит баллы.") +
        (portfolio.length
          ? '<div class="cab-list">' + portfolio.map(function (item) {
              var s = item.status === "approved" ? ["принято · +" + (item.points || 0), "status--pub"]
                : item.status === "rejected" ? ["не принято", "status--bad"] : ["на проверке", "status--pending"];
              return '<div class="cab-list__row"><div><b>' + esc(item.title) + "</b><small>" + esc(ui.fmtDate(item.createdAt)) +
                (item.note ? " · " + esc(item.note) : "") + "</small></div>" + pill(s) + "</div>";
            }).join("") + "</div>"
          : "") +
        (ok
          ? '<form class="form cab-form" data-portfolio-form>' +
            '<div class="field"><label for="pf-title">Название работы</label><input id="pf-title" name="title" type="text" maxlength="160"></div>' +
            '<div class="field form__full"><label for="pf-about">О работе</label><textarea id="pf-about" name="about" ' +
            'placeholder="Что это, где и когда снято или записано, ваша роль"></textarea></div>' +
            '<div class="field form__full"><label for="pf-files">Файлы: до трёх, фото, аудио или видео до 6 МБ</label>' +
            '<input id="pf-files" type="file" multiple accept="image/jpeg,image/png,image/webp,audio/*,video/mp4,video/webm" data-portfolio-files></div>' +
            '<label class="check form__full"><input type="checkbox" name="publish"> Можно показать работу на сайте</label>' +
            '<div class="form__full row"><button class="btn btn--sm" type="submit">Отправить работу</button>' +
            '<span class="form__note" data-portfolio-note></span></div></form>'
          : '<p class="form__note">Форма откроется после принятого согласия на обработку данных.</p>') +
        "</div>";

      $$("[data-submit]", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var row = btn.closest("[data-post]");
          var note = $("[data-post-note]", row);
          btn.disabled = true;
          note.textContent = "Отправляем…";
          Store.submitPost(btn.getAttribute("data-submit")).then(function (res) {
            if (res.ok) { state.flash = res.message; Store.refreshCard().then(function (c) { state.card = c; }); drawTab(); return; }
            btn.disabled = false;
            if (res.needConsent) { state.flash = res.error; setTab("docs"); return; }
            note.textContent = res.error || "Не отправилось.";
          });
        });
      });
      $$("[data-delete]", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (btn.getAttribute("data-sure") !== "1") {
            btn.setAttribute("data-sure", "1");
            btn.textContent = "Точно удалить?";
            return;
          }
          Store.deletePost(btn.getAttribute("data-delete"));
          drawTab();
        });
      });
      bindPortfolio(body);
    }

    function gateHtml() {
      if (!user.emailVerified) {
        return '<div class="gate"><b>Почта не подтверждена.</b> Отправка материалов откроется после кода из письма. ' +
          '<button class="link-btn" type="button" data-go="settings">Подтвердить почту →</button></div>';
      }
      var key = consentKey();
      var text = key === "pending" ? "Согласие на обработку данных проверяется. Материал можно подготовить, отправка откроется после проверки."
        : key === "rejected" ? "Согласие не принято" + (state.consent.note ? ": " + esc(state.consent.note) : "") + ". Загрузите исправленный документ."
        : "Чтобы отправлять материалы, нужно согласие на обработку персональных данных.";
      return '<div class="gate"><b>Отправка закрыта.</b> ' + text +
        ' <button class="link-btn" type="button" data-go="docs">К документам →</button></div>';
    }

    function bindPortfolio(body) {
      var form = $("[data-portfolio-form]", body);
      if (!form) return;
      var note = $("[data-portfolio-note]", form);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var files = Array.prototype.slice.call(($("[data-portfolio-files]", form).files || []), 0, 3);
        if (!files.length) { note.textContent = "Приложите хотя бы один файл."; return; }
        for (var i = 0; i < files.length; i++) {
          if (files[i].size > 6 * 1024 * 1024) { note.textContent = "Файл «" + files[i].name + "» больше 6 МБ."; return; }
        }
        var btn = $("button[type=submit]", form);
        btn.disabled = true;
        note.textContent = "Загружаем…";
        Promise.all(files.map(ui.fileToDataUrl)).then(function (urls) {
          return Store.portfolioSend({
            title: fieldValue(form, "title").trim(),
            about: fieldValue(form, "about").trim(),
            files: urls,
            publish: !!form.querySelector('[name="publish"]').checked,
          });
        }).then(function () {
          state.flash = "Работа отправлена комиссии.";
          drawTab();
        }, function (err) {
          btn.disabled = false;
          note.textContent = (err && err.message) || "Не отправилось.";
        });
      });
    }

    /* ----------------------------------------------------------- документы */
    function drawDocs(body, flash) {
      var key = consentKey();
      var c = state.consent || {};
      var project = SC.project || {};
      var operator = (project.operator && project.operator.name) || "оператор проекта";
      var canUpload = key === "none" || key === "rejected" || key === "pending" || key === "withdrawn";
      var statusText = {
        none: "Согласие ещё не загружено. Без него закрыты отправка материалов, портфолио, заявка на пресс-карту и редакции.",
        pending: "Документ отправлен " + (c.createdAt ? ui.fmtDate(c.createdAt) : "") + " и проверяется. Решение придёт сюда и на почту.",
        approved: "Согласие принято" + (c.decidedAt ? " " + ui.fmtDate(c.decidedAt) : "") + ". Больше ничего загружать не нужно.",
        rejected: "Согласие не принято" + (c.note ? ": " + c.note : "") + ". Исправьте и загрузите заново.",
        withdrawn: "Согласие отозвано. Чтобы продолжить работу, загрузите новое.",
        exempt: "Руководству проекта согласие самому себе не требуется.",
      }[key];

      body.innerHTML = flash +
        head("Документы", "Согласие на обработку персональных данных",
          "Проект хранит ваше имя, почту и материалы, а имя автора стоит под публикациями. По закону на это нужно письменное согласие. " +
          "Оператор персональных данных — " + esc(operator) + ".") +
        '<div class="cab-status cab-status--' + key + '">' + pill(CONSENT_TEXT[key] || CONSENT_TEXT.none) +
        "<p>" + esc(statusText) + "</p></div>" +
        (key === "exempt" ? "" :
          '<ol class="cab-steps">' +
          "<li><b>Скачайте два бланка.</b> " +
          '<a class="link-accent" href="' + esc(consentFormUrl("processing")) + '" target="_blank" rel="noopener">Согласие на обработку</a> и ' +
          '<a class="link-accent" href="' + esc(consentFormUrl("distribution")) + '" target="_blank" rel="noopener">согласие на распространение</a> ' +
          "(имя автора под материалами на сайте).</li>" +
          "<li><b>Заполните и подпишите от руки.</b> Если вам меньше 18 лет, подписывает и родитель или опекун.</li>" +
          "<li><b>Сфотографируйте или отсканируйте</b> каждый лист целиком, чтобы текст читался.</li>" +
          "<li><b>Загрузите файлы сюда.</b> До четырёх листов: фотографии или PDF.</li></ol>") +
        (c.pages
          ? '<div class="cab-files"><b>Загружено листов: ' + c.pages + "</b> " +
            Array.apply(null, { length: c.pages }).map(function (_, i) {
              return '<button class="btn btn--sm btn--ghost" type="button" data-consent-view="' + (i + 1) + '">Лист ' + (i + 1) + "</button>";
            }).join(" ") + '<span class="form__note" data-consent-view-note></span></div>'
          : "") +
        (canUpload && key !== "exempt"
          ? '<form class="form cab-form" data-consent-form>' +
            '<div class="field form__full"><label for="consent-files">' +
            (key === "pending" ? "Заменить загруженные листы" : "Подписанные листы") + ": JPG, PNG или PDF</label>" +
            '<input id="consent-files" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" data-consent-files></div>' +
            '<div class="form__full row"><button class="btn" type="submit">Отправить на проверку</button>' +
            '<span class="form__note" data-consent-note></span></div></form>'
          : "") +
        '<div class="cab-block">' + head("Справочно", "Документы проекта") +
        '<div class="chips">' +
        '<a class="chip" href="/assets/docs/politika-konfidencialnosti.pdf" target="_blank" rel="noopener">Политика обработки данных</a>' +
        '<a class="chip" href="/assets/docs/polzovatelskoe-soglashenie.pdf" target="_blank" rel="noopener">Пользовательское соглашение</a>' +
        '<a class="chip" href="/assets/docs/polozhenie-o-redakcii.pdf" target="_blank" rel="noopener">Кодекс редакции</a>' +
        '<a class="chip" href="/assets/docs/pamyatka-avtoru.pdf" target="_blank" rel="noopener">Памятка автору</a>' +
        '<a class="chip" href="/docs">Все документы</a></div>' +
        '<p class="form__note">Вопросы по персональным данным и отзыв согласия: <a class="link-accent" href="mailto:' +
        esc((project.mail && project.mail.personalData) || "info@smenakontenta.ru") + '">' +
        esc((project.mail && project.mail.personalData) || "info@smenakontenta.ru") + "</a>.</p></div>";

      $$("[data-consent-view]", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var note = $("[data-consent-view-note]", body);
          note.textContent = "Открываем…";
          Store.consentFile("", Number(btn.getAttribute("data-consent-view"))).then(function (res) {
            var url = ui.dataUrlToBlobUrl(res.data);
            note.textContent = "";
            if (url) window.open(url, "_blank", "noopener");
            else note.textContent = "Не удалось открыть файл.";
          }, function (err) { note.textContent = (err && err.message) || "Файл не открылся."; });
        });
      });

      var form = $("[data-consent-form]", body);
      if (form) {
        var note = $("[data-consent-note]", form);
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var files = Array.prototype.slice.call($("[data-consent-files]", form).files || []);
          if (!files.length) { note.textContent = "Выберите файлы с подписанными листами."; return; }
          if (files.length > 4) { note.textContent = "Не больше четырёх файлов."; return; }
          var btn = $("button[type=submit]", form);
          btn.disabled = true;
          note.textContent = "Готовим файлы…";
          Promise.all(files.map(function (f) { return ui.docScanToDataUrl(f); })).then(function (pages) {
            note.textContent = "Отправляем…";
            return Store.sendConsent(pages);
          }).then(function (consent) {
            state.consent = consent;
            state.flash = "Согласие отправлено на проверку. Решение придёт сюда и на почту.";
            drawTab();
          }, function (err) {
            btn.disabled = false;
            note.textContent = (err && err.message) || "Не отправилось.";
          });
        });
      }
    }

    function consentFormUrl(kind) {
      var docs = SC.docs || [];
      var want = kind === "distribution" ? "soglasie-na-rasprostranenie" : "soglasie-na-obrabotku";
      for (var i = 0; i < docs.length; i++) {
        if (String(docs[i].file || "").indexOf(want) !== -1) return docs[i].file;
      }
      return kind === "distribution"
        ? "/assets/docs/soglasie-na-rasprostranenie-pd.pdf"
        : "/assets/docs/soglasie-na-obrabotku-pd.pdf";
    }

    /* --------------------------------------------------------- пресс-карта */
    function drawCard(body, flash) {
      var c = state.card;
      if (!c) {
        body.innerHTML = flash + head("Пресс-карта", "Пресс-карта автора") + '<p class="no-data">Загружаем состояние карты…</p>';
        return;
      }
      var key = cardKey();
      var card = c.card;
      var req = c.request;
      var need = c.minPosts || 5;
      var html = flash + head("Пресс-карта", "Пресс-карта автора",
        "Карта подтверждает, что вы автор проекта. Это документ с номером и сроком действия: " +
        "подлинность любой карты проверяется по номеру на странице «Проверка карты».");

      if (card && card.number) {
        var valid = card.state === "issued";
        html += '<div class="cab-card cab-card--' + esc(card.state) + '">' +
          '<div class="cab-card__top"><span class="cab-card__label">Пресс-карта</span>' + pill(CARD_TEXT[card.state] || CARD_TEXT.none) + "</div>" +
          '<div class="cab-card__num">' + esc(card.number) + "</div>" +
          '<div class="cab-card__name">' + esc(user.name) + "</div>" +
          '<dl class="cab-card__facts">' +
          "<div><dt>Выдана</dt><dd>" + (card.issuedAt ? esc(ui.fmtDate(card.issuedAt)) : "—") + "</dd></div>" +
          "<div><dt>Действует до</dt><dd>" + (card.validUntil ? esc(ui.fmtDate(card.validUntil)) : "—") + "</dd></div>" +
          "<div><dt>Основание</dt><dd>" + (card.byRole ? "по должности" : "по публикациям") + "</dd></div></dl>" +
          (card.note && !valid ? '<p class="cab-card__note">' + esc(card.note) + "</p>" : "") +
          '<div class="cab-card__actions">' +
          '<a class="btn btn--sm" href="/card-doc?id=' + encodeURIComponent(card.id) + '">Документ о присвоении</a>' +
          '<a class="btn btn--sm btn--ghost" href="/verify?n=' + encodeURIComponent(card.number) + '">Проверить по номеру</a></div></div>';
      }

      if (req && req.state === "pending") {
        html += '<div class="cab-status cab-status--pending">' + pill(CARD_TEXT.pending) +
          "<p>" + (req.renewal ? "Заявка на продление" : "Заявка") + " от " + esc(ui.fmtDate(req.createdAt)) +
          " ждёт решения редакции. Ответ придёт сюда и на почту.</p></div>";
      } else if (req && req.state === "rejected" && !(card && card.state === "issued")) {
        html += '<div class="cab-status cab-status--rejected">' + pill(CARD_TEXT.rejected) +
          "<p>В заявке от " + esc(ui.fmtDate(req.createdAt)) + " отказано" + (req.note ? ": " + esc(req.note) : "") + ".</p></div>";
      }

      if (!(req && req.state === "pending")) {
        var have = c.published || 0;
        var pct = Math.min(100, Math.round((have / need) * 100));
        html += '<div class="cab-block">';
        if (!c.byRole && !(card && card.state === "issued")) {
          html += '<div class="cab-progress"><div class="cab-progress__bar"><i style="width:' + pct + '%"></i></div>' +
            "<span>Опубликовано материалов: <b>" + have + "</b> из " + need + "</span></div>";
        }
        if (c.canApply) {
          html += '<div class="row" style="gap:12px;flex-wrap:wrap;align-items:center">' +
            '<button class="btn btn--accent" type="button" data-card-apply>' + (c.renewal ? "Подать на продление" : "Подать заявку на пресс-карту") + "</button>" +
            '<span class="form__note" data-card-note>' + (c.byRole ? "Сотруднику редакции карта положена по должности." : "К заявке приложатся ваши опубликованные материалы.") + "</span></div>";
        } else if (c.why) {
          html += '<p class="form__note">' + esc(c.why) + "</p>";
        }
        html += "</div>";
      }

      html += '<div class="cab-block">' + head("Как это устроено", "Правила карты") +
        '<ul class="cab-rules">' +
        "<li>Заявка открывается после " + need + " опубликованных материалов. Сотрудникам редакции карта положена по должности.</li>" +
        "<li>Карта действует год. За 30 дней до конца срока можно подать на продление.</li>" +
        "<li>Пластиковую карту проект не печатает и не рассылает. Документ о присвоении можно распечатать самому.</li>" +
        "<li>Редакция может приостановить или отозвать карту при нарушении правил. Причина будет указана здесь.</li></ul></div>";
      body.innerHTML = html;

      var apply = $("[data-card-apply]", body);
      if (apply) {
        apply.addEventListener("click", function () {
          var note = $("[data-card-note]", body);
          apply.disabled = true;
          note.textContent = "Отправляем заявку…";
          Store.cardApply().then(function () {
            state.card = Store.card();
            state.flash = "Заявка отправлена. Решение придёт сюда и на почту.";
            drawTab();
          }, function (err) {
            apply.disabled = false;
            if (err && err.needConsent) { state.flash = err.message; setTab("docs"); return; }
            note.textContent = (err && err.message) || "Заявка не отправилась.";
          });
        });
      }
    }

    /* ------------------------------------------------------------ редакция */
    function drawEditorial(body, flash) {
      body.innerHTML = flash +
        head("Редакция", "Моя редакция",
          "Редакция — это команда авторов в регионе: школа, вуз, молодёжный центр или самостоятельная группа. " +
          'Вступить в существующую можно на <a class="link-accent" href="/region' +
          (user.region ? "?r=" + encodeURIComponent(user.region) : "") + '">странице региона</a>.') +
        '<div data-my-editorial class="cab-block"><p class="no-data">Загружаем…</p></div>' +
        '<div data-editorial-reports class="cab-block"></div>' +
        '<div data-editorial-open class="cab-block"></div>';
      mountMyEditorial(body);
      mountEditorialOpen(body);
    }

    /* Моя редакция: участник видит, где состоит; руководитель — штат и заявки. */
    function mountMyEditorial(body) {
      var box = $("[data-my-editorial]", body);
      if (!box) return;
      var APP = {
        pending: ["на рассмотрении", "status--pending"],
        approved: ["приняты", "status--pub"],
        rejected: ["отказ", "status--bad"],
        left: ["вы вышли", "status--draft"],
        excluded: ["исключены", "status--bad"],
      };

      function reload(note) {
        Store.editorialMine().then(function (data) { state.editorial = data; paint(data, note || ""); });
      }
      /* первая загрузка идёт общим обновлением кабинета — второй раз не спрашиваем */
      function first() {
        if (state.editorial) paint(state.editorial, "");
        else if (state.loaded) reload();
      }

      function paint(data, note) {
        var html = note ? '<p class="cab-flash" role="status">' + esc(note) + "</p>" : "";
        var ed = data.editorial;
        var mem = data.member;

        if (ed) {
          var waiting = data.incoming.filter(function (a) { return a.status === "pending"; });
          html +=
            '<div class="cab-card"><div class="cab-card__top"><div><span class="kicker">Вы руководитель</span><h3>' + esc(ed.name) + "</h3></div>" +
            pill(["открыта", "status--pub"]) + "</div>" +
            '<p class="cab-card__text">' + esc(ed.about || "") + "</p>" +
            '<p class="form__note">' + esc(ui.regionName(ed.region) || "") + " · в штате " + data.roster.length +
            ' · <a class="link-accent" href="/region?r=' + encodeURIComponent(ed.region) + '">страница региона</a>' +
            (Store.isStaff(user) ? ' · <a class="link-accent" href="/admin#queue">материалы редакции на проверке</a>' : "") + "</p></div>" +

            '<h3 class="cab-sub">Заявки в редакцию' + (waiting.length ? " · " + waiting.length : "") + "</h3>" +
            (waiting.length
              ? waiting.map(function (a) {
                  return '<div class="cab-card" data-app="' + esc(a.id) + '"><div class="cab-card__top"><h3>' + esc(a.name) + "</h3>" + pill(APP.pending) + "</div>" +
                    '<p class="form__note">Дата рождения: ' + esc(a.birthDate || "—") + " · " + esc(a.email || "") + " · заявка " + esc(ui.fmtDate(a.createdAt)) + "</p>" +
                    '<p class="cab-card__text">' + esc(a.why || "") + "</p>" +
                    (a.sitePosts && a.sitePosts.length ? '<p class="form__note">Материалы на сайте: ' + a.sitePosts.map(esc).join(" · ") + "</p>" : "") +
                    (a.portfolio && a.portfolio.length
                      ? '<p class="form__note">Файлы: ' + a.portfolio.map(function (url, i) {
                          return '<a class="link-accent" href="' + esc(url) + '" target="_blank" rel="noopener">файл ' + (i + 1) + "</a>";
                        }).join(" · ") + "</p>"
                      : "") +
                    (a.escalated
                      ? '<p class="form__note">Прошло семь дней — заявку решает центральная редакция.</p>'
                      : '<div class="cab-actions"><input type="text" placeholder="Причина отказа — человек её увидит" maxlength="400" data-app-note aria-label="Причина отказа">' +
                        '<button class="btn btn--sm btn--accent" type="button" data-app-ok>Принять</button>' +
                        '<button class="btn btn--sm btn--ghost" type="button" data-app-no>Отказать</button></div>') +
                    "</div>";
                }).join("")
              : '<p class="form__note">Новых заявок нет. Авторы подают их на странице региона.</p>') +

            '<h3 class="cab-sub">Штат редакции · ' + data.roster.length + "</h3>" +
            '<div class="cab-list">' + data.roster.map(function (m) {
              return '<div class="cab-list__row" data-member="' + esc(m.id) + '"><div><b>' + esc(m.name) + "</b><small>" +
                (m.head ? "руководитель" : esc(m.craft || "участник")) + (m.number ? " · № " + m.number : "") +
                (m.email ? " · " + esc(m.email) : "") + (m.joinedAt ? " · с " + esc(ui.fmtDate(m.joinedAt)) : "") + "</small></div>" +
                (m.head ? "" : '<button class="btn btn--sm btn--ghost" type="button" data-member-out>Исключить</button>') + "</div>";
            }).join("") + "</div>" +
            '<div class="cab-actions" data-out-form hidden><input type="text" placeholder="Причина исключения — человек её увидит" maxlength="400" data-out-note aria-label="Причина исключения">' +
            '<button class="btn btn--sm" type="button" data-out-go>Исключить из редакции</button>' +
            '<button class="btn btn--sm btn--ghost" type="button" data-out-cancel>Отмена</button></div>' +
            '<p class="form__note">Руководителя редакции меняет и редакцию закрывает директор проекта: напишите в <a class="link-accent" href="/support">поддержку</a>.</p>';
        } else if (mem) {
          html +=
            '<div class="cab-card"><div class="cab-card__top"><div><span class="kicker">Вы участник</span><h3>' + esc(mem.name) + "</h3></div>" +
            pill(["в штате", "status--pub"]) + "</div>" +
            '<p class="cab-card__text">' + esc(mem.about || "") + "</p>" +
            '<p class="form__note">' + esc(ui.regionName(mem.region) || "") + " · руководитель — " + esc(mem.founderName || "—") +
            " · в штате " + (mem.members || 1) + "</p>" +
            '<p class="form__note">Ваши материалы первым проверяет руководитель редакции.</p>' +
            '<div class="cab-actions"><button class="btn btn--sm btn--ghost" type="button" data-leave>Выйти из редакции</button></div></div>';
        } else {
          html +=
            '<div class="fill-note fill-note--flat"><b>Вы пока вне редакции</b><p>Можно писать самостоятельно или вступить в редакцию своего региона.</p>' +
            '<p><a class="link-accent" href="/region' + (user.region ? "?r=" + encodeURIComponent(user.region) : "") + '">Выбрать редакцию региона →</a></p></div>';
        }

        /* свои заявки на вступление — история */
        var mine = data.applications.filter(function (a) { return !(mem && a.status === "approved" && a.editorialId === mem.id); });
        if (mine.length) {
          html += '<h3 class="cab-sub">Мои заявки на вступление</h3><div class="cab-list">' + mine.map(function (a) {
            return '<div class="cab-list__row"><div><b>' + esc(a.editorialName || "Редакция") + "</b><small>" + esc(ui.fmtDate(a.createdAt)) +
              (a.note ? " · " + esc(a.note) : "") +
              (a.escalated ? " · семь дней без решения: заявка передана в центральную редакцию" : "") + "</small></div>" +
              pill(APP[a.status] || [a.status, "status--draft"]) + "</div>";
          }).join("") + "</div>";
        }

        box.innerHTML = html;
        var say = function (text) {
          var el = $(".cab-flash", box);
          if (!el) { el = document.createElement("p"); el.className = "cab-flash"; el.setAttribute("role", "status"); box.insertBefore(el, box.firstChild); }
          el.textContent = text;
        };

        $$("[data-app]", box).forEach(function (el) {
          var id = el.getAttribute("data-app");
          var noteEl = $("[data-app-note]", el);
          var ok = $("[data-app-ok]", el);
          var no = $("[data-app-no]", el);
          if (ok) ok.addEventListener("click", function () {
            ok.disabled = true;
            Store.editorialReview(id, "approved", "").then(function () { reload("Заявка принята: человек в штате редакции."); },
              function (err) { ok.disabled = false; say(err.message); });
          });
          if (no) no.addEventListener("click", function () {
            var text = noteEl.value.trim();
            if (text.length < 5) { say("Напишите причину отказа: человек увидит её в кабинете."); noteEl.focus(); return; }
            no.disabled = true;
            Store.editorialReview(id, "rejected", text).then(function () { reload("В заявке отказано, человек получил причину."); },
              function (err) { no.disabled = false; say(err.message); });
          });
        });

        var outForm = $("[data-out-form]", box);
        var outId = "";
        $$("[data-member-out]", box).forEach(function (btn) {
          btn.addEventListener("click", function () {
            outId = btn.closest("[data-member]").getAttribute("data-member");
            outForm.hidden = false;
            $("[data-out-note]", outForm).focus();
          });
        });
        if (outForm) {
          $("[data-out-cancel]", outForm).addEventListener("click", function () { outForm.hidden = true; outId = ""; });
          $("[data-out-go]", outForm).addEventListener("click", function () {
            var text = $("[data-out-note]", outForm).value.trim();
            if (text.length < 5) { say("Напишите причину исключения."); return; }
            Store.editorialExclude(outId, text).then(function () { reload("Участник исключён и получил уведомление с причиной."); },
              function (err) { say(err.message); });
          });
        }

        var leave = $("[data-leave]", box);
        if (leave) leave.addEventListener("click", function () {
          if (leave.getAttribute("data-sure") !== "1") {
            leave.setAttribute("data-sure", "1");
            leave.textContent = "Точно выйти?";
            say("После выхода ваши материалы снова проверяет центральная редакция. Нажмите ещё раз, чтобы выйти.");
            return;
          }
          leave.disabled = true;
          Store.editorialLeave().then(function (res) {
            /* меняется и сам аккаунт (редакция, возможно роль) — обновляем кабинет целиком */
            state.flash = res.roleReset ? "Вы вышли из редакции. Роль «" + res.roleWas + "», выданная для работы в ней, снята." : "Вы вышли из редакции.";
            refresh();
          }, function (err) { leave.disabled = false; say(err.message); });
        });

        /* отчёты редакции — у руководителя (этап «Отчёты») */
        var reports = $("[data-editorial-reports]", body);
        if (reports && ed && window.SCReports && window.SCReports.cabinet) window.SCReports.cabinet(reports, user, ui, ed);
        /* открыть свою редакцию участнику чужой незачем: сначала выход */
        var openBox = $("[data-editorial-open]", body);
        if (openBox && mem) openBox.hidden = true;
      }

      first();
    }

    /* Заявление на открытие редакции: анкета → документ → подпись → письмо. */
    function mountEditorialOpen(body) {
      var box = $("[data-editorial-open]", body);
      if (!box) return;
      box.innerHTML = '<p class="no-data">Загружаем заявление…</p>';
      var fetchOpen = function () {
        Store.editorialOpenMine().then(function (res) {
          state.open = res;
          paint(res);
        }, function (err) {
          box.innerHTML = '<p class="form__note">' + esc((err && err.message) || "Не удалось загрузить заявление.") + "</p>";
        });
      };
      /* первая загрузка идёт общим обновлением кабинета; после действий — свежий запрос */
      var startOpen = function () {
        if (state.open && !state.openStale) paint(state.open);
        else if (state.loaded) { state.openStale = false; fetchOpen(); }
      };

      var STATUS = {
        draft: ["черновик", "status--draft"],
        awaiting: ["ждёт подписанного скана", "status--pending"],
        review: ["у директора", "status--pending"],
        approved: ["редакция открыта", "status--pub"],
        rejected: ["отказано", "status--bad"],
        withdrawn: ["отозвано", "status--draft"],
      };

      function paint(res) {
        if (res.ownsEditorial) { box.innerHTML = ""; return; }
        var app = res.application;
        var past = (res.past || []).filter(function (a) { return a.status !== "withdrawn" || a.number; });
        var pastHtml = past.length
          ? '<div class="cab-list" style="margin-top:14px">' + past.map(function (a) {
              return '<div class="cab-list__row"><div><b>' + esc(a.number || "Черновик") + " · " + esc((a.form && a.form.name) || "без названия") +
                "</b><small>" + esc(ui.fmtDate(a.updatedAt || a.createdAt)) + (a.note ? " · " + esc(a.note) : "") + "</small></div>" +
                pill(STATUS[a.status] || STATUS.draft) + "</div>";
            }).join("") + "</div>"
          : "";
        var title = head("Своя редакция", "Открыть редакцию",
          "Редакцию открывает директор проекта по заявлению руководителя. Нужны команда не меньше " + (res.teamMin + 1) +
          " человек вместе с руководителем и взрослый куратор, если руководителю меньше 18 лет.");

        if (!app) {
          box.innerHTML = title +
            (res.consentOk
              ? '<button class="btn" type="button" data-eo-start>Заполнить анкету</button>'
              : '<div class="gate"><b>Сначала согласие.</b> Анкета откроется после принятого согласия на обработку данных. ' +
                '<button class="link-btn" type="button" data-go="docs">К документам →</button></div>') + pastHtml;
          var start = $("[data-eo-start]", box);
          if (start) start.addEventListener("click", function () { drawForm(res, { form: {} }); });
          bindCommon(box);
          return;
        }
        if (app.status === "draft") { drawForm(res, app); return; }

        var docUrl = "/editorial-doc?id=" + encodeURIComponent(app.id);
        var steps = app.status === "awaiting"
          ? '<ol class="cab-steps eo-steps">' +
            '<li><b>Откройте и распечатайте заявление.</b> <a class="btn btn--sm" href="' + docUrl + '">Заявление ' + esc(app.number) + "</a></li>" +
            "<li><b>Подпишите.</b> Подпись руководителя" + (isMinor(app.form) ? " и куратора" : "") + ", дата.</li>" +
            '<li><b>Отправьте скан на <a class="link-accent" href="mailto:' + esc(res.mailTo) + "?subject=" +
            encodeURIComponent("Заявление " + app.number) + '">' + esc(res.mailTo) + "</a></b> с почты аккаунта (" + esc(user.email) +
            "). В теме письма укажите номер " + esc(app.number) + ".</li>" +
            "<li><b>Дождитесь решения.</b> Когда письмо получат, статус здесь изменится. Решение принимает директор.</li></ol>"
          : '<p class="cab-sec__text">Подписанное заявление получено ' + (app.receivedAt ? esc(ui.fmtDate(app.receivedAt)) : "") +
            ". Решение принимает директор проекта, ответ придёт сюда и на почту.</p>" +
            '<a class="btn btn--sm btn--ghost" href="' + docUrl + '">Открыть заявление</a>';
        box.innerHTML = title +
          '<div class="cab-status cab-status--pending">' + pill(STATUS[app.status]) +
          "<p>Заявление <b>" + esc(app.number) + "</b> на открытие редакции «" + esc(app.form.name) + "», отправлено " +
          esc(ui.fmtDate(app.submittedAt || app.updatedAt)) + ".</p></div>" + steps +
          '<div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px">' +
          '<button class="btn btn--sm btn--ghost" type="button" data-eo-withdraw>Отозвать заявление</button>' +
          '<span class="form__note" data-eo-note>Отзыв нужен, если хотите исправить анкету или передумали.</span></div>' + pastHtml;
        var w = $("[data-eo-withdraw]", box);
        w.addEventListener("click", function () {
          if (w.getAttribute("data-sure") !== "1") { w.setAttribute("data-sure", "1"); w.textContent = "Точно отозвать?"; return; }
          w.disabled = true;
          Store.editorialOpenWithdraw().then(function () { state.openStale = true; mountEditorialOpen(body); }, function (err) {
            w.disabled = false;
            $("[data-eo-note]", box).textContent = (err && err.message) || "Не получилось.";
          });
        });
      }

      function isMinor(form) {
        if (!form || !form.headBirth) return false;
        var b = new Date(form.headBirth);
        if (isNaN(b.getTime())) return false;
        var now = new Date();
        var age = now.getFullYear() - b.getFullYear();
        if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
        return age < 18;
      }

      function teamRow(row, i) {
        row = row || {};
        return '<div class="eo-team__row" data-eo-member>' +
          '<input type="text" placeholder="Имя и фамилия" maxlength="120" data-m="name" value="' + esc(row.name || "") + '" aria-label="Участник ' + (i + 1) + ': имя и фамилия">' +
          '<input type="text" placeholder="Роль: фотограф, корреспондент" maxlength="60" data-m="role" value="' + esc(row.role || "") + '" aria-label="Участник ' + (i + 1) + ': роль">' +
          '<input type="number" placeholder="Возраст" min="10" max="99" data-m="age" value="' + esc(row.age || "") + '" aria-label="Участник ' + (i + 1) + ': возраст">' +
          '<button class="btn btn--sm btn--ghost" type="button" data-eo-remove aria-label="Убрать участника">×</button></div>';
      }

      function drawForm(res, app) {
        var f = app.form || {};
        var cur = f.curator || {};
        var conf = f.confirms || {};
        var team = (f.team && f.team.length ? f.team : [{}, {}]).slice();
        while (team.length < res.teamMin) team.push({});
        var bases = res.bases || {};
        var fld = function (label, name, value, extra, type) {
          return '<div class="field"><label for="eo-' + name + '">' + label + '</label><input id="eo-' + name + '" name="' + name +
            '" type="' + (type || "text") + '" value="' + esc(value || "") + '" ' + (extra || "") + "></div>";
        };
        box.innerHTML =
          head("Своя редакция", "Анкета на открытие редакции",
            "Заполните анкету. Из неё сформируется заявление на имя директора: его нужно распечатать, подписать и отправить на " + esc(res.mailTo) + ".") +
          (app.note ? '<div class="gate"><b>Заявление вернули на доработку.</b> ' + esc(app.note) + "</div>" : "") +
          '<form class="form eo-form" data-eo-form novalidate>' +
          '<h3 class="form__full eo-form__h">Редакция</h3>' +
          fld("Название редакции", "name", f.name, 'maxlength="120"') +
          '<div class="field"><label for="eo-region">Регион</label><select id="eo-region" name="region"><option value="">Выберите регион</option>' +
          ui.regionOptions(f.region || user.region) + "</select></div>" +
          fld("Город или населённый пункт", "city", f.city, 'maxlength="80"') +
          '<div class="field"><label for="eo-base">На базе чего работает</label><select id="eo-base" name="base"><option value="">Выберите</option>' +
          Object.keys(bases).map(function (k) {
            return '<option value="' + esc(k) + '"' + (f.base === k ? " selected" : "") + ">" + esc(bases[k]) + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field form__full"><label for="eo-baseName">Название организации (если есть)</label>' +
          '<input id="eo-baseName" name="baseName" type="text" maxlength="160" value="' + esc(f.baseName || "") + '" placeholder="Например: школа № 5 г. Казани"></div>' +
          '<div class="field form__full"><label for="eo-about">О редакции: о чём пишете и для кого (не меньше 50 символов)</label>' +
          '<textarea id="eo-about" name="about" maxlength="2000">' + esc(f.about || "") + "</textarea></div>" +
          '<div class="field form__full"><label for="eo-plan">Что и как часто будете выпускать</label>' +
          '<textarea id="eo-plan" name="plan" maxlength="1200" placeholder="Например: две новости в неделю, репортаж раз в месяц, подкаст">' + esc(f.plan || "") + "</textarea></div>" +
          '<div class="field form__full"><label for="eo-links">Ссылки на соцсети редакции (если есть)</label>' +
          '<input id="eo-links" name="links" type="text" maxlength="400" value="' + esc(f.links || "") + '"></div>' +

          '<h3 class="form__full eo-form__h">Руководитель</h3>' +
          fld("Фамилия, имя, отчество", "headName", f.headName || user.name, 'maxlength="120"') +
          '<div class="field"><label for="eo-headBirth">Дата рождения (не младше ' + (res.headMinAge || 14) + ' лет)</label>' +
          '<input id="eo-headBirth" name="headBirth" type="date" value="' + esc(f.headBirth || "") + '"></div>' +
          fld("Телефон", "headPhone", f.headPhone, 'maxlength="20" placeholder="+7 900 000-00-00"', "tel") +
          '<div class="field"><label>Почта аккаунта</label><input type="text" value="' + esc(user.email) + '" disabled></div>' +

          '<h3 class="form__full eo-form__h">Куратор <small>обязателен, если руководителю меньше 18 лет</small></h3>' +
          fld("Фамилия, имя, отчество куратора", "curatorName", cur.name, 'maxlength="120"') +
          fld("Должность или кем приходится", "curatorRole", cur.role, 'maxlength="120" placeholder="учитель, руководитель медиацентра, родитель"') +
          fld("Телефон куратора", "curatorPhone", cur.phone, 'maxlength="20"', "tel") +
          fld("Почта куратора (если есть)", "curatorEmail", cur.email, 'maxlength="120"', "email") +

          '<h3 class="form__full eo-form__h">Команда <small>кроме руководителя — не меньше ' + res.teamMin + " человек, каждому не меньше " + (res.headMinAge || 14) + " лет</small></h3>" +
          '<div class="form__full eo-team" data-eo-team>' + team.map(teamRow).join("") + "</div>" +
          '<div class="form__full"><button class="btn btn--sm btn--ghost" type="button" data-eo-add>Добавить участника</button></div>' +

          '<h3 class="form__full eo-form__h">Подтверждения</h3>' +
          check("truth", conf.truth, "Сведения в анкете достоверны.") +
          check("rules", conf.rules, 'Я прочитал(а) <a class="link-accent" href="/assets/docs/polozhenie-o-redakcii.pdf" target="_blank" rel="noopener">Кодекс редакции</a> и раздел о региональных редакциях в <a class="link-accent" href="/assets/docs/polzovatelskoe-soglashenie.pdf" target="_blank" rel="noopener">пользовательском соглашении</a> и буду им следовать.') +
          check("consents", conf.consents, "Каждый участник команды сам зарегистрируется на сайте и загрузит своё согласие на обработку данных.") +
          check("reports", conf.reports, "Редакция будет сдавать короткий отчёт о работе раз в месяц.") +

          '<div class="form__full eo-problems" data-eo-problems hidden></div>' +
          '<div class="form__full row" style="gap:10px;flex-wrap:wrap;align-items:center">' +
          '<button class="btn btn--accent" type="submit">Сформировать заявление</button>' +
          '<button class="btn btn--ghost" type="button" data-eo-save>Сохранить черновик</button>' +
          (app.id ? '<button class="btn btn--ghost btn--sm" type="button" data-eo-drop>Удалить черновик</button>' : "") +
          '<span class="form__note" data-eo-note></span></div></form>';

        var form = $("[data-eo-form]", box);
        var teamBox = $("[data-eo-team]", form);
        var note = $("[data-eo-note]", form);
        var problems = $("[data-eo-problems]", form);

        function check(key, on, label) {
          return '<label class="check form__full"><input type="checkbox" data-eo-confirm="' + key + '"' + (on ? " checked" : "") + "> <span>" + label + "</span></label>";
        }

        function collect() {
          var v = function (name) { return fieldValue(form, name); };
          return {
            name: v("name"), region: v("region"), city: v("city"), base: v("base"),
            baseName: v("baseName"), about: v("about"), plan: v("plan"), links: v("links"),
            headName: v("headName"), headBirth: v("headBirth"), headPhone: v("headPhone"),
            curator: { name: v("curatorName"), role: v("curatorRole"), phone: v("curatorPhone"), email: v("curatorEmail") },
            team: $$("[data-eo-member]", teamBox).map(function (row) {
              return {
                name: $('[data-m="name"]', row).value.trim(),
                role: $('[data-m="role"]', row).value.trim(),
                age: Number($('[data-m="age"]', row).value) || 0,
              };
            }).filter(function (m) { return m.name || m.role || m.age; }),
            confirms: $$("[data-eo-confirm]", form).reduce(function (acc, el) {
              acc[el.getAttribute("data-eo-confirm")] = el.checked;
              return acc;
            }, {}),
          };
        }

        function send(submit) {
          note.textContent = submit ? "Проверяем анкету…" : "Сохраняем…";
          problems.hidden = true;
          Store.editorialOpenSave(collect(), submit).then(function (r) {
            /* сохранённое на сервере новее копии в кабинете — в следующий раз спросим заново */
            state.openStale = true;
            if (r && r.ok) {
              if (submit) { state.flash = "Заявление сформировано. Распечатайте, подпишите и отправьте скан на " + res.mailTo + "."; }
              if (submit) { drawTab(); return; }
              note.textContent = "Черновик сохранён" + (r.problems && r.problems.length ? ". Осталось заполнить: " + r.problems.length : ". Анкета заполнена полностью") + ".";
              return;
            }
            if (r && r.needConsent) { state.flash = r.error; setTab("docs"); return; }
            if (r && r.problems && r.problems.length) {
              problems.hidden = false;
              problems.innerHTML = "<b>Что нужно исправить:</b><ul>" + r.problems.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
              note.textContent = "Черновик сохранён, заявление не сформировано.";
              try { problems.scrollIntoView({ block: "center" }); } catch (e) {}
              return;
            }
            note.textContent = (r && r.error) || "Не сохранилось.";
          });
        }

        form.addEventListener("submit", function (e) { e.preventDefault(); send(true); });
        $("[data-eo-save]", form).addEventListener("click", function () { send(false); });
        $("[data-eo-add]", form).addEventListener("click", function () {
          if ($$("[data-eo-member]", teamBox).length >= res.teamMax) { note.textContent = "В анкете не больше " + res.teamMax + " участников."; return; }
          teamBox.insertAdjacentHTML("beforeend", teamRow({}, $$("[data-eo-member]", teamBox).length));
        });
        teamBox.addEventListener("click", function (e) {
          var btn = e.target.closest ? e.target.closest("[data-eo-remove]") : null;
          if (!btn) return;
          if ($$("[data-eo-member]", teamBox).length <= 1) return;
          btn.closest("[data-eo-member]").remove();
        });
        var drop = $("[data-eo-drop]", form);
        if (drop) drop.addEventListener("click", function () {
          if (drop.getAttribute("data-sure") !== "1") { drop.setAttribute("data-sure", "1"); drop.textContent = "Точно удалить?"; return; }
          Store.editorialOpenWithdraw().then(function () { state.openStale = true; mountEditorialOpen(body); }, function () {});
        });
      }

      startOpen();
    }

    /* ---------------------------------------------------------- медиашкола */
    function drawSchool(body, flash) {
      body.innerHTML = flash +
        head("Медиашкола", "Моё обучение",
          "Курсы из коротких уроков с заданиями и тестами. Задания проверяет преподаватель, прогресс сохраняется.") +
        '<div data-school-cabinet class="cab-block"><p class="no-data">Загружаем курсы…</p></div>';
      var box = $("[data-school-cabinet]", body);
      if (window.SCSchool && window.SCSchool.cabinet) {
        window.SCSchool.cabinet(box, user, ui, { consentOk: consentOk(), go: setTab });
      } else {
        box.innerHTML = '<a class="btn" href="/media-school">Открыть медиашколу</a>';
      }
    }

    /* ----------------------------------------------------------- сообщения */
    function drawMessages(body, flash) {
      var list = state.messages;
      body.innerHTML = flash +
        head("Связь", "Сообщения и решения",
          "Решения редакции по материалам, документам, карте и заявлениям. Каждое дублируется письмом на почту аккаунта.") +
        (list.length
          ? '<div class="cab-msgs">' + list.map(function (m) {
              return '<article class="cab-msg' + (m.read ? "" : " is-new") + '"><p>' + esc(m.text) + "</p><small>" +
                esc(m.from || "Редакция") + (m.fromRole && m.fromRole !== "Уведомление" ? ", " + esc(m.fromRole) : "") +
                " · " + esc(ui.fmtWhen(m.createdAt)) + "</small></article>";
            }).join("") + "</div>"
          : '<div class="empty"><h3>Сообщений пока нет</h3><p>Здесь появятся решения редакции и письма от неё.</p></div>') +
        '<p class="form__note">Ответить можно на письмо или через <a class="link-accent" href="/support">поддержку</a>.</p>' +
        '<div data-hiring-cabinet class="cab-block"></div>' +
        '<div data-tasks-cabinet class="cab-block"></div>';
      ui.mounts.hiring(user);
      ui.mounts.tasks(user);
      if (list.some(function (m) { return !m.read; })) {
        Store.messagesRead().then(function (ok) {
          if (!ok) return;
          state.messages = state.messages.map(function (m) { return Object.assign({}, m, { read: true }); });
          drawTabs();
        });
      }
    }

    /* ------------------------------------------------------------- профиль */
    function drawSettings(body, flash) {
      /* согласие проверено на конкретное имя — после этого имя меняет редакция */
      var nameLocked = consentKey() === "approved";
      body.innerHTML = flash +
        '<div data-email-card class="cab-block cab-block--first"></div>' +
        head("Настройки", "Профиль автора") +
        '<div class="cab-ava-row">' +
        (user.avatar ? '<img class="cab-ava cab-ava--lg" src="' + esc(user.avatar) + '" alt="">'
          : '<span class="cab-ava cab-ava--lg cab-ava--mono">' + esc(Store.initials(user.name)) + "</span>") +
        '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-avatar-open>Загрузить фото</button>' +
        (user.avatar ? '<button class="btn btn--sm btn--ghost" type="button" data-avatar-clear>Убрать фото</button>' : "") +
        '<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-avatar-input>' +
        '<span class="form__note" data-avatar-note></span></div></div>' +
        '<form class="form cab-form" data-profile-form>' +
        '<div class="field"><label for="p-name">Имя и фамилия</label><input id="p-name" name="name" type="text" maxlength="80" value="' + esc(user.name) + '"' +
        (nameLocked ? " disabled" : "") + ">" +
        (nameLocked ? '<small class="form__note">Имя закреплено согласием на обработку данных. Изменить его можно через <a class="link-accent" href="/support">поддержку</a>.</small>' : "") + "</div>" +
        '<div class="field"><label>Почта</label><input type="text" value="' + esc(user.email) + '" disabled></div>' +
        '<div class="field"><label for="p-role">Направление</label><select id="p-role" name="role">' +
        Store.ROLES.map(function (r) { return "<option" + (r === user.role ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("") + "</select></div>" +
        '<div class="field"><label for="p-region">Регион</label><select id="p-region" name="region"><option value="">Не выбран</option>' +
        ui.regionOptions(user.region) + "</select></div>" +
        '<div class="field form__full"><label for="p-bio">О себе</label><textarea id="p-bio" name="bio" maxlength="600" ' +
        'placeholder="Пара предложений: о чём хотите рассказывать">' + esc(user.bio || "") + "</textarea></div>" +
        '<div class="form__full row"><button class="btn" type="submit">Сохранить</button><span class="form__note" data-profile-status></span></div></form>' +

        '<div class="cab-block">' + head("Безопасность", "Пароль") +
        '<form class="form cab-form" data-pass-form>' +
        '<div class="field"><label for="p-old">Текущий пароль</label><input id="p-old" name="oldPass" type="password" autocomplete="current-password"></div>' +
        '<div class="field"><label for="p-new">Новый пароль</label><input id="p-new" name="newPass" type="password" placeholder="От 8 символов" autocomplete="new-password"></div>' +
        '<div class="form__full row"><button class="btn btn--sm btn--ghost" type="submit">Сменить пароль</button><span class="form__note" data-pass-note></span></div></form></div>' +
        '<div data-twofa-card class="cab-block"></div>' +
        '<div data-recovery-card class="cab-block"></div>' +
        '<div class="cab-block">' + head("Оформление", "Цвет интерфейса") + ui.swatchesHtml() +
        '<p class="form__note" style="margin:8px 0 0">Выбор запоминается в этом браузере.</p></div>' +
        '<div data-danger-zone class="cab-block"></div>';

      ui.mounts.emailCard(user);
      ui.mounts.twofa(user);
      ui.mounts.recovery();
      ui.mounts.danger(user);
      ui.syncAccent();

      var form = $("[data-profile-form]", body);
      var status = $("[data-profile-status]", form);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        status.textContent = "Сохраняем…";
        Store.saveProfile({ name: nameLocked ? user.name : fieldValue(form, "name").trim(), bio: fieldValue(form, "bio").trim(),
          region: fieldValue(form, "region"), role: fieldValue(form, "role") })
          .then(function (res) {
            if (res && res.ok) { state.flash = "Профиль сохранён."; drawShell(); drawTab(); }
            else status.textContent = (res && res.error) || "Не сохранилось.";
          });
      });

      var passForm = $("[data-pass-form]", body);
      var passNote = $("[data-pass-note]", passForm);
      passForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var oldPass = fieldValue(passForm, "oldPass"), newPass = fieldValue(passForm, "newPass");
        if (!oldPass || newPass.length < 8) { passNote.textContent = "Введите текущий пароль и новый — не короче 8 символов."; return; }
        passNote.textContent = "Меняем…";
        Store.changePassword(oldPass, newPass).then(function (res) {
          if (res && res.ok === false) { passNote.textContent = res.error || "Пароль не сменился."; return; }
          passForm.reset();
          passNote.textContent = "Пароль изменён. На других устройствах нужно войти заново.";
        }, function (err) { passNote.textContent = (err && err.message) || "Пароль не сменился."; });
      });

      var input = $("[data-avatar-input]", body);
      var avaNote = $("[data-avatar-note]", body);
      $("[data-avatar-open]", body).addEventListener("click", function () { input.click(); });
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) return;
        avaNote.textContent = "Загружаем…";
        ui.avatarToSquare(file).then(function (dataUrl) {
          return Store.saveProfile({ name: user.name, avatar: dataUrl });
        }).then(function (res) {
          if (res && res.ok) { state.flash = "Фото обновлено."; drawShell(); drawTab(); }
          else avaNote.textContent = (res && res.error) || "Фото не загрузилось.";
        });
      });
      var clear = $("[data-avatar-clear]", body);
      if (clear) clear.addEventListener("click", function () {
        Store.saveProfile({ name: user.name, avatarClear: true }).then(function () { drawShell(); drawTab(); });
      });
    }

    /* -------------------------------------------------------------- запуск */
    drawShell();
    drawTab();
    window.addEventListener("hashchange", function () {
      drawTab();
      try { window.scrollTo(0, 0); } catch (e) {}
    });

    function refresh() {
      var jobs = [
        Store.refreshMe().then(function () { user = Store.currentUser() || user; }),
        Store.refreshConsent().then(function (c) { state.consent = c; }),
        Store.refreshCard().then(function (c) { if (c) state.card = c; }),
        Store.syncMine(),
        Store.messagesMine().then(function (list) { state.messages = list || []; }),
        Store.editorialMine().then(function (res) { state.editorial = res; }, function () {}),
        Store.editorialOpenMine().then(function (res) { state.open = res; }, function () {}),
        Store.withToken("points-history", {}).then(function (res) { state.points = res.balance || 0; }, function () { state.points = 0; }),
        Store.refreshPortfolio(),
      ];
      var left = jobs.length;
      var redraw = function () {
        left--;
        if (left > 0) return;
        state.loaded = true;
        if (!Store.hasToken()) { window.location.replace("/join?next=profile#login"); return; }
        /* не перерисовываем вкладку, если человек уже печатает в форме */
        var active = document.activeElement;
        var typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && host.contains(active);
        drawShellHead();
        if (!typing) drawTab(); else drawTabs();
      };
      jobs.forEach(function (job) { Promise.resolve(job).then(redraw, redraw); });
    }

    function drawShellHead() {
      var meta = $(".cab-head__meta", host);
      if (meta) {
        meta.textContent = (user.role || "Автор") + (user.region ? " · " + ui.regionName(user.region) : "") +
          (user.access && user.access !== "Пользователь" ? " · " + user.access : "");
      }
    }

    refresh();
  };
})();
