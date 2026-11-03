#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка карты регионов для сайта «Смена контента».

Что делает скрипт:
  1. берёт GeoJSON с границами регионов России (источник — imsha/russia_geojson_regions_2021,
     см. tools/README.md);
  2. упрощает границы (алгоритм Дугласа — Пекера), чтобы файл весил десятки килобайт;
  3. проецирует координаты (равновеликая коническая проекция Альберса — «классическая» форма России);
  4. собирает компактный assets/js/map-data.js с SVG-путями + справочник регионов.

Запуск:  python3 tools/build-map.py путь/к/ru.json
Повторный запуск нужен только если меняются границы регионов.
"""

import json
import math
import os
import sys

# ---------------------------------------------------------------- справочники

FEDERAL_DISTRICTS = {
    "Центральный ФО": [
        "Белгородская область", "Брянская область", "Владимирская область",
        "Воронежская область", "Ивановская область", "Калужская область",
        "Костромская область", "Курская область", "Липецкая область",
        "Московская область", "Орловская область", "Рязанская область",
        "Смоленская область", "Тамбовская область", "Тверская область",
        "Тульская область", "Ярославская область", "Москва",
    ],
    "Северо-Западный ФО": [
        "Республика Карелия", "Республика Коми", "Архангельская область",
        "Вологодская область", "Калининградская область", "Ленинградская область",
        "Мурманская область", "Новгородская область", "Псковская область",
        "Санкт-Петербург", "Ненецкий АО",
    ],
    "Южный ФО": [
        "Республика Адыгея", "Республика Калмыкия", "Республика Крым",
        "Краснодарский край", "Астраханская область", "Волгоградская область",
        "Ростовская область",
    ],
    "Северо-Кавказский ФО": [
        "Республика Дагестан", "Республика Ингушетия", "Кабардино-Балкарская Республика",
        "Карачаево-Черкесская Республика", "Республика Северная Осетия — Алания",
        "Чеченская Республика", "Ставропольский край",
    ],
    "Приволжский ФО": [
        "Республика Башкортостан", "Республика Марий Эл", "Республика Мордовия",
        "Республика Татарстан", "Удмуртская Республика", "Чувашская Республика",
        "Пермский край", "Кировская область", "Нижегородская область",
        "Оренбургская область", "Пензенская область", "Самарская область",
        "Саратовская область", "Ульяновская область",
    ],
    "Уральский ФО": [
        "Курганская область", "Свердловская область", "Тюменская область",
        "Челябинская область", "Ханты-Мансийский АО — Югра", "Ямало-Ненецкий АО",
    ],
    "Сибирский ФО": [
        "Республика Алтай", "Республика Тыва", "Республика Хакасия",
        "Алтайский край", "Красноярский край", "Иркутская область",
        "Кемеровская область - Кузбасс", "Новосибирская область", "Омская область",
        "Томская область",
    ],
    "Дальневосточный ФО": [
        "Республика Бурятия", "Республика Саха (Якутия)", "Забайкальский край",
        "Камчатский край", "Приморский край", "Хабаровский край",
        "Амурская область", "Магаданская область", "Сахалинская область",
        "Еврейская АО", "Чукотский АО",
    ],
}

# короткие названия для подписей на карте и в списках
SHORT = {
    "Республика Саха (Якутия)": "Якутия",
    "Республика Северная Осетия — Алания": "Северная Осетия",
    "Кемеровская область - Кузбасс": "Кузбасс",
    "Ханты-Мансийский АО — Югра": "Ханты-Мансийский АО",
    "Республика Башкортостан": "Башкортостан",
    "Республика Татарстан": "Татарстан",
    "Республика Дагестан": "Дагестан",
    "Республика Бурятия": "Бурятия",
    "Республика Крым": "Крым",
    "Чувашская Республика": "Чувашия",
    "Удмуртская Республика": "Удмуртия",
    "Республика Марий Эл": "Марий Эл",
    "Республика Мордовия": "Мордовия",
    "Республика Калмыкия": "Калмыкия",
    "Республика Адыгея": "Адыгея",
    "Республика Тыва": "Тыва",
    "Республика Хакасия": "Хакасия",
    "Республика Алтай": "Алтай",
    "Республика Карелия": "Карелия",
    "Республика Коми": "Коми",
    "Республика Ингушетия": "Ингушетия",
    "Кабардино-Балкарская Республика": "Кабардино-Балкария",
    "Карачаево-Черкесская Республика": "Карачаево-Черкесия",
    "Чеченская Республика": "Чечня",
    "Еврейская АО": "Еврейская АО",
    "Ненецкий АО": "Ненецкий АО",
    "Ямало-Ненецкий АО": "ЯНАО",
    "Чукотский АО": "Чукотка",
    "Хабаровский край": "Хабаровский край",
}

TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify(name):
    out = []
    for ch in name.lower():
        if ch in TRANSLIT:
            out.append(TRANSLIT[ch])
        elif ch.isalnum() and ch.isascii():
            out.append(ch)
        else:
            out.append("-")
    slug = "".join(out)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")


# ---------------------------------------------------------------- гео-математика

def albers(lon, lat, lon0=100.0, lat0=55.0, lat1=50.0, lat2=70.0):
    """Равновеликая коническая проекция Альберса. Возвращает (x, y) в радианах-ish."""
    if lon < 0:
        lon += 360.0  # перенос Чукотки через 180-й меридиан
    p1, p2 = math.radians(lat1), math.radians(lat2)
    n = 0.5 * (math.sin(p1) + math.sin(p2))
    c = math.cos(p1) ** 2 + 2 * n * math.sin(p1)
    rho = math.sqrt(max(c - 2 * n * math.sin(math.radians(lat)), 0)) / n
    rho0 = math.sqrt(max(c - 2 * n * math.sin(math.radians(lat0)), 0)) / n
    theta = n * math.radians(lon - lon0)
    return rho * math.sin(theta), rho0 - rho * math.cos(theta)


def perp_dist(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, tol):
    """Дуглас — Пекер (итеративный, чтобы не упасть на рекурсии)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        dmax, idx = 0.0, i
        for k in range(i + 1, j):
            d = perp_dist(points[k], points[i], points[j])
            if d > dmax:
                dmax, idx = d, k
        if dmax > tol:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(points, keep) if k]


