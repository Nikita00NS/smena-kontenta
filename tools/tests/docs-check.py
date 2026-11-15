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
    variants = re.findall(r'\{ label: "([^"]+)", file: "([^"]+)", pages: (\d+) \}', block)
    check(len(cards) >= 8, "на странице документов не меньше восьми карточек", len(cards))
    check(len(variants) == 4 and {label for label, _, _ in variants} == {"14 лет и старше", "Младше 14 лет"},
          "на странице доступны оба возрастных варианта каждого согласия", variants)
    expected_variant_files = {
        "soglasie-na-obrabotku-pd.pdf", "soglasie-na-obrabotku-pd-do-14.pdf",
        "soglasie-na-rasprostranenie-pd.pdf", "soglasie-na-rasprostranenie-pd-do-14.pdf",
    }
    variant_files = {os.path.basename(file.split("?v=")[0]) for _, file, _ in variants}
    check(variant_files == expected_variant_files,
          "ссылки ведут на четыре нужных PDF-бланка", sorted(variant_files))

    for path, pages in cards:
        name = os.path.basename(path)
        full = os.path.join(ROOT, path.lstrip("/").split("?v=")[0])
        if not os.path.exists(full):
            check(False, "файл есть: " + name)
            continue
        reader = PdfReader(full)
        check(len(reader.pages) == int(pages),
              "число страниц совпадает: " + name, "%s ≠ %s" % (len(reader.pages), pages))

    # --- четыре отдельных возрастных бланка согласий ---------------------------
    processing_names = ["soglasie-na-obrabotku-pd.pdf", "soglasie-na-obrabotku-pd-do-14.pdf"]
    processing_text = {}
    for name in processing_names:
        reader, body = text_of(name)
        p_variant = norm(body)
        processing_text[name] = p_variant
        check(len(reader.pages) == 1, "одна страница: " + name, len(reader.pages))
        resources = reader.pages[0].get("/Resources") or {}
        xobjects = resources.get("/XObject") or {}
        images = [obj for obj in xobjects.values()
                  if obj.get_object().get("/Subtype") == "/Image"]
        check(not images, "нет изображений-подписей: " + name)
        check("СОГЛАСИЕ" in p_variant and "на использование и обработку персональных данных" in p_variant,
              "согласие на обработку названо: " + name)
        check("152-ФЗ" in p_variant, "есть ссылка на 152-ФЗ: " + name)
        check("940802781550" not in p_variant and "784304154610" in p_variant,
              "оператор — Ильин Б. П., Сирик не указан: " + name)
        check("30 дней" in p_variant, "срок прекращения обработки — 30 дней: " + name)
        check("уточнение (обновление, изменение)" in p_variant,
              "перечень операций сохраняет обновление и изменение: " + name)
        check("информационная система сайта и электронная почта" in p_variant,
              "указаны автоматизированные средства обработки: " + name)
        check("пересылка почтой" in p_variant,
              "цель включает выдачу карты лично или почтой: " + name)
        check("отдельное согласие на распространение" in p_variant,
              "обработка не смешана с распространением: " + name)
        check("сфотограф" not in p_variant and "загрузите" not in p_variant and "личном кабинете" not in p_variant,
              "в бланке нет инструкций по фото и загрузке: " + name)
        check("E-mail аккаунта автора" in p_variant,
              "контактное поле автора без длинной инструкции: " + name)
        check("Подпись" in p_variant and "Расшифровка подписи" in p_variant,
              "есть строки подписи и расшифровки: " + name)

    processing_adult = processing_text[processing_names[0]]
    processing_child = processing_text[processing_names[1]]
    check("14 лет и старше" in processing_adult and "14–17 лет" in processing_adult,
          "вариант от 14 лет отдельно описывает подпись автора и представителя")
    check("младше 14 лет" in processing_child and "Подпись законного представителя" in processing_child,
          "для младше 14 лет согласие подписывает законный представитель")
    check("№ 178" in processing_adult and "№ 178" in processing_child,
          "ссылка на типовую форму РКН есть в обоих вариантах обработки")

    distribution_names = ["soglasie-na-rasprostranenie-pd.pdf", "soglasie-na-rasprostranenie-pd-do-14.pdf"]
    distribution_text = {}
    for name in distribution_names:
        reader, body = text_of(name)
        sp_variant = norm(body)
        distribution_text[name] = sp_variant
        check(len(reader.pages) == 1, "одна страница: " + name, len(reader.pages))
        check("10.1" in sp_variant, "ссылка на статью 10.1: " + name)
        check("smenakontenta.ru" in sp_variant, "сайт указан как ресурс распространения: " + name)
        for title, url in social_links():
            check(url in sp_variant, "площадка в согласии " + title + ": " + name, url)
        check("Объём разрешения" in sp_variant and "сайт и площадки проекта" in sp_variant,
              "отдельно указан объём разрешения: " + name)
        check("Условия и запреты" in sp_variant and "[ ] разрешаю" in sp_variant and "[ ] не разрешаю" in sp_variant,
              "есть перечень категорий и условия распространения: " + name)
        check("трёх рабочих дней" in sp_variant,
              "срок прекращения распространения — три рабочих дня: " + name)
        check("сфотограф" not in sp_variant and "загрузите" not in sp_variant and "личном кабинете" not in sp_variant,
              "в бланке нет инструкций по фото и загрузке: " + name)
        check("Подпись" in sp_variant and "Расшифровка подписи" in sp_variant,
              "есть строки подписи и расшифровки: " + name)

    distribution_adult = distribution_text[distribution_names[0]]
    distribution_child = distribution_text[distribution_names[1]]
    check("14 лет и старше" in distribution_adult and "Подпись автора" in distribution_adult,
          "вариант распространения от 14 лет подписывает автор")
    check("младше 14 лет" in distribution_child and "Подпись законного представителя" in distribution_child,
          "вариант распространения младше 14 лет подписывает представитель")

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

    # --- оформление: гриф утверждения и подписи операторов ----------------------
    for name in ["politika-konfidencialnosti.pdf", "polzovatelskoe-soglashenie.pdf"]:
        _, body = text_of(name)
        check("УТВЕРЖДЕНО" in body, "гриф УТВЕРЖДЕНО: " + name)
        check("подпись и дата" in body, "подписи сторон в документе: " + name)
    for name in processing_names + distribution_names:
        _, body = text_of(name)
        check("Подпись" in body and "Расшифровка подписи" in body,
              "бланк содержит рукописную подпись и расшифровку: " + name)
        if "obrabotku" in name:
            check("№ 178" in body, "ссылка на типовую форму РКН: " + name)
        else:
            check("10.1" in body, "основание — статья 10.1: " + name)
    check("продлён" in tm and "отозвать" in tm, "у карты есть продление и отзыв")

    # --- оформление: без колонтитулов и служебных приписок ---------------------
    banned = [
        "ПРЕСС-КИТ · ВЕРСИЯ",
        "Молодёжное медиа · медиашкола · сообщество авторов",
        "Приложение №",
        "проверяет юрист",
        "Дата версии — в колонтитуле",
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
