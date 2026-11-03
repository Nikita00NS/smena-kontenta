from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

W, H = 960, 540
BG, PANEL, INK, MUTED, ACCENT, LINE = (
    HexColor("#0A0A0A"), HexColor("#161513"), HexColor("#F7F5EF"),
    HexColor("#9A968C"), HexColor("#FF3D14"), HexColor("#2A2824"),
)

pdfmetrics.registerFont(TTFont("D", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))

OUT = "/home/user/deck/smena-kontenta-prezentacia.pdf"
c = canvas.Canvas(OUT, pagesize=landscape((W, H)))
c.setTitle("Смена контента — презентация проекта")
c.setAuthor("Смена контента")


def page(n):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    return n


def footer(n):
    c.setFont("D", 8)
    c.setFillColor(MUTED)
    c.drawString(60, 22, "Смена контента · smenakontenta.ru")
    c.drawRightString(W - 60, 22, "%02d" % n)


def txt(x, y, s, size=14, color=INK, bold=False, leading=None):
    c.setFont("DB" if bold else "D", size)
    c.setFillColor(color)
    c.drawString(x, y, s)


def wrap(x, y, s, size=14, color=INK, width=800, leading=None, bold=False):
    """простой перенос по словам"""
    c.setFont("DB" if bold else "D", size)
    c.setFillColor(color)
    lead = leading or size * 1.32
    words = s.split()
    line = ""
    yy = y
    for w in words:
        probe = (line + " " + w).strip()
        if c.stringWidth(probe, "DB" if bold else "D", size) > width and line:
            c.drawString(x, yy, line)
            yy -= lead
            line = w
        else:
            line = probe
    if line:
        c.drawString(x, yy, line)
    return yy - lead


def kicker(s, y=H - 62):
    txt(60, y, s.upper(), 9.5, ACCENT, True)
    return y - 26


def title(s, y, size=30):
    txt(60, y, s, size, INK, True)
    return y - 34


def rule(y, x=60, w=W - 120, color=LINE):
    c.setStrokeColor(color)
    c.setLineWidth(0.7)
    c.line(x, y, x + w, y)


def bullets(items, y, size=13, gap=30, width=820):
    for i, it in enumerate(items):
        yy = y - i * gap
        c.setFillColor(ACCENT)
        c.rect(60, yy + 3, 5, 5, stroke=0, fill=1)
        wrap(80, yy, it, size, INK, width)


def stat(x, y, big, small):
    txt(x, y, big, 40, INK, True)
    wrap(x, y - 26, small, 10.5, MUTED, 190)


# --- 1 титул
n = page(1)
txt(60, H - 62, "МОЛОДЁЖНОЕ МЕДИА · МЕДИАШКОЛА · СООБЩЕСТВО АВТОРОВ", 9.5, ACCENT, True)
txt(60, H - 140, "Смена контента", 52, INK, True)
wrap(60, H - 190, "Медиа, которое молодые люди делают сами:", 16, INK, 620)
wrap(60, H - 214, "истории из регионов России и школа, где учат их делать", 16, INK, 620)
rule(H - 268)
txt(60, H - 316, "САЙТ", 8.5, MUTED, True)
txt(60, H - 348, "smenakontenta.ru", 24, ACCENT, True)
for i, line in enumerate(["14 разделов · карта 84 регионов",
                          "6 документов проекта · панель редакции",
                          "регион запуска — Москва, 2026 год"]):
    txt(470, H - 306 - i * 20, line, 11, MUTED)
footer(1)
c.showPage()

# --- 2 три части
n = page(2)
y = kicker("Что это")
title("Три части одного проекта", y)
cards = [
    ("Медиа", ["Новости, репортажи, интервью,", "фотоистории, видео и подкасты", "о жизни молодёжи в регионах."]),
    ("Медиашкола", ["Шесть направлений, задачи,", "разбор каждого материала", "и публикация с подписью автора."]),
    ("Сообщество", ["Авторы, фотографы, редакторы", "и наставники из разных городов.", "Со временем — региональные команды."]),
]
for i, (t, lines) in enumerate(cards):
    x = 60 + i * 280
    c.setFillColor(PANEL)
    c.setStrokeColor(LINE)
    c.rect(x, 130, 250, 240, stroke=1, fill=1)
    txt(x + 24, 330, t, 17, INK, True)
    for j, line in enumerate(lines):
        txt(x + 24, 296 - j * 19, line, 10.5, MUTED)
