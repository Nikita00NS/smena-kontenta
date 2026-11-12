#!/usr/bin/env python3
"""Переносит данные проекта из tools/docs/project.json в assets/js/data.js.

Сайт и документы должны называть оператора, директора и почту одинаково.
Источник один — project.json. Этот скрипт обновляет блок SC.project в data.js
между метками; ИНН и служебные пометки на сайт не попадают.

Запуск:   python3 tools/docs/sync-project.py
Проверка: python3 tools/docs/sync-project.py --check   (код 1, если data.js устарел)
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "tools", "docs", "project.json")
DST = os.path.join(ROOT, "assets", "js", "data.js")
BEGIN = "  /* project:begin — блок собирается из tools/docs/project.json, руками не править */\n"
END = "  /* project:end */\n"
ANCHOR = "  brand: {\n"

# что нельзя показывать на сайте: ИНН — личные данные, пометки — служебные
PRIVATE = {"inn", "addressNote", "_readme", "status"}


def public(value):
    if isinstance(value, dict):
        return {k: public(v) for k, v in value.items() if k not in PRIVATE}
    return value


def block(project):
    body = json.dumps(public(project), ensure_ascii=False, indent=2)
    body = "\n".join("  " + line for line in body.split("\n"))
    return BEGIN + "  project: " + body.strip() + ",\n" + END


def main():
    with open(SRC, encoding="utf-8") as fh:
        project = json.load(fh)
    with open(DST, encoding="utf-8") as fh:
        js = fh.read()
    new_block = block(project)
    if BEGIN in js and END in js:
        start = js.index(BEGIN)
        stop = js.index(END) + len(END)
        updated = js[:start] + new_block + js[stop:]
    else:
        if js.count(ANCHOR) != 1:
            sys.exit("не нашёл место для блока project в data.js")
        updated = js.replace(ANCHOR, new_block + ANCHOR)
    if "--check" in sys.argv:
        if updated != js:
            sys.exit("data.js устарел: запустите python3 tools/docs/sync-project.py")
        print("data.js совпадает с project.json")
        return
    if updated != js:
        with open(DST, "w", encoding="utf-8") as fh:
            fh.write(updated)
        print("data.js обновлён из project.json")
    else:
        print("data.js уже актуален")


if __name__ == "__main__":
    main()
