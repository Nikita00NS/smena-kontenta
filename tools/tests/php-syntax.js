/* Быстрая проверка синтаксиса PHP без установленного PHP.
   Запуск:  node tools/tests/php-syntax.js            (все файлы api/)
            node tools/tests/php-syntax.js api/index.php  (один файл)
   Требует: npm i php-parser (ставится вместе с php-wasm для api-checks.js) */
const fs = require("fs");
const path = require("path");

let parser;
try {
  parser = require("php-parser");
} catch (e) {
  console.log("Нужен пакет php-parser: npm i php-parser (из папки tools/tests)");
  process.exit(2);
}

const engine = parser.create({
  parser: { extractDoc: true, php7: true },
  ast: { withPositions: false },
});

/* Без аргументов проверяем все PHP-файлы приёмной: раньше список был
   вписан руками, и новые библиотеки в проверку не попадали. */
let files = process.argv.slice(2);
if (!files.length) {
  const root = path.resolve(__dirname, "..", "..");
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) return e.name === "data" ? [] : walk(rel);
    return e.name.endsWith(".php") ? [rel] : [];
  });
  files = walk("api").sort();
}

let bad = 0;
for (const file of files) {
  const full = path.resolve(__dirname, "..", "..", file);
  if (!fs.existsSync(full)) {
    console.log("нет файла:", file);
    bad++;
    continue;
  }
  try {
    engine.parseCode(fs.readFileSync(full, "utf8"));
    console.log("OK  ", file);
  } catch (err) {
    bad++;
    console.log("FAIL", file, "—", err.message);
  }
}
process.exit(bad ? 1 : 0);
