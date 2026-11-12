#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Два согласия для подписи от руки.

1. assets/docs/soglasie-na-obrabotku-pd.pdf
   Согласие на использование и обработку персональных данных. Построено по
   образцу «ЮНПРЕСС 14+»: те же реквизиты автора, перечень данных, цели,
   бессрочность и отзыв в 30 дней. Обязательное условие работы на сайте.

2. assets/docs/soglasie-na-rasprostranenie-pd.pdf
   Согласие на распространение персональных данных (статья 10.1 № 152-ФЗ).
   Отдельный документ: с 1 марта 2021 года разрешение сделать данные
   общедоступными нельзя включать в согласие на обработку. Нужно только для
   конкурсов и активностей, которые выходят в открытые площадки проекта.

Оформление: чистый лист, только название, текст, поля и номер страницы.
Колонтитулов, логотипов, «приложений к политике» и служебных приписок нет.
Список площадок берётся из assets/js/data.js (brand.social), чтобы адреса
в документе и в подвале сайта не расходились.

Запуск:  python3 tools/build-consent.py
Нужны reportlab (pip install reportlab) и шрифты DejaVu.
"""

import os
import re
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
    TableStyle, HRFlowable, KeepTogether,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "docs", "soglasie-na-obrabotku-pd.pdf")
OUT_DISTRIBUTION = os.path.join(ROOT, "assets", "docs", "soglasie-na-rasprostranenie-pd.pdf")
SITE = "smenakontenta.ru"

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
]
BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]


def first_existing(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    raise SystemExit("Не найден шрифт DejaVu. Установите пакет fonts-dejavu.")


pdfmetrics.registerFont(TTFont("D", first_existing(FONT_CANDIDATES)))
pdfmetrics.registerFont(TTFont("DB", first_existing(BOLD_CANDIDATES)))

INK = colors.HexColor("#111111")
GREY = colors.HexColor("#555555")
LINE = colors.HexColor("#bbbbbb")
SOFT = colors.HexColor("#f2f2f2")

S = {
    "title": ParagraphStyle("title", fontName="DB", fontSize=13, leading=17,
                            textColor=INK, alignment=TA_CENTER, spaceAfter=2),
    "subtitle": ParagraphStyle("subtitle", fontName="D", fontSize=11, leading=15,
                               textColor=INK, alignment=TA_CENTER, spaceAfter=12),
    "h2": ParagraphStyle("h2", fontName="DB", fontSize=10, leading=14,
                         textColor=INK, spaceBefore=9, spaceAfter=4),
    "p": ParagraphStyle("p", fontName="D", fontSize=9.5, leading=13.6,
                        textColor=INK, spaceAfter=6, alignment=TA_LEFT),
    "small": ParagraphStyle("small", fontName="D", fontSize=8.2, leading=11.6,
                            textColor=GREY, spaceAfter=4),
    "field": ParagraphStyle("field", fontName="D", fontSize=9.2, leading=13,
                            textColor=INK),
    "cell": ParagraphStyle("cell", fontName="D", fontSize=8.6, leading=11.6,
                           textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="DB", fontSize=8.6, leading=11.6,
                            textColor=INK),
}

OPERATORS = [
    ("Сирик Никита Сергеевич", "940802781550"),
    ("Ильин Борис Павлович", "784304154610"),
]


from social import links as social_links


def operators_text():
    return "; ".join("%s, ИНН %s" % (name, inn) for name, inn in OPERATORS)


def page_number(canvas, doc):
    """Единственный служебный элемент листа — номер страницы."""
    canvas.saveState()
    canvas.setFont("D", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, "стр. %d" % doc.page)
    canvas.restoreState()


def document(path, title):
    doc = BaseDocTemplate(
        path, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=title, author="", subject=title, creator="",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=page_number)])
    return doc


def line(label, width=None):
    """Поле для заполнения от руки: подпись и линия."""
    caption = Paragraph(label, S["small"])
    blank = Table([[""]], colWidths=[width or 170 * mm], rowHeights=[7 * mm])
    blank.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.7, LINE),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
    ]))
    t = Table([[caption], [blank]], colWidths=[width or 170 * mm], hAlign="LEFT")
    blank.hAlign = "LEFT"
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


def two_fields(left, right, left_width=100 * mm, right_width=70 * mm):
    t = Table([[line(left, left_width), line(right, right_width)]],
              colWidths=[left_width + 5 * mm, right_width], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def signature_block(label="Подпись автора"):
    sign = Table([
        [Paragraph(label, S["small"]),
         Paragraph("Расшифровка подписи", S["small"]),
         Paragraph("Дата", S["small"])],
        ["", "", ""],
    ], colWidths=[55 * mm, 75 * mm, 40 * mm], rowHeights=[6 * mm, 12 * mm])
    sign.setStyle(TableStyle([
        ("LINEBELOW", (0, 1), (-1, 1), 0.8, INK),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return sign


# ------------------------------------------------------- согласие на обработку ---

def build():
    doc = document(OUT, "Согласие на использование и обработку персональных данных")
    story = []

    story.append(Paragraph("СОГЛАСИЕ", S["title"]))
    story.append(Paragraph("на использование и обработку персональных данных", S["subtitle"]))
    story.append(Paragraph("Дата заполнения: «____» ______________ 20____ г.", S["p"]))

    story.append(Paragraph("1. Кто даёт согласие", S["h2"]))
    story.append(line("Я, фамилия, имя, отчество (полностью)"))
    story.append(Spacer(1, 3))
    story.append(two_fields("Дата рождения", "Телефон", 80 * mm, 85 * mm))
    story.append(Spacer(1, 3))
    story.append(line("Адрес электронной почты, с которого зарегистрирован аккаунт (печатными буквами)"))
    story.append(Spacer(1, 3))
    story.append(line("Регион проживания (субъект Российской Федерации)", 110 * mm))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Поля ниже заполняются только при оформлении пресс-карты. Для регистрации, "
        "отправки материалов и их публикации на сайте они не нужны.", S["small"]))
    story.append(line("Паспорт: серия, номер", 80 * mm))
    story.append(Spacer(1, 3))
    story.append(line("Паспорт выдан (когда и кем)", 170 * mm))
    story.append(Spacer(1, 3))
    story.append(line("Адрес регистрации", 170 * mm))

    story.append(Paragraph("2. Кому и на что даётся согласие", S["h2"]))
    story.append(Paragraph(
        "На основании Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных» "
        "я даю согласие на обработку моих персональных данных операторам проекта "
        "«Смена контента» (город Москва, сайт %s): %s — в связи с моей регистрацией "
        "и работой на сайте проекта." % (SITE, operators_text()), S["p"]))
    story.append(Paragraph(
        "Согласие даётся на сбор, запись, систематизацию, накопление, хранение, "
        "уточнение (обновление, изменение), извлечение, использование, передачу "
        "(предоставление, доступ) лицам, привлечённым к работе редакции, обезличивание, "
        "блокирование, удаление и уничтожение персональных данных.", S["p"]))

    story.append(Paragraph("3. Перечень персональных данных", S["h2"]))
    story.append(Paragraph(
        "Фамилия, имя, отчество; дата рождения; регион проживания; название школы, "
        "класса или иного места учёбы, если я указал его сам; номер телефона; адрес "
        "электронной почты; фотография профиля и фотографии с моим участием; тексты, "
        "фотографии, аудио- и видеоматериалы, которые я загружаю; сведения об участии "
        "в конкурсах и активностях проекта и их результатах, начисленных баллах; "
        "фамилия, имя, отчество и телефон одного из родителей (законных представителей) "
        "для авторов младше 18 лет; при оформлении пресс-карты — паспортные данные, "
        "почтовый адрес и номер пресс-карты.", S["p"]))

    goals = [Paragraph("4. Цели обработки", S["h2"])]
    for item in [
        "регистрация, вход и работа личного кабинета на сайте проекта;",
        "проверка и публикация моих материалов на сайте с указанием авторства;",
        "связь со мной по вопросам материалов, проверки и участия в проекте;",
        "оформление, выдача, продление и отзыв пресс-карты автора;",
        "участие в редакции региона, медиашколе, конкурсах и активах проекта, учёт баллов;",
        "рассмотрение моих обращений в поддержку и обеспечение безопасности сайта.",
    ]:
        goals.append(Paragraph("— " + item, S["p"]))
    story.append(KeepTogether(goals))

    story.append(Paragraph("5. Где публикуются материалы", S["h2"]))
    story.append(Paragraph(
        "Мои материалы публикуются на сайте %s. Разрешение показать моё имя, фотографию "
        "и работу неограниченному кругу лиц — как на сайте, так и в площадках проекта — "
        "оформляется отдельным согласием на распространение персональных данных. "
        "Настоящее согласие такого разрешения не даёт." % SITE, S["p"]))

    story.append(Paragraph("6. Способ, срок и отзыв", S["h2"]))
    story.append(Paragraph(
        "Обработка может осуществляться как с использованием средств автоматизации, "
        "так и без использования таких средств. Согласие действует до его отзыва.", S["p"]))
    story.append(Paragraph(
        "Я вправе отозвать согласие в любое время: направить заявление через форму на "
        "странице %s/support либо письмо на support@smenakontenta.ru с той почты, которая указана "
        "в моём аккаунте. Операторы прекращают обработку и уничтожают персональные данные "
        "в срок, не превышающий 30 дней с даты поступления отзыва, и уведомляют меня об "
        "уничтожении в письменной форме. Данные, хранение которых предусмотрено законом, "
        "сохраняются в течение установленного законом срока. Отзыв согласия влечёт "
        "удаление аккаунта и размещённых с него материалов." % SITE, S["p"]))

    story.append(Paragraph("7. Возраст автора", S["h2"]))
    story.append(Paragraph(
        "Автор, достигший 14 лет, подписывает согласие самостоятельно. Если автору нет "
        "18 лет, согласие дополнительно подтверждает законный представитель (родитель, "
        "усыновитель, опекун) — его данные и подпись ниже. За автора младше 14 лет "
        "согласие даёт только законный представитель.", S["p"]))

    story.append(KeepTogether([
        Paragraph("8. Подписи", S["h2"]),
        signature_block("Подпись автора"),
        Spacer(1, 8),
        line("Законный представитель: фамилия, имя, отчество", 110 * mm),
        Spacer(1, 3),
        two_fields("Телефон представителя", "Кем приходится автору", 80 * mm, 85 * mm),
        Spacer(1, 6),
        signature_block("Подпись законного представителя"),
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=0.4, color=LINE, spaceAfter=6),
        Paragraph(
            "Заполненный и подписанный лист сфотографируйте целиком и загрузите в личном "
            "кабинете в блоке «Согласие на обработку персональных данных». Пока документ "
            "не проверен редакцией, отправка материалов закрыта.", S["small"]),
    ]))

    doc.build(story)
    print("готово:", os.path.relpath(OUT, ROOT), "%.0f КБ" % (os.path.getsize(OUT) / 1024))


# --------------------------------------------------- согласие на распространение ---

def build_distribution():
    doc = document(OUT_DISTRIBUTION, "Согласие на распространение персональных данных")
    story = []

    story.append(Paragraph("СОГЛАСИЕ", S["title"]))
    story.append(Paragraph("на распространение персональных данных", S["subtitle"]))
    story.append(Paragraph(
        "Оформляется отдельно от согласия на обработку персональных данных в соответствии "
        "со статьёй 10.1 Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных». "
        "Имя автора, его фотография и работа на сайте видны всем посетителям — это "
        "раскрытие данных неограниченному кругу лиц, поэтому такое разрешение оформляется "
        "отдельно. Публикация в площадках проекта допускается только при соответствующей "
        "отметке в разделе 3 и только для конкурсов и активностей проекта.", S["p"]))
    story.append(Paragraph("Дата заполнения: «____» ______________ 20____ г.", S["p"]))

    story.append(Paragraph("1. Сведения об операторе", S["h2"]))
    story.append(Paragraph(
        "Операторы проекта «Смена контента», город Москва, сайт %s: %s. "
        "Обращение к оператору: форма на странице %s/support или письмо на support@smenakontenta.ru."
        % (SITE, operators_text(), SITE), S["p"]))

    story.append(Paragraph("2. Сведения о субъекте персональных данных", S["h2"]))
    story.append(line("Фамилия, имя, отчество (полностью)"))
    story.append(Spacer(1, 3))
    story.append(two_fields("Дата рождения", "Телефон", 80 * mm, 85 * mm))
    story.append(Spacer(1, 3))
    story.append(line("Адрес электронной почты, указанный в личном кабинете"))
    story.append(Spacer(1, 3))
    story.append(line("Конкурс или активность, для которой даётся согласие"))

    story.append(Paragraph("3. Информационные ресурсы оператора", S["h2"]))
    story.append(Paragraph("Сайт проекта: https://%s/ — материал, имя автора, фотография "
                           "профиля, страница региона." % SITE, S["p"]))
    story.append(Paragraph("Площадки проекта (для конкурсов и активностей):", S["p"]))
    for title, url in social_links():
        story.append(Paragraph("— %s: %s" % (title, url), S["p"]))
    story.append(Paragraph(
        "Отметьте объём разрешения: только сайт проекта / сайт проекта и перечисленные "
        "площадки. Если отметки нет, разрешение считается данным только для сайта. "
        "Размещение на иных ресурсах настоящим согласием не разрешается.", S["p"]))
    story.append(line("Моя отметка об объёме разрешения и подпись рядом", 170 * mm))

    story.append(Paragraph("4. Цель распространения", S["h2"]))
    story.append(Paragraph(
        "Публикация моих материалов на сайте проекта с указанием авторства; при "
        "соответствующей отметке — участие в конкурсе или активности проекта: показ "
        "работы, подведение итогов, объявление победителей, освещение работы редакции "
        "в площадках проекта.", S["p"]))

    story.append(Paragraph("5. Категории и перечень данных, условия и запреты", S["h2"]))
    story.append(Paragraph(
        "Отметьте решение по каждой строке. Незаполненная строка означает «не разрешаю». "
        "В третьем столбце укажите условия и запреты (например, «без указания школы»); "
        "если их нет — поставьте прочерк.", S["small"]))

    rows = [[Paragraph("Категория и перечень данных", S["cellb"]),
             Paragraph("Моё решение", S["cellb"]),
             Paragraph("Условия и запреты", S["cellb"])]]
    for caption in [
        "Фамилия, имя, отчество",
        "Возраст (полных лет)",
        "Регион проживания (субъект Российской Федерации)",
        "Фотография или видеозапись с моим участием",
        "Моя работа: текст, фото, видео, аудио — с указанием авторства",
        "Название редакции, школы или класса, если я указал его сам",
        "Ссылка на мой профиль на сайте проекта",
        "Результат участия в конкурсе, начисленные баллы",
    ]:
        rows.append([Paragraph(caption, S["cell"]),
                     Paragraph("разрешаю / не разрешаю", S["cell"]), ""])
    table = Table(rows, colWidths=[74 * mm, 42 * mm, 54 * mm],
                  rowHeights=[8 * mm] + [9.5 * mm] * (len(rows) - 1), repeatRows=1)
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
        ("BACKGROUND", (0, 0), (-1, 0), SOFT),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(table)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Запрет на передачу (кроме предоставления доступа) указанных данных "
        "неограниченному кругу лиц: установлен / не установлен. "
        "Запрет на обработку (кроме предоставления доступа) указанных данных "
        "иными лицами: установлен / не установлен. Нужное отметить.", S["p"]))

    story.append(Paragraph("6. Способы распространения", S["h2"]))
    story.append(Paragraph(
        "Размещение данных в открытом доступе на ресурсах из раздела 3: публикация "
        "поста, карточки участника, фотографии или работы с указанием авторства. "
        "Иные способы распространения настоящим согласием не разрешаются.", S["p"]))

    story.append(Paragraph("7. Срок действия и порядок отзыва", S["h2"]))
    story.append(Paragraph(
        "Для сайта согласие действует, пока материал размещён на сайте, и прекращается "
        "при его удалении или при отзыве согласия. Для площадок проекта — до окончания "
        "конкурса и трёх месяцев после подведения итогов, если не отозвано раньше. "
        "Я вправе в любой момент потребовать "
        "прекращения распространения своих данных: направить требование через форму "
        "на странице %s/support либо письмо на support@smenakontenta.ru с адреса почты, указанного в аккаунте, "
        "указав фамилию, имя, отчество и контактные данные. Операторы прекращают "
        "распространение в течение трёх рабочих дней с момента получения требования, "
        "если иной срок не установлен законом." % SITE, S["p"]))
    story.append(Paragraph(
        "Копии, сделанные другими лицами до прекращения распространения, операторы "
        "удалить не могут: они убирают публикации со своих ресурсов и сообщают об этом "
        "заявителю.", S["p"]))

    story.append(KeepTogether([
        Paragraph("8. Подписи", S["h2"]),
        Paragraph(
            "Участник, достигший 14 лет, подписывает согласие самостоятельно. Если участнику "
            "нет 18 лет, согласие дополнительно подтверждает законный представитель. "
            "За участника младше 14 лет согласие даёт только законный представитель.", S["p"]),
        signature_block("Подпись участника"),
        Spacer(1, 8),
        line("Законный представитель: фамилия, имя, отчество", 110 * mm),
        Spacer(1, 3),
        two_fields("Телефон представителя", "Кем приходится участнику", 80 * mm, 85 * mm),
        Spacer(1, 6),
        signature_block("Подпись законного представителя"),
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=0.4, color=LINE, spaceAfter=6),
        Paragraph(
            "Сфотографируйте все заполненные страницы целиком и загрузите их в личном "
            "кабинете в блоке «Согласие на распространение персональных данных».", S["small"]),
    ]))

    doc.build(story)
    print("готово:", os.path.relpath(OUT_DISTRIBUTION, ROOT),
          "%.0f КБ" % (os.path.getsize(OUT_DISTRIBUTION) / 1024))


if __name__ == "__main__":
    build()
    build_distribution()
