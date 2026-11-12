#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка документов проекта.

Сверяет карточки на странице «Документы» с самими файлами и проверяет, что
в текстах осталось то, без чего документ не работает: два отдельных согласия,
площадки проекта, сроки отзыва, отсутствие колонтитулов и служебных приписок.

Запуск:  python3 tools/tests/docs-check.py
Нужен pypdf:  pip install pypdf
"""

import os
import re
import sys

from pypdf import PdfReader

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from social import links as social_links  # noqa: E402

DOCS_DIR = os.path.join(ROOT, "assets", "docs")
DATA_JS = os.path.join(ROOT, "assets", "js", "data.js")

problems = []
ok_count = 0


def check(condition, message, extra=""):
    global ok_count
    if condition:
        ok_count += 1
        print("  ok   " + message)
    else:
        problems.append(message + (" → " + str(extra) if extra else ""))
        print("  FAIL " + message + (" → " + str(extra) if extra else ""))


def text_of(name):
    reader = PdfReader(os.path.join(DOCS_DIR, name))
    return reader, "\n".join(page.extract_text() or "" for page in reader.pages)


def norm(text):
    """Переносы строк и двойные пробелы не должны мешать поиску фраз."""
    return re.sub(r"\s+", " ", text).strip()


def main():
    src = open(DATA_JS, encoding="utf-8").read()
    start = src.find("docs: [")
    block = src[start:src.find("\n  ],", start)]
    cards = re.findall(r'file: "([^"]+)",\s*pages: (\d+)', block)
    check(len(cards) >= 8, "на странице документов не меньше восьми карточек", len(cards))

    for path, pages in cards:
        name = os.path.basename(path)
        full = os.path.join(ROOT, path.lstrip("/"))
        if not os.path.exists(full):
            check(False, "файл есть: " + name)
            continue
        reader = PdfReader(full)
        check(len(reader.pages) == int(pages),
              "число страниц совпадает: " + name, "%s ≠ %s" % (len(reader.pages), pages))

    # --- согласие на обработку -------------------------------------------------
    reader, processing = text_of("soglasie-na-obrabotku-pd.pdf")
    p = norm(processing)
    check("СОГЛАСИЕ" in p and "на использование и обработку персональных данных" in p,
          "согласие на обработку названо как в образце")
    check("152-ФЗ" in p, "в согласии на обработку есть ссылка на 152-ФЗ")
    check("940802781550" in p and "784304154610" in p, "указаны оба оператора с ИНН")
    check("30 дней" in p, "срок прекращения обработки при отзыве — 30 дней")
    check("достигший 14 лет" in p, "возраст самостоятельной подписи — 14 лет")
    check("законный представитель" in p, "для несовершеннолетних есть подтверждение представителя")
    check("отдельным согласием на распространение" in p,
          "согласие на обработку не смешано с разрешением на распространение")

    # --- согласие на распространение ------------------------------------------
    reader, spread = text_of("soglasie-na-rasprostranenie-pd.pdf")
    sp = norm(spread)
    check("статьёй 10.1" in sp, "согласие на распространение ссылается на статью 10.1")
    check("smenakontenta.ru" in sp, "сайт указан как ресурс распространения")
    for title, url in social_links():
        check(url in sp, "площадка в согласии: " + title, url)
    check("только сайт проекта / сайт проекта и перечисленные" in sp,
          "есть отметка об объёме разрешения: сайт или сайт и площадки")
    check("Условия и запреты" in sp and "разрешаю / не разрешаю" in sp,
          "категории данных размечаются вручную, есть условия и запреты")
    check("трёх рабочих дней" in sp, "прекращение распространения — три рабочих дня")

    # --- политика и соглашение -------------------------------------------------
    reader, privacy = text_of("politika-konfidencialnosti.pdf")
    pv = norm(privacy)
    check("Действует с" in pv, "у политики указана дата вступления в силу")
    check("являются распространением персональных данных" in pv,
          "политика объясняет, что публикация имени и работы — распространение")
    check("трёх рабочих дней" in pv, "в политике есть срок прекращения распространения")
    check("localStorage" in pv, "политика описывает реальное хранилище браузера")
    for title, url in social_links():
        check(url in pv, "площадка в политике: " + title, url)

    reader, terms = text_of("polzovatelskoe-soglashenie.pdf")
    tm = norm(terms)
    check("Ильин Борис Павлович" in tm and "Борисович" not in tm, "имена учредителей написаны верно")
    check("доведение материала до всеобщего сведения на Сайте" in tm,
          "лицензия ограничена сайтом")
    check("только при соответствующей отметке" in tm,
          "площадки проекта — только по отметке в согласии")
    check("двенадцать месяцев" in tm, "срок пресс-карты — двенадцать месяцев")
    check("продлён" in tm and "отозвать" in tm, "у карты есть продление и отзыв")

    # --- оформление: без колонтитулов и служебных приписок ---------------------
    banned = [
        "ПРЕСС-КИТ · ВЕРСИЯ",
        "Молодёжное медиа · медиашкола · сообщество авторов",
        "Приложение №",
        "проверяет юрист",
        "Дата версии — в колонтитуле",
        "УТВЕРЖДЕНО",
    ]
    for name in sorted(os.listdir(DOCS_DIR)):
        if not name.endswith(".pdf"):
            continue
        _, body = text_of(name)
        found = [word for word in banned if word.lower() in body.lower()]
        check(not found, "без шапок и приписок: " + name, found)

    print("\n=== ИТОГ ===")
    print("проверок пройдено:", ok_count)
    if problems:
        print("проблем:", len(problems))
        for problem in problems:
            print("  —", problem)
        sys.exit(1)
    print("все проверки пройдены")


if __name__ == "__main__":
    main()
