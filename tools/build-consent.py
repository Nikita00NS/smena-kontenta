#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка документа «Согласие на обработку персональных данных».

Файл: assets/docs/soglasie-na-obrabotku-pd.pdf

Это форма, которую автор распечатывает, подписывает от руки, фотографирует
и загружает в личном кабинете. До одобрения комиссией публикация недоступна.

ВАЖНО: шаблон подготовлен по 152-ФЗ, но перед публикацией его должен
посмотреть юрист — особенно пункты про несовершеннолетних авторов.

Запуск:  python3 tools/build-consent.py
Нужен пакет reportlab:  pip install reportlab
"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
    TableStyle, HRFlowable,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "docs", "soglasie-na-obrabotku-pd.pdf")

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
]
BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]
MONO_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
]


def first_existing(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    raise SystemExit("Не найден шрифт DejaVu. Установите пакет fonts-dejavu.")


pdfmetrics.registerFont(TTFont("D", first_existing(FONT_CANDIDATES)))
pdfmetrics.registerFont(TTFont("DB", first_existing(BOLD_CANDIDATES)))
pdfmetrics.registerFont(TTFont("DM", first_existing(MONO_CANDIDATES)))

INK = colors.HexColor("#14130f")
ACCENT = colors.HexColor("#ff3d14")
MUTED = colors.HexColor("#797464")
LINE = colors.HexColor("#d8d3c5")
SOFT = colors.HexColor("#f3f0e8")

S = {
    "kicker": ParagraphStyle("kicker", fontName="DM", fontSize=7.5, leading=11,
                             textColor=ACCENT, spaceAfter=6),
    "h1": ParagraphStyle("h1", fontName="DB", fontSize=21, leading=25,
                         textColor=INK, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="DB", fontSize=11, leading=15,
                         textColor=INK, spaceBefore=10, spaceAfter=4),
    "p": ParagraphStyle("p", fontName="D", fontSize=9.4, leading=13.8,
                        textColor=INK, spaceAfter=6, alignment=TA_LEFT),
    "small": ParagraphStyle("small", fontName="D", fontSize=8, leading=11.4,
                            textColor=MUTED, spaceAfter=4),
    "field": ParagraphStyle("field", fontName="D", fontSize=9.4, leading=18,
                            textColor=INK),
    "center": ParagraphStyle("center", fontName="D", fontSize=8.6, leading=12,
                             textColor=MUTED, alignment=TA_CENTER),
}

PROJECT = {
    "name": "«Смена контента»",
    "founders": [
        "Сирик Никита Сергеевич",
        "Ильин Борис Павлович",
    ],
    "city": "Москва",
}


def line(label, width=None):
    """Строка формы: подпись поля и линия для заполнения от руки."""
    label = Paragraph(label, S["small"])
    blank = Table([[""]], colWidths=[width or 105 * mm], rowHeights=[9 * mm])
    blank.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.7, LINE),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
    ]))
    t = Table([[label], [blank]], colWidths=[width or 105 * mm], hAlign="LEFT")
    blank.hAlign = "LEFT"
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


def footer(canvas, doc):
    """Официальный бланк: без логотипа, без цветных плашек и рекламных подписей.
    Сверху — название документа, снизу — только номер страницы."""
    canvas.saveState()
    canvas.setFont("DM", 7.4)
    canvas.setFillColor(INK)
    canvas.drawString(20 * mm, 283 * mm,
                      "СОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ")
    canvas.setStrokeColor(colors.black)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 280.5 * mm, 190 * mm, 280.5 * mm)
    canvas.setFont("DM", 7.2)
    canvas.drawCentredString(105 * mm, 12 * mm, "— %d —" % doc.page)
    canvas.restoreState()


