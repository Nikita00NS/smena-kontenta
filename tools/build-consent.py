#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собрать четыре отдельные формы согласий для авторов разного возраста.

14 лет и старше:
  assets/docs/soglasie-na-obrabotku-pd.pdf
  assets/docs/soglasie-na-rasprostranenie-pd.pdf
Младше 14 лет (подписывает законный представитель):
  assets/docs/soglasie-na-obrabotku-pd-do-14.pdf
  assets/docs/soglasie-na-rasprostranenie-pd-do-14.pdf

Два вида согласия остаются раздельными: обработка данных и их распространение.
В бланках только юридические условия, поля для заполнения и подписи от руки;
служебные инструкции по фото и загрузке находятся в личном кабинете.

Запуск: python3 tools/build-consent.py
Нужны reportlab и шрифты DejaVu.
"""

import os
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "assets", "docs")
SITE = "smenakontenta.ru"
CONTENT_W = 186 * mm  # A4 минус поля по 12 мм
GUTTER = 4 * mm

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
)
BOLD_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
)


def first_existing(paths):
    for path in paths:
        if os.path.exists(path):
            return path
    raise SystemExit("Не найден шрифт DejaVu. Установите пакет fonts-dejavu.")


pdfmetrics.registerFont(TTFont("D", first_existing(FONT_CANDIDATES)))
pdfmetrics.registerFont(TTFont("DB", first_existing(BOLD_CANDIDATES)))

INK = colors.HexColor("#111111")
GREY = colors.HexColor("#555555")
LINE = colors.HexColor("#8c8c8c")

STYLE = {
    "title": ParagraphStyle(
        "consent-title", fontName="DB", fontSize=12.2, leading=14,
        textColor=INK, alignment=TA_CENTER, spaceAfter=1.2 * mm,
    ),
    "subtitle": ParagraphStyle(
        "consent-subtitle", fontName="D", fontSize=9.1, leading=11,
        textColor=INK, alignment=TA_CENTER, spaceAfter=2 * mm,
    ),
    "section": ParagraphStyle(
        "consent-section", fontName="DB", fontSize=8.6, leading=10,
        textColor=INK, spaceBefore=1.1 * mm, spaceAfter=0.6 * mm,
    ),
    "p": ParagraphStyle(
        "consent-body", fontName="D", fontSize=8.05, leading=9.65,
        textColor=INK, alignment=TA_LEFT, spaceAfter=1.15 * mm,
    ),
    "small": ParagraphStyle(
        "consent-small", fontName="D", fontSize=7.1, leading=8.2,
        textColor=GREY, alignment=TA_LEFT, spaceAfter=0.45 * mm,
    ),
    "field": ParagraphStyle(
        "consent-field", fontName="D", fontSize=7.1, leading=8.2,
        textColor=INK, alignment=TA_LEFT,
    ),
}

from social import links as social_links  # noqa: E402


def P(text, style="p"):
    return Paragraph(text, STYLE[style])


def page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("D", 7)
    canvas.setFillColor(GREY)
    canvas.drawRightString(A4[0] - 12 * mm, 7 * mm, "лист %d" % doc.page)
    canvas.restoreState()


def make_document(path, title):
    doc = BaseDocTemplate(
        path, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=9 * mm, bottomMargin=11 * mm,
        title=title, author="", subject=title, creator="",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="consent")
    doc.addPageTemplates([PageTemplate(id="consent", frames=[frame], onPage=page_number)])
    return doc


def field_table(label, width):
    table = Table(
        [[P(escape(label), "field")], [""]],
        colWidths=[width], rowHeights=[3.6 * mm, 5.2 * mm], hAlign="LEFT",
    )
    table.setStyle(TableStyle([
        ("LINEBELOW", (0, 1), (0, 1), 0.65, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
    ]))
    return table


def fields_row(labels, widths=None):
    count = len(labels)
    if widths is None:
        usable = CONTENT_W - GUTTER * (count - 1)
        widths = [usable / count] * count
    if len(widths) != count or abs(sum(widths) + GUTTER * (count - 1) - CONTENT_W) > 0.25 * mm:
        raise ValueError("Ширины строк полей не укладываются в печатную область A4")
    cells = []
    col_widths = []
    for i, label in enumerate(labels):
        if i:
            cells.append("")
            col_widths.append(GUTTER)
        width = widths[i]
        cells.append(field_table(label, width))
        col_widths.append(width)
    row = Table([cells], colWidths=col_widths, hAlign="LEFT")
    row.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    row.spaceAfter = 1.1 * mm
    return row


def signature_row(labels, widths=None):
    if widths is None:
        # `fields_row` adds a 4 mm gutter between each column; reserve both
        # gaps so the signature lines stay inside the printable page width.
        widths = [64 * mm, 79 * mm, CONTENT_W - 2 * GUTTER - 143 * mm]
    return fields_row(labels, widths)


def city_date():
    return fields_row(["Город", "Дата"], [91 * mm, CONTENT_W - GUTTER - 91 * mm])


def author_fields(under14):
    story = [P("АВТОР", "section")]
    if not under14:
        story.extend([
            fields_row(["Фамилия, имя, отчество автора", "Дата рождения"],
                       [112 * mm, CONTENT_W - GUTTER - 112 * mm]),
            fields_row(["E-mail аккаунта автора", "Телефон"],
                       [117 * mm, CONTENT_W - GUTTER - 117 * mm]),
            fields_row(["Регион и город проживания"]),
            P("Автору от 14 лет. Если автору 14–17 лет, согласие также подтверждает законный представитель; для автора от 18 лет этот блок не заполняется.", "small"),
            P("ЗАКОННЫЙ ПРЕДСТАВИТЕЛЬ (только для автора 14–17 лет)", "section"),
            fields_row(["Фамилия, имя, отчество представителя", "Кем приходится автору"],
                       [112 * mm, CONTENT_W - GUTTER - 112 * mm]),
            fields_row(["Телефон представителя"]),
        ])
    else:
        story.extend([
            fields_row(["Фамилия, имя, отчество автора", "Дата рождения"],
                       [112 * mm, CONTENT_W - GUTTER - 112 * mm]),
            fields_row(["E-mail аккаунта автора", "Регион и город проживания"],
                       [76 * mm, CONTENT_W - GUTTER - 76 * mm]),
            P("ЗАКОННЫЙ ПРЕДСТАВИТЕЛЬ", "section"),
            fields_row(["Фамилия, имя, отчество представителя", "Кем приходится автору"],
                       [112 * mm, CONTENT_W - GUTTER - 112 * mm]),
            fields_row(["Контактный телефон представителя"]),
        ])
    return story


def signature_fields(under14):
    if under14:
        return [
            P("Подпись законного представителя", "section"),
            signature_row(["Подпись", "Расшифровка подписи", "Дата"]),
        ]
    return [
        P("Подписи", "section"),
        signature_row(["Подпись автора", "Расшифровка подписи", "Дата"]),
        P("Для автора 14–17 лет:", "small"),
        signature_row(["Подпись представителя", "Расшифровка подписи", "Дата"]),
    ]


def operator_text():
    return (
        "оператору персональных данных — Ильину Борису Павловичу, ИНН 784304154610, "
        "проект «Смена контента», сайт https://%s/, город Москва" % SITE
    )


def consent_intro(under14, action):
    signer = "Я, законный представитель автора, указанного выше,"
    if not under14:
        signer = "Я, автор, указанный выше,"
    if action == "processing":
        return (
            signer + " на основании Федерального закона от 27.07.2006 № 152-ФЗ "
            "«О персональных данных» даю согласие на обработку персональных данных "
            "%s в связи с регистрацией на сайте и участием в проекте «Смена контента»: "
            "сбор, запись, систематизацию, накопление, хранение, уточнение (обновление, изменение), "
            "извлечение, использование, передачу лицам, привлечённым к работе редакции, обезличивание, "
            "блокирование и уничтожение данных." % operator_text()
        )
    return (
        signer + " на основании статьи 10.1 Федерального закона от 27.07.2006 № 152-ФЗ "
        "«О персональных данных» разрешаю %s сделать указанные ниже персональные данные "
        "общедоступными. Это согласие оформляется отдельно от согласия на обработку." % operator_text()
    )


def processing_body(under14):
    story = [P(consent_intro(under14, "processing"))]
    story.append(P(
        "Перечень данных: фамилия, имя, отчество; дата рождения; регион и город проживания; "
        "адрес электронной почты; номер телефона; место учёбы, если указано автором; "
        "фотография профиля и фотографии с участием автора; загруженные тексты, фотографии, "
        "аудио- и видеоматериалы; род занятий, указанный в профиле; сведения об участии в "
        "конкурсах, активностях и медиашколе проекта и их результатах, включая баллы; "
        "фамилия, имя, отчество и телефон законного представителя, если эти поля заполнены. "
        "При оформлении пресс-карты дополнительно обрабатываются паспортные данные, адрес "
        "регистрации и доставки и номер карты. Иные данные — только если автор укажет их "
        "сам в материалах или обращениях."
    ))
    story.append(P(
        "Цели: регистрация, вход и работа личного кабинета; проверка и публикация материалов "
        "с указанием авторства; связь по вопросам материалов и участия; приём заявок на "
        "пресс-карту, её изготовление, выдача лично в Москве или пересылка почтой, продление "
        "и отзыв; участие в редакции региона, медиашколе и конкурсах; "
        "рассмотрение обращений и безопасность сайта. Форма построена по типовой форме "
        "приказа Роскомнадзора от 27.10.2022 № 178; уведомление в РКН направлено "
        "(рег. № 100489565), обработка ведётся с 05.11.2026."
    ))
    story.append(P(
        "Обработка осуществляется автоматизированными средствами (информационная система "
        "сайта и электронная почта) и без них: редакция рассматривает сканы и материалы. "
        "Настоящее согласие не разрешает распространять данные неограниченному кругу лиц: для этого "
        "оформляется отдельное согласие на распространение. Согласие действует до отзыва."
    ))
    story.append(P(
        "Согласие можно отозвать в любой момент заявлением через %s/support или письмом "
        "на support@smenakontenta.ru. После получения отзыва оператор обязан прекратить "
        "обработку и уничтожить данные не позднее 30 дней, если иной срок хранения не "
        "установлен законом; об уничтожении заявитель уведомляется письменно." % SITE
    ))
    return story


def distribution_body(under14):
    story = [P(consent_intro(under14, "distribution"))]
    story.append(P(
        "Цель распространения — публикация авторских работ и результатов участия в "
        "конкурсах и активностях проекта. Конкурс или активность:"
    ))
    story.append(fields_row(["Название конкурса или активности"]))
    story.append(P(
        "Источники распространения: сайт проекта https://%s/ и площадки проекта, "
        "на которых публикуются конкурсные работы:" % SITE
    ))
    for title, url in social_links():
        story.append(P("— %s: %s" % (escape(title), escape(url)), "small"))
    story.append(P("По каждой категории отметьте один вариант:", "section"))
    categories = (
        "фамилия, имя, отчество автора",
        "регион и город проживания",
        "дата рождения",
        "фотография автора",
        "авторские работы (тексты, фото, видео, аудио)",
        "результаты участия, включая баллы и места",
    )
    for category in categories:
        story.append(P("[  ] разрешаю   [  ] не разрешаю — %s" % category, "small"))
    story.append(P(
        "Объём разрешения: [  ] сайт проекта   [  ] сайт и площадки проекта. "
        "Если вариант не отмечен, разрешение не действует. Паспортные данные и адрес "
        "регистрации не распространяются."
    ))
    story.append(P(
        "Условия и запреты: передача данных другим третьим лицам, кроме указанных площадок, "
        "не допускается, за исключением предусмотренных законом случаев. Согласие можно "
        "отозвать заявлением через %s/support или письмом на support@smenakontenta.ru. "
        "После отзыва материалы снимаются с площадок не позднее трёх рабочих дней, с сайта — "
        "в течение суток; об уничтожении данных заявитель уведомляется письменно." % SITE
    ))
    return story


def build_form(kind, under14):
    processing = kind == "processing"
    base = "soglasie-na-obrabotku-pd" if processing else "soglasie-na-rasprostranenie-pd"
    filename = base + ("-do-14" if under14 else "") + ".pdf"
    path = os.path.join(DOCS, filename)
    age = "младше 14 лет" if under14 else "14 лет и старше"
    if processing:
        title = "Согласие на использование и обработку персональных данных · " + age
        subtitle = "на использование и обработку персональных данных · " + age
    else:
        title = "Согласие на распространение персональных данных · " + age
        subtitle = "на распространение персональных данных (статья 10.1 № 152-ФЗ) · " + age

    doc = make_document(path, title)
    story = [
        P("СОГЛАСИЕ", "title"),
        P(escape(subtitle), "subtitle"),
        city_date(),
    ]
    story.extend(author_fields(under14))
    story.extend(processing_body(under14) if processing else distribution_body(under14))
    story.extend(signature_fields(under14))
    doc.build(story)
    print("готово:", os.path.relpath(path, ROOT), "страниц:", doc.page,
          "%.0f КБ" % (os.path.getsize(path) / 1024))
    return doc.page


def build():
    os.makedirs(DOCS, exist_ok=True)
    for kind in ("processing", "distribution"):
        for under14 in (False, True):
            build_form(kind, under14)


if __name__ == "__main__":
    build()
