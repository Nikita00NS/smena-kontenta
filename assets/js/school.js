/* ============================================================================
   МЕДИАШКОЛА

   Курс — уроки по порядку: текст, видео (VK Видео или Rutube), задание или
   тест. Задания проверяет преподаватель, тесты — сайт, прогресс хранит сервер.

   window.SCPages.school(ui)                        — страница /media-school:
                                                      каталог и прохождение курса
   window.SCSchool.cabinet(box, user, ui, opts)     — кабинет, вкладка «Медиашкола»
   window.SCSchool.admin(panel, user, ui, kit)      — панель, раздел «Медиашкола»

   Подключается на /media-school, /profile и /admin перед app.js.
   ========================================================================== */
(function () {
  "use strict";

  window.SCPages = window.SCPages || {};

  var COURSE_STATUS = {
    draft: ["черновик", "status--draft"],
    published: ["опубликован", "status--pub"],
    archived: ["в архиве", "status--draft"],
  };
  var LESSON_STATE = {
    done: "пройден", sent: "на проверке", returned: "нужно доработать",
    failed: "тест не сдан", open: "открыт", locked: "закрыт",
  };
  var LEVELS = ["Начальный", "Средний", "Продвинутый"];
  var CHECKS = { none: "без проверки: прочитал — отметил", task: "задание: проверяет преподаватель", test: "тест: проверяет сайт" };

  /* запрос к серверу: с входом — от имени аккаунта, без входа — открытый */
  function call(Store, action, payload) {
    return Store.hasToken() ? Store.callStaff(action, payload) : Store.api(action, payload || {});
  }

  function pill(esc, st) {
    return '<span class="status ' + st[1] + '">' + esc(st[0]) + "</span>";
  }

  function countsText(ui, c) {
    var parts = [c.lessons + " " + ui.plural(c.lessons, ["урок", "урока", "уроков"])];
    if (c.tests) parts.push(c.tests + " " + ui.plural(c.tests, ["тест", "теста", "тестов"]));
    if (c.tasks) parts.push(c.tasks + " " + ui.plural(c.tasks, ["задание", "задания", "заданий"]));
    return parts.join(" · ");
  }

  function bar(p) {
    var percent = p ? p.percent : 0;
    return '<div class="sch-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><i style="width:' + percent + '%"></i></div>';
  }

  /* текст урока: абзацы через пустую строку, «- » — список, «## » — подзаголовок, «> » — цитата */
  function renderBody(ui, text) {
    var out = [];
    var list = [];
    function flush() {
      if (!list.length) return;
      out.push("<ul>" + list.map(function (li) { return "<li>" + ui.inlineMd(li) + "</li>"; }).join("") + "</ul>");
      list = [];
    }
    String(text || "").split(/\n{2,}/).forEach(function (block) {
      block = block.trim();
      if (!block) return;
      var lines = block.split("\n");
      if (lines.every(function (l) { return l.trim().indexOf("- ") === 0; })) {
        lines.forEach(function (l) { list.push(l.trim().slice(2)); });
        flush();
        return;
      }
      flush();
      if (block.indexOf("## ") === 0) out.push("<h3>" + ui.inlineMd(block.slice(3)) + "</h3>");
      else if (block.indexOf("> ") === 0) out.push("<blockquote>" + ui.inlineMd(block.slice(2)) + "</blockquote>");
      else out.push("<p>" + ui.inlineMd(block).replace(/\n/g, "<br>") + "</p>");
    });
    flush();
    return out.join("");
  }

  /* ссылка на ролик → адрес встраиваемого плеера; не разобрали — останется кнопка-ссылка */
  function videoEmbed(url) {
    var m = /rutube\.ru\/video\/(?:private\/)?([a-f0-9]{32})/i.exec(url || "");
    if (m) return "https://rutube.ru/play/embed/" + m[1];
    m = /(?:vk\.com|vk\.ru|vkvideo\.ru)\/[^\s]*?video(-?\d+)_(\d+)/i.exec(url || "");
    if (m) return "https://vk.com/video_ext.php?oid=" + m[1] + "&id=" + m[2] + "&hd=2";
    return "";
  }

  function videoHtml(esc, url) {
    if (!url) return "";
    var embed = videoEmbed(url);
    return '<div class="sch-video-wrap">' +
      (embed
        ? '<div class="sch-video"><iframe src="' + esc(embed) + '" title="Видео к уроку" loading="lazy" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div>'
        : "") +
      '<a class="link-accent" href="' + esc(url) + '" target="_blank" rel="noopener">Открыть видео на площадке</a></div>';
  }

  /* почему нельзя записаться и куда идти */
  function gateFor(why, courseId) {
    if (why === "login") return ["Войдите, чтобы записаться", "/join?next=profile#login"];
    if (why === "email") return ["Подтвердите почту", "/profile#settings"];
    if (why === "consent") return ["Нужно согласие на обработку данных", "/profile#docs"];
    return ["Записаться", "/media-school?course=" + encodeURIComponent(courseId)];
  }

  function courseCard(ui, c, res) {
    var esc = ui.esc;
    var url = "/media-school?course=" + encodeURIComponent(c.id);
    var action;
    if (c.enrolled) {
      action = bar(c.progress) +
        '<div class="sch-card__foot"><span>' + (c.enrollStatus === "completed" ? "Курс пройден" : "Пройдено " + c.progress.done + " из " + c.progress.total) + "</span>" +
        '<a class="btn btn--sm' + (c.enrollStatus === "completed" ? " btn--ghost" : " btn--accent") + '" href="' + esc(url) + '">' +
        (c.enrollStatus === "completed" ? "Открыть" : "Продолжить") + "</a></div>";
    } else if (res.canEnroll) {
      action = '<div class="sch-card__foot"><a class="link-accent" href="' + esc(url) + '">Программа курса</a>' +
        '<button class="btn btn--sm btn--accent" type="button" data-enroll="' + esc(c.id) + '">Записаться</button></div>';
    } else {
      var gate = gateFor(res.why, c.id);
      action = '<div class="sch-card__foot"><a class="link-accent" href="' + esc(url) + '">Программа курса</a>' +
        '<a class="btn btn--sm" href="' + esc(gate[1]) + '">' + esc(gate[0]) + "</a></div>";
    }
    return '<article class="sch-card"><div class="sch-card__top"><span class="kicker">' + esc(c.level || "Курс") + "</span>" +
      (c.status !== "published" ? pill(esc, COURSE_STATUS[c.status] || COURSE_STATUS.draft) : "") + "</div>" +
      "<h3>" + esc(c.title) + "</h3><p>" + esc(c.summary) + "</p>" +
      '<p class="sch-card__meta">' + esc(countsText(ui, c.counts)) + (c.teacherName ? " · ведёт " + esc(c.teacherName) : "") + "</p>" +
      action + "</article>";
  }

  function bindEnroll(ui, root, done) {
    ui.$$("[data-enroll]", root).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-enroll");
        btn.disabled = true;
        btn.textContent = "Записываем…";
        call(ui.Store, "school-enroll", { id: id }).then(function (res) {
          if (res && res.ok) { window.location.href = "/media-school?course=" + encodeURIComponent(id); return; }
          btn.disabled = false;
          btn.textContent = "Записаться";
          done((res && res.error) || "Не удалось записаться. Попробуйте ещё раз.", res);
        });
      });
    });
  }

  /* ------------------------------------------------------------- каталог */
  function mountCatalog(ui, host) {
    var esc = ui.esc;
    host.innerHTML = '<div class="sec-head"><div class="sec-head__left"><span class="kicker">Курсы</span><h2>Чему можно научиться</h2>' +
      '<p class="sec-head__text">Короткие курсы из уроков с заданиями и тестами. Задания проверяет преподаватель, прогресс сохраняется в личном кабинете.</p></div></div>' +
      '<p class="form__note" data-school-note role="status"></p><div class="sch-grid" data-school-list><p class="no-data">Загружаем курсы…</p></div>';
    var note = ui.$("[data-school-note]", host);
    var list = ui.$("[data-school-list]", host);
    call(ui.Store, "school-catalog", {}).then(function (res) {
      if (!res || !res.ok) { list.innerHTML = '<p class="no-data">Курсы не загрузились. Обновите страницу.</p>'; return; }
      if (!res.courses.length) {
        list.innerHTML = '<div class="fill-note fill-note--flat"><b>Первые курсы готовятся</b><p>Преподаватели собирают программу. ' +
          "Когда курс откроется, он появится здесь — а пока можно писать материалы и получать разбор редактора.</p></div>";
        return;
      }
      list.innerHTML = res.courses.map(function (c) { return courseCard(ui, c, res); }).join("");
      if (res.why === "consent") {
        note.innerHTML = 'Чтобы записаться, нужно подписанное согласие на обработку данных: <a class="link-accent" href="/profile#docs">кабинет, вкладка «Документы»</a>.';
      }
      bindEnroll(ui, list, function (text) { note.textContent = text; });
    });
  }

  /* ------------------------------------------------------ прохождение курса */
  function mountCourse(ui, host, courseId) {
    var $ = ui.$, $$ = ui.$$, esc = ui.esc, Store = ui.Store;
    var current = "";
    var flash = "";
    var lastTest = null;      // результат только что отправленного теста

    if (!Store.currentUser()) {
      host.innerHTML = '<section class="section wrap"><div class="gate gate--page"><span class="kicker">Медиашкола</span><h1>Нужно войти</h1>' +
        '<p class="lead">Курсы проходят в своём аккаунте: так сохраняется прогресс и ответы на задания.</p>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:18px"><a class="btn btn--accent" href="/join?next=profile#login">Войти</a>' +
        '<a class="btn btn--ghost" href="/media-school">Все курсы</a></div></div></section>';
      return;
    }
    host.innerHTML = '<section class="section wrap"><p class="no-data">Открываем курс…</p></section>';

    function pick(data) {
      var ids = data.lessons.map(function (l) { return l.id; });
      var fromHash = (window.location.hash || "").replace(/^#l=/, "");
      if (current && ids.indexOf(current) !== -1) return current;
      if (fromHash && ids.indexOf(fromHash) !== -1) return fromHash;
      for (var i = 0; i < data.lessons.length; i++) {
        var st = data.lessons[i].state;
        if (st === "open" || st === "returned" || st === "failed") return data.lessons[i].id;
      }
      return ids[0] || "";
    }

    function lessonHtml(data, l, index) {
      var ro = data.preview;          // преподаватель смотрит курс: ответы не отправляются
      var out = '<div class="sch-lesson__head"><span class="kicker">Урок ' + (index + 1) + " из " + data.lessons.length + "</span><h2>" + esc(l.title) + "</h2></div>";
      if (l.state === "locked") {
        return out + '<p class="gate">' + (data.enrolled
          ? "Этот урок откроется, когда вы пройдёте предыдущий."
          : "Уроки открываются после записи на курс.") + "</p>";
      }
      out += '<div class="prose sch-lesson__body">' + renderBody(ui, l.body) + "</div>" + videoHtml(esc, l.video);

      if (l.check === "none") {
        out += l.state === "done"
          ? '<p class="sch-done">Урок пройден' + (l.doneAt ? " " + esc(ui.fmtDate(l.doneAt)) : "") + ".</p>"
          : '<div class="sch-actions"><button class="btn btn--accent" type="button" data-lesson-done' + (ro ? " disabled" : "") + ">Изучено — дальше</button></div>";
      }

      if (l.check === "task") {
        var answer = l.answer || {};
        out += '<div class="sch-task"><h3>Задание</h3><div class="prose">' + renderBody(ui, l.task) + "</div>";
        if (l.state === "done") {
          out += '<p class="sch-done">Задание принято' + (l.review && l.review.by ? " — " + esc(l.review.by) : "") + ".</p>" +
            (l.review && l.review.note ? '<p class="cab-post__note"><b>Комментарий преподавателя:</b> ' + esc(l.review.note) + "</p>" : "") +
            '<details class="adm-text"><summary>Ваш ответ</summary><p>' + esc(answer.text || "") + "</p></details>";
        } else if (l.state === "sent") {
          out += '<p class="gate"><b>Работа на проверке у преподавателя.</b> Отправлена ' + esc(ui.fmtWhen(l.sentAt)) +
            ". Следующий урок уже открыт — ждать не нужно.</p>" +
            '<details class="adm-text"><summary>Что вы отправили</summary><p>' + esc(answer.text || "") + "</p></details>";
        } else {
          out += (l.state === "returned" && l.review
            ? '<p class="cab-post__note cab-post__note--err"><b>Преподаватель просит доработать:</b> ' + esc(l.review.note || "") + "</p>" : "") +
            '<form class="form sch-form" data-task-form novalidate>' +
            '<div class="field form__full"><label for="sch-answer">Ваш ответ</label>' +
            '<textarea id="sch-answer" name="text" rows="8" maxlength="8000" placeholder="Напишите ответ здесь">' + esc(answer.text || "") + "</textarea></div>" +
            '<div class="field form__full"><label for="sch-link">Ссылка на работу <small>(необязательно: фото, видео, документ)</small></label>' +
            '<input id="sch-link" name="link" type="url" maxlength="300" placeholder="https://" value="' + esc(answer.link || "") + '"></div>' +
            '<div class="form__full row" style="gap:10px;align-items:center;flex-wrap:wrap"><button class="btn btn--accent" type="submit"' + (ro ? " disabled" : "") + ">Отправить на проверку</button>" +
            '<span class="form__note" data-task-note role="status"></span></div></form>';
        }
        out += "</div>";
      }

      if (l.check === "test") {
        var t = l.test || {};
        out += '<div class="sch-task"><h3>Тест</h3><p class="form__note">Нужно набрать не меньше ' + l.pass + "% верных ответов. Попыток сколько угодно." +
          (t.attempts ? " Попыток: " + t.attempts + ", лучший результат — " + t.best + "%." : "") + "</p>";
        if (lastTest && lastTest.lessonId === l.id) {
          out += '<p class="' + (lastTest.passed ? "sch-done" : "cab-post__note cab-post__note--err") + '"><b>' +
            (lastTest.passed ? "Тест сдан" : "Тест не сдан") + ":</b> верно " + lastTest.right + " из " + lastTest.total + " (" + lastTest.score + "%)." +
            (lastTest.passed ? "" : " Перечитайте урок и попробуйте ещё раз.") + "</p>";
        } else if (l.state === "done") {
          out += '<p class="sch-done">Тест сдан. Его можно пройти ещё раз — результат не ухудшится.</p>';
        }
        out += '<form class="sch-test" data-test-form novalidate>' + l.questions.map(function (q, qi) {
          var mark = lastTest && lastTest.lessonId === l.id ? lastTest.marks[qi] : null;
          return '<fieldset class="sch-q' + (mark === true ? " is-right" : mark === false ? " is-wrong" : "") + '"><legend>' + (qi + 1) + ". " + esc(q.q) + "</legend>" +
            q.options.map(function (opt, oi) {
              return '<label class="check"><input type="radio" name="q' + qi + '" value="' + oi + '"><span>' + esc(opt) + "</span></label>";
            }).join("") +
            (mark === true ? '<p class="form__note">Верно</p>' : mark === false ? '<p class="form__note">Неверно</p>' : "") + "</fieldset>";
        }).join("") +
          '<div class="row" style="gap:10px;align-items:center;flex-wrap:wrap"><button class="btn btn--accent" type="submit"' + (ro ? " disabled" : "") + ">" +
          (t.attempts ? "Проверить ещё раз" : "Проверить") + '</button><span class="form__note" data-test-note role="status"></span></div></form></div>';
      }
      return out;
    }

    function draw(data) {
      current = pick(data);
      var index = 0;
      data.lessons.forEach(function (l, i) { if (l.id === current) index = i; });
      var lesson = data.lessons[index];
      var c = data.course;
      var p = data.progress;
      var prev = data.lessons[index - 1];
      var next = data.lessons[index + 1];

      host.innerHTML =
        '<section class="sch-top"><div class="wrap"><a class="link-accent" href="/media-school">← Все курсы</a>' +
        '<div class="sch-top__row"><div><span class="kicker">' + esc(c.level || "Курс") + (c.teacherName ? " · ведёт " + esc(c.teacherName) : "") + "</span>" +
        "<h1>" + esc(c.title) + "</h1><p>" + esc(c.summary) + "</p></div>" +
        (data.enrolled
          ? '<div class="sch-top__progress"><b>' + p.percent + "%</b><span>" + (data.enrollStatus === "completed" ? "курс пройден" : "пройдено " + p.done + " из " + p.total) + "</span>" + bar(p) + "</div>"
          : "") + "</div>" +
        (flash ? '<p class="cab-flash" role="status">' + esc(flash) + "</p>" : "") +
        (data.preview ? '<p class="gate"><b>Просмотр преподавателя.</b> Так курс видит ученик; ответы и отметки в этом режиме не сохраняются.</p>' : "") +
        (data.enrollStatus === "completed" ? '<p class="sch-done sch-done--big">Курс пройден' + (data.completedAt ? " " + esc(ui.fmtDate(data.completedAt)) : "") + ". Уроки остаются открытыми.</p>" : "") +
        (!data.enrolled && !data.preview
          ? '<div class="gate" data-course-gate><b>Вы ещё не записаны на курс.</b> Ниже — программа; уроки откроются после записи. ' +
            '<span data-course-enroll></span></div>'
          : "") +
        "</div></section>" +
        '<section class="section wrap sch-layout">' +
        '<nav class="sch-nav" aria-label="Уроки курса"><ol>' + data.lessons.map(function (l, i) {
          return '<li><a href="#l=' + esc(l.id) + '" data-lesson="' + esc(l.id) + '" class="sch-nav__item is-' + esc(l.state) + (l.id === current ? " is-current" : "") + '">' +
            '<span class="sch-nav__n">' + (i + 1) + "</span><span><b>" + esc(l.title) + "</b><small>" +
            esc(l.check === "task" ? "задание" : l.check === "test" ? "тест" : "урок") + (l.hasVideo ? " · видео" : "") +
            " · " + esc(LESSON_STATE[l.state] || "") + "</small></span></a></li>";
        }).join("") + "</ol></nav>" +
        '<article class="sch-lesson">' + lessonHtml(data, lesson, index) +
        '<div class="sch-pager">' +
        (prev ? '<a class="btn btn--sm btn--ghost" href="#l=' + esc(prev.id) + '" data-lesson="' + esc(prev.id) + '">← ' + esc(prev.title) + "</a>" : "<span></span>") +
        (next ? '<a class="btn btn--sm btn--ghost" href="#l=' + esc(next.id) + '" data-lesson="' + esc(next.id) + '">' + esc(next.title) + " →</a>" : "") +
        "</div></article></section>";
      flash = "";
      document.title = c.title + " — Медиашкола — Смена контента";

      $$("[data-lesson]", host).forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.preventDefault();
          current = a.getAttribute("data-lesson");
          lastTest = null;
          try { window.history.replaceState(null, "", "#l=" + current); } catch (err) {}
          draw(data);
          var top = $(".sch-lesson", host);
          if (top && top.scrollIntoView) top.scrollIntoView({ block: "start" });
        });
      });

      /* запись прямо со страницы курса */
      var enrollSlot = $("[data-course-enroll]", host);
      if (enrollSlot) {
        call(Store, "school-catalog", {}).then(function (cat) {
          if (!cat || !cat.ok) return;
          if (cat.canEnroll) {
            enrollSlot.innerHTML = '<button class="btn btn--sm btn--accent" type="button" data-enroll="' + esc(c.id) + '">Записаться</button>';
            bindEnroll(ui, enrollSlot, function (text) { enrollSlot.insertAdjacentHTML("beforeend", ' <span class="form__note">' + esc(text) + "</span>"); });
          } else {
            var gate = gateFor(cat.why, c.id);
            enrollSlot.innerHTML = '<a class="btn btn--sm" href="' + esc(gate[1]) + '">' + esc(gate[0]) + "</a>";
          }
        });
      }

      function after(res, okText) {
        if (res && res.ok) {
          flash = res.completed ? "Курс пройден. Поздравляем!" : okText;
          if (res.state === "done" && next && lesson.check === "none") current = next.id;
          load();
          return true;
        }
        return false;
      }

      var doneBtn = $("[data-lesson-done]", host);
      if (doneBtn) {
        doneBtn.addEventListener("click", function () {
          doneBtn.disabled = true;
          call(Store, "school-lesson-done", { courseId: c.id, lessonId: lesson.id }).then(function (res) {
            if (!after(res, "")) { doneBtn.disabled = false; flash = (res && res.error) || "Не сохранилось."; draw(data); }
          });
        });
      }

      var taskForm = $("[data-task-form]", host);
      if (taskForm) {
        taskForm.addEventListener("submit", function (e) {
          e.preventDefault();
          var note = $("[data-task-note]", host);
          var text = taskForm.querySelector('[name="text"]').value.trim();
          var link = taskForm.querySelector('[name="link"]').value.trim();
          if (text.length < 20) { note.textContent = "Ответ слишком короткий: напишите хотя бы пару предложений."; return; }
          var btn = taskForm.querySelector('button[type="submit"]');
          btn.disabled = true;
          note.textContent = "Отправляем…";
          call(Store, "school-task-send", { courseId: c.id, lessonId: lesson.id, text: text, link: link }).then(function (res) {
            if (!after(res, "Работа отправлена преподавателю. Решение придёт в «Сообщения» и на почту.")) {
              btn.disabled = false;
              note.textContent = (res && res.error) || "Не отправилось. Попробуйте ещё раз.";
            }
          });
        });
      }

      var testForm = $("[data-test-form]", host);
      if (testForm) {
        testForm.addEventListener("submit", function (e) {
          e.preventDefault();
          var note = $("[data-test-note]", host);
          var answers = lesson.questions.map(function (q, qi) {
            var picked = testForm.querySelector('input[name="q' + qi + '"]:checked');
            return picked ? Number(picked.value) : -1;
          });
          if (answers.indexOf(-1) !== -1) { note.textContent = "Ответьте на все вопросы."; return; }
          var btn = testForm.querySelector('button[type="submit"]');
          btn.disabled = true;
          note.textContent = "Проверяем…";
          call(Store, "school-test-send", { courseId: c.id, lessonId: lesson.id, answers: answers }).then(function (res) {
            if (res && res.ok) {
              lastTest = { lessonId: lesson.id, passed: res.passed, right: res.right, total: res.total, score: res.score, marks: res.marks };
              if (res.completed) flash = "Курс пройден. Поздравляем!";
              load();
              return;
            }
            btn.disabled = false;
            note.textContent = (res && res.error) || "Не проверилось. Попробуйте ещё раз.";
          });
        });
      }
    }

    function load() {
      call(Store, "school-course", { id: courseId }).then(function (res) {
        if (!res || !res.ok) {
          host.innerHTML = '<section class="section wrap"><div class="gate gate--page"><span class="kicker">Медиашкола</span><h1>Курс недоступен</h1>' +
            '<p class="lead">' + esc((res && res.error) || "Не удалось открыть курс.") + '</p><div class="row" style="margin-top:18px"><a class="btn btn--accent" href="/media-school">Все курсы</a></div></div></section>';
          return;
        }
        draw(res);
      });
    }
    load();
  }

  window.SCPages.school = function (ui) {
    var main = ui.$("#main");
    var courseId = ui.param("course");
    if (courseId && main) { mountCourse(ui, main, courseId); return; }
    var host = ui.$("[data-school-catalog]");
    if (host) mountCatalog(ui, host);
  };

  /* ------------------------------------------------------------- кабинет */
  function cabinet(box, user, ui, opts) {
    var esc = ui.esc;
    opts = opts || {};
    call(ui.Store, "school-catalog", {}).then(function (res) {
      if (!res || !res.ok) { box.innerHTML = '<p class="form__note">Курсы не загрузились: ' + esc((res && res.error) || "нет связи с сервером") + "</p>"; return; }
      var mine = res.courses.filter(function (c) { return c.enrolled; });
      var other = res.courses.filter(function (c) { return !c.enrolled; });
      var gate = "";
      if (res.why === "consent") {
        gate = '<p class="gate"><b>Запись на курсы откроется после согласия на обработку данных.</b> ' +
          '<button class="link-btn" type="button" data-school-go="docs">Перейти к документам →</button></p>';
      } else if (res.why === "email") {
        gate = '<p class="gate"><b>Сначала подтвердите почту.</b> <button class="link-btn" type="button" data-school-go="settings">Открыть профиль →</button></p>';
      }
      box.innerHTML = gate +
        (res.staff ? '<p class="form__note">Вы ведёте медиашколу: курсы и проверка заданий — в <a class="link-accent" href="/admin#school">панели проекта</a>.</p>' : "") +
        '<h3 class="cab-sub" style="margin-top:0">Мои курсы</h3>' +
        (mine.length
          ? '<div class="sch-grid">' + mine.map(function (c) { return courseCard(ui, c, res); }).join("") + "</div>"
          : '<p class="form__note">Вы пока не записаны ни на один курс.</p>') +
        '<h3 class="cab-sub">Каталог</h3>' +
        '<p class="form__note" data-school-note role="status"></p>' +
        (other.length
          ? '<div class="sch-grid">' + other.map(function (c) { return courseCard(ui, c, res); }).join("") + "</div>"
          : '<p class="form__note">' + (mine.length ? "Других курсов пока нет." : "Первые курсы готовятся — они появятся здесь.") + "</p>");
      ui.$$("[data-school-go]", box).forEach(function (b) {
        b.addEventListener("click", function () { if (opts.go) opts.go(b.getAttribute("data-school-go")); });
      });
      bindEnroll(ui, box, function (text) { var n = ui.$("[data-school-note]", box); if (n) n.textContent = text; });
    });
  }

  /* -------------------------------------------------------------- панель */
  function admin(panel, user, ui, kit) {
    var $ = ui.$, $$ = ui.$$, esc = ui.esc;

    /* --- задания на проверке --- */
    var queue = kit.section(panel, "school-queue", "Медиашкола", "Задания на проверке",
      "Ответы учеников на задания ваших курсов. Примите работу или верните с замечанием — ученик увидит его в уроке и получит сообщение.");
    queue.tools.innerHTML = '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
    $("[data-reload]", queue.tools).addEventListener("click", loadQueue);

    function loadQueue() {
      kit.load(queue, "school-queue", {}, function (res) {
        var items = res.items || [];
        queue.body.innerHTML = items.length ? items.map(function (w) {
          return '<article class="adm-item" data-work="' + esc(w.enrollId) + '" data-lesson="' + esc(w.lessonId) + '">' +
            '<div class="adm-item__top"><h3>' + esc(w.userName) + " — " + esc(w.lessonTitle) + "</h3>" +
            '<span class="status status--pending">на проверке</span></div>' +
            '<p class="adm-item__meta">' + esc(w.courseTitle) + (w.userNumber ? " · участник № " + w.userNumber : "") + " · отправлено " + esc(kit.when(w.sentAt)) +
            (w.tries > 1 ? " · попытка " + w.tries : "") + "</p>" +
            '<details class="adm-text"><summary>Задание</summary><p>' + esc(w.task) + "</p></details>" +
            '<div class="rep-text"><h4>Ответ ученика</h4><p>' + esc(w.text) + "</p></div>" +
            (w.link ? '<p class="adm-item__meta">Ссылка: <a class="link-accent" href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">' + esc(w.link) + "</a></p>" : "") +
            '<div class="adm-item__actions"><input type="text" class="adm-input" placeholder="Комментарий ученику" data-note maxlength="1500" aria-label="Комментарий ученику">' +
            '<button class="btn btn--sm btn--accent" type="button" data-decide="accepted">Принять</button>' +
            '<button class="btn btn--sm btn--ghost" type="button" data-decide="returned">Вернуть на доработку</button></div></article>';
        }).join("") : kit.emptyNote("Работ на проверке нет.");
        $$("[data-work]", queue.body).forEach(function (el) {
          var note = $("[data-note]", el);
          $$("[data-decide]", el).forEach(function (btn) {
            btn.addEventListener("click", function () {
              var decision = btn.getAttribute("data-decide");
              var text = note.value.trim();
              if (decision === "returned" && text.length < 5) { queue.status.textContent = "Напишите, что исправить: ученик увидит это в уроке."; note.focus(); return; }
              kit.act(queue, "school-review", { enrollId: el.getAttribute("data-work"), lessonId: el.getAttribute("data-lesson"), decision: decision, note: text }, function () {
                queue.status.textContent = decision === "accepted" ? "Работа принята, ученик получил сообщение." : "Работа возвращена, ученик получил замечание.";
                loadQueue();
              }, btn);
            });
          });
        });
      });
    }

    /* --- курсы --- */
    var sec = kit.section(panel, "school-courses", "Медиашкола", "Курсы",
      "Курс — уроки по порядку. Преподаватель собирает курс и отмечает, что он готов; в каталог курс попадает после публикации руководством школы.");
    var state = { data: null, editing: null, students: "" };

    function courseRow(c) {
      var st = COURSE_STATUS[c.status] || COURSE_STATUS.draft;
      var can = state.data.canManage;
      return '<article class="adm-item" data-course="' + esc(c.id) + '">' +
        '<div class="adm-item__top"><h3>' + esc(c.title) + "</h3>" + pill(esc, st) +
        (c.ready && c.status === "draft" ? '<span class="status status--pending">готов к публикации</span>' : "") + "</div>" +
        '<p class="adm-item__meta">' + esc(c.level || "без уровня") + " · " + esc(countsText(ui, c.counts)) + " · ведёт " + esc(c.teacherName || "—") +
        " · учеников: " + c.students + (c.completed ? ", прошли: " + c.completed : "") + (c.waiting ? " · работ на проверке: " + c.waiting : "") +
        (c.updatedAt ? " · изменён " + esc(kit.day(c.updatedAt)) : "") + "</p>" +
        '<div class="adm-item__actions">' +
        (c.canEdit ? '<button class="btn btn--sm" type="button" data-edit>Редактировать</button>' : "") +
        '<button class="btn btn--sm btn--ghost" type="button" data-students>Ученики</button>' +
        '<a class="btn btn--sm btn--ghost" href="/media-school?course=' + encodeURIComponent(c.id) + '" target="_blank" rel="noopener">Посмотреть как ученик</a>' +
        (can && c.status !== "published" ? '<button class="btn btn--sm btn--accent" type="button" data-status="published">Опубликовать</button>' : "") +
        (can && c.status === "published" ? '<button class="btn btn--sm btn--ghost" type="button" data-status="draft">Снять с публикации</button>' : "") +
        (can && c.status !== "archived" ? '<button class="btn btn--sm btn--ghost" type="button" data-status="archived">В архив</button>' : "") +
        '</div><div data-students-box></div></article>';
    }

    function drawList() {
      var d = state.data;
      sec.tools.innerHTML = (d.canCreate ? '<button class="btn btn--sm btn--accent" type="button" data-new>Новый курс</button>' : "") +
        '<button class="btn btn--sm btn--ghost" type="button" data-reload>Обновить</button>';
      $("[data-reload]", sec.tools).addEventListener("click", loadCourses);
      var add = $("[data-new]", sec.tools);
      if (add) add.addEventListener("click", function () { openEditor(null); });
      sec.body.innerHTML = d.courses.length ? d.courses.map(courseRow).join("") : kit.emptyNote("Курсов пока нет. Нажмите «Новый курс».");
      $$("[data-course]", sec.body).forEach(function (el) {
        var id = el.getAttribute("data-course");
        var edit = $("[data-edit]", el);
        if (edit) edit.addEventListener("click", function () {
          sec.status.textContent = "Открываем курс…";
          ui.Store.callStaff("school-course-get", { id: id }).then(function (res) {
            sec.status.textContent = res && res.ok ? "" : (res && res.error) || "Курс не открылся.";
            if (res && res.ok) openEditor(res.course);
          });
        });
        $$("[data-status]", el).forEach(function (btn) {
          btn.addEventListener("click", function () {
            kit.act(sec, "school-course-status", { id: id, status: btn.getAttribute("data-status") }, function () {
              sec.status.textContent = "Состояние курса изменено.";
              loadCourses();
            }, btn);
          });
        });
        $("[data-students]", el).addEventListener("click", function () {
          var slot = $("[data-students-box]", el);
          if (slot.innerHTML) { slot.innerHTML = ""; return; }
          slot.innerHTML = '<p class="form__note">Загружаем учеников…</p>';
          ui.Store.callStaff("school-students", { id: id }).then(function (res) {
            if (!res || !res.ok) { slot.innerHTML = '<p class="form__note">' + esc((res && res.error) || "Не загрузилось.") + "</p>"; return; }
            slot.innerHTML = res.students.length
              ? '<div class="adm-table">' + res.students.map(function (s) {
                  return '<div class="adm-row"><div><b>' + esc(s.userName) + "</b><small>" + (s.userNumber ? "№ " + s.userNumber + " · " : "") + esc(ui.regionName(s.region) || "") +
                    " · с " + esc(kit.day(s.startedAt)) + "</small></div>" +
                    '<div class="adm-row__kv">' + (s.status === "completed" ? "прошёл курс " + esc(kit.day(s.completedAt)) : s.status === "left" ? "ушёл с курса" : "пройдено " + s.progress.done + " из " + s.progress.total) + "</div></div>";
                }).join("") + "</div>"
              : '<p class="form__note">На курс пока никто не записался.</p>';
          });
        });
      });
    }

    /* --- редактор курса --- */
    function optionsText(q) {
      return (q.options || []).map(function (opt, i) { return (i === q.answer ? "*" : "") + opt; }).join("\n");
    }

    function parseOptions(text) {
      var options = [];
      var answer = -1;
      String(text || "").split("\n").forEach(function (line) {
        line = line.trim();
        if (!line) return;
        if (line.charAt(0) === "*") { answer = options.length; line = line.slice(1).trim(); }
        if (line) options.push(line);
      });
      return { options: options, answer: answer };
    }

    function lessonEditor(l, i, total) {
      var qs = l.questions && l.questions.length ? l.questions : [{ q: "", options: [], answer: -1 }];
      return '<fieldset class="sch-edit" data-les="' + esc(l.id || "") + '">' +
        "<legend>Урок " + (i + 1) + "</legend>" +
        '<div class="sch-edit__bar">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-up' + (i === 0 ? " disabled" : "") + ' aria-label="Выше">↑</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-down' + (i === total - 1 ? " disabled" : "") + ' aria-label="Ниже">↓</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-del>Удалить урок</button></div>' +
        '<div class="form">' +
        '<div class="field"><label>Название урока</label><input type="text" data-f="title" maxlength="140" value="' + esc(l.title || "") + '"></div>' +
        '<div class="field"><label>Как проверяется</label><select data-f="check">' + Object.keys(CHECKS).map(function (k) {
          return '<option value="' + k + '"' + ((l.check || "none") === k ? " selected" : "") + ">" + esc(CHECKS[k]) + "</option>";
        }).join("") + "</select></div>" +
        '<div class="field form__full"><label>Текст урока</label><textarea data-f="body" rows="7" maxlength="20000" placeholder="Абзацы — через пустую строку. «## » в начале — подзаголовок, «- » — пункт списка, «> » — цитата.">' + esc(l.body || "") + "</textarea></div>" +
        '<div class="field form__full"><label>Видео <small>(необязательно)</small></label><input type="url" data-f="video" maxlength="300" placeholder="Ссылка на VK Видео или Rutube: https://vkvideo.ru/video-1_2 или https://rutube.ru/video/…" value="' + esc(l.video || "") + '"></div>' +
        '<div class="field form__full" data-only="task"><label>Задание</label><textarea data-f="task" rows="4" maxlength="3000" placeholder="Что сделать и что прислать">' + esc(l.task || "") + "</textarea></div>" +
        '<div class="form__full" data-only="test"><div class="field" style="max-width:260px"><label>Порог сдачи, % верных ответов</label>' +
        '<input type="number" data-f="pass" min="50" max="100" step="5" value="' + esc(String(l.pass || 70)) + '"></div>' +
        '<div data-questions>' + qs.map(questionEditor).join("") + "</div>" +
        '<button class="btn btn--sm btn--ghost" type="button" data-add-q>Добавить вопрос</button></div>' +
        "</div></fieldset>";
    }

    function questionEditor(q) {
      return '<div class="sch-edit__q" data-q><div class="field"><label>Вопрос</label><input type="text" data-q-text maxlength="400" value="' + esc(q.q || "") + '"></div>' +
        '<div class="field"><label>Варианты ответа — каждый с новой строки; перед верным поставьте звёздочку *</label>' +
        '<textarea data-q-options rows="4" placeholder="*Верный вариант&#10;Неверный вариант&#10;Ещё один неверный">' + esc(optionsText(q)) + "</textarea></div>" +
        '<button class="link-btn" type="button" data-del-q>Убрать вопрос</button></div>';
    }

    function openEditor(course) {
      var d = state.data;
      var c = course || { title: "", summary: "", level: LEVELS[0], lessons: [{ title: "", body: "", check: "none" }], teacherId: user.id, ready: false };
      state.editing = c;
      sec.tools.innerHTML = "";
      sec.body.innerHTML =
        '<form class="sch-editor" data-editor novalidate>' +
        '<h3 class="adm-sub" style="margin-top:0">' + (c.id ? "Курс «" + esc(c.title) + "»" : "Новый курс") + "</h3>" +
        '<div class="form">' +
        '<div class="field form__full"><label for="sch-title">Название курса</label><input id="sch-title" type="text" maxlength="140" value="' + esc(c.title || "") + '"></div>' +
        '<div class="field form__full"><label for="sch-summary">О чём курс и для кого</label><textarea id="sch-summary" rows="3" maxlength="600">' + esc(c.summary || "") + "</textarea></div>" +
        '<div class="field"><label for="sch-level">Уровень</label><select id="sch-level">' + LEVELS.map(function (lv) {
          return "<option" + (c.level === lv ? " selected" : "") + ">" + esc(lv) + "</option>";
        }).join("") + "</select></div>" +
        (d.canManage
          ? '<div class="field"><label for="sch-teacher">Преподаватель</label><select id="sch-teacher">' + d.teachers.map(function (t) {
              return '<option value="' + esc(t.id) + '"' + (String(c.teacherId) === String(t.id) ? " selected" : "") + ">" + esc(t.name) + " — " + esc(t.access) + "</option>";
            }).join("") + "</select></div>"
          : "") +
        "</div>" +
        '<div data-lessons></div>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap;margin:14px 0"><button class="btn btn--sm btn--ghost" type="button" data-add-lesson>Добавить урок</button></div>' +
        (c.status === "published" ? '<p class="form__note">Курс опубликован: правки увидят ученики сразу после сохранения.</p>'
          : '<label class="check"><input type="checkbox" id="sch-ready"' + (c.ready ? " checked" : "") + "><span>Курс готов — показать руководству школы для публикации</span></label>") +
        '<div class="eo-problems" data-problems hidden></div>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px"><button class="btn btn--accent" type="submit">Сохранить курс</button>' +
        '<button class="btn btn--ghost" type="button" data-cancel>Отмена</button><span class="form__note" data-editor-note role="status"></span></div></form>';

      var form = $("[data-editor]", sec.body);
      var lessonsBox = $("[data-lessons]", form);

      function collectLessons() {
        return $$("[data-les]", lessonsBox).map(function (el) {
          var get = function (name) { var f = el.querySelector('[data-f="' + name + '"]'); return f ? f.value : ""; };
          var check = get("check") || "none";
          var out = { id: el.getAttribute("data-les") || undefined, title: get("title").trim(), body: get("body").trim(), video: get("video").trim(), check: check };
          if (check === "task") out.task = get("task").trim();
          if (check === "test") {
            out.pass = Number(get("pass")) || 70;
            out.questions = $$("[data-q]", el).map(function (qel) {
              var parsed = parseOptions(qel.querySelector("[data-q-options]").value);
              return { q: qel.querySelector("[data-q-text]").value.trim(), options: parsed.options, answer: parsed.answer };
            });
          }
          return out;
        });
      }

      function paintLessons(list) {
        lessonsBox.innerHTML = list.map(function (l, i) { return lessonEditor(l, i, list.length); }).join("");
        $$("[data-les]", lessonsBox).forEach(function (el, i) {
          var checkSel = el.querySelector('[data-f="check"]');
          function sync() {
            $$("[data-only]", el).forEach(function (part) { part.hidden = part.getAttribute("data-only") !== checkSel.value; });
          }
          checkSel.addEventListener("change", sync);
          sync();
          el.querySelector("[data-del]").addEventListener("click", function () {
            var now = collectLessons(); now.splice(i, 1); paintLessons(now);
          });
          el.querySelector("[data-up]").addEventListener("click", function () {
            var now = collectLessons(); now.splice(i - 1, 0, now.splice(i, 1)[0]); paintLessons(now);
          });
          el.querySelector("[data-down]").addEventListener("click", function () {
            var now = collectLessons(); now.splice(i + 1, 0, now.splice(i, 1)[0]); paintLessons(now);
          });
          el.querySelector("[data-add-q]").addEventListener("click", function () {
            var now = collectLessons(); now[i].questions = (now[i].questions || []).concat([{ q: "", options: [], answer: -1 }]); paintLessons(now);
          });
          $$("[data-del-q]", el).forEach(function (btn, qi) {
            btn.addEventListener("click", function () {
              var now = collectLessons(); now[i].questions.splice(qi, 1); paintLessons(now);
            });
          });
        });
      }
      paintLessons(c.lessons || []);

      $("[data-add-lesson]", form).addEventListener("click", function () {
        paintLessons(collectLessons().concat([{ title: "", body: "", check: "none" }]));
      });
      $("[data-cancel]", form).addEventListener("click", function () { state.editing = null; drawList(); });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var note = $("[data-editor-note]", form);
        var problems = $("[data-problems]", form);
        var teacher = $("#sch-teacher", form);
        var ready = $("#sch-ready", form);
        var payload = {
          id: c.id || undefined,
          title: $("#sch-title", form).value.trim(),
          summary: $("#sch-summary", form).value.trim(),
          level: $("#sch-level", form).value,
          lessons: collectLessons(),
          ready: ready ? ready.checked : false,
        };
        if (teacher) payload.teacherId = teacher.value;
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        note.textContent = "Сохраняем…";
        problems.hidden = true;
        ui.Store.callStaff("school-course-save", { course: payload }).then(function (res) {
          btn.disabled = false;
          if (res && res.ok) {
            state.editing = null;
            sec.status.textContent = "Курс сохранён.";
            kit.refreshSummary();
            loadCourses();
            return;
          }
          note.textContent = "";
          problems.hidden = false;
          problems.innerHTML = "<b>Курс не сохранён. Исправьте:</b><ul>" + ((res && res.problems) || [(res && res.error) || "Не удалось сохранить."]).map(function (p) {
            return "<li>" + esc(p) + "</li>";
          }).join("") + "</ul>";
          try { problems.scrollIntoView({ block: "center" }); } catch (err) {}
        });
      });
    }

    function loadCourses() {
      kit.load(sec, "school-admin", {}, function (res) {
        state.data = res;
        drawList();
      });
    }

    loadQueue();
    loadCourses();
  }

  window.SCSchool = { cabinet: cabinet, admin: admin, videoEmbed: videoEmbed, renderBody: renderBody };
})();
