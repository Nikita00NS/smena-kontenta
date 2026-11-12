/* ============================================================================
   СТРАНИЦЫ ДОКУМЕНТОВ

   /verify          проверка пресс-карты по номеру — открыта всем
   /card-doc        документ о присвоении пресс-карты — владельцу и редакции
   /editorial-doc   заявление на открытие редакции — заявителю и редакции

   Документы собираются в браузере из данных сервера и печатаются обычной
   печатью (Ctrl+P → «Сохранить как PDF»). Реквизиты проекта — из SC.project,
   то есть из tools/docs/project.json: там же, откуда берут их PDF-документы.

   Файл подключается перед app.js и получает от него общие помощники (ui).
   ========================================================================== */
(function () {
  "use strict";

  window.SCPages = window.SCPages || {};

  var CARD_STATE = {
    issued: ["Карта действует", "is-good", "действует"],
    suspended: ["Карта приостановлена", "is-warn", "приостановлена"],
    revoked: ["Карта отозвана", "is-bad", "отозвана"],
    expired: ["Срок действия истёк", "is-bad", "срок действия истёк"],
    annulled: ["Карта заменена новой", "is-bad", "заменена новой"],
    rejected: ["Карта не выдавалась", "is-bad", "не выдавалась"],
    pending: ["Карта ещё не выдана", "is-warn", "заявка на рассмотрении"],
  };

  function project(ui) {
    var p = (ui.SC && ui.SC.project) || {};
    return {
      name: p.nameQuoted || "«Смена контента»",
      site: p.siteShort || "smenakontenta.ru",
      city: p.city || "Москва",
      director: p.director || { name: "", short: "", dative: "", position: "Генеральный директор", positionDative: "Генеральному директору" },
      cofounder: p.cofounder || { name: "", short: "", position: "Сооснователь" },
      operator: p.operator || { name: "", instrumental: "" },
      mail: p.mail || {},
      card: p.card || { minPosts: 5, validYears: 1 },
      editorial: p.editorial || { reportDay: 5 },
    };
  }

  /* «12 ноября 2026 г.» — так даты пишут в документах */
  function docDate(ui, iso) {
    if (!iso) return "—";
    var text = ui.fmtDate(iso);
    return text ? text + " г." : "—";
  }

  function phone(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (d.length === 11 && (d[0] === "7" || d[0] === "8")) {
      return "+7 " + d.slice(1, 4) + " " + d.slice(4, 7) + "-" + d.slice(7, 9) + "-" + d.slice(9);
    }
    return String(raw || "");
  }
  window.SCFormat = { phone: phone };

  function facts(esc, rows) {
    return '<dl class="doc-facts">' + rows.filter(function (r) { return r && r[1]; }).map(function (r) {
      return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>";
    }).join("") + "</dl>";
  }

  /* Экран вместо документа: вход, отказ, ошибка. */
  function notice(esc, title, text, href, label) {
    return '<section class="section wrap"><div class="gate gate--page"><span class="kicker">Документ</span><h1>' + esc(title) + "</h1>" +
      '<p class="lead">' + esc(text) + "</p>" +
      '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:18px"><a class="btn btn--accent" href="' + esc(href) + '">' + esc(label) + "</a>" +
      '<a class="btn btn--ghost" href="/">На главную</a></div></div></section>';
  }

  function toolbar(esc, backHref, backLabel, hint) {
    return '<div class="doc-bar wrap" data-doc-bar><a class="btn btn--sm btn--ghost" href="' + esc(backHref) + '">← ' + esc(backLabel) + "</a>" +
      '<button class="btn btn--sm btn--accent" type="button" data-doc-print>Печать или PDF</button>' +
      '<span class="form__note">' + esc(hint) + "</span></div>";
  }

  function bindPrint(ui, root) {
    var btn = ui.$("[data-doc-print]", root);
    if (btn) btn.addEventListener("click", function () { window.print(); });
  }

  /* ------------------------------------------------------- проверка карты */
  window.SCPages.verify = function (ui) {
    var $ = ui.$, esc = ui.esc, Store = ui.Store;
    var host = $("[data-verify]");
    if (!host) return;
    var p = project(ui);

    host.innerHTML =
      '<section class="page-hero"><div class="wrap page-hero__grid"><div><span class="kicker">Пресс-карта</span>' +
      "<h1>Проверка<br>пресс-карты</h1></div>" +
      '<div class="page-hero__aside"><p class="lead">Введите номер карты — сайт покажет, выдавал ли её проект ' + esc(p.name) +
      ", кому и действует ли она сейчас.</p></div></div></section>" +
      '<section class="section wrap verify">' +
      '<form class="verify__form" data-verify-form novalidate>' +
      '<label class="visually-hidden" for="verify-number">Номер карты</label>' +
      '<input id="verify-number" name="number" type="text" placeholder="СК-2026-0001" autocomplete="off" autocapitalize="characters" maxlength="24" spellcheck="false">' +
      '<button class="btn btn--accent" type="submit">Проверить</button></form>' +
      '<p class="form__note" data-verify-note role="status">Номер стоит в документе о присвоении карты: буквы СК, год и четыре цифры.</p>' +
      '<div data-verify-result aria-live="polite"></div>' +
      '<div class="verify__about"><h2>Что означает ответ</h2><ul class="cab-rules">' +
      "<li><b>Карта действует</b> — человек является автором проекта, карта выдана и не истекла.</li>" +
      "<li><b>Приостановлена</b> — редакция временно остановила действие карты.</li>" +
      "<li><b>Отозвана, истекла или заменена</b> — документ больше ничего не подтверждает.</li>" +
      "<li><b>Не найдена</b> — карты с таким номером проект не выдавал.</li></ul>" +
      '<p class="form__note">Пресс-карта проекта подтверждает участие в молодёжном медиа ' + esc(p.name) +
      ". Она не является удостоверением журналиста средства массовой информации.</p></div></section>";

    var form = $("[data-verify-form]", host);
    var input = $("#verify-number", host);
    var note = $("[data-verify-note]", host);
    var box = $("[data-verify-result]", host);

    function show(res) {
      if (!res.found) {
        box.innerHTML = '<article class="verify-card is-bad"><div class="verify-card__state">Карта не найдена</div>' +
          '<div class="verify-card__num">' + esc(res.number || "") + "</div>" +
          "<p>Карты с таким номером проект не выдавал. Проверьте номер: буквы СК, год, четыре цифры.</p></article>";
        return;
      }
      var st = CARD_STATE[res.state] || CARD_STATE.revoked;
      box.innerHTML = '<article class="verify-card ' + st[1] + '"><div class="verify-card__state">' + esc(st[0]) + "</div>" +
        '<div class="verify-card__num">' + esc(res.number) + "</div>" +
        facts(esc, [
          ["Владелец", res.name],
          ["Направление", res.role],
          ["Регион", ui.regionName(res.region)],
          ["Редакция", res.editorial],
          ["Выдана", res.issuedAt ? docDate(ui, res.issuedAt) : ""],
          [res.state === "issued" ? "Действует до" : "Срок действия был до", res.validUntil ? docDate(ui, res.validUntil) : ""],
        ]) +
        (res.valid ? "" : "<p>Этот документ сейчас не подтверждает участие в проекте.</p>") +
        '<p class="form__note">Проверено ' + esc(ui.fmtWhen(new Date().toISOString())) + " по реестру проекта.</p></article>";
    }

    function run(number) {
      note.textContent = "Проверяем…";
      box.innerHTML = "";
      Store.cardVerify(number).then(function (res) {
        if (!res || !res.ok) {
          note.textContent = (res && res.error) || "Проверка не удалась. Попробуйте ещё раз.";
          return;
        }
        note.textContent = "";
        show(res);
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var number = input.value.trim();
      if (number.length < 5) { note.textContent = "Введите номер карты полностью: СК-2026-0001."; input.focus(); return; }
      run(number);
    });

    var given = ui.param("n");
    if (given) { input.value = given; run(given); }
  };

  /* -------------------------------------- документ о присвоении пресс-карты */
  window.SCPages["card-doc"] = function (ui) {
    var $ = ui.$, esc = ui.esc, Store = ui.Store;
    var host = $("[data-card-doc]");
    if (!host) return;
    var p = project(ui);
    var id = ui.param("id") || "";

    if (!Store.currentUser()) {
      host.innerHTML = notice(esc, "Нужно войти", "Документ о пресс-карте открывается владельцу карты и редакции.",
        "/join?next=" + encodeURIComponent("card-doc" + (id ? "?id=" + id : "")) + "#login", "Войти");
      return;
    }
    host.innerHTML = '<section class="section wrap"><p class="no-data">Собираем документ…</p></section>';

    Store.cardDoc(id).then(function (d) {
      var c = d.card, h = d.holder;
      var st = CARD_STATE[c.state] || CARD_STATE.revoked;
      var basis = d.byRole
        ? "участие в работе редакции проекта (карта выдана по должности)"
        : "опубликовано не менее " + (p.card.minPosts || 5) + " материалов на сайте проекта";
      var back = d.own ? ["/profile#card", "В кабинет"] : ["/admin#cards", "К картам"];

      host.innerHTML =
        toolbar(esc, back[0], back[1], d.canPrint
          ? "В окне печати выберите «Сохранить как PDF», чтобы получить файл."
          : "Карта недействительна: документ открыт только для справки.") +
        '<article class="doc-sheet" data-doc-sheet>' +
        '<header class="doc-sheet__head"><div><b>' + esc(p.name) + "</b><span>молодёжное медиа · " + esc(p.site) + "</span></div>" +
        '<div class="doc-sheet__stamp ' + st[1] + '">' + esc(st[2]) + "</div></header>" +
        '<h1 class="doc-sheet__title">Решение № ' + esc(c.number) + "<small>о присвоении пресс-карты автора</small></h1>" +
        '<p class="doc-sheet__place"><span>г. ' + esc(p.city) + "</span><span>" + esc(docDate(ui, c.issuedAt)) + "</span></p>" +
        '<p>Настоящим подтверждается, что</p><p class="doc-sheet__name">' + esc(h.name) + "</p>" +
        "<p>является автором молодёжного медиа " + esc(p.name) + ", и ему (ей) присвоена пресс-карта автора проекта.</p>" +
        facts(esc, [
          ["Номер карты", c.number],
          ["Направление", h.craft],
          ["Должность в проекте", h.access && h.access !== "Пользователь" ? h.access : ""],
          ["Регион", ui.regionName(h.region)],
          ["Редакция", h.editorial],
          ["Номер участника", h.number ? "№ " + h.number : ""],
          ["Основание", basis],
          ["Дата выдачи", docDate(ui, c.issuedAt)],
          ["Действует до", docDate(ui, c.validUntil)],
          ["Состояние на " + ui.fmtDate(new Date().toISOString()), st[2] + (c.note && c.state !== "issued" ? ": " + c.note : "")],
        ]) +
        '<p class="doc-sheet__small">Пресс-карта подтверждает участие в проекте ' + esc(p.name) + " и действует один год. " +
        "Она не является удостоверением журналиста средства массовой информации и не даёт прав, установленных законом для журналистов. " +
        "Редакция вправе приостановить или отозвать карту при нарушении правил проекта.</p>" +
        '<p class="doc-sheet__small">Подлинность и текущее состояние карты проверяются по номеру на странице <b>' + esc(p.site) + "/verify</b>. " +
        "Документ сформирован в электронном виде; при расхождении с реестром проекта действуют данные реестра.</p>" +
        '<div class="doc-signs">' +
        '<div class="doc-sign"><span>' + esc(p.director.position) + '</span><i></i><b>' + esc(p.director.short) + "</b></div>" +
        '<div class="doc-sign"><span>' + esc(p.cofounder.position) + '</span><i></i><b>' + esc(p.cofounder.short) + "</b></div></div>" +
        (d.issuedBy ? '<p class="doc-sheet__small">Решение о выдаче внёс в реестр: ' + esc(d.issuedBy) + ".</p>" : "") +
        "</article>";
      document.title = "Пресс-карта " + c.number + " — " + h.name;
      bindPrint(ui, host);
    }, function (err) {
      host.innerHTML = notice(esc, "Документ недоступен", (err && err.message) || "Не удалось получить данные карты.", "/profile#card", "В кабинет");
    });
  };

  /* ------------------------------------------ заявление на открытие редакции */
  window.SCPages["editorial-doc"] = function (ui) {
    var $ = ui.$, esc = ui.esc, Store = ui.Store;
    var host = $("[data-editorial-doc]");
    if (!host) return;
    var p = project(ui);
    var id = ui.param("id") || "";

    if (!Store.currentUser()) {
      host.innerHTML = notice(esc, "Нужно войти", "Заявление открывается заявителю и редакции проекта.",
        "/join?next=" + encodeURIComponent("editorial-doc" + (id ? "?id=" + id : "")) + "#login", "Войти");
      return;
    }
    host.innerHTML = '<section class="section wrap"><p class="no-data">Собираем заявление…</p></section>';

    function ageOf(iso) {
      var b = new Date(iso);
      if (isNaN(b.getTime())) return null;
      var now = new Date();
      var age = now.getFullYear() - b.getFullYear();
      if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
      return age;
    }

    Store.editorialOpenGet(id).then(function (d) {
      var a = d.application;
      var f = a.form || {};
      var cur = f.curator || {};
      var team = f.team || [];
      var minor = ageOf(f.headBirth) !== null && ageOf(f.headBirth) < 18;
      var base = ((d.bases || {})[f.base] || "") + (f.baseName ? " — " + f.baseName : "");
      var back = d.own ? ["/profile#editorial", "В кабинет"] : ["/admin#editorials", "К заявлениям"];
      var draft = a.status === "draft";

      host.innerHTML =
        toolbar(esc, back[0], back[1], draft
          ? "Это черновик: заявление получит номер после кнопки «Сформировать заявление» в кабинете."
          : "Распечатайте, подпишите и отправьте скан на " + (d.mailTo || p.mail.editorial || "") + ".") +
        '<article class="doc-sheet" data-doc-sheet>' +
        '<div class="doc-sheet__to">' +
        "<p>" + esc(p.director.positionDative) + "<br>проекта " + esc(p.name) + "<br>" + esc(p.director.dative) + "</p>" +
        "<p>от " + esc(f.headName || a.applicant.name) +
        (f.headBirth ? ",<br>дата рождения: " + esc(docDate(ui, f.headBirth)) : "") +
        (f.headPhone ? "<br>телефон: " + esc(phone(f.headPhone)) : "") +
        "<br>электронная почта: " + esc(a.applicant.email) + "</p></div>" +
        '<h1 class="doc-sheet__title">Заявление' + (a.number ? " № " + esc(a.number) : "") + "<small>на открытие редакции</small></h1>" +
        "<p>Прошу открыть в проекте " + esc(p.name) + " редакцию <b>«" + esc(f.name || "") + "»</b>" +
        " (" + esc(ui.regionName(f.region) || "") + (f.city ? ", " + esc(f.city) : "") + ")" +
        (base ? ", которая работает на базе: " + esc(base) : "") + ".</p>" +
        (f.about ? "<p><b>О редакции.</b> " + esc(f.about) + "</p>" : "") +
        (f.plan ? "<p><b>План выпуска.</b> " + esc(f.plan) + "</p>" : "") +
        (f.links ? "<p><b>Страницы редакции.</b> " + esc(f.links) + "</p>" : "") +
        "<p><b>Руководитель редакции:</b> " + esc(f.headName || "") + (f.headBirth ? ", дата рождения " + esc(docDate(ui, f.headBirth)) : "") + ".</p>" +
        (cur.name
          ? "<p><b>Куратор редакции</b> (совершеннолетний, отвечает за работу редакции вместе с руководителем): " + esc(cur.name) +
            (cur.role ? ", " + esc(cur.role) : "") + (cur.phone ? ", телефон " + esc(phone(cur.phone)) : "") +
            (cur.email ? ", почта " + esc(cur.email) : "") + ".</p>"
          : "") +
        "<p><b>Состав редакции</b> (кроме руководителя):</p>" +
        '<ol class="doc-sheet__list">' + team.map(function (m) {
          return "<li>" + esc(m.name) + (m.role ? " — " + esc(m.role) : "") + (m.age ? ", " + esc(String(m.age)) + " " + ui.plural(Number(m.age), ["год", "года", "лет"]) : "") + "</li>";
        }).join("") + "</ol>" +
        "<p>Подтверждаю, что:</p>" +
        '<ul class="doc-sheet__list">' +
        "<li>сведения, указанные в заявлении, достоверны;</li>" +
        "<li>с Положением о редакции проекта ознакомлен(а) и обязуюсь его соблюдать;</li>" +
        "<li>каждый участник редакции сам регистрируется на сайте и подаёт согласие на обработку персональных данных; " +
        "за участника младше 18 лет согласие подписывает также его родитель или иной законный представитель;</li>" +
        "<li>редакция сдаёт отчёт о работе раз в месяц, до " + esc(String(p.editorial.reportDay || 5)) + "-го числа.</li></ul>" +
        '<p class="doc-sheet__small">Персональные данные, указанные в заявлении, обрабатывает оператор — ' + esc(p.operator.name || "") +
        " — на основании согласия заявителя, поданного в личном кабинете, для рассмотрения заявления и работы редакции.</p>" +
        '<div class="doc-signs doc-signs--col">' +
        '<div class="doc-sign"><span>Руководитель редакции</span><i></i><b>' + esc(f.headName || "") + "</b><em>«___» ____________ 20___ г.</em></div>" +
        (cur.name || minor
          ? '<div class="doc-sign"><span>Куратор редакции</span><i></i><b>' + esc(cur.name || "") + "</b><em>«___» ____________ 20___ г.</em></div>"
          : "") +
        "</div>" +
        '<div class="doc-sheet__office"><b>Отметки проекта</b>' +
        "<p>Заявление получено «___» ____________ 20___ г.</p>" +
        "<p>Решение: открыть редакцию / отказать (нужное подчеркнуть).</p>" +
        '<div class="doc-sign"><span>' + esc(p.director.position) + '</span><i></i><b>' + esc(p.director.short) + "</b></div></div>" +
        "</article>";
      document.title = "Заявление " + (a.number || "— черновик") + " — редакция «" + (f.name || "") + "»";
      bindPrint(ui, host);
    }, function (err) {
      host.innerHTML = notice(esc, "Заявление недоступно", (err && err.message) || "Не удалось получить заявление.", "/profile#editorial", "В кабинет");
    });
  };
})();