footer(2)
c.showPage()

# --- 3 цифры
n = page(3)
y = kicker("Коротко в цифрах")
title("Что уже собрано", y)
for i, (b, sm) in enumerate([("84", "региона на карте"), ("14", "разделов сайта"),
                             ("6", "документов проекта"), ("150 ₽", "бюджет запуска")]):
    stat(60 + i * 215, 310, b, sm)
rule(200)
wrap(60, 160, "Хостинг в России, домен .ru, никаких платных сервисов и подписок.", 12, MUTED, 820)
wrap(60, 140, "Сайт открывается без VPN и с телефона: тёмная тема по умолчанию, светлая — переключателем.", 12, MUTED, 820)
footer(3)
c.showPage()

# --- 4 карта
n = page(4)
y = kicker("Главная особенность")
title("Карта регионов", y)
bullets(["84 субъекта: клик по региону — материалы местных авторов",
         "если публикаций нет, сайт честно об этом говорит и предлагает стать первым",
         "на карте видно, откуда уже есть истории, а где нужен автор"], 270, 13, 34)
c.setFillColor(PANEL)
c.setStrokeColor(LINE)
c.rect(60, 100, 840, 78, stroke=1, fill=1)
wrap(84, 152, "Ни одной выдуманной новости. Пустой регион — это не «скоро здесь будет интересно»,", 11.5, INK, 790)
wrap(84, 132, "а честный сигнал: сюда нужен автор. Именно этим проект отличается от витрины.", 11.5, INK, 790)
footer(4)
c.showPage()

# --- 5 путь материала
n = page(5)
y = kicker("Редакционный процесс")
title("Как материал попадает на сайт", y)
steps = [("01", "Регистрация", ["минута, без заявок", "и ожидания"]),
         ("02", "Материал", ["редактор с подсказками,", "черновики сохраняются"]),
         ("03", "Проверка", ["редакция читает", "и даёт замечания"]),
         ("04", "Публикация", ["лента, карта региона,", "портфолио автора"])]
for i, (num, t, lines) in enumerate(steps):
    x = 60 + i * 212
    txt(x, 330, num, 10, ACCENT, True)
    txt(x, 306, t, 15, INK, True)
    for j, line in enumerate(lines):
        txt(x, 282 - j * 17, line, 9.5, MUTED)
    if i < 3:
        txt(x + 182, 306, "→", 14, ACCENT)
wrap(60, 190, "У каждого материала есть номер. Перед публикацией — проверка фактов и прав на фото:", 11.5, INK, 800)
wrap(60, 170, "сайт не публикует то, что редакция не может подтвердить.", 11.5, INK, 800)
footer(5)
c.showPage()

# --- 6 пресс-карта
n = page(6)
y = kicker("Пресс-карта")
title("Карта — по заявке, а не по выслуге", y)
bullets(["5 публикаций — право подать заявку индивидуальному автору",
         "20 публикаций — карта каждому участнику редакции",
         "в заявке автор прикладывает все свои материалы: они проверяются по номерам",
         "номер карты вида СК-2026-001, срок действия — год"], 272, 12.5, 30)
c.setFillColor(PANEL)
c.setStrokeColor(LINE)
c.rect(60, 100, 840, 66, stroke=1, fill=1)
wrap(84, 146, "Решение принимает редакция в панели. Карта подтверждает: человек пишет для проекта", 11, INK, 790)
wrap(84, 128, "и его материалы прошли проверку — это и есть ответ на вопрос «кто вы такие».", 11, INK, 790)
footer(6)
c.showPage()

