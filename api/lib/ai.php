<?php
/* ============================================================================
   ИИ-ПОМОЩНИК ПИСЕМ — один сервис: DeepSeek.

   Почему один: Gemini и Groq отвечают с российских адресов отказом 403,
   и три выбора только путали. DeepSeek работает из России без VPN,
   API совместим с OpenAI, ключ один (вида sk-…).

   Правила:
   • ключ хранится на сервере в smena-data/ai-settings.json и в браузер не
     возвращается — интерфейс знает только «ключ задан / не задан»;
   • помощник готовит текст, но ничего не отправляет: отправка только после
     явного нажатия человеком;
   • в запрос уходят только те поля письма, которые человек видит на экране.
     Ни паролей, ни токенов, ни данных других участников.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

function ai_file($dir) { return $dir . '/ai-settings.json'; }

function ai_settings($dir) {
    $saved = read_json(ai_file($dir), array());
    if (!is_array($saved)) $saved = array();
    return array(
        'provider' => 'deepseek',
        'key' => isset($saved['key']) ? (string) $saved['key'] : '',
        'model' => isset($saved['model']) ? (string) $saved['model'] : '',
        'updatedAt' => isset($saved['updatedAt']) ? (string) $saved['updatedAt'] : '',
        'lastTest' => isset($saved['lastTest']) && is_array($saved['lastTest']) ? $saved['lastTest'] : null,
        /* ключ на каждый сервис: если один сервис недоступен из России,
           помощник сам переключается на другой */
        'keys' => isset($saved['keys']) && is_array($saved['keys']) ? $saved['keys'] : array(),
    );
}

function ai_public($dir) {
    $cfg = ai_settings($dir);
    return array(
        'provider' => 'deepseek',
        'model' => $cfg['model'] !== '' ? $cfg['model'] : ai_default_model($cfg['provider']),
        'hasKey' => $cfg['key'] !== '',
        'ready' => $cfg['key'] !== '',
        'updatedAt' => $cfg['updatedAt'],
        'lastTest' => $cfg['lastTest'],
    );
}

function ai_default_model($provider = 'deepseek') {
    return 'deepseek-chat';
}

/* Задания помощника. Формулировки — по-русски и коротко: модель не должна
   додумывать факты, которых нет в письме. */
function ai_tasks() {
    return array(
        'compose' => array('label' => 'Составить письмо', 'prompt' => 'Составь деловое письмо по теме. Без вымышленных фактов, без обращений вроде «Уважаемый клиент», если имя неизвестно.'),
        'improve' => array('label' => 'Улучшить текст', 'prompt' => 'Улучши текст: яснее формулировки, короче предложения, тот же смысл. Не добавляй новых фактов.'),
        'spelling' => array('label' => 'Орфография и пунктуация', 'prompt' => 'Исправь орфографию, пунктуацию и согласование. Ничего не переписывай по смыслу.'),
        'official' => array('label' => 'Официальный тон', 'prompt' => 'Перепиши в официально-деловом тоне, без канцелярита и штампов.'),
        'friendly' => array('label' => 'Дружелюбный тон', 'prompt' => 'Перепиши дружелюбно и по-человечески, но без панибратства.'),
        'shorten' => array('label' => 'Сократить', 'prompt' => 'Сократи текст примерно вдвое, сохранив все важные сведения.'),
        'subject' => array('label' => 'Придумать тему', 'prompt' => 'Предложи три варианта темы письма, каждую до 60 знаков, без кликбейта. Ответь только темами, по одной в строке.'),
        'reply' => array('label' => 'Ответить на обращение', 'prompt' => 'Составь ответ на обращение: признай вопрос, дай понятный ответ по существу, предложи следующий шаг. Не обещай сроков, которых не указали.'),
        'business' => array('label' => 'Деловая переписка', 'prompt' => 'Составь короткое деловое письмо: суть, просьба, срок ответа.'),
        'translate_en' => array('label' => 'Перевести на английский', 'prompt' => 'Переведи на английский, сохранив тон и обращение.'),
        'translate_ru' => array('label' => 'Перевести на русский', 'prompt' => 'Переведи на русский, сохранив тон и обращение.'),
        'adapt' => array('label' => 'Подогнать под адресата', 'prompt' => 'Адаптируй письмо под адресата из поля «Кому»: если это автор — проще и теплее, если организация — суше и формальнее.'),
    );
}

