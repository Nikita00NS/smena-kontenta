#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка PDF-документов проекта «Смена контента» — одна команда на все.

    python3 tools/docs/build.py            собрать всё
    python3 tools/docs/build.py soglasie   собрать только названные документы
    python3 tools/docs/build.py --list     показать, что умеет собирать
    python3 tools/docs/build.py --check    ничего не менять, проверить: файлы в
                                           assets/docs совпадают с текстами (код 1, если нет)

Откуда что берётся:
    project.json   данные проекта: директор, оператор, почта, сроки — меняются здесь
    layout.py      шрифты и два оформления (строгий документ и материал для людей)
    legal.py       политика, соглашение, два согласия
    guides.py      пресс-кит, кодекс редакции, памятка автору, программа медиашколы

После правки project.json: python3 tools/docs/sync-project.py (данные для сайта)
и python3 tools/docs/build.py (документы).

Нужны: пакеты reportlab и pypdf (pip install reportlab pypdf) и шрифты DejaVu.
Файлы собираются одинаково при каждом запуске: если текст не менялся, PDF не
изменится ни на байт — в истории видны только настоящие правки.
"""

import io
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import layout  # noqa: E402
import legal  # noqa: E402
import guides  # noqa: E402

# Список документов: порядок здесь — порядок карточек на странице /docs.
#   key      имя для командной строки
#   make     функция, которая собирает PDF и возвращает путь к нему
#   must     сколько страниц должно получиться (0 — сколько выйдет)
#   title, tag, desc, required — карточка документа на сайте (SC.docs)
DOCS = [
    dict(key="soglasie", make=legal.consent, must=1,
         title="Согласие на обработку персональных данных", tag="Бланк для подписи", required=True,
         desc="Один лист: распечатать, заполнить от руки, подписать и загрузить в личном кабинете. "
              "Автору младше 18 лет нужна ещё подпись родителя. Без принятого согласия публикация закрыта."),
    dict(key="rasprostranenie", make=legal.consent_public, must=1,
         title="Согласие на распространение персональных данных", tag="Бланк для подписи", required=True,
         desc="Разрешение показывать на сайте ваше имя, регион, фотографию профиля и материалы. "
              "Подписывается и загружается вместе с согласием на обработку данных."),
    dict(key="politika", make=legal.privacy, must=0,
         title="Политика обработки персональных данных", tag="Обязательный документ", required=True,
         desc="Кто оператор, какие данные сайт собирает и зачем, где они хранятся, кто их видит, "
              "как отозвать согласие и удалить данные."),
    dict(key="soglashenie", make=legal.terms, must=0,
         title="Пользовательское соглашение", tag="Обязательный документ", required=True,
         desc="Правила сайта: аккаунт и согласие, права авторов на материалы, пресс-карта, "
              "региональные редакции, ответственность сторон."),
    dict(key="kodeks", make=guides.redaction_rules, must=0,
         title="Кодекс редакции", tag="Основной документ", required=False,
         desc="Роли, путь материала до публикации, правила проверки фактов, источники, несовершеннолетние "
              "герои, персональные данные, исправления, реклама и ИИ."),
    dict(key="pamyatka", make=guides.author_guide, must=0,
         title="Памятка автору", tag="Для авторов", required=False,
         desc="Как выбрать тему, выстроить текст, оформить цитаты и подписи к фотографиям. "
              "Чек-лист перед публикацией."),
    dict(key="programma", make=guides.school_program, must=0,
         title="Программа медиашколы", tag="Для участников", required=False,
         desc="Модули, формат занятий, сколько времени нужно и что участник получает на выходе."),
    dict(key="press-kit", make=guides.press_kit, must=0,
         title="Пресс-кит проекта", tag="Для партнёров", required=False,
         desc="О проекте в трёх объёмах, аудитория, что уже сделано, правила пресс-карты, "
              "форматы сотрудничества и как упоминать проект."),
]

# имена файлов — чтобы список для сайта собирался и при частичной сборке
FILES = {
    "soglasie": "soglasie-na-obrabotku-pd.pdf",
    "rasprostranenie": "soglasie-na-rasprostranenie-pd.pdf",
    "politika": "politika-konfidencialnosti.pdf",
    "soglashenie": "polzovatelskoe-soglashenie.pdf",
    "kodeks": "polozhenie-o-redakcii.pdf",
    "pamyatka": "pamyatka-avtoru.pdf",
    "programma": "programma-mediashkoly.pdf",
    "press-kit": "press-kit.pdf",
}

# документы, которых больше нет: сборщик убирает старые файлы сам
RETIRED = ["blank-press-karty.pdf"]


def pages_of(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        return 0
    return len(PdfReader(path).pages)


DATA_JS = os.path.join(layout.ROOT, "assets", "js", "data.js")
BEGIN = "  /* docs:begin — список собирает tools/docs/build.py, руками не править */\n"
END = "  /* docs:end */\n"


def site_block(rows):
    """Список документов для сайта: SC.docs в assets/js/data.js."""
    out = [BEGIN, "  docs: [\n"]
    for r in rows:
        out.append("    {\n")
        out.append("      title: %s,\n" % json.dumps(r["title"], ensure_ascii=False))
        out.append("      file: %s,\n" % json.dumps("/assets/docs/" + r["file"], ensure_ascii=False))
        out.append("      pages: %d,\n" % r["pages"])
        out.append("      desc: %s,\n" % json.dumps(r["desc"], ensure_ascii=False))
        out.append("      tag: %s,\n" % json.dumps(r["tag"], ensure_ascii=False))
        out.append("      required: %s,\n" % ("true" if r["required"] else "false"))
        out.append("    },\n")
    out.append("  ],\n")
    out.append(END)
    return "".join(out)


def sync_site(rows, check=False):
    with io.open(DATA_JS, encoding="utf-8") as fh:
        js = fh.read()
    if BEGIN not in js or END not in js:
        print("ВНИМАНИЕ: в assets/js/data.js нет меток docs:begin / docs:end — список документов не обновлён")
        return False
    start = js.index(BEGIN)
    stop = js.index(END) + len(END)
    updated = js[:start] + site_block(rows) + js[stop:]
    if updated == js:
        return True
    if check:
        return False
    with io.open(DATA_JS, "w", encoding="utf-8") as fh:
        fh.write(updated)
    print("список документов на сайте обновлён: assets/js/data.js")
    return True


def build_one(doc, out_dir=None):
    """Собрать один документ; out_dir — куда положить (по умолчанию assets/docs)."""
    real = layout.OUT
    if out_dir:
        layout.OUT = out_dir
    try:
        return doc["make"]()
    finally:
        layout.OUT = real


def same_file(a, b):
    with open(a, "rb") as fa, open(b, "rb") as fb:
        return fa.read() == fb.read()


def main(argv):
    names = [d["key"] for d in DOCS]
    if "--list" in argv:
        for d in DOCS:
            print("%-16s %s" % (d["key"], d["title"]))
        return 0
    check = "--check" in argv
    wanted = [a for a in argv if not a.startswith("-")] or names
    unknown = [w for w in wanted if w not in names]
    if unknown:
        print("Нет такого документа: %s. Есть: %s" % (", ".join(unknown), ", ".join(names)))
        return 2

    bad = 0
    rows = []
    for d in DOCS:
        target = os.path.join(layout.OUT, FILES[d["key"]])
        if d["key"] in wanted and check:
            # ничего не трогаем: собираем во временную папку и сравниваем с репозиторием
            tmp = tempfile.mkdtemp(prefix="sk-docs-")
            try:
                built = build_one(d, tmp)
                same = os.path.exists(target) and same_file(built, target)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            if not same:
                print("УСТАРЕЛ: %s" % os.path.relpath(target, layout.ROOT))
                bad += 1
        elif d["key"] in wanted:
            built = build_one(d)
            if os.path.basename(built) != FILES[d["key"]]:
                print("ОШИБКА: %s собрался в файл %s, а в списке FILES стоит %s"
                      % (d["key"], os.path.basename(built), FILES[d["key"]]))
                return 2
            count = pages_of(target)
            note = ""
            if d["must"] and count and count != d["must"]:
                note = "  ← ДОЛЖНО БЫТЬ %d стр.: текст не помещается, сократите его" % d["must"]
                bad += 1
            print("готово: %-46s %2s стр. %5.0f КБ%s"
                  % (os.path.relpath(target, layout.ROOT), count or "?", os.path.getsize(target) / 1024.0, note))
        rows.append(dict(d, file=FILES[d["key"]], pages=pages_of(target) if os.path.exists(target) else 0))

    if not check:
        for old in RETIRED:
            path = os.path.join(layout.OUT, old)
            if os.path.exists(path):
                os.remove(path)
                print("убран устаревший файл:", os.path.relpath(path, layout.ROOT))

    if all(r["pages"] for r in rows):
        if not sync_site(rows, check=check) and check:
            print("УСТАРЕЛ: список документов в assets/js/data.js")
            bad += 1
    else:
        print("ВНИМАНИЕ: не все документы собраны — список на сайте не обновлён; запустите сборку без параметров")
    for w in layout.warnings():
        print("ВНИМАНИЕ:", w)
    if check:
        print("документы совпадают с текстами и project.json" if not bad
              else "есть расхождения: запустите python3 tools/docs/build.py")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
