#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка файлов логотипа из одного исходника.

    python3 tools/make-logo.py путь/к/логотипу.png

Скрипт делает:
  assets/img/logo.png            белый логотип с прозрачным фоном (шапка, подвал, пресс-карта)
  assets/img/logo-dark.png       чёрный логотип с прозрачным фоном (PDF, печать)
  assets/img/logo-mark.png       только знак без надписи (фавиконки, аватарки)
  assets/img/favicon.png         128 px, знак на чёрном квадрате
  assets/img/favicon-32.png      32 px
  assets/img/apple-touch-icon.png 180 px

Подходит любой исходник: PNG с прозрачностью, белый логотип на чёрном фоне
или чёрный логотип на белом. Прозрачность вычисляется автоматически.
"""

import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "img")


def mask_from(im):
    """Возвращает альфа-канал: прозрачность фона, даже если её нет в файле."""
    im = im.convert("RGBA")
    alpha = im.getchannel("A")
    lo, hi = alpha.getextrema()
    if lo < 250 and hi > 5:
        return alpha  # в файле уже есть прозрачность

    gray = im.convert("L")
    lo, hi = gray.getextrema()
    corners = [gray.getpixel(p) for p in
               ((0, 0), (gray.width - 1, 0), (0, gray.height - 1),
                (gray.width - 1, gray.height - 1))]
    background_is_light = sum(corners) / 4 > 127
    return gray.point(lambda p: 255 - p) if background_is_light else gray


def columns(alpha, threshold=12):
    """Группы столбцов, в которых есть содержимое."""
    runs, start = [], None
    w, h = alpha.size
    for x in range(w + 1):
        filled = False
        if x < w:
            filled = alpha.crop((x, 0, x + 1, h)).getextrema()[1] > threshold
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            runs.append((start, x))
            start = None
    return runs


def tinted(alpha, color):
    out = Image.new("RGBA", alpha.size, color + (0,))
    out.putalpha(alpha)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT, "logo.png")
    if not os.path.exists(src):
        sys.exit("Не найден файл: " + src)

    im = Image.open(src)
    alpha = mask_from(im)
    box = alpha.getbbox()
    if not box:
        sys.exit("В файле не нашлось изображения")
    alpha = alpha.crop(box)

    os.makedirs(OUT, exist_ok=True)

    full = tinted(alpha, (255, 255, 255))
    full.save(os.path.join(OUT, "logo.png"), optimize=True)
    tinted(alpha, (12, 12, 12)).save(os.path.join(OUT, "logo-dark.png"), optimize=True)
    print("logo.png       %dx%d   (полный логотип)" % full.size)

    # знак — первая группа столбцов слева, если частей несколько
    runs = columns(alpha)
    mark = alpha
    min_gap = max(20, int(alpha.width * 0.03))
    for i in range(len(runs) - 1):
        gap = runs[i + 1][0] - runs[i][1]
        if gap >= min_gap and runs[i][1] > alpha.width * 0.1:
            mark = alpha.crop((0, 0, runs[i][1], alpha.height))
            break
    mark_box = mark.getbbox()
    if mark_box:
        mark = mark.crop(mark_box)
    if "--mark-only" not in sys.argv:
        tinted(mark, (255, 255, 255)).save(os.path.join(OUT, "logo-mark.png"), optimize=True)

    def icon(size, pad_ratio=0.17):
        """Знак по центру тёмного квадрата: так иконка читается и на светлой,
        и на тёмной панели браузера."""
        pad = max(2, round(size * pad_ratio))
        inner = size - pad * 2
        mh, mw = inner, round(mark.width * inner / mark.height)
        if mw > inner:
            mw, mh = inner, round(mark.height * inner / mark.width)
        small = mark.resize((mw, mh), Image.LANCZOS)
        out = Image.new("RGB", (size, size), (10, 10, 10))
        out.paste(small, ((size - mw) // 2, (size - mh) // 2), small)
        return out

    # Полный набор: поисковики просят значки, кратные 48 px, иначе иконка
    # в выдаче не показывается. 128 и 32 оставлены для старых браузеров.
    for size in (16, 32, 48, 96, 128, 192, 512):
        icon(size).save(os.path.join(OUT, "favicon-%d.png" % size), optimize=True)
    icon(128).save(os.path.join(OUT, "favicon.png"), optimize=True)
    icon(32, 0.19).save(os.path.join(OUT, "favicon-32.png"), optimize=True)
    icon(180, 0.2).save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)

    # /favicon.ico в корне: его браузер спрашивает сам, ещё до чтения разметки
    icon(48).save(os.path.join(ROOT, "favicon.ico"),
                  sizes=[(16, 16), (32, 32), (48, 48)])

    # манифест: иконка для «добавить на главный экран» на телефоне
    manifest = {
        "name": "Смена контента",
        "short_name": "Смена",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0a0a0a",
        "theme_color": "#0a0a0a",
        "icons": [
            {"src": "/assets/img/favicon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/assets/img/favicon-512.png", "sizes": "512x512", "type": "image/png"},
        ],
    }
    with open(os.path.join(ROOT, "site.webmanifest"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print("logo.png       %dx%d" % full.size)
    print("logo-mark.png  %dx%d" % mark.size)
    print("фавиконки: 16, 32, 48, 96, 128, 192, 512, apple 180, favicon.ico, манифест")
    print("готово — можно обновлять страницы")


if __name__ == "__main__":
    main()