/* Один запрос к выбранному бесплатному провайдеру. Возвращает текст или ошибку. */
function ai_provider_label($provider = 'deepseek') {
    return 'DeepSeek';
}

function ai_request_one($cfg, $system, $userText) {
    $key = isset($cfg['key']) ? (string) $cfg['key'] : '';
    $model = isset($cfg['model']) && $cfg['model'] !== '' ? $cfg['model'] : ai_default_model();
    if ($key === '') {
        return array('ok' => false, 'error' => 'Ключ DeepSeek не задан.', 'status' => 0);
    }

    /* DeepSeek полностью совместим с форматом OpenAI. */
    $url = 'https://api.deepseek.com/chat/completions';
    $payload = array(
        'model' => $model,
        'temperature' => 0.4,
        'max_tokens' => 900,
        'messages' => array(
            array('role' => 'system', 'content' => $system),
            array('role' => 'user', 'content' => $userText),
        ),
    );
    $headers = array('Content-Type: application/json', 'Authorization: Bearer ' . $key);

    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
    $answer = '';
    $status = 0;
    $error = '';

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => true,
        ));
        $answer = (string) curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($answer === '') $error = curl_error($ch);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(array(
            'http' => array(
                'method' => 'POST',
                'header' => implode("\r\n", $headers),
                'content' => $body,
                'timeout' => 45,
                'ignore_errors' => true,
            ),
            'ssl' => array('verify_peer' => true, 'verify_peer_name' => true),
        ));
        $answer = (string) @file_get_contents($url, false, $ctx);
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $status = (int) $m[1];
        }
        if ($answer === '') $error = 'Сервер помощника не ответил.';
    }

    if ($status >= 400 || $answer === '') {
        $short = '';
        $decoded = json_decode($answer, true);
        if (is_array($decoded) && isset($decoded['error'])) {
            $short = is_array($decoded['error'])
                ? (isset($decoded['error']['message']) ? (string) $decoded['error']['message'] : '')
                : (string) $decoded['error'];
        }
        $label = ai_provider_label($provider);
        return array('ok' => false, 'provider' => $provider, 'status' => $status,
            'error' => $error !== '' ? ($label . ': ' . $error)
            : ($label . ' ответил ошибкой ' . $status . ($short !== '' ? ': ' . substr($short, 0, 200) : '')));
    }

    $decoded = json_decode($answer, true);
    $text = '';
    if (isset($decoded['choices'][0]['message']['content'])) {
        $text = (string) $decoded['choices'][0]['message']['content'];
    }
    $text = trim($text);
    if ($text === '') {
        return array('ok' => false, 'error' => 'Помощник вернул пустой ответ. Попробуйте другую модель или повторите.');
    }
    return array('ok' => true, 'text' => $text, 'model' => $model, 'provider' => 'deepseek');
}

function ai_request($cfg, $system, $userText) {
    return ai_request_one($cfg, $system, $userText);
}