def ring_area(points):
    s = 0.0
    for i in range(len(points) - 1):
        s += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1]
    return abs(s) / 2.0


def project(points):
    return [albers(lon, lat) for lon, lat in points]


EXTRA_REGIONS = [
    {"name": "Севастополь", "short": "Севастополь", "slug": "sevastopol", "district": "Южный ФО"},
    {"name": "Донецкая Народная Республика", "short": "ДНР", "slug": "donetskaya-narodnaya-respublika", "district": "Южный ФО"},
    {"name": "Луганская Народная Республика", "short": "ЛНР", "slug": "luganskaya-narodnaya-respublika", "district": "Южный ФО"},
    {"name": "Запорожская область", "short": "Запорожская обл.", "slug": "zaporozhskaya-oblast", "district": "Южный ФО"},
    {"name": "Херсонская область", "short": "Херсонская обл.", "slug": "khersonskaya-oblast", "district": "Южный ФО"},
]


def main():
    if len(sys.argv) < 2:
        print("usage: build-map.py <ru.json>")
        sys.exit(1)

    data = json.load(open(sys.argv[1], encoding="utf-8"))
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    district_of = {}
    for dist, names in FEDERAL_DISTRICTS.items():
        for n in names:
            district_of[n] = dist

    TOL = 0.035          # градусы: чем больше, тем грубее контур
    MIN_AREA = 0.02      # отбрасываем совсем мелкие острова

    regions = []
    all_xy = []
    prepared = []

    for feat in data["features"]:
        name = feat["properties"]["name"]
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]

        rings = []
        for poly in polys:
            for ring in poly:  # внешние + дырки; дырки игнорируем визуально
                pts = [(lon, lat) for lon, lat in ring]
                if ring_area(pts) < MIN_AREA:
                    continue
                simp = simplify(pts, TOL)
                if len(simp) < 3:
                    continue
                rings.append((ring_area(simp), simp))

        if not rings:
            continue
        rings.sort(key=lambda r: -r[0])
        rings = rings[:6]  # самое крупное + несколько островов

        prepared.append((name, rings))

    # первая проекция для общего bounding box
    for name, rings in prepared:
        for _, ring in rings:
            all_xy.extend(project(ring))

    xs = [p[0] for p in all_xy]
    ys = [p[1] for p in all_xy]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)

    W = 1000.0
    scale = W / (maxx - minx)
    H = (maxy - miny) * scale

    def to_svg(x, y):
        return ((x - minx) * scale, (maxy - y) * scale)

    used_district = set()
    for name, rings in prepared:
        d_parts = []
        for _, ring in rings:
            xy = [to_svg(x, y) for x, y in project(ring)]
            d_parts.append("M" + " ".join(
                f"{x:.1f} {y:.1f}" for x, y in xy) + "Z")
        district = district_of.get(name, "")
        if district:
            used_district.add(district)
        regions.append({
            "name": name,
            "short": SHORT.get(name, name),
            "slug": slugify(name),
            "district": district,
            "d": "".join(d_parts),
        })

    # Регионы, которых нет в геоданных 2021 года. Контуров у них пока нет,
    # но страницы, авторы и редакции работать должны.
    for extra in EXTRA_REGIONS:
        if extra["name"] not in {r["name"] for r in regions}:
            regions.append({
                "name": extra["name"],
                "short": extra["short"],
                "slug": extra["slug"],
                "district": extra["district"],
                "d": "",
                "noShape": True,
            })

    regions.sort(key=lambda r: r["name"])
    missing = [n for n in district_of if n not in {r["name"] for r in regions}]

    out_js = os.path.join(root, "assets", "js", "map-data.js")
    with open(out_js, "w", encoding="utf-8") as f:
        f.write("/* Автоматически собранный файл. Не редактируйте вручную.\n"
                "   Источник границ: imsha/russia_geojson_regions_2021 (см. tools/README.md).\n"
                "   Пересборка: python3 tools/build-map.py путь/к/ru.json */\n")
        f.write("window.RU_MAP = {\n")
        f.write('  viewBox: "0 0 %.1f %.1f",\n' % (W, H))
        f.write('  regions: [\n')
        for r in regions:
            extra = ",noShape:true" if r.get("noShape") else ""
            f.write("    {name:%s,short:%s,slug:%s,district:%s,d:%s%s},\n" % (
                json.dumps(r["name"], ensure_ascii=False),
                json.dumps(r["short"], ensure_ascii=False),
                json.dumps(r["slug"], ensure_ascii=False),
                json.dumps(r["district"], ensure_ascii=False),
                json.dumps(r["d"]),
                extra,
            ))
        f.write("  ]\n};\n")

    size = os.path.getsize(out_js) / 1024
    print(f"регионов: {len(regions)}  ->  {out_js} ({size:.0f} KB)")
    print(f"viewBox: 0 0 {W:.0f} {H:.0f}")
    print("округов:", len(used_district))
    if missing:
        print("ВНИМАНИЕ, нет в геоданных:", ", ".join(missing))


main()