def build():
    doc = BaseDocTemplate(
        OUT, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=16 * mm, bottomMargin=18 * mm,
        title="Согласие на обработку персональных данных",
        author="",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=footer)])

    founders = ", ".join(PROJECT["founders"])
    story = []

    story.append(Paragraph(
        "Приложение № 1<br/>к Политике конфиденциальности проекта «Смена контента»",
        S["small"]))
    story.append(Spacer(1, 8))
    story.append(Paragraph("СОГЛАСИЕ<br/>на обработку персональных данных", S["h1"]))
    story.append(Paragraph(
        "Заполняется от руки, подписывается, фотографируется и загружается "
        "в личном кабинете на сайте проекта. Пока согласие не проверено "
        "комиссией, публикация материалов недоступна.", S["p"]))
    story.append(HRFlowable(width="100%", thickness=0.8, color=INK,
                            spaceBefore=2, spaceAfter=10))

    story.append(Paragraph("1. Оператор", S["h2"]))
    story.append(Paragraph(
        "Оператор персональных данных — редакция проекта %s, город %s. "
        "Учредители проекта: %s. Связаться с оператором можно через раздел "
        "«Документы» на сайте проекта и через поддержку в личном кабинете."
        % (PROJECT["name"], PROJECT["city"], founders), S["p"]))

    story.append(Paragraph("2. Данные субъекта", S["h2"]))
    story.append(line("Фамилия, имя, отчество (полностью)"))
    story.append(Spacer(1, 4))
    story.append(line("Дата рождения (число, месяц, год)", 60 * mm))
    story.append(Spacer(1, 4))
    story.append(line("Адрес электронной почты, указанный при регистрации", 90 * mm))
    story.append(Spacer(1, 4))
    story.append(line("Телефон для связи (необязательно)", 60 * mm))
    story.append(Spacer(1, 8))

    story.append(Paragraph(
        "Если на момент подписания мне нет 18 лет, согласие подписывает "
        "мой законный представитель (родитель или опекун) — его данные "
        "указываются ниже.", S["small"]))
    story.append(Spacer(1, 4))
    story.append(line("ФИО законного представителя (для авторов младше 18 лет)", 100 * mm))
    story.append(Spacer(1, 4))
    story.append(line("Документ, подтверждающий полномочия (серия и номер)", 90 * mm))

    story.append(Paragraph("3. Что я разрешаю", S["h2"]))
    story.append(Paragraph(
        "Я свободно, своей волей и в своём интересе даю согласие на обработку "
        "моих персональных данных следующими способами: сбор, запись, "
        "систематизация, накопление, хранение, уточнение (обновление, изменение), "
        "извлечение, использование, обезличивание, блокирование, удаление, "
        "уничтожение — с использованием средств автоматизации и без них.", S["p"]))

    story.append(Paragraph("4. Какие данные", S["h2"]))
    story.append(Paragraph(
        "Фамилия и имя, дата рождения, адрес электронной почты, регион, "
        "фотография профиля, сведения об образовании и занятиях, если я указал их "
        "сам, а также тексты, фотографии, аудио- и видеоматериалы, которые я "
        "загружаю на платформу.", S["p"]))

    story.append(Paragraph("5. Цели обработки", S["h2"]))
    for item in [
        "регистрация и работа личного кабинета на платформе проекта;",
        "проверка и публикация моих материалов на сайте проекта;",
        "связь со мной по вопросам материалов, проверки и участия в проекте;",
        "оформление и выдача пресс-карты автора, участие в редакции региона;",
        "ведение внутреннего учёта авторов и редакций проекта.",
    ]:
        story.append(Paragraph("— " + item, S["p"]))

    story.append(Paragraph("6. Срок и отзыв согласия", S["h2"]))
    story.append(Paragraph(
        "Согласие действует до его отзыва. Я могу отозвать согласие в любой "
        "момент, написав в поддержку проекта или на почту, указанную на сайте; "
        "после отзыва оператор прекращает обработку и удаляет данные в срок, "
        "установленный законом. Отзыв согласия не влияет на законность обработки, "
        "проведённой до его получения.", S["p"]))

    story.append(Paragraph("7. Мои права", S["h2"]))
    story.append(Paragraph(
        "Я вправе получать сведения об обработке своих данных, требовать их "
        "уточнения, блокирования или уничтожения, если они неполны, устарели, "
        "неточны или незаконно получены, а также обжаловать действия оператора "
        "в уполномоченном органе по защите прав субъектов персональных данных.", S["p"]))

    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=0.7, color=LINE, spaceAfter=8))

    sign = Table([
        [Paragraph("Подпись автора", S["small"]), Paragraph("Дата", S["small"]),
         Paragraph("Расшифровка (фамилия и инициалы)", S["small"])],
        ["", "", ""],
    ], colWidths=[62 * mm, 40 * mm, 68 * mm], rowHeights=[7 * mm, 14 * mm])
    sign.setStyle(TableStyle([
        ("LINEBELOW", (0, 1), (-1, 1), 0.8, INK),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(sign)

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Подпись законного представителя (если автору нет 18 лет) и дата", S["small"]))
    rep = Table([["", ""]], colWidths=[80 * mm, 40 * mm], rowHeights=[14 * mm])
    rep.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(rep)

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "Как отправить: сфотографируйте заполненный и подписанный лист целиком "
        "при хорошем свете, затем в личном кабинете нажмите «Загрузить согласие». "
        "Комиссия проекта проверит документ и откроет публикацию материалов.", S["small"]))
    story.append(Paragraph(
        "Документ подготовлен как форма для подписи. Перед началом работы "
        "его проверяет юрист проекта.", S["center"]))

    doc.build(story)
    print("готово:", OUT, "%.0f КБ" % (os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    build()