function ai_routes($act, $dir) {
    if (!in_array($act, array('ai-status', 'ai-save', 'ai-test', 'ai-assist'), true)) return false;
    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);

    if ($act === 'ai-status') {
        if (!can($me, 'mail.use')) fail('Помощник доступен редакции и администрации.', 403);
        respond(array('ok' => true, 'ai' => ai_public($dir), 'tasks' => ai_tasks(),
            'canManage' => can($me, 'mail.manage')));
    }

    if ($act === 'ai-save') {
        if (!can($me, 'mail.manage')) fail('Ключ помощника меняет только администрация.', 403);
        $saved = read_json(ai_file($dir), array());
        if (!is_array($saved)) $saved = array();
        $saved['provider'] = 'deepseek';
        if (isset($in['key']) && trim((string) $in['key']) !== '') {
            $saved['key'] = trim((string) $in['key']);
        }
        if (!empty($in['clearKey'])) $saved['key'] = '';
        /* Модель одна: deepseek-chat. Вторая (reasoner) — только по явному
           запросу, её ответы медленнее. */
        if (isset($in['model'])) {
            $model = (string) $in['model'];
            $saved['model'] = in_array($model, array('deepseek-chat', 'deepseek-reasoner'), true) ? $model : '';
        }
        $saved['updatedAt'] = date('c');
        if (!write_json(ai_file($dir), $saved)) fail('Настройки помощника не сохранились.', 500);
        audit_log($dir, $me['email'], 'ИИ-помощник', 'DeepSeek' . (!empty($saved['key']) ? ', ключ задан' : ', ключ пуст'));
        respond(array('ok' => true, 'note' => '', 'ai' => ai_public($dir)));
    }

    if ($act === 'ai-test') {
        if (!can($me, 'mail.manage')) fail('Проверка доступна администрации.', 403);
        $cfg = ai_settings($dir);
        if ($cfg['key'] === '') fail('Сначала впишите ключ.', 409);
        $res = ai_request($cfg, 'Ты проверка связи. Ответь одним словом: работает.', 'Проверка связи.');
        $saved = read_json(ai_file($dir), array());
        if (!is_array($saved)) $saved = array();
        $saved['lastTest'] = array('ok' => !empty($res['ok']),
            'error' => empty($res['ok']) ? $res['error'] : '',
            'at' => date('c'),
            'provider' => isset($res['provider']) ? $res['provider'] : $cfg['provider'],
            'model' => isset($res['model']) ? $res['model'] : '');
        write_json(ai_file($dir), $saved);
        if (empty($res['ok'])) fail($res['error'], 502);
        respond(array('ok' => true, 'answer' => $res['text'], 'ai' => ai_public($dir)));
    }

    if ($act === 'ai-assist') {
        if (!can($me, 'mail.use')) fail('Помощник доступен редакции и администрации.', 403);
        check_rate($dir);
        $cfg = ai_settings($dir);
        if ($cfg['key'] === '') {
            fail('Помощник не подключён: администрация впишет бесплатный ключ в разделе «Почта».', 409);
        }
        $tasks = ai_tasks();
        $task = (string) (isset($in['task']) ? $in['task'] : 'improve');
        if (!isset($tasks[$task])) fail('Такого задания нет.', 404);
        $subject = text((string) (isset($in['subject']) ? $in['subject'] : ''), 300);
        $bodyText = text((string) (isset($in['text']) ? $in['text'] : ''), 8000);
        $recipient = text((string) (isset($in['to']) ? $in['to'] : ''), 200);
        $hint = text((string) (isset($in['hint']) ? $in['hint'] : ''), 500);
        if ($bodyText === '' && $hint === '' && $task !== 'compose') fail('Нечего улучшать: напишите текст письма.');

        $system = 'Ты помощник редакции молодёжного медиа «Смена контента». Пишешь по-русски, ясно и по-деловому, '
            . 'без канцелярита, без кликбейта, без вымышленных фактов. Не добавляй обращений и подписей, которых не просили. '
            . 'Возвращай только готовый текст без пояснений и без разметки.';
        $userText = 'Задание: ' . $tasks[$task]['label'] . "\n" . $tasks[$task]['prompt'] . "\n";
        if ($recipient !== '') $userText .= "Кому: " . $recipient . "\n";
        if ($subject !== '') $userText .= "Тема: " . $subject . "\n";
        if ($bodyText !== '') $userText .= "Текст:\n" . $bodyText . "\n";
        if ($hint !== '') $userText .= "Пожелание автора: " . $hint . "\n";

        $res = ai_request($cfg, $system, $userText);
        if (empty($res['ok'])) fail($res['error'], 502);
        audit_log($dir, $me['email'], 'ИИ-помощник', 'задание: ' . $tasks[$task]['label']);
        respond(array('ok' => true, 'task' => $task, 'text' => $res['text'],
            'model' => isset($res['model']) ? $res['model'] : '',
            'note' => 'Это предложение, а не готовое письмо: проверьте и отправьте сами.'));
    }

    return true;
}
