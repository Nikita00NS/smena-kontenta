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
STYLE = {
    "title": ParagraphStyle("t", fontName="DB", fontSize=13, leading=16,
                            textColor=INK, alignment=TA_CENTER, spaceAfter=1),
    "subtitle": ParagraphStyle("st", fontName="D", fontSize=10.5, leading=14,
                               textColor=INK, alignment=TA_CENTER, spaceAfter=6),
    "p": ParagraphStyle("p", fontName="D", fontSize=8.7, leading=11.3,
                        textColor=INK, spaceAfter=5),
    "pc": ParagraphStyle("pc", fontName="D", fontSize=8.7, leading=11.3,
                         textColor=INK, spaceAfter=5),
    "small": ParagraphStyle("sm", fontName="D", fontSize=7.6, leading=10.0,
                            textColor=GREY, spaceAfter=3),
    "sig": ParagraphStyle("sig", fontName="D", fontSize=9.0, leading=12.4,
                          textColor=INK, spaceAfter=2),
}

DOC = None
DOC_PATH = None

def page_number(canvas, doc):
    """Единственный служебный элемент — номер листа, как на бумажных бланках."""
    canvas.saveState()
    canvas.setFont("D", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawRightString(A4[0] - 15 * mm, 10 * mm, "лист %d" % doc.page)
    canvas.restoreState()

def start(path, title):
    global DOC, DOC_PATH
    DOC_PATH = path
    DOC = BaseDocTemplate(
        path, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=13 * mm, bottomMargin=13 * mm,
        title=title, author="", subject=title, creator="",
    )
    frame = Frame(DOC.leftMargin, DOC.bottomMargin, DOC.width, DOC.height, id="f")
    DOC.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=page_number)])
    return []

def P(text, style="p"):
    return Paragraph(text, STYLE[style])

def place(story, name):
    DOC.build(story)
    pages = DOC.page
    print("готово:", os.path.relpath(DOC_PATH, ROOT), "страниц:", pages,
          "%.0f КБ" % (os.path.getsize(DOC_PATH) / 1024))
    return pages

def city_date():
    """Строка «г. ____ «__» ____ 20__ г.» — как на бумажном бланке."""
    t = Table([[P("г. ____________________", "pc"),
                P("«______» ________________ 20____ г.", "pc")]],
              colWidths=[85 * mm, 95 * mm], hAlign="RIGHT")
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    return t

def sign_row(who):
    """Подпись с расшифровкой — «_________ / _________ / (подпись)(расшифровка)»."""
    return P(
        '%s: _______________ / ____________________________ /<br/>'
        '<font size="7.2" color="#555555">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
        '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
        '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
        '(подпись)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
        '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(расшифровка подписи)</font>' % who,
        "sig")

def author_head():
    """Шапка бланка: кто даёт согласие, поля для заполнения от руки."""
    return [
        P("Я, _______________________________________________________________________,"),
        P('<font size="7.2" color="#555555">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
          '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
          '(фамилия, имя, отчество автора — полностью, разборчиво)</font>'),
        P("дата рождения: «____» ______________ _______ г., телефон: +7 ____________________,"),
        P("e-mail*: _____________________________________________________________________,"),
        P("регион и город проживания: ___________________________________________________,"),
        P("паспорт <font size='7.2' color='#555555'>(серия, номер, когда и кем выдан — заполняется "
          "только при оформлении пресс-карты)</font>: серия ______ № ____________, выдан "
          "_________________________________________________________ «____» ____________ 20____ г.,"),
        P("адрес регистрации: ____________________________________________________________."),
    ]

def parent_block():
    return [
        P("Автор, достигший 14 лет, подписывает согласие самостоятельно. Для автора младше "
          "18 лет согласие дополнительно подтверждает законный представитель, за автора "
          "младше 14 лет согласие даёт только законный представитель:"),
        P("______________________________________________________________________________,"),
        P('<font size="7.2" color="#555555">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
          '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
          '(фамилия, имя, отчество законного представителя)</font>'),
        P("телефон: +7 ____________________, кем приходится автору: ______________________,"),
        P("подпись: ______________ / ____________________________ / "
          '<font size="7.2" color="#555555">(подпись, расшифровка)</font>'),
    ]