# --- 7 техника
n = page(7)
y = kicker("Техническая часть")
title("Сайт, который работает сам", y)
bullets(["серверная часть на PHP на хостинге в России: приёмная материалов и панель редакции",
         "материал, написанный с телефона, доходит до редакции — не остаётся в браузере",
         "адреса без .html: /about, /news, /docs — как у большого медиа",
         "выкладка автоматическая: правка в репозитории → сайт обновился за минуту",
         "данные хранятся на сервере в России, без зарубежных сервисов"], 280, 12, 32)
footer(7)
c.showPage()

# --- 8 документы
n = page(8)
y = kicker("Документы")
title("Шесть документов проекта", y)
items = ["Пресс-кит для партнёров", "Редакционная политика и кодекс",
         "Памятка автору", "Программа медиашколы",
         "Политика конфиденциальности", "Пользовательское соглашение"]
for i, it in enumerate(items):
    col, row = i % 2, i // 2
    x, yy = 60 + col * 420, 290 - row * 44
    txt(x, yy, "—", 11, ACCENT, True)
    txt(x + 26, yy, it, 12.5, INK)
wrap(60, 96, "Все документы — PDF на сайте. ИНН учредителей печатается только там, где это обязательно:", 9.5, MUTED, 800)
wrap(60, 78, "в политике конфиденциальности. В презентационных материалах — только имена.", 9.5, MUTED, 800)
footer(8)
c.showPage()

# --- 9 готово
n = page(9)
y = kicker("Статус")
title("Что готово к запуску", y)
done = ["сайт опубликован на домене smenakontenta.ru",
        "регистрация, кабинет автора, редактор материалов",
        "лента, страницы регионов, поиск и фильтры",
        "проверка материалов редакцией и панель управления",
        "заявки на пресс-карту и выдача номеров",
        "документы, пресс-кит, адаптив и тёмная тема"]
for i, it in enumerate(done):
    yy = 288 - i * 32
    txt(60, yy, "✓", 10, ACCENT, True)
    txt(82, yy, it, 12.5, INK)
footer(9)
c.showPage()

# --- 10 план
n = page(10)
y = kicker("Ближайший план")
title("Что делаем дальше", y)
plan = [("Почта на домене", "ящик вида redakcia@smenakontenta.ru: регистрация с подтверждением адреса"),
        ("Вход через VK и Яндекс", "автор заходит в один клик, почта привязывается обязательно"),
        ("Панель: редактирование", "правка текстов, авторы, история решений редакции"),
        ("Юридический шаг", "уведомление оператора персональных данных — в установленном порядке")]
for i, (t, d) in enumerate(plan):
    yy = 300 - i * 52
    txt(60, yy, "0%d" % (i + 1), 10, ACCENT, True)
    txt(96, yy, t, 13.5, INK, True)
    wrap(330, yy, d, 10, MUTED, 570)
footer(10)
c.showPage()

# --- 11 кого ищем
n = page(11)
y = kicker("Что нужно проекту")
title("Кого мы ищем", y)
want = [("Авторов", "школьников, студентов и всех, кто хочет пробовать: истории нужны из всех регионов"),
        ("Редактора", "человека, который будет читать материалы и держать планку"),
        ("Вузы и центры", "практику для студентов и площадки для занятий"),
        ("Редакции СМИ", "наставничество и обмен опытом")]
for i, (t, d) in enumerate(want):
    yy = 300 - i * 52
    txt(60, yy, t, 14, INK, True)
    wrap(330, yy, d, 10.5, MUTED, 570)
footer(11)
c.showPage()

# --- 12 финал
n = page(12)
txt(60, H - 100, "СМЕНА КОНТЕНТА", 9.5, ACCENT, True)
txt(60, H - 175, "Спасибо.", 36, INK, True)
txt(60, H - 220, "Ждём авторов из всех 84 регионов.", 24, INK, True)
rule(H - 270)
txt(60, H - 320, "САЙТ", 8.5, MUTED, True)
txt(60, H - 352, "smenakontenta.ru", 22, ACCENT, True)
txt(470, H - 314, "Документы, пресс-кит и программа", 10.5, MUTED)
txt(470, H - 332, "медиашколы — в разделе «Документы».", 10.5, MUTED)
footer(12)
c.showPage()

c.save()
print("PDF готов:", OUT)
