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

# Самовосстановление версии. Кэш хостинга и браузера держит старый HTML
# по ключу URL: человек видит прежний интерфейс, хотя файлы уже новые.
# Каждая страница при загрузке сверяет сборку data.js, полученную С СЕРВЕРА
# (запрос со случайным ключом, мимо кэша), со своей; если она новее —
# страница сама перезагружается на адрес с ?v=новой сборки.
CHECKER = (
    '<script>/* smena-v-check */(function(){'
    'if(location.protocol==="file:")return;'
    'function go(f){try{if(sessionStorage.getItem("smena-v")===f)return;'
    'sessionStorage.setItem("smena-v",f);'
    'var u=new URL(location.href);u.searchParams.set("v",f);location.replace(u.href)}catch(e){}}'
    'function ck(){try{if(!window.SC||!window.SC.build)return false;'
    'if(typeof fetch!=="function")return true;'
    'fetch("/assets/js/data.js?nc="+Date.now(),{cache:"no-store"})'
    '.then(function(r){return r.text()})'
    '.then(function(t){var m=t.match(/build\\s*:\\s*"([^"]+)"/);'
    'if(m&&m[1]&&m[1]!==window.SC.build)go(m[1])}).catch(function(){});'
    'return true}catch(e){return true}}'
    'var n=0;(function w(){if(ck()||++n>20)return;setTimeout(w,150)})()})();</script>'
)
injected = 0
for base, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "assets"}]
    for name in files:
        if not name.endswith(".html"):
            continue
        hp = os.path.join(base, name)
        with open(hp, encoding="utf-8") as fh:
            html = fh.read()
        if "smena-v-check" in html or "</body>" not in html:
            continue
        html = html.replace("</body>", CHECKER + "</body>", 1)
        with open(hp, "w", encoding="utf-8") as fh:
            fh.write(html)
        injected += 1
if injected:
    print("самопроверка версии добавлена в страницы:", injected)

print("версия", BUILD, "— обновлено страниц:", changed)
