# -*- coding: utf-8 -*-
"""
Общая вёрстка PDF-документов проекта «Смена контента».

Здесь всё, что одинаково для каждого документа: данные проекта (project.json),
шрифты, стили и два оформления:

  Official — строгий документ: политика, соглашение, согласия, положения.
             Чёрный текст, колонтитулы, «стр. 2 из 5», гриф «УТВЕРЖДАЮ».
  Brand    — материалы для людей и партнёров: пресс-кит, памятка, программа.
             Логотип и акцентная линия.

Тексты документов лежат в legal.py и guides.py, запуск — build.py.
"""

import json
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, HRFlowable, KeepTogether, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "assets", "docs")

# ------------------------------------------------------------ данные проекта

with open(os.path.join(HERE, "project.json"), encoding="utf-8") as _f:
    P = json.load(_f)

NAME = P["name"]                 # Смена контента
QNAME = P["nameQuoted"]          # «Смена контента»
SITE = P["siteShort"]            # smenakontenta.ru
CITY = P["city"]
DIRECTOR = P["director"]
COFOUNDER = P["cofounder"]
OPERATOR = P["operator"]
MAIL = P["mail"]
HOSTING = P["hosting"]
CARD = P["card"]
EDITORIAL = P["editorial"]

MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
          "августа", "сентября", "октября", "ноября", "декабря"]


def ru_date(iso):
    """2026-11-12 → «12 ноября 2026 г.»"""
    y, m, d = [int(x) for x in iso.split("-")]
    return "%d %s %d г." % (d, MONTHS[m - 1], y)


DOCS_DATE = ru_date(P["docsDate"])
VERSION = "Редакция " + P["docsVersion"]
PROCESSING_START = ru_date(P["processingStart"])


def operator_full(with_inn=True):
    """Оператор одной строкой — так он назван во всех документах."""
    s = OPERATOR["name"]
    if with_inn and OPERATOR.get("inn"):
        s += " (ИНН %s)" % OPERATOR["inn"]
    return s + ", " + OPERATOR["role"]


def operator_dative(with_inn=True):
    """То же в дательном падеже: «даю согласие оператору — …»."""
    s = OPERATOR["dative"]
    if with_inn and OPERATOR.get("inn"):
        s += " (ИНН %s)" % OPERATOR["inn"]
    return s + ", " + OPERATOR.get("roleDative", OPERATOR["role"])


def operator_address():
    """Куда писать оператору. Почтовый адрес печатается, когда он указан в
    project.json; до этого — только электронная почта."""
    parts = []
    if OPERATOR.get("address"):
        parts.append("почтовый адрес: " + OPERATOR["address"])
    parts.append("электронная почта: " + MAIL["personalData"])
    return "; ".join(parts)


def general_mail():
    return MAIL.get("general") or "указана на сайте в разделе «Документы»"


def general_mail_phrase():
    return MAIL.get("general") or "почту проекта (она указана на сайте)"


def warnings():
    """Чего не хватает в project.json, чтобы документы были полными."""
    out = []
    if not OPERATOR.get("address"):
        out.append("в project.json не указан почтовый адрес оператора (operator.address): "
                   "по п. 3 ч. 4 ст. 9 закона № 152-ФЗ он должен стоять в согласии")
    return out


# --------------------------------------------------------------------- шрифты

FONT_DIRS = [
    os.path.join(HERE, "fonts"),
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/dejavu",
    "/usr/share/fonts/TTF",
    "/Library/Fonts",
    os.path.expanduser("~/Library/Fonts"),
    "C:\\Windows\\Fonts",
]


def _font(filename):
    for d in FONT_DIRS:
        path = os.path.join(d, filename)
        if os.path.exists(path):
            return path
    raise SystemExit(
        "Не найден шрифт %s. Установите пакет fonts-dejavu или положите файлы "
        "DejaVuSans.ttf, DejaVuSans-Bold.ttf и DejaVuSansMono.ttf в tools/docs/fonts/." % filename)


