#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Дымовая проверка продакшена после FTP-выкладки.

Только чтение: главная, /verify, статика с новой версией, PDF согласий,
публичный API и запрет служебных файлов. Не создаёт аккаунты и не пишет данные.
Запуск: python3 tools/production-smoke.py --base https://smenakontenta.ru --stamp 2026-11-12-03
"""
import argparse
import json
import ssl
import sys
import time
import urllib.error
import urllib.request

UA = "smena-deploy-smoke/1.0"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=25, context=ssl.create_default_context()) as r:
            return r.status, r.read(), ""
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, body, ""
    except Exception as e:
        return None, b"", str(e)


def checks(base, stamp):
    out = []

    def add(name, ok, detail=""):
        out.append((name, bool(ok), detail))

    code, body, err = fetch(base + "/")
    text = body.decode("utf-8", "replace")
    add("главная отдаётся и содержит версию " + stamp, code == 200 and stamp in text, err or ("HTTP %s" % code))

    code, body, err = fetch(base + "/verify/")
    text = body.decode("utf-8", "replace")
    add("/verify/ отдаётся с новой версией", code == 200 and 'data-page="verify"' in text and stamp in text,
        err or ("HTTP %s" % code))

    code, body, err = fetch(base + "/assets/js/data.js?v=" + stamp)
    text = body.decode("utf-8", "replace")
    add("data.js содержит рабочую почту проекта", code == 200 and "info@smenakontenta.ru" in text,
        err or ("HTTP %s" % code))

    for name in ("soglasie-na-obrabotku-pd.pdf", "soglasie-na-rasprostranenie-pd.pdf"):
        code, body, err = fetch(base + "/assets/docs/" + name)
        add("PDF отдаётся: " + name, code == 200 and body.startswith(b"%PDF"), err or ("HTTP %s" % code))

    code, body, err = fetch(base + "/api/index.php?action=state")
    ok = False
    detail = err or ("HTTP %s" % code)
    if code == 200:
        try:
            ok = json.loads(body.decode("utf-8", "replace")).get("ok") is True
            detail = "JSON ok"
        except Exception as e:
            detail = "не JSON: " + str(e)
    add("публичный API state отвечает ok", ok, detail)

    for path in ("/api/lib/pdf.php", "/api/lib/private-media.php", "/api/lib/fonts/golos-text-regular.ttf"):
        code, body, err = fetch(base + path)
        add("служебный файл закрыт: " + path, code in (403, 404), err or ("HTTP %s" % code))

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://smenakontenta.ru")
    ap.add_argument("--stamp", default="2026-11-12-03")
    ap.add_argument("--attempts", type=int, default=6)
    ap.add_argument("--delay", type=int, default=15)
    args = ap.parse_args()
    base = args.base.rstrip("/")

    last = []
    for attempt in range(1, args.attempts + 1):
        last = checks(base, args.stamp)
        failed = [x for x in last if not x[1]]
        print("Попытка %d/%d: %d/%d проверок пройдено" % (attempt, args.attempts, len(last) - len(failed), len(last)))
        for name, ok, detail in last:
            print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else " → " + detail))
        if not failed:
            print("Продакшен отвечает: версия на месте, документы и API доступны, служебные файлы закрыты.")
            return 0
        if attempt < args.attempts:
            time.sleep(args.delay)
    print("Продакшен не прошёл дымовую проверку после %d попыток." % args.attempts)
    return 1


if __name__ == "__main__":
    sys.exit(main())
