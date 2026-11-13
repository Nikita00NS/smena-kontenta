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
PATTERN = re.compile(r'(/assets/(?:css|js|docs)/[\w.\-]+\.(?:css|js|pdf))(\?v=[^"\']*)?')

changed = 0
targets = []
for base, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "assets"}]
    for name in files:
        if name.endswith(".html"):
            targets.append(os.path.join(base, name))
js_dir = os.path.join(ROOT, "assets", "js")
if os.path.isdir(js_dir):
    for name in os.listdir(js_dir):
        if name.endswith(".js"):
            targets.append(os.path.join(js_dir, name))
for path in targets:
    with open(path, encoding="utf-8") as fh:
        html = fh.read()
    new = PATTERN.sub(lambda m: m.group(1) + "?v=" + BUILD, html)
    if new != html:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(new)
        changed += 1

# Версия сборки также живёт в data.js: её видит админка и подвал — так сразу
# понятно, какой интерфейс перед глазами, без догадок про кэш браузера.
data_path = os.path.join(ROOT, "assets", "js", "data.js")
with open(data_path, encoding="utf-8") as fh:
    data = fh.read()
new = re.sub(r'(build:\s*")[^"]*(")', r"\g<1>" + BUILD + r"\g<2>", data, count=1)
if new != data:
    with open(data_path, "w", encoding="utf-8") as fh:
        fh.write(new)
    print("версия в data.js обновлена")

print("версия", BUILD, "— обновлено страниц:", changed)
