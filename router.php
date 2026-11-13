<?php
/* ============================================================================
   ЕДИНАЯ ТОЧКА ВХОДА ДЛЯ СТРАНИЦ САЙТА.
   Зачем: на хостинге перед сайтом стоит кэш, который держит старые копии
   статических страниц даже после выкладки — люди видят старый сайт, хотя
   файлы на сервере новые. Ответы PHP кэш не хранит, поэтому короткие адреса
   (/about, /school, …) теперь отдаются через этот роутер, мимо кэша.
   Роутер читает готовый HTML из папки страницы: содержимое то же самое,
   меняется только способ доставки.
   ========================================================================== */

$pages = array(
    'home', 'news', 'about', 'partners', 'region', 'media-school', 'school',
    'docs', 'poisk', 'join', 'profile', 'write', 'admin', 'article',
    'support', 'founders', 'verify',
);

$p = isset($_GET['p']) ? (string) $_GET['p'] : 'home';
if (!in_array($p, $pages, true)) {
    http_response_code(404);
    header('Content-Type: text/html; charset=UTF-8');
    readfile(__DIR__ . '/404.html');
    exit;
}

$file = __DIR__ . ($p === 'home' ? '/index.html' : '/' . $p . '/index.html');
if (!is_readable($file)) {
    http_response_code(404);
    header('Content-Type: text/html; charset=UTF-8');
    readfile(__DIR__ . '/404.html');
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
readfile($file);
