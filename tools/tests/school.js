/* Медиашкола: форма на странице, статус в кабинете.
   Запуск: node tools/tests/school.js */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");

function inline(html) {
  return html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      const file = path.join(ROOT, src.split("?")[0]);
      return fs.existsSync(file) ? "<script>\n" + fs.readFileSync(file, "utf8") + "\n</script>" : "";
    });
}

let bad = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { bad++; console.log("  FAIL " + name + (extra === undefined ? "" : " → " + extra)); }
}

function makeDom(page, override) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e.detail || e.message || e);
    if (!/Not implemented/i.test(msg)) errors.push(msg);
  });
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));
  const html = inline(fs.readFileSync(path.join(ROOT, page), "utf8"))
    .replace("</body>", "<script>" + override + "</script></body>");
  const dom = new JSDOM(html, {
    url: "https://smenakontenta.ru" + page.replace("/index.html", "/"),
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("smena_lang", "ru"); /* проверки текста — на русском */
      w.fetch = () => Promise.reject(new Error("сети нет"));
      w.scrollTo = () => {};
      w.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
    },
  });
  return { dom, errors };
}

const BASE = `
  localStorage.removeItem("smena_token_v1");
  localStorage.removeItem("smena_user_v1");
  var applied = null;
  var schApp = null;
  Store.schoolMine = function () { return Promise.resolve({ ok: true, application: schApp, directions: [] }); };
  Store.schoolApply = function (p) {
    applied = p;
    schApp = { id: "sc_1", status: "pending", direction: p.direction, motivation: p.motivation, createdAt: "2026-11-13T00:00:00Z" };
    return Promise.resolve({ ok: true, application: schApp });
  };
`;

