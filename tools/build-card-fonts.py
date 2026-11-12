#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Шрифты для серверного PDF пресс-карты.

Сайт уже носит Golos Text двумя подмножествами (латиница и кириллица) в woff2.
Для PDF нужен один TTF на начертание: скрипт объединяет подмножества, сохраняет
TTF рядом с PDF-движком и кладёт.metrics JSON (карта символов и ширины), чтобы
PHP не разбирал таблицы шрифта на каждом запросе.

Запуск из корня проекта:
    pip install fonttools brotli
    python3 tools/build-card-fonts.py

Результат:
    api/lib/fonts/golos-text-regular.ttf / .json
    api/lib/fonts/golos-text-bold.ttf    / .json

Лицензия шрифта — SIL OFL 1.1, текст в api/lib/fonts/OFL.txt.
"""

import json
import os
import sys

from fontTools.merge import Merger
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "api", "lib", "fonts")

WEIGHTS = {
    "regular": "400",
    "bold": "700",
}

# Символы, которые обязаны быть в шрифте для карты и инструкций к печати.
REQUIRED = (
    "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"
    "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    "0123456789"
    " .,:;!?-–—()[]«»\"'/\\№×·%"
)


def build(name, weight):
    latin = os.path.join(SRC, f"golos-text-latin-{weight}-normal.woff2")
    cyrillic = os.path.join(SRC, f"golos-text-cyrillic-{weight}-normal.woff2")
    for path in (latin, cyrillic):
        if not os.path.isfile(path):
            raise SystemExit("Нет исходного шрифта: " + path)

    font = Merger().merge([latin, cyrillic])
    font.flavor = None
    cmap = font.getBestCmap()
    missing = sorted({ch for ch in REQUIRED if ord(ch) not in cmap})
    if missing:
        raise SystemExit("В шрифте не хватает символов: " + "".join(missing))

    ttf_path = os.path.join(OUT, f"golos-text-{name}.ttf")
    font.save(ttf_path)

    # Перечитываем сохранённый файл: метрики должны соответствовать именно тому
    # TTF, который уйдёт в PDF, а не промежуточному объекту в памяти.
    saved = TTFont(ttf_path)
    cmap = saved.getBestCmap()
    glyph_order = saved.getGlyphOrder()
    gid_by_name = {name: gid for gid, name in enumerate(glyph_order)}
    hmtx = saved["hmtx"].metrics
    head = saved["head"]
    hhea = saved["hhea"]
    os2 = saved["OS/2"]
    units = head.unitsPerEm
    widths = {}
    for gid, glyph in enumerate(glyph_order):
        advance = hmtx.get(glyph, (units, 0))[0]
        widths[str(gid)] = round(advance * 1000 / units)

    metrics = {
        "unitsPerEm": units,
        "ascent": round(hhea.ascent * 1000 / units),
        "descent": round(hhea.descent * 1000 / units),
        "capHeight": round(getattr(os2, "sCapHeight", hhea.ascent) * 1000 / units),
        "bbox": [
            round(head.xMin * 1000 / units),
            round(head.yMin * 1000 / units),
            round(head.xMax * 1000 / units),
            round(head.yMax * 1000 / units),
        ],
        "italicAngle": float(saved["post"].italicAngle),
        "widths": widths,
        # getBestCmap() возвращает имена глифов, а PDF нужен числовой GID.
        "cmap": {str(cp): gid_by_name[glyph] for cp, glyph in cmap.items()},
    }
    with open(os.path.join(OUT, f"golos-text-{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(metrics, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{name}: {len(cmap)} символов, {os.path.getsize(ttf_path)} байт TTF")


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, weight in WEIGHTS.items():
        build(name, weight)
    license_path = os.path.join(OUT, "OFL.txt")
    if not os.path.isfile(license_path):
        raise SystemExit("Нет лицензии шрифта: " + license_path)


if __name__ == "__main__":
    main()
