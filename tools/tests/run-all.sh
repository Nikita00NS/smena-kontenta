#!/usr/bin/env bash
# Все проверки проекта подряд. Останавливается на первой провалившейся.
# Запуск из корня репозитория: bash tools/tests/run-all.sh
set -e -o pipefail
cd "$(dirname "$0")/../.."
export NODE_PATH="${NODE_PATH:-/tmp/sk-tests/node_modules}"

step() { echo; echo "=== $1 ==="; }

step "Синтаксис PHP";            node tools/tests/php-syntax.js | tail -1
step "Переводы";                 node tools/tests/i18n-check.js | tail -1
step "Данные проекта на сайте";  python3 tools/docs/sync-project.py --check
if python3 -c "import reportlab, pypdf" 2>/dev/null; then
  step "Документы";              python3 tools/docs/build.py --check | tail -1
else
  step "Документы";              echo "пропущено: нет пакетов reportlab и pypdf (pip install reportlab pypdf)"
fi
step "Страницы";                 node tools/tests/pages-smoke.js | tail -1
step "Сервер";                   (cd tools/tests && node api-checks.js | tail -1)
step "Интерфейс";                node tools/tests/ui-checks.js | tail -1
echo; echo "Все проверки пройдены."
