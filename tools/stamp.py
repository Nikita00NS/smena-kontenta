#!/usr/bin/env python3
"""Проставляет версию к ссылкам на CSS и JS во всех страницах.

Запускать перед каждой выкладкой: python3 tools/stamp.py 2026-11-05-1
Нужно, чтобы после обновления сайта браузер не показывал старый интерфейс.
"""
import os
import re
import sys

BUILD = sys.argv[1] if len(sys.argv) > 1 else "dev"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERN = re.compile(r'(/assets/(?:css|js)/[\w.\-]+\.(?:css|js))(\?v=[^"\']*)?')

changed = 0
for base, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "assets"}]
    for name in files:
        if not name.endswith(".html"):
            continue
        path = os.path.join(base, name)
        with open(path, encoding="utf-8") as fh:
            html = fh.read()
        new = PATTERN.sub(lambda m: m.group(1) + "?v=" + BUILD, html)
        if new != html:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(new)
            changed += 1
print("версия", BUILD, "— обновлено страниц:", changed)
