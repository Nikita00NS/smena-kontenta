/* ============================================================================
   Автоматическое сезонное оформление «Смены контента».
   Даты берутся по местному календарю устройства; эффекты декоративные,
   отключаются для текущего месяца кнопкой и не используют внешние ресурсы.
   ========================================================================== */
(function (window, document) {
  "use strict";

  var STORAGE_KEY = "smena_seasonal_hidden_v1";
  var initialized = false;
  var LOCALES = {
    ru: "ru-RU", en: "en-GB", uk: "uk-UA", kk: "kk-KZ", be: "be-BY",
    de: "de-DE", fr: "fr-FR", es: "es-ES", tr: "tr-TR", zh: "zh-CN"
  };

  var MONTH_MARKS = ["✳", "✦", "✿", "↗", "✺", "☼", "◉", "✹", "✎", "✦", "◎", "❄"];
  var SEASONS = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];

  var HOLIDAYS = {
    "new-year": { label: "newYearLabel", message: "newYearMessage", mark: "❄" },
    "defender-day": { label: "defenderLabel", message: "defenderMessage", mark: "⬡" },
    "women-day": { label: "womenLabel", message: "womenMessage", mark: "✿" },
    "cosmonautics-day": { label: "cosmonauticsLabel", message: "cosmonauticsMessage", mark: "↗" },
    "spring-labour-day": { label: "springLabourLabel", message: "springLabourMessage", mark: "✿" },
    "victory-day": { label: "victoryLabel", message: "victoryMessage", mark: "✦" },
    "russia-day": { label: "russiaLabel", message: "russiaMessage", mark: "◈" },
    "knowledge-day": { label: "knowledgeLabel", message: "knowledgeMessage", mark: "✎" },
    "unity-day": { label: "unityLabel", message: "unityMessage", mark: "◎" },
    "constitution-day": { label: "constitutionLabel", message: "constitutionMessage", mark: "§" }
  };

  function makeCopy(monthCaption, seasons, holidays, hideLabel, regionLabel) {
    return {
      monthCaption: monthCaption,
      seasons: seasons,
      holidays: holidays,
      hideLabel: hideLabel,
      regionLabel: regionLabel
    };
  }

  var COPY = {
    ru: makeCopy("Тема месяца", {
      winter: "Зима — собираем истории, которые согревают.",
      spring: "Весна — время новых идей и историй.",
      summer: "Лето — сезон репортажей из самых разных мест.",
      autumn: "Осень — пора замечать важные детали."
    }, {
      newYearLabel: "Новогоднее настроение",
      newYearMessage: "Снег уже в редакции — собираем истории для нового года.",
      defenderLabel: "День защитника Отечества",
      defenderMessage: "За надёжную команду и смелые идеи.",
      womenLabel: "Международный женский день",
      womenMessage: "Отмечаем талант, смелость и истории, которые меняют мир.",
      cosmonauticsLabel: "День космонавтики",
      cosmonauticsMessage: "Большие открытия начинаются с любопытства.",
      springLabourLabel: "Праздник Весны и Труда",
      springLabourMessage: "Пусть новые идеи растут и объединяют.",
      victoryLabel: "День Победы",
      victoryMessage: "Помним, бережём память и говорим с уважением.",
      russiaLabel: "День России",
      russiaMessage: "Голоса регионов — часть общей истории.",
      knowledgeLabel: "День знаний",
      knowledgeMessage: "Открываем новый сезон историй и открытий.",
      unityLabel: "День народного единства",
      unityMessage: "Разные регионы — одна команда историй.",
      constitutionLabel: "День Конституции",
      constitutionMessage: "Права, свободы и ответственность — основа общего дома."
    }, "Скрыть оформление", "Сезонное оформление"),
    en: makeCopy("Theme of the month", {
      winter: "Winter is for stories that bring a little warmth.",
      spring: "Spring is a time for fresh ideas and new stories.",
      summer: "Summer is the season for reporting from everywhere.",
      autumn: "Autumn is a good time to notice the details."
    }, {
      newYearLabel: "New Year mood",
      newYearMessage: "Snow has reached the newsroom—we're gathering stories for the new year.",
      defenderLabel: "Defender of the Fatherland Day",
      defenderMessage: "Here's to a reliable team and brave ideas.",
      womenLabel: "International Women's Day",
      womenMessage: "Celebrating talent, courage, and stories that change the world.",
      cosmonauticsLabel: "Cosmonautics Day",
      cosmonauticsMessage: "Big discoveries begin with curiosity.",
      springLabourLabel: "Spring and Labour Day",
      springLabourMessage: "May new ideas grow and bring people together.",
      victoryLabel: "Victory Day",
      victoryMessage: "We remember, preserve memory, and speak with respect.",
      russiaLabel: "Russia Day",
      russiaMessage: "The voices of the regions are part of a shared story.",
      knowledgeLabel: "Knowledge Day",
      knowledgeMessage: "A new season of stories and discoveries begins.",
      unityLabel: "National Unity Day",
      unityMessage: "Different regions, one community of stories.",
      constitutionLabel: "Constitution Day",
      constitutionMessage: "Rights, freedoms, and responsibility are the foundation of our shared home."
    }, "Hide seasonal design", "Seasonal design"),
    uk: makeCopy("Тема місяця", {
      winter: "Зима — збираємо історії, що зігрівають.",
      spring: "Весна — час нових ідей та історій.",
      summer: "Літо — сезон репортажів із різних місць.",
      autumn: "Осінь — час помічати важливі деталі."
    }, {
      newYearLabel: "Новорічний настрій",
      newYearMessage: "Сніг уже в редакції — збираємо історії до нового року.",
      defenderLabel: "День захисника Вітчизни",
      defenderMessage: "За надійну команду та сміливі ідеї.",
      womenLabel: "Міжнародний жіночий день",
      womenMessage: "Відзначаємо талант, сміливість та історії, що змінюють світ.",
      cosmonauticsLabel: "День космонавтики",
      cosmonauticsMessage: "Великі відкриття починаються з цікавості.",
      springLabourLabel: "Свято Весни і Праці",
      springLabourMessage: "Нехай нові ідеї зростають і об'єднують.",
      victoryLabel: "День перемоги над нацизмом у Другій світовій війні",
      victoryMessage: "Пам'ятаємо, бережемо пам'ять і говоримо з повагою.",
      russiaLabel: "День Росії",
      russiaMessage: "Голоси регіонів — частина спільної історії.",
      knowledgeLabel: "День знань",
      knowledgeMessage: "Відкриваємо новий сезон історій та відкриттів.",
      unityLabel: "День народної єдності",
      unityMessage: "Різні регіони — одна команда історій.",
      constitutionLabel: "День Конституції",
      constitutionMessage: "Права, свободи та відповідальність — основа спільного дому."
    }, "Приховати оформлення", "Сезонне оформлення"),
    kk: makeCopy("Ай тақырыбы", {
      winter: "Қыс — жылытатын оқиғаларды жинаймыз.",
      spring: "Көктем — жаңа идеялар мен оқиғалар уақыты.",
      summer: "Жаз — әр жерден репортаж жасайтын маусым.",
      autumn: "Күз — маңызды бөлшектерді байқайтын кез."
    }, {
      newYearLabel: "Жаңа жыл көңіл күйі",
      newYearMessage: "Редакцияға қар жауды — жаңа жылға оқиғалар жинаймыз.",
      defenderLabel: "Отан қорғаушылар күні",
      defenderMessage: "Сенімді команда мен батыл идеялар үшін.",
      womenLabel: "Халықаралық әйелдер күні",
      womenMessage: "Әлемді өзгертетін талантты, батылдықты және оқиғаларды атап өтеміз.",
      cosmonauticsLabel: "Ғарышкерлер күні",
      cosmonauticsMessage: "Үлкен жаңалықтар қызығушылықтан басталады.",
      springLabourLabel: "Көктем және еңбек мерекесі",
      springLabourMessage: "Жаңа идеялар өсіп, адамдарды біріктірсін.",
      victoryLabel: "Жеңіс күні",
      victoryMessage: "Еске аламыз, жадымызды сақтаймыз және құрметпен сөйлейміз.",
      russiaLabel: "Ресей күні",
      russiaMessage: "Өңірлердің дауыстары — ортақ тарихтың бөлігі.",
      knowledgeLabel: "Білім күні",
      knowledgeMessage: "Оқиғалар мен жаңалықтардың жаңа маусымын бастаймыз.",
      unityLabel: "Халық бірлігі күні",
      unityMessage: "Әртүрлі өңірлер — ортақ оқиғалар командасы.",
      constitutionLabel: "Конституция күні",
      constitutionMessage: "Құқықтар, бостандықтар мен жауапкершілік — ортақ үйдің негізі."
    }, "Безендіруді жасыру", "Маусымдық безендіру"),
    be: makeCopy("Тэма месяца", {
      winter: "Зіма — збіраем гісторыі, якія саграваюць.",
      spring: "Вясна — час новых ідэй і гісторый.",
      summer: "Лета — сезон рэпартажаў з розных мясцін.",
      autumn: "Восень — пара заўважаць важныя дэталі."
    }, {
      newYearLabel: "Навагодні настрой",
      newYearMessage: "Снег ужо ў рэдакцыі — збіраем гісторыі да новага года.",
      defenderLabel: "Дзень абаронцы Айчыны",
      defenderMessage: "За надзейную каманду і смелыя ідэі.",
      womenLabel: "Міжнародны жаночы дзень",
      womenMessage: "Адзначаем талент, смеласць і гісторыі, якія мяняюць свет.",
      cosmonauticsLabel: "Дзень касманаўтыкі",
      cosmonauticsMessage: "Вялікія адкрыцці пачынаюцца з цікаўнасці.",
      springLabourLabel: "Свята Вясны і Працы",
      springLabourMessage: "Няхай новыя ідэі растуць і аб'ядноўваюць.",
      victoryLabel: "Дзень Перамогі",
      victoryMessage: "Памятаем, беражом памяць і гаворым з павагай.",
      russiaLabel: "Дзень Расіі",
      russiaMessage: "Галасы рэгіёнаў — частка агульнай гісторыі.",
      knowledgeLabel: "Дзень ведаў",
      knowledgeMessage: "Адкрываем новы сезон гісторый і адкрыццяў.",
      unityLabel: "Дзень народнага адзінства",
      unityMessage: "Розныя рэгіёны — адна каманда гісторый.",
      constitutionLabel: "Дзень Канстытуцыі",
      constitutionMessage: "Правы, свабоды і адказнасць — аснова агульнага дома."
    }, "Схаваць афармленне", "Сезоннае афармленне"),
    de: makeCopy("Thema des Monats", {
      winter: "Der Winter bringt Geschichten, die ein wenig wärmen.",
      spring: "Der Frühling ist die Zeit für neue Ideen und Geschichten.",
      summer: "Der Sommer ist die Saison für Reportagen von überall.",
      autumn: "Der Herbst lädt dazu ein, auf Details zu achten."
    }, {
      newYearLabel: "Neujahrsstimmung",
      newYearMessage: "Der Schnee ist schon in der Redaktion – wir sammeln Geschichten fürs neue Jahr.",
      defenderLabel: "Tag des Vaterlandsverteidigers",
      defenderMessage: "Auf ein verlässliches Team und mutige Ideen.",
      womenLabel: "Internationaler Frauentag",
      womenMessage: "Wir feiern Talent, Mut und Geschichten, die die Welt verändern.",
      cosmonauticsLabel: "Tag der Kosmonautik",
      cosmonauticsMessage: "Große Entdeckungen beginnen mit Neugier.",
      springLabourLabel: "Tag des Frühlings und der Arbeit",
      springLabourMessage: "Mögen neue Ideen wachsen und Menschen verbinden.",
      victoryLabel: "Tag des Sieges",
      victoryMessage: "Wir erinnern uns, bewahren das Gedenken und sprechen mit Respekt.",
      russiaLabel: "Tag Russlands",
      russiaMessage: "Die Stimmen der Regionen sind Teil einer gemeinsamen Geschichte.",
      knowledgeLabel: "Tag des Wissens",
      knowledgeMessage: "Eine neue Saison voller Geschichten und Entdeckungen beginnt.",
      unityLabel: "Tag der nationalen Einheit",
      unityMessage: "Verschiedene Regionen, eine Gemeinschaft von Geschichten.",
      constitutionLabel: "Tag der Verfassung",
      constitutionMessage: "Rechte, Freiheiten und Verantwortung sind das Fundament unseres gemeinsamen Hauses."
    }, "Saisonales Design ausblenden", "Saisonales Design"),
    fr: makeCopy("Thème du mois", {
      winter: "L'hiver rassemble des histoires qui réchauffent.",
      spring: "Le printemps est le temps des idées et des récits nouveaux.",
      summer: "L'été est la saison des reportages aux quatre coins du pays.",
      autumn: "L'automne invite à remarquer les détails importants."
    }, {
      newYearLabel: "Ambiance du Nouvel An",
      newYearMessage: "La neige est déjà à la rédaction : nous préparons les histoires de la nouvelle année.",
      defenderLabel: "Journée du défenseur de la patrie",
      defenderMessage: "À une équipe fiable et à des idées audacieuses.",
      womenLabel: "Journée internationale des femmes",
      womenMessage: "Célébrons le talent, le courage et les histoires qui changent le monde.",
      cosmonauticsLabel: "Journée de la cosmonautique",
      cosmonauticsMessage: "Les grandes découvertes commencent par la curiosité.",
      springLabourLabel: "Fête du printemps et du travail",
      springLabourMessage: "Que les idées nouvelles grandissent et nous rassemblent.",
      victoryLabel: "Jour de la Victoire",
      victoryMessage: "Nous nous souvenons, préservons la mémoire et parlons avec respect.",
      russiaLabel: "Jour de la Russie",
      russiaMessage: "Les voix des régions font partie d'une histoire commune.",
      knowledgeLabel: "Jour du savoir",
      knowledgeMessage: "Une nouvelle saison d'histoires et de découvertes commence.",
      unityLabel: "Journée de l'unité nationale",
      unityMessage: "Des régions différentes, une même communauté d'histoires.",
      constitutionLabel: "Jour de la Constitution",
      constitutionMessage: "Les droits, les libertés et la responsabilité fondent notre maison commune."
    }, "Masquer le décor saisonnier", "Décor saisonnier"),
    es: makeCopy("Tema del mes", {
      winter: "El invierno reúne historias que dan calor.",
      spring: "La primavera trae nuevas ideas e historias.",
      summer: "El verano es tiempo de reportajes desde cualquier lugar.",
      autumn: "El otoño invita a fijarse en los detalles importantes."
    }, {
      newYearLabel: "Ambiente de Año Nuevo",
      newYearMessage: "La nieve ya llegó a la redacción: reunimos historias para el nuevo año.",
      defenderLabel: "Día del Defensor de la Patria",
      defenderMessage: "Por un equipo unido y unas ideas valientes.",
      womenLabel: "Día Internacional de la Mujer",
      womenMessage: "Celebramos el talento, el valor y las historias que cambian el mundo.",
      cosmonauticsLabel: "Día de la Cosmonáutica",
      cosmonauticsMessage: "Los grandes descubrimientos empiezan con curiosidad.",
      springLabourLabel: "Día de la Primavera y el Trabajo",
      springLabourMessage: "Que las nuevas ideas crezcan y nos unan.",
      victoryLabel: "Día de la Victoria",
      victoryMessage: "Recordamos, cuidamos la memoria y hablamos con respeto.",
      russiaLabel: "Día de Rusia",
      russiaMessage: "Las voces de las regiones forman parte de una historia común.",
      knowledgeLabel: "Día del Conocimiento",
      knowledgeMessage: "Comienza una nueva temporada de historias y descubrimientos.",
      unityLabel: "Día de la Unidad Nacional",
      unityMessage: "Regiones distintas, una comunidad de historias.",
      constitutionLabel: "Día de la Constitución",
      constitutionMessage: "Los derechos, las libertades y la responsabilidad son la base de nuestro hogar común."
    }, "Ocultar diseño de temporada", "Diseño de temporada"),
    tr: makeCopy("Ayın teması", {
      winter: "Kış, içimizi ısıtan hikâyeleri toplama zamanı.",
      spring: "İlkbahar yeni fikirlerin ve hikâyelerin zamanı.",
      summer: "Yaz, her yerden haber ve röportaj mevsimi.",
      autumn: "Sonbahar, önemli ayrıntıları fark etme zamanı."
    }, {
      newYearLabel: "Yeni yıl havası",
      newYearMessage: "Haber odasına kar geldi; yeni yıl için hikâyeler topluyoruz.",
      defenderLabel: "Vatan Savunucuları Günü",
      defenderMessage: "Güvenilir bir ekip ve cesur fikirler için.",
      womenLabel: "Dünya Kadınlar Günü",
      womenMessage: "Dünyayı değiştiren yeteneği, cesareti ve hikâyeleri kutluyoruz.",
      cosmonauticsLabel: "Kozmonot Günü",
      cosmonauticsMessage: "Büyük keşifler merakla başlar.",
      springLabourLabel: "Bahar ve Emek Bayramı",
      springLabourMessage: "Yeni fikirler büyüsün ve insanları birleştirsin.",
      victoryLabel: "Zafer Bayramı",
      victoryMessage: "Hatırlıyor, anıları koruyor ve saygıyla konuşuyoruz.",
      russiaLabel: "Rusya Günü",
      russiaMessage: "Bölgelerin sesleri ortak bir hikâyenin parçasıdır.",
      knowledgeLabel: "Bilgi Günü",
      knowledgeMessage: "Yeni hikâyeler ve keşiflerle dolu bir sezon başlıyor.",
      unityLabel: "Ulusal Birlik Günü",
      unityMessage: "Farklı bölgeler, tek bir hikâye topluluğu.",
      constitutionLabel: "Anayasa Günü",
      constitutionMessage: "Haklar, özgürlükler ve sorumluluk ortak evimizin temelidir."
    }, "Mevsim tasarımını gizle", "Mevsim tasarımı"),
    zh: makeCopy("本月主题", {
      winter: "冬天，收集温暖人心的故事。",
      spring: "春天，是新想法和新故事的季节。",
      summer: "夏天，是从各地带来报道的时节。",
      autumn: "秋天，让我们留意那些重要的细节。"
    }, {
      newYearLabel: "新年氛围",
      newYearMessage: "雪花已经飘进编辑部，我们正在收集新年的故事。",
      defenderLabel: "祖国保卫者日",
      defenderMessage: "致可靠的团队和勇敢的想法。",
      womenLabel: "国际妇女节",
      womenMessage: "致敬改变世界的才华、勇气和故事。",
      cosmonauticsLabel: "航天日",
      cosmonauticsMessage: "伟大的发现始于好奇心。",
      springLabourLabel: "春天与劳动节",
      springLabourMessage: "愿新想法不断成长，并把大家连接在一起。",
      victoryLabel: "胜利日",
      victoryMessage: "铭记历史、珍惜记忆，并始终保持尊重。",
      russiaLabel: "俄罗斯日",
      russiaMessage: "各地区的声音共同构成一段故事。",
      knowledgeLabel: "知识日",
      knowledgeMessage: "新的故事与发现季即将开启。",
      unityLabel: "民族团结日",
      unityMessage: "不同的地区，共同的故事社区。",
      constitutionLabel: "宪法日",
      constitutionMessage: "权利、自由与责任，是共同家园的基石。"
    }, "隐藏季节装饰", "季节装饰")
  };

  function twoDigits(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function holidayFor(month, day) {
    if ((month === 12 && day >= 20) || (month === 1 && day <= 8)) return "new-year";
    if (month === 2 && day === 23) return "defender-day";
    if (month === 3 && day === 8) return "women-day";
    if (month === 4 && day === 12) return "cosmonautics-day";
    if (month === 5 && day === 1) return "spring-labour-day";
    if (month === 5 && day === 9) return "victory-day";
    if (month === 6 && day === 12) return "russia-day";
    if (month === 9 && day === 1) return "knowledge-day";
    if (month === 11 && day === 4) return "unity-day";
    if (month === 12 && day === 12) return "constitution-day";
    return "";
  }

  function detect(date) {
    date = date instanceof Date ? date : new Date(date);
    if (isNaN(date.getTime())) date = new Date();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    var year = date.getFullYear();
    var holiday = holidayFor(month, day);
    var period = holiday === "new-year"
      ? "new-year-" + (month === 12 ? year : year - 1)
      : year + "-" + twoDigits(month);
    return {
      year: year,
      month: month,
      day: day,
      season: SEASONS[month - 1],
      holiday: holiday,
      period: period
    };
  }

  function currentLanguage() {
    var lang = "";
    if (window.SmenaI18n && window.SmenaI18n.lang) lang = window.SmenaI18n.lang;
    if (!lang) {
      try { lang = window.localStorage.getItem("smena_lang") || ""; } catch (e) {}
    }
    if (!lang) lang = document.documentElement.getAttribute("lang") || "ru";
    lang = String(lang).toLowerCase().split(/[-_]/)[0];
    return COPY[lang] ? lang : "ru";
  }

  function monthName(date, lang) {
    var locale = LOCALES[lang] || LOCALES.ru;
    var label;
    try {
      label = new Intl.DateTimeFormat(locale, { month: "long" }).format(date);
    } catch (e) {
      label = String(date.getMonth() + 1);
    }
    try { return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1); }
    catch (e2) { return label.charAt(0).toUpperCase() + label.slice(1); }
  }

  function storageValue(key) {
    try { return window.localStorage.getItem(key) || ""; }
    catch (e) { return ""; }
  }

  function clearDecorations() {
    var root = document.documentElement;
    root.removeAttribute("data-seasonal-month");
    root.removeAttribute("data-seasonal-season");
    root.removeAttribute("data-seasonal-holiday");
    var banner = document.querySelector(".site-seasonal");
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    var snow = document.querySelector(".site-seasonal-snow");
    if (snow && snow.parentNode) snow.parentNode.removeChild(snow);
  }

  function appendText(parent, tag, className, text) {
    var node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  function addBanner(state, copy, lang) {
    var banner = document.createElement("aside");
    banner.className = "site-seasonal";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", copy.regionLabel);
    banner.setAttribute("data-no-i18n", "");

    var event = state.holiday && HOLIDAYS[state.holiday] ? HOLIDAYS[state.holiday] : null;
    var mark = appendText(banner, "span", "site-seasonal__mark", event ? event.mark : MONTH_MARKS[state.month - 1]);
    mark.setAttribute("aria-hidden", "true");

    var content = document.createElement("div");
    content.className = "site-seasonal__content";
    banner.appendChild(content);

    var label = event ? copy.holidays[event.label] : copy.monthCaption + " · " + monthName(new Date(state.year, state.month - 1, state.day), lang);
    var message = event ? copy.holidays[event.message] : copy.seasons[state.season];
    appendText(content, "span", "site-seasonal__label", label);
    appendText(content, "p", "site-seasonal__message", message);

    var close = document.createElement("button");
    close.className = "site-seasonal__dismiss";
    close.type = "button";
    close.setAttribute("aria-label", copy.hideLabel);
    close.setAttribute("title", copy.hideLabel);
    close.textContent = "×";
    close.addEventListener("click", function () {
      try { window.localStorage.setItem(STORAGE_KEY, state.period); } catch (e) {}
      clearDecorations();
    });
    banner.appendChild(close);

    var mount = document.querySelector("[data-header]");
    if (mount) {
      mount.insertAdjacentElement("afterend", banner);
    } else {
      mount = document.querySelector(".ps-hud");
      if (mount) {
        banner.classList.add("site-seasonal--search");
        mount.insertAdjacentElement("afterend", banner);
      } else if (document.body.firstChild) {
        document.body.insertBefore(banner, document.body.firstChild);
      } else {
        document.body.appendChild(banner);
      }
    }
  }

  function addSnow() {
    var reduced = false;
    try { reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) {}
    if (reduced) return;

    var layer = document.createElement("div");
    layer.className = "site-seasonal-snow";
    layer.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 16; i++) {
      var flake = document.createElement("span");
      flake.className = "site-seasonal-snow__flake";
      flake.textContent = i % 4 === 0 ? "✦" : "❄";
      flake.style.left = ((i * 47 + 9) % 100) + "%";
      flake.style.fontSize = (12 + (i % 4) * 4) + "px";
      flake.style.setProperty("--snow-delay", -((i % 9) * 1.4) + "s");
      flake.style.setProperty("--snow-duration", (14 + (i % 5) * 2) + "s");
      flake.style.setProperty("--snow-drift", ((i % 2 ? 1 : -1) * (10 + (i % 4) * 8)) + "px");
      layer.appendChild(flake);
    }
    document.body.appendChild(layer);
  }

  function init(date) {
    if (!document.body) return null;
    initialized = true;
    clearDecorations();
    var state = detect(date || new Date());
    var language = currentLanguage();
    var copy = COPY[language] || COPY.ru;

    if (storageValue(STORAGE_KEY) === state.period) return state;

    document.documentElement.setAttribute("data-seasonal-month", String(state.month));
    document.documentElement.setAttribute("data-seasonal-season", state.season);
    if (state.holiday) document.documentElement.setAttribute("data-seasonal-holiday", state.holiday);

    addBanner(state, copy, language);
    if (state.holiday === "new-year") addSnow();
    return state;
  }

  window.SmenaSeasonal = {
    detect: detect,
    init: init
  };

  function autoInit() {
    if (!initialized) init(new Date());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit, { once: true });
  } else {
    autoInit();
  }
})(window, document);