def ops():
    return ("операторам персональных данных — Сирику Никите Сергеевичу, ИНН 940802781550, "
            "и Ильину Борису Павловичу, ИНН 784304154610, — проект «Смена контента», "
            "сайт http://%s/, город Москва" % SITE)

# ------------------------------------------------------- согласие на обработку ---

def build():
    story = start(OUT, "Согласие на использование и обработку персональных данных")
    story.append(P("СОГЛАСИЕ", "title"))
    story.append(P("на использование и обработку персональных данных", "subtitle"))
    story.append(city_date())
    story.extend(author_head())
    story.append(P(
        "на основании Федерального закона от 27.07.2006 г. № 152-ФЗ «О персональных данных» "
        "даю согласие на обработку моих персональных данных %s, в связи с моей регистрацией "
        "на сайте и участием в работе проекта «Смена контента», а именно: на сбор, запись, "
        "систематизацию, накопление, хранение, уточнение (обновление, изменение), извлечение, "
        "использование, передачу лицам, привлечённым к работе редакции, обезличивание, "
        "блокирование и уничтожение моих персональных данных." % ops()))
    story.append(P(
        "Перечень персональных данных, на обработку которых даётся согласие: фамилия, имя, "
        "отчество; дата рождения; регион и город проживания; адрес электронной почты; номер "
        "телефона; название школы, класса или иного места учёбы, если я указал их сам; "
        "фотография профиля и фотографии с моим участием; тексты, фотографии, аудио- и "
        "видеоматериалы, которые я загружаю на сайт; род занятий (профессия), указанный "
        "в профиле; сведения об участии в конкурсах, "
        "активностях и медиашколе проекта и об их результатах, включая баллы; фамилия, имя, "
        "отчество и телефон одного из родителей (законных представителей) для авторов младше "
        "18 лет; при оформлении пресс-карты — паспортные данные, адрес регистрации, адрес "
        "доставки пресс-карты и её номер. Иные данные обрабатываются только если я укажу их "
        "сам в материалах или обращениях."))
    story.append(P(
        "Цели обработки: регистрация, вход и работа личного кабинета; проверка и публикация "
        "моих материалов с указанием авторства; связь со мной по вопросам материалов, "
        "проверки и участия; приём заявок на пресс-карту, её изготовление, выдача лично "
        "в Москве либо пересылка почтой, продление и отзыв; "
        "участие в редакции региона, медиашколе и конкурсах проекта; рассмотрение обращений "
        "в поддержку и безопасность сайта. Форма согласия построена по типовой форме "
        "приказа Роскомнадзора от 27.10.2022 № 178; уведомление в РКН направлено "
        "(рег. № 100489565), обработка ведётся с 05.11.2026."))
    story.append(P(
        "Я согласен(-сна), что обработка может осуществляться как с использованием "
        "автоматизированных средств (информационная система сайта, электронная почта), так и "
        "без них: редакция читает присланные сканы и материалы. Разрешение показывать моё "
        "имя, фотографию и работы неограниченному кругу лиц даётся отдельным согласием на "
        "распространение персональных данных; настоящее согласие такого разрешения не даёт. "
        "Согласие действует до его отзыва."))
    story.append(P(
        "Я оставляю за собой право отозвать настоящее согласие в любой момент, направив "
        "заявление через форму на странице %s/support либо письмом на support@smenakontenta.ru "
        "с той почты, которая указана в моём аккаунте. В случае получения отзыва операторы "
        "обязаны прекратить обработку или обеспечить прекращение обработки персональных "
        "данных и уничтожить или обеспечить их уничтожение в срок, не превышающий 30 дней "
        "с даты поступления заявления, и уведомить меня об уничтожении в письменной форме. "
        "Данные, хранение которых предусмотрено законом, сохраняются в течение установленного "
        "законом срока." % SITE))
    story.append(sign_row("Подпись автора"))
    story.extend(parent_block())
    story.append(P(
        '<font size="7.6" color="#555555">*E-mail, с которого зарегистрирован аккаунт на сайте '
        '«Смена контента» (заполнять строчными печатными буквами, разборчиво). Заполненный и '
        'подписанный лист сфотографируйте целиком и загрузите в личном кабинете, в блоке '
        '«Согласие на обработку персональных данных». Пока редакция не проверила документ, '
        'отправка материалов закрыта.</font>', "small"))
    return place(story, OUT)

