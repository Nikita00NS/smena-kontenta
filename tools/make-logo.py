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

import os
import sys

from PIL import Image

OUT = os.path.join("assets", "img")


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
    tinted(mark, (255, 255, 255)).save(os.path.join(OUT, "logo-mark.png"), optimize=True)

    for size, pad, name in ((128, 22, "favicon.png"),
                            (32, 6, "favicon-32.png"),
                            (180, 34, "apple-touch-icon.png")):
        inner = size - pad * 2
        mh, mw = inner, round(mark.width * inner / mark.height)
        if mw > inner:
            mw, mh = inner, round(mark.height * inner / mark.width)
        small = mark.resize((mw, mh), Image.LANCZOS)
        icon = Image.new("RGB", (size, size), (10, 10, 10))
        icon.paste(small, ((size - mw) // 2, (size - mh) // 2), small)
        icon.save(os.path.join(OUT, name), optimize=True)

    print("logo.png       %dx%d" % full.size)
    print("logo-mark.png  %dx%d" % mark.size)
    print("фавиконки: 128, 32, 180 px")
    print("готово — можно обновлять страницы")


if __name__ == "__main__":
    main()
