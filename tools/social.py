#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Единый список площадок проекта для сборки документов.

Адреса живут в коде сайта: assets/js/data.js → SC.brand.social. Генераторы
PDF берут их отсюда, чтобы список в документах и в подвале не расходился.
"""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, "assets", "js", "data.js")


def links():
    """Пары (название, адрес) в том порядке, в каком они идут в подвале сайта."""
    with open(DATA_JS, encoding="utf-8") as fh:
        src = fh.read()
    start = src.find("social: [")
    if start < 0:
        raise SystemExit("В assets/js/data.js не найден список brand.social.")
    block = src[start:src.find("],", start)]
    pairs = re.findall(r'title:\s*"([^"]+)"[^}]*?url:\s*"([^"]+)"', block, re.S)
    if not pairs:
        raise SystemExit("В brand.social не разобраны площадки: проверьте формат списка.")
    return pairs


if __name__ == "__main__":
    for title, url in links():
        print(title, "—", url)