pdfmetrics.registerFont(TTFont("D", _font("DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DB", _font("DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("DM", _font("DejaVuSansMono.ttf")))
pdfmetrics.registerFontFamily("D", normal="D", bold="DB", italic="D", boldItalic="DB")
pdfmetrics.registerFontFamily("DB", normal="DB", bold="DB", italic="DB", boldItalic="DB")

INK = colors.HexColor("#111111")
GREY = colors.HexColor("#555555")
LINE = colors.HexColor("#bbbbbb")
ACCENT = colors.HexColor("#ff3d14")
MUTED = colors.HexColor("#797464")
SOFT_LINE = colors.HexColor("#d8d3c5")

# ---------------------------------------------------------------------- стили

S = {
    # строгие документы
    "label": ParagraphStyle("label", fontName="D", fontSize=8, leading=11,
                            textColor=GREY, alignment=TA_LEFT, spaceAfter=8),
    "title": ParagraphStyle("title", fontName="DB", fontSize=15, leading=20,
                            textColor=INK, alignment=TA_CENTER, spaceAfter=4),
    "sub": ParagraphStyle("sub", fontName="D", fontSize=9, leading=13,
                          textColor=GREY, alignment=TA_CENTER, spaceAfter=14),
    "approve": ParagraphStyle("approve", fontName="D", fontSize=9, leading=13,
                              textColor=INK, alignment=TA_LEFT),
    "h2": ParagraphStyle("h2", fontName="DB", fontSize=10.5, leading=14,
                         textColor=INK, spaceBefore=12, spaceAfter=5, alignment=TA_LEFT),
    "p": ParagraphStyle("p", fontName="D", fontSize=9.6, leading=14.2,
                        textColor=INK, alignment=TA_LEFT, spaceAfter=5),
    "li": ParagraphStyle("li", fontName="D", fontSize=9.6, leading=14,
                         textColor=INK, alignment=TA_LEFT, leftIndent=12, spaceAfter=3),
    "cell": ParagraphStyle("cell", fontName="D", fontSize=8.8, leading=12,
                           textColor=INK, alignment=TA_LEFT),
    "cellb": ParagraphStyle("cellb", fontName="DB", fontSize=8.8, leading=12,
                            textColor=INK, alignment=TA_LEFT),
    "small": ParagraphStyle("small", fontName="D", fontSize=8, leading=11.5,
                            textColor=GREY, alignment=TA_LEFT, spaceAfter=4),
    # формы на один лист: мелкий плотный текст
    "form_title": ParagraphStyle("form_title", fontName="DB", fontSize=15, leading=18,
                                 textColor=INK, alignment=TA_LEFT, spaceAfter=2),
    "form_sub": ParagraphStyle("form_sub", fontName="DB", fontSize=9.2, leading=12,
                               textColor=INK, alignment=TA_LEFT),
    "form_to": ParagraphStyle("form_to", fontName="D", fontSize=8.4, leading=11.2,
                              textColor=INK, alignment=TA_LEFT),
    "form_p": ParagraphStyle("form_p", fontName="D", fontSize=8.5, leading=11.05,
                             textColor=INK, alignment=TA_JUSTIFY, spaceAfter=2.8),
    "form_pl": ParagraphStyle("form_pl", fontName="D", fontSize=8.5, leading=11.05,
                              textColor=INK, alignment=TA_LEFT, spaceAfter=2.8),
    "form_note": ParagraphStyle("form_note", fontName="D", fontSize=7.2, leading=9.6,
                                textColor=GREY, alignment=TA_LEFT, spaceAfter=2),
    "form_cell": ParagraphStyle("form_cell", fontName="D", fontSize=8.2, leading=10.6,
                                textColor=INK, alignment=TA_LEFT),
    # материалы для людей и партнёров
    "b_kicker": ParagraphStyle("b_kicker", fontName="DM", fontSize=7.5, leading=11,
                               textColor=ACCENT, spaceAfter=6),
    "b_h1": ParagraphStyle("b_h1", fontName="DB", fontSize=25, leading=28,
                           textColor=INK, spaceAfter=8),
    "b_h2": ParagraphStyle("b_h2", fontName="DB", fontSize=12.5, leading=16,
                           textColor=INK, spaceBefore=14, spaceAfter=5),
    "b_h3": ParagraphStyle("b_h3", fontName="DB", fontSize=10, leading=13,
                           textColor=INK, spaceBefore=8, spaceAfter=3),
    "b_p": ParagraphStyle("b_p", fontName="D", fontSize=9.8, leading=14.6,
                          textColor=INK, spaceAfter=7, alignment=TA_LEFT),
    "b_lead": ParagraphStyle("b_lead", fontName="D", fontSize=11, leading=16,
                             textColor=colors.HexColor("#403d34"), spaceAfter=10),
    "b_small": ParagraphStyle("b_small", fontName="D", fontSize=8.2, leading=11.5,
                              textColor=MUTED, spaceAfter=4),
    "b_li": ParagraphStyle("b_li", fontName="D", fontSize=9.6, leading=14,
                           textColor=INK, leftIndent=10, bulletIndent=0, spaceAfter=3),
    "b_quote": ParagraphStyle("b_quote", fontName="D", fontSize=10.2, leading=15,
                              textColor=INK, leftIndent=12, spaceAfter=8, spaceBefore=4),
    "b_cell": ParagraphStyle("b_cell", fontName="D", fontSize=8.6, leading=12, textColor=INK),
    "b_cellb": ParagraphStyle("b_cellb", fontName="DB", fontSize=8.6, leading=12, textColor=INK),
}


class NumberedCanvas(pdfcanvas.Canvas):
    """Нумерация «стр. 2 из 4»: общее число страниц известно только после
    сборки, поэтому страницы откладываются и подписываются в конце."""

    footer_x = A4[0] - 20 * mm

    def __init__(self, *args, **kwargs):
        pdfcanvas.Canvas.__init__(self, *args, **kwargs)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("D", 7)
            self.setFillColor(GREY)
            self.drawRightString(self.footer_x, 11.5 * mm,
                                 "стр. %d из %d" % (self._pageNumber, total))
            pdfcanvas.Canvas.showPage(self)
        pdfcanvas.Canvas.save(self)


class FillLine(Flowable):
    """Строка формы: текст вперемешку с пропусками для заполнения от руки.

    parts — список:
      "текст"             печатается как есть;
      число               пропуск: доля свободной ширины строки;
      (число, "подпись")  пропуск с мелкой подписью под линией.
    Свободная ширина делится между пропусками по их долям, поэтому линии
    всегда доходят до правого края и не переносятся как попало."""

    def __init__(self, parts, size=8.6, height=15.4, font="D"):
        Flowable.__init__(self)
        self.parts = parts
        self.size = size
        self.font = font
        self.caption = any(isinstance(p, tuple) for p in parts)
        self.height = height + (5.2 if self.caption else 0)

    def wrap(self, aw, ah):
        self.width = aw
        return aw, self.height

    def draw(self):
        c = self.canv
        text_w = sum(stringWidth(p, self.font, self.size) for p in self.parts if isinstance(p, str))
        weights = [(p[0] if isinstance(p, tuple) else p) for p in self.parts if not isinstance(p, str)]
        free = max(0.0, self.width - text_w)
        total = float(sum(weights)) or 1.0
        y = 3.4 + (5.2 if self.caption else 0)
        x = 0.0
        c.setFillColor(INK)
        c.setStrokeColor(INK)
        c.setLineWidth(0.45)
        for p in self.parts:
            if isinstance(p, str):
                c.setFont(self.font, self.size)
                c.drawString(x, y, p)
                x += stringWidth(p, self.font, self.size)
                continue
            weight, caption = (p if isinstance(p, tuple) else (p, ""))
            w = free * weight / total
            c.line(x + 1.2, y - 1.6, x + w - 1.2, y - 1.6)
            if caption:
                c.setFont(self.font, 5.9)
                c.setFillColor(GREY)
                c.drawCentredString(x + w / 2.0, y - 7.6, caption)
                c.setFillColor(INK)
            x += w


class Official:
    """Строгий документ проекта."""

    def __init__(self, filename, title, label="Документ проекта", approve=True, form=False):
        self.filename = filename
        self.path = os.path.join(OUT, filename)
        self.title = title
        self.label = label
        self.approve = approve
        self.form = form          # форма на один лист: узкие поля, без шапки документа
        self.items = []

    def _frame(self, canvas, doc):
        w, h = A4
        left = doc.leftMargin
        right = w - doc.rightMargin
        canvas.saveState()
        canvas.setFillColor(GREY)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        if self.form:
            # бланк на один лист: без верхнего колонтитула, в подвале — кем и
            # когда утверждена форма
            foot = 8.5 * mm
            canvas.line(left, foot, right, foot)
            canvas.setFont("D", 7)
            canvas.drawString(left, foot - 4.5 * mm, "%s · %s. Форма утверждена %s: %s %s"
                              % (QNAME, VERSION.lower(), DOCS_DATE, DIRECTOR["position"].lower(),
                                 DIRECTOR["short"]))
            canvas.restoreState()
            return
        canvas.setFont("D", 7.5)
        top = h - 14 * mm
        canvas.drawString(left, top, "%s · %s" % (QNAME, self.title))
        canvas.drawRightString(right, top, "%s от %s" % (VERSION, DOCS_DATE))
        canvas.line(left, top - 2 * mm, right, top - 2 * mm)
        foot = 16 * mm
        canvas.line(left, foot, right, foot)
        canvas.setFont("D", 7)
        canvas.drawString(left, foot - 4.5 * mm, "%s · %s" % (QNAME, SITE))
        canvas.restoreState()

    def add(self, *flow):
        self.items.extend(flow)

    def h2(self, text):
        self.add(Paragraph(text, S["h2"]))

    def p(self, text, style="p"):
        self.add(Paragraph(text, S[style]))

    def li(self, items, style="li"):
        for it in items:
            self.add(Paragraph(it, S[style], bulletText="—"))

    def table(self, rows, widths, head=True, cell="cell", cellb="cellb"):
        data = [[Paragraph(str(c), S[cellb] if (head and i == 0) else S[cell]) for c in row]
                for i, row in enumerate(rows)]
        t = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1 if head else 0)
        style = [
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (0, -1), 0),
        ]
        if head:
            style.insert(0, ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK))
        t.setStyle(TableStyle(style))
        self.add(t, Spacer(1, 8))

    def fill(self, *parts, **kw):
        self.add(FillLine(list(parts), **kw))

    def sign(self, who=""):
        """Дата — подпись — расшифровка."""
        self.add(FillLine(["«", 0.5, "» ", 2.2, " 20", 0.5, " г.     ",
                           (3.2, "подпись" + (" " + who if who else "")), "     ",
                           (5.2, "фамилия и инициалы")], height=16.5))

    def approve_block(self):
        text = ("УТВЕРЖДАЮ<br/>%s<br/>проекта %s<br/><br/>______________ %s<br/>%s"
                % (DIRECTOR["position"], QNAME, DIRECTOR["short"], DOCS_DATE))
        t = Table([["", Paragraph(text, S["approve"])]], colWidths=[100 * mm, 70 * mm], hAlign="LEFT")
        t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0)]))
        return [t, Spacer(1, 12)]

    def build(self):
        os.makedirs(OUT, exist_ok=True)
        if self.form:
            margins = dict(leftMargin=17 * mm, rightMargin=15 * mm, topMargin=11 * mm, bottomMargin=10.5 * mm)
        else:
            margins = dict(leftMargin=20 * mm, rightMargin=20 * mm, topMargin=22 * mm, bottomMargin=20 * mm)
        doc = BaseDocTemplate(
            self.path, pagesize=A4, title=self.title, author=NAME, subject=self.title,
            creator=NAME, invariant=1, **margins)
        frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main",
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=self._frame)])

        head = []
        if not self.form:
            if self.approve:
                head += self.approve_block()
            head += [
                Paragraph(self.label.upper(), S["label"]),
                Paragraph(self.title, S["title"]),
                Paragraph("%s от %s · %s" % (VERSION, DOCS_DATE, SITE), S["sub"]),
                HRFlowable(width="100%", thickness=0.7, color=INK),
                Spacer(1, 10),
            ]

        class Canvas(NumberedCanvas):
            footer_x = A4[0] - doc.rightMargin

        if self.form:
            # у формы номер страницы стоит ниже: поля узкие
            def save(canvas_self):
                total = len(canvas_self._saved)
                for state in canvas_self._saved:
                    canvas_self.__dict__.update(state)
                    canvas_self.setFont("D", 7)
                    canvas_self.setFillColor(GREY)
                    canvas_self.drawRightString(Canvas.footer_x, 4 * mm,
                                                "стр. %d из %d" % (canvas_self._pageNumber, total))
                    pdfcanvas.Canvas.showPage(canvas_self)
                pdfcanvas.Canvas.save(canvas_self)
            Canvas.save = save

        doc.build(head + self.items, canvasmaker=Canvas)
        return self.path