(async () => {
  /* 1. Гость: приглашение зарегистрироваться */
  {
    const { dom } = makeDom("/school/index.html", BASE);
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    const host = doc.querySelector("[data-school-status]");
    check("на странице медиашколы есть блок заявки", !!host);
    check("гостю предлагают создать аккаунт",
      !!host && /Создать аккаунт/.test(host.textContent), host && host.textContent.slice(0, 120));
    dom.window.close();
  }

  /* 2. Автор без заявки: форма, направление из списка, отправка */
  {
    const { dom } = makeDom("/school/index.html", BASE + `
      localStorage.setItem("smena_token_v1", "school-token");
      localStorage.setItem("smena_user_v1", JSON.stringify({ id: "u_sch", name: "Школа Тест", email: "sch@example.ru", createdAt: "2026-11-01T00:00:00Z" }));
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    const w = dom.window;
    const form = doc.querySelector("[data-school-form]");
    check("вошедшему показывают форму заявки", !!form);
    const dirs = form ? Array.from(form.querySelectorAll('.school-dir-chips input[name="direction"]')) : [];
    check("шесть направлений из программы", dirs.length === 6, dirs.length);
    check("в списке есть «Проверка информации»",
      dirs.some((o) => o.value === "Проверка информации"));
    const iv = dirs.filter((o) => o.value === "Интервью")[0];
    if (iv) { iv.checked = true; iv.dispatchEvent(new w.Event("change", { bubbles: true })); }
    form.querySelector('textarea[name="motivation"]').value = "Делаю разговоры с героями района: записала уже три интервью на телефон.";
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    check("заявка ушла с выбранным направлением",
      w.applied && w.applied.direction === "Интервью", w.applied);
    check("после отправки форма подтверждает",
      /Заявка отправлена/.test((doc.querySelector("[data-school-apply]") || {}).textContent || ""));
    dom.window.close();
  }

  /* 3. Принятый: зелёная плашка и следующий шаг */
  {
    const { dom } = makeDom("/school/index.html", BASE + `
      localStorage.setItem("smena_token_v1", "school-token");
      localStorage.setItem("smena_user_v1", JSON.stringify({ id: "u_sch", name: "Школа Тест", email: "sch@example.ru", createdAt: "2026-11-01T00:00:00Z" }));
      schApp = { id: "sc_1", status: "accepted", direction: "Фотография", createdAt: "2026-11-10T00:00:00Z" };
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    const state = doc.querySelector("[data-school-state]");
    check("принятому показывают зелёную плашку",
      !!state && state.classList.contains("fill-note--ok"), state && state.className);
    check("следующий шаг — первое задание", /Сделать первый материал/.test(state.textContent));
    dom.window.close();
  }

  /* 3b. Ученик в наборе: «Мой курс» — задания, сдача работ, групповые разборы */
  {
    const { dom } = makeDom("/school/index.html", BASE + `
      localStorage.setItem("smena_token_v1", "school-token");
      localStorage.setItem("smena_user_v1", JSON.stringify({ id: "u_sch", name: "Школа Тест", email: "sch@example.ru", createdAt: "2026-11-01T00:00:00Z" }));
      schApp = { id: "sc_1", status: "accepted", direction: "Фотография", createdAt: "2026-11-10T00:00:00Z" };
      Store.consent = function () { return { status: "approved" }; };
      var courseSent = null;
      var quizSubmitted = null;
      Store.schoolMyCourse = function () {
        return Promise.resolve({
          ok: true,
          cohort: { id: "sc_1", name: "Набор 001" },
          quizzes: [{ id: "scq_1", cohortId: "sc_1", assignmentId: "as_1", title: "Тест: герой в кадре",
            intro: "", passScore: 70, points: 5,
            questions: [
              { id: "sq0", text: "Кого показываем в кадре?", explanation: "Один герой — один смысл.",
                options: [{ text: "Героя с действием", correct: true }, { text: "Пустую улицу", correct: false }] },
              { id: "sq1", text: "Что с подписями?", explanation: "Имена проверяем у героя.",
                options: [{ text: "Имя и фамилия героя", correct: true }, { text: "Ничего", correct: false }] },
            ] }],
          myQuiz: {},
          assignments: [{ id: "as_1", title: "Задание 1: портрет двора", brief: "Снимите серию из 10 кадров об одном дворе и выберите три.", dueAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10), order: 1 }],
          modules: [{ id: "scm_1", cohortId: "sc_1", assignmentId: "as_1", title: "Модуль 1: герой в кадре",
            checklist: "Три кадра с героем, подписи с именами, звук чистый",
            body: "Смотрите на героя, а не на улицу: один человек, одно действие, один смысл кадра.",
            order: 1 }],
          subs: [
            { id: "sb_9", assignmentId: "as_1", userId: "u_other", userName: "Марина", text: "", status: "accepted", groupNote: "Сильная серия: третий кадр — лучший, подпись короткая.", reviewedAt: "2026-11-11T10:00:00Z", group: true, points: 0 },
            { id: "sb_1", assignmentId: "as_1", userId: "u_sch", userName: "Школа Тест", text: "черновик серии", status: "returned", groupNote: "Мне не хватает героя в кадрах.", personalNote: "Третий кадр переснимите ближе к скамейке.", points: 0, attempt: 1, createdAt: "2026-11-10T10:00:00Z", reviewedAt: "2026-11-11T10:00:00Z" },
          ],
          points: 12,
        });
      };
      Store.schoolSubSend = function (id, text, ai) {
        courseSent = { id: id, text: text, ai: ai };
        return Promise.resolve({ ok: true });
      };
      Store.schoolQuizSubmit = function (quizId, answers) {
        quizSubmitted = { quizId: quizId, answers: answers };
        var right = answers.filter(function (a) { return a.optionIndex === 0; }).length;
        var score = Math.round(right * 100 / answers.length);
        return Promise.resolve({ ok: true, score: score, passed: score >= 70, passScore: 70,
          attempt: 1, awarded: score >= 70 ? 5 : 0,
          detail: answers.map(function (a) {
            return { questionId: a.questionId, correctIndex: 0, right: a.optionIndex === 0,
              explanation: "Один герой — один смысл кадра." };
          }) });
      };
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    const w = dom.window;
    const sec = doc.getElementById("course");
    const host = doc.querySelector("[data-school-course]");
    check("курс принятому ученику открывается", !!sec && !sec.hidden && !!host && /Набор 001/.test(host.textContent));
    const program = host.querySelector("details");
    check("раздел «Программа набора» с материалом редакции",
      /Программа набора/.test(host.textContent) && !!program && /героя, а не на улицу/.test(program.textContent));
    check("чек-лист модуля виден в карточке задания",
      /Чек-лист: что должно получиться/.test(host.textContent) && /звук чистый/.test(host.textContent));
    check("баннер дедлайна показан, когда срок близко",
      /Срок близко/.test(host.textContent) && /До дедлайна/.test(host.textContent));
    check("баллы ученика видны", /баллы: 12/.test(host.textContent));
    const cardPanels = Array.from(host.querySelectorAll(".panel")).filter((pn) => /Задание 1/.test(pn.textContent));
    const tag = cardPanels[0] ? cardPanels[0].querySelector(".panel__tag") : null;
    check("работа с разбором помечена «есть разбор»", !!tag && /есть разбор/.test(tag.textContent));
    check("личный разбор показан, текст работы — нет",
      /переснимите ближе/.test(host.textContent) && !/черновик серии/.test(host.textContent));
    check("групповой разбор набора виден без текста чужой работы",
      /Сильная серия: третий кадр/.test(host.textContent) && /Марина/.test(host.textContent));
    const ta = host.querySelector("[data-course-text]");
    ta.value = "Переснял третий кадр у скамейки, добавил героя — дедлайна жду до декабря: серия из пяти кадров готова, ещё пять сниму на неделе.";
    host.querySelector("[data-course-ai]").value = "ИИ помог с планом кадров, снимал и отбирал сам";
    host.querySelector("[data-course-send]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    check("сдача работы ушла с полем про ИИ",
      !!w.courseSent && w.courseSent.id === "as_1" && w.courseSent.text.length > 40 && /ИИ помог с планом/.test(w.courseSent.ai),
      w.courseSent);
    const quizPanel = host.querySelector('[data-quiz="scq_1"]');
    check("тест в курсе виден с меткой баллов", !!quizPanel && /Тест: герой в кадре/.test(quizPanel.textContent) && /5 б\./.test(quizPanel.textContent));
    const q0 = quizPanel.querySelector('.pcard__section[data-qblock="0"] input[data-qopt="1"]');

    if (q0) q0.checked = true;
    const q1a = quizPanel.querySelector('.pcard__section[data-qblock="1"] input[data-qopt="0"]');
    if (q1a) q1a.checked = true;
    quizPanel.querySelector("[data-quiz-send]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    check("ответы ушли на автопроверку",
      !!w.quizSubmitted && w.quizSubmitted.quizId === "scq_1" && w.quizSubmitted.answers.length === 2 &&
      w.quizSubmitted.answers[0].optionIndex === 1, w.quizSubmitted);
    check("результат: не зачёт с правильным ответом и пояснением",
      /Пока не зачёт — 50%/.test(quizPanel.textContent) && /правильный ответ:/.test(quizPanel.textContent) &&
      /Один герой — один смысл/.test(quizPanel.textContent) && !!quizPanel.querySelector("[data-quiz-retake]"),
      quizPanel.textContent.slice(0, 200));
    dom.window.close();
  }

  /* 3c. Все задания приняты: зелёная плашка «Курс набора пройден» */
  {
    const { dom } = makeDom("/school/index.html", BASE + `
      localStorage.setItem("smena_token_v1", "school-token");
      localStorage.setItem("smena_user_v1", JSON.stringify({ id: "u_sch", name: "Школа Тест", email: "sch@example.ru", createdAt: "2026-11-01T00:00:00Z" }));
      schApp = { id: "sc_1", status: "accepted", direction: "Фотография", createdAt: "2026-11-10T00:00:00Z" };
      Store.schoolMyCourse = function () {
        return Promise.resolve({
          ok: true,
          cohort: { id: "sc_1", name: "Набор 001" },
          assignments: [{ id: "as_1", title: "Задание 1: портрет двора", brief: "Снимите серию из 10 кадров.", dueAt: "", order: 1 }],
          subs: [{ id: "sb_1", assignmentId: "as_1", userId: "u_sch", userName: "Школа Тест", text: "серия готова",
            status: "accepted", groupNote: "сильная серия", personalNote: "", points: 12, attempt: 1,
            createdAt: "2026-11-10T10:00:00Z", reviewedAt: "2026-11-11T10:00:00Z" }],
          modules: [], quizzes: [], myQuiz: {},
          points: 47,
        });
      };
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    const host = doc.querySelector("[data-school-course]");
    check("после принятия всех заданий видна плашка «Курс набора пройден»",
      !!host && /Курс набора пройден/.test(host.textContent) && /справку о завершении/.test(host.textContent),
      host && host.textContent.slice(0, 160));
    dom.window.close();
  }

  /* 4. Кабинет: блок медиашколы в обзоре */
  {
    const { dom } = makeDom("/profile/index.html", BASE + `
      localStorage.setItem("smena_token_v1", "school-token");
      localStorage.setItem("smena_user_v1", JSON.stringify({ id: "u_sch", name: "Школа Тест", email: "sch@example.ru", role: "Автор", createdAt: "2026-11-01T00:00:00Z" }));
      schApp = { id: "sc_1", status: "pending", direction: "Видео и монтаж", createdAt: "2026-11-11T00:00:00Z" };
    `);
    await new Promise((r) => setTimeout(r, 2000));
    const doc = dom.window.document;
    const overview = doc.querySelector('[data-cab-panel="overview"]');
    check("в кабинете есть блок медиашколы", !!overview && !!overview.querySelector("[data-school-host]"));
    check("в кабинете виден статус заявки",
      !!overview && /Заявка на рассмотрении/.test(overview.textContent) && /Видео и монтаж/.test(overview.textContent));
    dom.window.close();
  }

  if (bad) {
    console.log("медиашкола: проверка не пройдена");
    process.exit(1);
  }
  console.log("все проверки пройдены");
})();
