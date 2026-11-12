/* Быстрая проверка синтаксиса PHP без установленного PHP.
   Запуск:  node tools/tests/php-syntax.js api/index.php api/lib/*.php
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

let files = process.argv.slice(2);
if (!files.length) {
  files = ["api/index.php", "api/smtp.php"].concat(
    fs.readdirSync(path.resolve(__dirname, "..", "..", "api", "lib"))
      .filter((name) => name.endsWith(".php"))
      .sort()
      .map((name) => "api/lib/" + name)
  );
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