class Brand:
    """Материал для людей и партнёров: логотип, акцентная линия, крупный заголовок."""

    def __init__(self, filename, kicker, title, subtitle, header_right=""):
        self.filename = filename
        self.path = os.path.join(OUT, filename)
        self.kicker = kicker
        self.title = title
        self.subtitle = subtitle
        self.header_right = header_right or kicker.split(" · ")[0]
        self.items = []

    def _frame(self, canvas, doc):
        w, h = A4
        canvas.saveState()
        logo = os.path.join(ROOT, "assets", "img", "logo-dark.png")
        if os.path.exists(logo):
            lh = 5.0 * mm
            lw = lh * 1706 / 309
            canvas.drawImage(logo, 22 * mm, h - 19.2 * mm, width=lw, height=lh, mask="auto")
        else:
            canvas.setFillColor(INK)
            canvas.setFont("DM", 7.2)
            canvas.drawString(22 * mm, h - 16 * mm, NAME.upper())
        canvas.setFont("DM", 7.2)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(w - 22 * mm, h - 16.4 * mm, self.header_right)
        canvas.setStrokeColor(ACCENT)
        canvas.setLineWidth(1)
        canvas.line(22 * mm, h - 21.4 * mm, w - 22 * mm, h - 21.4 * mm)

        canvas.setStrokeColor(SOFT_LINE)
        canvas.setLineWidth(0.6)
        canvas.line(22 * mm, 17 * mm, w - 22 * mm, 17 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("DM", 6.8)
        canvas.drawString(22 * mm, 12.5 * mm, "Молодёжное медиа · медиашкола · сообщество авторов")
        canvas.drawRightString(w - 22 * mm, 12.5 * mm, "стр. %d" % canvas.getPageNumber())
        canvas.restoreState()

    def add(self, *flowables):
        self.items.extend(flowables)

    def h2(self, text):
        self.add(Paragraph(text, S["b_h2"]))

    def h3(self, text):
        self.add(Paragraph(text, S["b_h3"]))

    def p(self, text, style="p"):
        self.add(Paragraph(text, S["b_" + style]))

    def bullets(self, items):
        for it in items:
            self.add(Paragraph(it, S["b_li"], bulletText="—"))

    def quote(self, text):
        self.add(Spacer(1, 2), Paragraph(text, S["b_quote"]), Spacer(1, 4))

    def table(self, rows, widths=None):
        data = []
        for i, row in enumerate(rows):
            style = "b_cellb" if i == 0 else "b_cell"
            data.append([Paragraph(str(c), S[style]) for c in row])
        t = Table(data, colWidths=widths or [55 * mm, 110 * mm], hAlign="LEFT", repeatRows=1)
        t.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
            ("LINEBELOW", (0, 1), (-1, -1), 0.5, SOFT_LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (0, -1), 0),
        ]))
        self.add(t, Spacer(1, 8))

    def build(self):
        os.makedirs(OUT, exist_ok=True)
        doc = BaseDocTemplate(
            self.path, pagesize=A4,
            leftMargin=22 * mm, rightMargin=22 * mm, topMargin=24 * mm, bottomMargin=22 * mm,
            title=self.title, author=NAME, subject=self.kicker, creator=NAME, invariant=1)
        frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
        doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=self._frame)])
        head = [Paragraph(self.kicker, S["b_kicker"]), Paragraph(self.title, S["b_h1"])]
        if self.subtitle:
            head.append(Paragraph(self.subtitle, S["b_lead"]))
        head.append(Spacer(1, 4))
        doc.build(head + self.items)
        return self.path


__all__ = [
    "A4", "mm", "Paragraph", "Spacer", "Table", "TableStyle", "HRFlowable", "KeepTogether",
    "FillLine", "Official", "Brand", "S", "P", "INK", "GREY", "LINE",
    "NAME", "QNAME", "SITE", "CITY", "DIRECTOR", "COFOUNDER", "OPERATOR", "MAIL", "HOSTING",
    "CARD", "EDITORIAL", "DOCS_DATE", "VERSION", "PROCESSING_START", "ROOT", "OUT",
    "operator_full", "operator_dative", "operator_address", "general_mail", "general_mail_phrase", "ru_date", "warnings",
]