# ------------------------------------------------- согласие на распространение ---

def build_distribution():
    story = start(OUT_DISTRIBUTION, "Согласие на распространение персональных данных")
    story.append(P("СОГЛАСИЕ", "title"))
    story.append(P("на распространение персональных данных (статья 10.1 № 152-ФЗ)", "subtitle"))
    story.append(city_date())
    story.extend(author_head())
    story.append(P(
        "на основании статьи 10.1 Федерального закона от 27.07.2006 г. № 152-ФЗ "
        "«О персональных данных» разрешаю %s сделать мои персональные данные "
        "общедоступными. Согласие даётся отдельно от согласия на обработку: с 1 марта 2021 "
        "года разрешение распространять данные нельзя включать в согласие на их обработку. "
        "Документ нужен для конкурсов и активностей, материалы которых выходят за пределами "
        "сайта, и для публикации авторских работ." % ops()))
    story.append(P(
        "Конкурс или активность, для которой даётся согласие: ______________________________"
        "_________________________________________________________________________________."))
    story.append(P(
        "Информационные ресурсы, где данные станут общедоступными: сайт проекта "
        "https://%s/ (материал, имя автора и фотография видны всем посетителям) и площадки "
        "проекта, на которых публикуются конкурсные работы:" % SITE))
    for title, url in social_links():
        story.append(P("— %s: %s;" % (title, url)))
    story.append(P(
        "Отмечаю разрешение по каждой категории (ненужное зачеркнуть): фамилия, имя, "
        "отчество — разрешаю / не разрешаю; регион и город проживания — разрешаю / "
        "не разрешаю; дата рождения — разрешаю / не разрешаю; фотография — разрешаю / "
        "не разрешаю; мои работы (тексты, фотографии, видео, аудио) — разрешаю / не "
        "разрешаю; результаты участия в конкурсах и активностях проекта, включая баллы "
        "и места, — разрешаю / не разрешаю. Паспортные данные и адрес регистрации "
        "распространению не подлежат ни при каких условиях."))
    story.append(P(
        "Объём разрешения: __ сайт проекта __ сайт и площадки проекта <font size=\"7.2\" "
        "color=\"#555555\">(подчеркнуть нужное; без отметки разрешение не действует)</font>."))
    story.append(P(
        "Условия и запреты: площадки проекта вправе удалить материал с моими данными по "
        "моему требованию; передача данных иным третьим лицам, кроме площадок, указанных "
        "выше, не допускается, кроме случаев, прямо предусмотренных законом. Я вправе "
        "отозвать настоящее согласие, направив заявление через форму на странице "
        "%s/support либо письмом на support@smenakontenta.ru с той почты, которая указана "
        "в моём аккаунте. После получения отзыва материалы снимаются с площадок проекта "
        "в срок не позднее трёх рабочих дней, с сайта — в течение суток. Об уничтожении "
        "данных я уведомляюсь в письменной форме." % SITE))
    story.append(sign_row("Подпись автора"))
    story.append(P("<br/>", "p"))
    story.extend(parent_block())
    story.append(P(
        '<font size="7.8" color="#555555">*E-mail, указанный в личном кабинете на сайте '
        '«Смена контента» (заполнять строчными печатными буквами, разборчиво). Заполненный '
        'и подписанный лист сфотографируйте целиком и загрузите в личном кабинете, в блоке '
        '«Согласие на распространение персональных данных».</font>', "small"))
    return place(story, OUT_DISTRIBUTION)

if __name__ == "__main__":
    build()
    build_distribution()
