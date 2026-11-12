/* ============================================================================
   ОТЧЁТЫ РЕДАКЦИЙ

   Раз в месяц руководитель региональной редакции сдаёт отчёт: текст пишет
   сам, цифры считает сервер. Центральная редакция читает и принимает отчёты.

   window.SCReports.cabinet(box, user, ui, editorial)  — кабинет, вкладка «Редакция»
   window.SCReports.admin(panel, user, ui, kit)        — панель, раздел «Редакции»

   Файл подключается на страницах /profile и /admin перед app.js.
   ========================================================================== */
(function () {
  "use strict";

  var STATUS = {
    none: ["не сдан", "status--draft"],
    draft: ["черновик", "status--draft"],
    sent: ["на проверке", "status--pending"],
    accepted: ["принят", "status--pub"],
    returned: ["возвращён", "status--bad"],
  };

  var FIELDS = [
    ["done", "Что сделано за месяц", "Вышедшие материалы, рубрики, съёмки, работа с новичками — своими словами.", 5, true],
    ["events", "События и выезды", "Где были, что освещали, с кем работали. Если ничего не было — оставьте пустым.", 3, false],
    ["problems", "Что мешает и какая нужна помощь", "Техника, доступ на мероприятия, наставник, вопросы к центральной редакции.", 3, false],
    ["plans", "Планы на следующий месяц", "Темы, форматы, сколько материалов рассчитываете выпустить.", 3, false],
  ];

  function pill(esc, key) {
    var st = STATUS[key] || STATUS.none;
    return '<span class="status ' + st[1] + '">' + esc(st[0]) + "</span>";
  }

  /* цифры редакции за месяц: одна и та же плашка в кабинете и в панели */
  function statsHtml(esc, s) {
    if (!s) return "";
    var cells = [
      [s.published, "опубликовано"],
      [s.submitted, "отправлено на проверку"],
      [s.rejected, "возвращено авторам"],
      [s.authors, "авторов писали"],
      [s.members, "в штате сейчас"],
      [s.cards, "с пресс-картой"],
    ];
    var extra = [];
    if (s.joined || s.left) extra.push("пришло: " + (s.joined || 0) + ", ушло: " + (s.left || 0));
    if (s.pending) extra.push("ждёт проверки сейчас: " + s.pending);
    if (s.formats && s.formats.length) {
      extra.push("форматы: " + s.formats.map(function (f) { return f.name + " — " + f.count; }).join(", "));
    }
    if (s.top && s.top.length) {
      extra.push("больше всех публикаций: " + s.top.map(function (t) { return t.name + " (" + t.published + ")"; }).join(", "));
    }
    return '<div class="rep-stats">' + cells.map(function (c) {
      return "<div><b>" + esc(String(c[0] || 0)) + "</b><span>" + esc(c[1]) + "</span></div>";
    }).join("") + "</div>" +
      (extra.length ? '<p class="form__note rep-stats__note">' + esc(extra.join(" · ")) + "</p>" : "");
  }

  function formText(esc, form) {
    form = form || {};
    return FIELDS.map(function (f) {
      var value = String(form[f[0]] || "").trim();
      if (!value) return "";
      return '<div class="rep-text"><h4>' + esc(f[1]) + "</h4><p>" + esc(value) + "</p></div>";
    }).join("");
  }

  /* ------------------------------------------------------------- кабинет */
  function cabinet(box, user, ui, editorial) {
    var $ = ui.$, $$ = ui.$$, esc = ui.esc, Store = ui.Store;
    var open = "";       // период, форма которого сейчас раскрыта
    var flash = "";

    function dueText(iso) {
      return ui.fmtDate(iso);
    }

    function row(p) {
      var r = p.report;
      var editable = p.status === "none" || p.status === "draft" || p.status === "returned";
      var isOpen = open === p.period;
      var meta = [];
      if (p.status === "accepted" && r) meta.push("принят " + ui.fmtDate(r.decidedAt));
      else if (p.status === "sent" && r) meta.push("отправлен " + ui.fmtDate(r.sentAt) + (r.late ? ", позже срока" : ""));
      else meta.push(p.overdue ? "срок прошёл " + dueText(p.due) : "сдать до " + dueText(p.due));
      var form = (r && r.form) || {};
      return '<article class="cab-card rep-item' + (p.overdue ? " rep-item--late" : "") + '" data-period="' + esc(p.period) + '">' +
        '<div class="cab-card__top"><div><h3>' + esc(cap(p.title)) + "</h3><small class=\"form__note\">" + esc(meta.join(" · ")) + "</small></div>" +
        pill(esc, p.status) + "</div>" +
        (p.status === "returned" && r && r.note
          ? '<p class="cab-post__note cab-post__note--err"><b>Вернули на доработку:</b> ' + esc(r.note) + "</p>" : "") +
        (p.status === "accepted" && r && r.note ? '<p class="cab-post__note"><b>Комментарий редакции:</b> ' + esc(r.note) + "</p>" : "") +
        (isOpen
          ? statsHtml(esc, p.stats) +
            (editable
              ? '<form class="form cab-form rep-form" data-rep-form novalidate>' +
                FIELDS.map(function (f) {
                  return '<div class="field form__full"><label for="rep-' + f[0] + '">' + esc(f[1]) + (f[4] ? "" : " <small>(необязательно)</small>") + "</label>" +
                    '<textarea id="rep-' + f[0] + '" name="' + f[0] + '" rows="' + f[3] + '" maxlength="3000" placeholder="' + esc(f[2]) + '">' +
                    esc(form[f[0]] || "") + "</textarea></div>";
                }).join("") +
                '<div class="form__full row" style="gap:10px;flex-wrap:wrap;align-items:center">' +
                '<button class="btn btn--accent" type="submit" data-rep-send>Отправить отчёт</button>' +
                '<button class="btn btn--ghost" type="button" data-rep-draft>Сохранить черновик</button>' +
                '<button class="btn btn--ghost" type="button" data-rep-close>Свернуть</button>' +
                '<span class="form__note" data-rep-note role="status"></span></div>' +
                '<p class="form__full form__note">Цифры выше сайт подставит в отчёт сам — в момент отправки.</p></form>'
              : formText(esc, form) +
                '<div class="cab-card__actions"><button class="btn btn--sm btn--ghost" type="button" data-rep-close>Свернуть</button></div>')
          : '<div class="cab-card__actions"><button class="btn btn--sm' + (editable ? "" : " btn--ghost") + '" type="button" data-rep-open>' +
            (p.status === "none" ? "Заполнить отчёт" : p.status === "draft" ? "Продолжить" : p.status === "returned" ? "Исправить" : "Посмотреть") +
            "</button></div>") +
        "</article>";
    }

    function cap(s) {
      s = String(s || "");
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function draw(res) {
      var cur = res.current;
      var periods = res.periods || [];
      var late = periods.filter(function (p) { return p.overdue; }).length;
      box.innerHTML =
        '<div class="cab-sec"><span class="kicker">Отчёты</span><h2>Отчёты редакции</h2>' +
        '<p class="cab-sec__text">Раз в месяц, до ' + (res.reportDay || 5) + "-го числа, руководитель сдаёт короткий отчёт за прошлый месяц. " +
        "Текст пишете вы, цифры сайт считает сам. Отчёт читает центральная редакция.</p></div>" +
        (flash ? '<p class="cab-flash" role="status">' + esc(flash) + "</p>" : "") +
        (late ? '<p class="gate"><b>Не сдано отчётов: ' + late + ".</b> Срок прошёл — заполните их ниже.</p>" : "") +
        (cur
          ? '<div class="rep-now"><h3 class="cab-sub">Сейчас: ' + esc(cur.title) + "</h3>" + statsHtml(esc, cur.stats) +
            '<p class="form__note">Отчёт за ' + esc(cur.title) + " можно будет сдать, когда месяц закончится; срок — до " + esc(dueText(cur.due)) + ".</p></div>"
          : "") +
        (periods.length
          ? '<h3 class="cab-sub">Отчёты по месяцам</h3>' + periods.map(row).join("")
          : '<p class="form__note">Первый отчёт — за месяц, в котором открылась редакция.</p>');
      flash = "";

      $$("[data-period]", box).forEach(function (el) {
        var period = el.getAttribute("data-period");
        var openBtn = $("[data-rep-open]", el);
        if (openBtn) openBtn.addEventListener("click", function () { open = period; draw(res); });
        var closeBtn = $("[data-rep-close]", el);
        if (closeBtn) closeBtn.addEventListener("click", function () { open = ""; draw(res); });
        var form = $("[data-rep-form]", el);
        if (!form) return;
        var note = $("[data-rep-note]", el);
        function collect() {
          var out = {};
          FIELDS.forEach(function (f) { out[f[0]] = form.querySelector('[name="' + f[0] + '"]').value.trim(); });
          return out;
        }
        function save(send, btn) {
          var data = collect();
          if (send && data.done.length < 30) {
            note.textContent = "Расскажите, что сделано за месяц: хотя бы 30 символов.";
            form.querySelector('[name="done"]').focus();
            return;
          }
          btn.disabled = true;
          note.textContent = send ? "Отправляем…" : "Сохраняем…";
          Store.withToken("report-save", { period: period, form: data, send: send }).then(function () {
            flash = send ? "Отчёт отправлен. Решение придёт в «Сообщения» и на почту." : "Черновик сохранён.";
            if (send) open = "";
            load();
          }, function (err) {
            btn.disabled = false;
            note.textContent = (err && err.message) || "Не сохранилось. Попробуйте ещё раз.";
          });
        }
        form.addEventListener("submit", function (e) { e.preventDefault(); save(true, $("[data-rep-send]", el)); });
        $("[data-rep-draft]", el).addEventListener("click", function () { save(false, $("[data-rep-draft]", el)); });
      });
    }

    function load() {
      if (!box.innerHTML) box.innerHTML = '<p class="no-data">Загружаем отчёты…</p>';
      Store.withToken("report-mine", {}).then(function (res) {
        if (!res.editorial) { box.innerHTML = ""; return; }
        draw(res);
      }, function (err) {
        box.innerHTML = '<p class="form__note">Отчёты не загрузились: ' + esc((err && err.message) || "нет связи с сервером") + "</p>";
      });
    }
    load();
  }

  /* -------------------------------------------------------------- панель */
  function admin(panel, user, ui, kit) {
    var $ = ui.$, $$ = ui.$$, esc = ui.esc;
    var sec = kit.section(panel, "reports", "Редакции", "Отчёты редакций",
      "Руководитель редакции сдаёт отчёт за месяц до пятого числа следующего. Цифры в отчёте посчитал сайт в момент отправки; " +
      "текст написал руководитель. Примите отчёт или верните с замечанием — руководитель увидит его в кабинете.");
    sec.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
    $("[data-reload]", sec.tools).addEventListener("click", reload);

    function item(r) {
      var waiting = r.status === "sent";
      return '<article class="adm-item" data-report="' + esc(r.id) + '">' +
        '<div class="adm-item__top"><h3>' + esc(r.editorialName) + " — " + esc(r.title) + "</h3>" + pill(esc, r.status) + "</div>" +
        '<p class="adm-item__meta">' + esc(ui.regionName(r.region) || "") + " · отправил " + esc(r.sentBy || "руководитель") + ", " + esc(kit.when(r.sentAt)) +
        (r.late ? " · позже срока (до " + esc(kit.day(r.due)) + ")" : "") +
        (!waiting && r.decidedBy ? " · решение: " + esc(r.decidedBy) + ", " + esc(kit.day(r.decidedAt)) : "") + "</p>" +
        statsHtml(esc, r.stats) + formText(esc, r.form) +
        (r.note ? '<p class="adm-item__lead">Комментарий: ' + esc(r.note) + "</p>" : "") +
        (waiting
          ? '<div class="adm-item__actions">' +
            '<input type="text" class="adm-input" placeholder="Комментарий или что дополнить" data-note maxlength="600" aria-label="Комментарий к отчёту">' +
            '<button class="btn btn--sm btn--accent" type="button" data-decide="accepted">Принять</button>' +
            '<button class="btn btn--sm btn--ghost" type="button" data-decide="returned">Вернуть на доработку</button></div>'
          : "") +
        "</article>";
    }

    function reload() {
      kit.load(sec, "report-queue", {}, function (res) {
        var list = res.reports || [];
        var waiting = list.filter(function (r) { return r.status === "sent"; });
        var done = list.filter(function (r) { return r.status !== "sent"; });
        var missing = res.missing || [];
        sec.body.innerHTML =
          (waiting.length ? waiting.map(item).join("") : kit.emptyNote("Новых отчётов нет.")) +
          (missing.length
            ? '<h3 class="adm-sub">Не сдали отчёт: ' + missing.length + "</h3>" +
              '<div class="adm-table">' + missing.map(function (m) {
                return '<div class="adm-row"><div><b>' + esc(m.editorialName) + "</b><small>" + esc(ui.regionName(m.region) || "") +
                  " · руководитель — " + esc(m.headName || "") + "</small></div>" +
                  '<div class="adm-row__kv">' + esc(m.title) + " · срок был " + esc(kit.day(m.due)) +
                  (m.status === "returned" ? " · возвращён, не исправлен" : m.status === "draft" ? " · есть черновик" : "") + "</div></div>";
              }).join("") + "</div>"
            : "") +
          (done.length
            ? '<details class="adm-more"><summary>Разобранные: ' + done.length + "</summary>" + done.map(item).join("") + "</details>"
            : "");
        $$("[data-report]", sec.body).forEach(function (el) {
          var id = el.getAttribute("data-report");
          var note = $("[data-note]", el);
          $$("[data-decide]", el).forEach(function (btn) {
            btn.addEventListener("click", function () {
              var decision = btn.getAttribute("data-decide");
              var text = note ? note.value.trim() : "";
              if (decision === "returned" && text.length < 5) {
                sec.status.textContent = "Напишите, что дополнить: руководитель увидит это в кабинете.";
                if (note) note.focus();
                return;
              }
              kit.act(sec, "report-review", { id: id, decision: decision, note: text }, function () {
                sec.status.textContent = decision === "accepted" ? "Отчёт принят, руководитель получил уведомление." : "Отчёт возвращён, руководитель получил замечание.";
                reload();
              }, btn);
            });
          });
        });
      });
    }
    reload();
  }

  window.SCReports = { cabinet: cabinet, admin: admin, statsHtml: statsHtml };
})();
