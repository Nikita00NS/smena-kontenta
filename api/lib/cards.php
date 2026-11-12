<?php
/* ============================================================================
   ПРЕСС-КАРТА

   Пластик больше не печатается и не рассылается: карта — это запись на
   сервере и документ «О присвоении пресс-карты» с номером, сроком и двумя
   подписями. Подлинность проверяется по номеру на странице /verify.

   Состояния:
     pending    — заявка на рассмотрении;
     issued     — выдана, действует год;
     expired    — срок вышел (вычисляется, в файле остаётся issued);
     suspended  — приостановлена;
     revoked    — отозвана;
     rejected   — в заявке отказано;
     annulled   — заменена новой картой.

   Состояние карты для кабинета, админки и проверки считает одна функция —
   card_state(). Раньше кабинет читал карту из браузера, а панель с сервера,
   и они расходились.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

const CARD_RENEW_DAYS = 30;   // за сколько дней до конца срока можно подать на продление

function card_min_posts() {
    return 5;
}

function read_cards($dir) {
    $cards = read_json($dir . '/cards.json', array());
    return is_array($cards) ? $cards : array();
}

function write_cards($dir, $cards) {
    return write_json($dir . '/cards.json', $cards);
}

function card_number_next($cards, $year) {
    $max = 0;
    foreach ($cards as $c) {
        if (empty($c['number'])) continue;
        if (preg_match('/(\d+)$/', (string) $c['number'], $m)) {
            $max = max($max, (int) $m[1]);
        }
    }
    return 'СК-' . $year . '-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
}

function card_valid_until($card) {
    if (!empty($card['validUntil'])) return (string) $card['validUntil'];
    /* карты, выданные до появления срока: год от даты выдачи */
    $from = !empty($card['issuedAt']) ? $card['issuedAt'] : (!empty($card['decidedAt']) ? $card['decidedAt'] : '');
    $ts = $from !== '' ? strtotime((string) $from) : false;
    return $ts ? date('c', strtotime('+1 year', $ts)) : '';
}

function card_state($card) {
    $status = isset($card['status']) ? (string) $card['status'] : 'pending';
    if ($status === 'issued') {
        $until = card_valid_until($card);
        if ($until !== '' && strtotime($until) < time()) return 'expired';
    }
    return $status;
}

function card_history_add(&$card, $action, $by, $note = '') {
    if (!isset($card['history']) || !is_array($card['history'])) $card['history'] = array();
    $card['history'][] = array(
        'at' => date('c'),
        'action' => $action,
        'by' => text($by, 120),
        'note' => text($note, 400),
    );
    if (count($card['history']) > 60) $card['history'] = array_slice($card['history'], -60);
}

/* Карта человека для показа: сначала документ (запись с номером), потом
   заявка без номера. Одна и та же функция для кабинета, списка участников
   и карточки человека. */
function cards_of_user($cards, $userId) {
    $mine = array();
    foreach ($cards as $c) {
        if (isset($c['userId']) && (string) $c['userId'] === (string) $userId) $mine[] = $c;
    }
    usort($mine, function ($a, $b) {
        return strcmp((string) (isset($b['createdAt']) ? $b['createdAt'] : ''), (string) (isset($a['createdAt']) ? $a['createdAt'] : ''));
    });
    return $mine;
}

function card_current($mine) {
    $live = null;
    $doc = null;
    $request = null;
    foreach ($mine as $c) {
        $status = isset($c['status']) ? $c['status'] : '';
        if (!empty($c['number'])) {
            if ($live === null && in_array($status, array('issued', 'suspended'), true)) $live = $c;
            if ($doc === null) $doc = $c;
        } elseif ($request === null) {
            $request = $c;
        }
    }
    $card = $live !== null ? $live : $doc;
    /* заявка, которая старше действующей карты, уже отработана */
    if ($card && $request && strcmp((string) $request['createdAt'], (string) $card['createdAt']) < 0) $request = null;
    return array('card' => $card, 'request' => $request);
}

function public_card($card) {
    if (!$card) return null;
    return array(
        'id' => $card['id'],
        'state' => card_state($card),
        'status' => isset($card['status']) ? $card['status'] : 'pending',
        'number' => isset($card['number']) ? $card['number'] : '',
        'note' => isset($card['note']) ? $card['note'] : '',
        'byRole' => !empty($card['byRole']),
        'renewal' => !empty($card['renewal']),
        'createdAt' => isset($card['createdAt']) ? $card['createdAt'] : '',
        'decidedAt' => isset($card['decidedAt']) ? $card['decidedAt'] : '',
        'issuedAt' => isset($card['issuedAt']) ? $card['issuedAt'] : '',
        'validUntil' => !empty($card['number']) ? card_valid_until($card) : '',
        'posts' => isset($card['posts']) && is_array($card['posts']) ? $card['posts'] : array(),
    );
}

function staff_card($card, $user, $contacts) {
    $out = public_card($card);
    $out['userId'] = isset($card['userId']) ? $card['userId'] : '';
    $out['name'] = $user ? $user['name'] : (isset($card['authorName']) ? $card['authorName'] : '');
    $out['region'] = $user && isset($user['region']) ? $user['region'] : (isset($card['authorRegion']) ? $card['authorRegion'] : '');
    $out['craft'] = $user && isset($user['role']) ? $user['role'] : (isset($card['authorRole']) ? $card['authorRole'] : '');
    $out['access'] = $user && isset($user['access']) ? $user['access'] : '';
    $email = $user && isset($user['email']) ? (string) $user['email'] : '';
    $out['email'] = $contacts ? $email : mask_email($email);
    $out['userNumber'] = $user && isset($user['number']) ? (int) $user['number'] : 0;
    $out['issuedBy'] = isset($card['issuedBy']) ? $card['issuedBy'] : '';
    $out['history'] = isset($card['history']) && is_array($card['history']) ? array_slice($card['history'], -20) : array();
    return $out;
}

function card_in_scope($scope, $card, $usersById) {
    if ($scope === null) return true;
    $uid = isset($card['userId']) ? (string) $card['userId'] : '';
    return $uid !== '' && isset($usersById[$uid]) && user_in_scope($scope, $usersById[$uid]);
}

function card_published_posts($dir, $userId) {
    $mine = array();
    foreach (read_json($dir . '/posts.json', array()) as $post) {
        if (!isset($post['authorId']) || (string) $post['authorId'] !== (string) $userId) continue;
        if (!isset($post['status']) || $post['status'] !== 'published') continue;
        $mine[] = $post;
    }
    usort($mine, function ($a, $b) {
        return strcmp((string) (isset($b['date']) ? $b['date'] : ''), (string) (isset($a['date']) ? $a['date'] : ''));
    });
    return $mine;
}

/* Можно ли подать заявку и почему нет. Тот же ответ видит кабинет — кнопка
   и подсказка не расходятся с тем, что решит сервер. */
function card_apply_check($dir, $me, $cards = null) {
    if ($cards === null) $cards = read_cards($dir);
    $published = count(card_published_posts($dir, $me['id']));
    $byRole = isset($me['access']) && (string) $me['access'] !== '' && (string) $me['access'] !== 'Пользователь';
    $need = card_min_posts();
    $current = card_current(cards_of_user($cards, $me['id']));
    $out = array('can' => false, 'why' => '', 'renewal' => false, 'published' => $published,
        'byRole' => $byRole, 'minPosts' => $need);

    if ($current['request'] && $current['request']['status'] === 'pending') {
        $out['why'] = 'Заявка уже отправлена и ждёт решения редакции.';
        return $out;
    }
    if ($current['card']) {
        $state = card_state($current['card']);
        if ($state === 'suspended') {
            $out['why'] = 'Карта приостановлена. Новую заявку подать нельзя — напишите в поддержку.';
            return $out;
        }
        if ($state === 'issued') {
            $left = (strtotime(card_valid_until($current['card'])) - time()) / 86400;
            if ($left > CARD_RENEW_DAYS) {
                $out['why'] = 'У вас действующая пресс-карта ' . $current['card']['number'] .
                    '. Продление открывается за ' . CARD_RENEW_DAYS . ' дней до конца срока.';
                return $out;
            }
            $out['renewal'] = true;
        }
        if ($state === 'expired') $out['renewal'] = true;
    }
    if (empty($me['emailVerified'])) {
        $out['why'] = 'Сначала подтвердите почту.';
        return $out;
    }
    if (!consent_ok($dir, $me)) {
        $out['why'] = 'Нужно принятое согласие на обработку персональных данных — вкладка «Документы».';
        return $out;
    }
    if (!$byRole && $published < $need) {
        $out['why'] = 'Для заявки нужно ' . $need . ' опубликованных материалов. Сейчас: ' . $published . '.';
        return $out;
    }
    $out['can'] = true;
    return $out;
}

/* Выдача: номер, срок на год, прежняя карта человека заменяется. */
function card_issue(&$cards, $id, $me, $note) {
    $now = date('c');
    $userId = isset($cards[$id]['userId']) ? (string) $cards[$id]['userId'] : '';
    foreach ($cards as $k => $other) {
        if ($k === $id || $userId === '' || !isset($other['userId']) || (string) $other['userId'] !== $userId) continue;
        if (!in_array(isset($other['status']) ? $other['status'] : '', array('issued', 'suspended'), true)) continue;
        $cards[$k]['status'] = 'annulled';
        $cards[$k]['note'] = 'Заменена новой картой.';
        $cards[$k]['decidedAt'] = $now;
        card_history_add($cards[$k], 'annulled', $me['name'], 'выдана новая карта');
    }
    $cards[$id]['number'] = card_number_next($cards, date('Y'));
    $cards[$id]['status'] = 'issued';
    $cards[$id]['note'] = $note;
    $cards[$id]['decidedAt'] = $now;
    $cards[$id]['issuedAt'] = $now;
    $cards[$id]['validUntil'] = date('c', strtotime('+1 year'));
    $cards[$id]['issuedBy'] = $me['name'];
    $cards[$id]['issuedById'] = $me['id'];
    $cards[$id]['issuedByRole'] = isset($me['access']) ? $me['access'] : '';
    card_history_add($cards[$id], 'issued', $me['name'], $note);
}

/* Латинские C и K в номере набирают чаще кириллических — приводим к одному виду. */
function card_number_normalize($raw) {
    $s = supper(trim((string) $raw));
    $s = strtr($s, array('C' => 'С', 'K' => 'К', '–' => '-', '—' => '-', '№' => '', ' ' => ''));
    if (preg_match('/^(\d{4})-?(\d{1,4})$/', $s, $m)) {
        $s = 'СК-' . $m[1] . '-' . str_pad($m[2], 4, '0', STR_PAD_LEFT);
    }
    if (preg_match('/^СК-?(\d{4})-?(\d{1,4})$/u', $s, $m)) {
        $s = 'СК-' . $m[1] . '-' . str_pad($m[2], 4, '0', STR_PAD_LEFT);
    }
    return $s;
}

function cards_routes($act, $dir) {
    $handled = array('card-status', 'card-apply', 'card-queue', 'card-review', 'card-grant',
        'card-suspend', 'card-restore', 'card-revoke', 'card-extend', 'card-verify', 'card-doc',
        'card-request');
    if (!in_array($act, $handled, true)) return false;
    $in = body();

    /* Заявка без аккаунта («по ключу автора») закрыта: карта выдаётся
       человеку, а не браузеру. */
    if ($act === 'card-request') {
        fail('Заявка на пресс-карту подаётся из личного кабинета, вкладка «Пресс-карта».', 410);
    }

    /* Проверка подлинности: открыта всем, отвечает только на точный номер. */
    if ($act === 'card-verify') {
        check_rate_for($dir, 'verify', client_ip(), 60,
            'Слишком много проверок подряд. Попробуйте через час.');
        $raw = isset($in['number']) ? $in['number'] : (isset($_GET['number']) ? $_GET['number'] : '');
        $number = card_number_normalize(text($raw, 40));
        if (!preg_match('/^СК-\d{4}-\d{4}$/u', $number)) {
            fail('Номер карты выглядит так: СК-2026-0001.');
        }
        $found = null;
        foreach (read_cards($dir) as $c) {
            if (!empty($c['number']) && card_number_normalize($c['number']) === $number) { $found = $c; break; }
        }
        if (!$found) {
            respond(array('ok' => true, 'found' => false, 'number' => $number));
        }
        $holder = null;
        foreach (read_users($dir) as $u) {
            if (isset($found['userId']) && $u['id'] === $found['userId']) $holder = $u;
        }
        $state = card_state($found);
        $gone = !$holder || (isset($holder['status']) && $holder['status'] === 'deleted');
        $editorial = '';
        if ($holder && !empty($holder['editorialId'])) {
            foreach (read_editorials($dir) as $e) {
                if ($e['id'] === $holder['editorialId']) $editorial = $e['name'];
            }
        }
        respond(array(
            'ok' => true,
            'found' => true,
            'number' => $found['number'],
            'state' => $gone ? 'revoked' : $state,
            'valid' => !$gone && $state === 'issued',
            /* у недействующей карты имя не показываем: документ ничего не подтверждает */
            'name' => !$gone && in_array($state, array('issued', 'suspended', 'expired'), true) ? $holder['name'] : '',
            'role' => !$gone && $state === 'issued' && isset($holder['role']) ? $holder['role'] : '',
            'region' => !$gone && $state === 'issued' && isset($holder['region']) ? $holder['region'] : '',
            'editorial' => !$gone && $state === 'issued' ? $editorial : '',
            'issuedAt' => isset($found['issuedAt']) ? $found['issuedAt'] : '',
            'validUntil' => card_valid_until($found),
        ));
    }

    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);

    if ($act === 'card-status') {
        $cards = read_cards($dir);
        $mine = cards_of_user($cards, $me['id']);
        $current = card_current($mine);
        $check = card_apply_check($dir, $me, $cards);
        $all = array();
        foreach ($mine as $c) $all[] = public_card($c);
        respond(array(
            'ok' => true,
            'card' => public_card($current['card']),
            'request' => public_card($current['request']),
            'requests' => $all,
            'minPosts' => $check['minPosts'],
            'published' => $check['published'],
            'byRole' => $check['byRole'],
            'consentOk' => consent_ok($dir, $me),
            'canApply' => $check['can'],
            'renewal' => $check['renewal'],
            'why' => $check['why'],
        ));
    }

    if ($act === 'card-apply') {
        require_verified($me);
        require_consent($dir, $me);
        $cards = read_cards($dir);
        $check = card_apply_check($dir, $me, $cards);
        if (!$check['can']) fail($check['why'] !== '' ? $check['why'] : 'Заявку сейчас подать нельзя.', 409);

        $attached = array();
        foreach (array_slice(card_published_posts($dir, $me['id']), 0, 20) as $post) {
            $attached[] = array(
                'id' => $post['id'],
                'number' => isset($post['number']) ? (int) $post['number'] : 0,
                'title' => $post['title'],
                'date' => isset($post['date']) ? $post['date'] : '',
                'region' => isset($post['region']) ? $post['region'] : '',
            );
        }
        $now = date('c');
        $id = new_id('c_');
        $cards[$id] = array(
            'id' => $id,
            'userId' => $me['id'],
            'authorName' => $me['name'],
            'authorRegion' => isset($me['region']) ? $me['region'] : '',
            'authorRole' => isset($me['role']) ? $me['role'] : '',
            'byRole' => $check['byRole'],
            'renewal' => $check['renewal'],
            'posts' => $attached,
            'status' => 'pending',
            'number' => '',
            'note' => '',
            'createdAt' => $now,
            'decidedAt' => '',
            'issuedAt' => '',
            'validUntil' => '',
            'history' => array(),
        );
        card_history_add($cards[$id], 'applied', $me['name'], $check['renewal'] ? 'продление' : '');
        if (!write_cards($dir, $cards)) fail('Не удалось сохранить заявку.', 500);
        respond(array('ok' => true, 'request' => public_card($cards[$id])));
    }

    if ($act === 'card-doc') {
        $id = text(isset($in['id']) ? $in['id'] : '', 40);
        $cards = read_cards($dir);
        if ($id === '') {
            $current = card_current(cards_of_user($cards, $me['id']));
            if ($current['card']) $id = $current['card']['id'];
        }
        if ($id === '' || !isset($cards[$id])) fail('Карта не найдена.', 404);
        $card = $cards[$id];
        $usersById = array();
        foreach (read_users($dir) as $u) $usersById[$u['id']] = $u;
        $own = isset($card['userId']) && (string) $card['userId'] === (string) $me['id'];
        if (!$own) {
            if (!can($me, 'cards.view')) fail('Документ о карте видит её владелец и редакция.', 403);
            if (!card_in_scope(staff_scope($me), $card, $usersById)) {
                fail('Эта карта — не в вашей редакции.', 403);
            }
        }
        if (empty($card['number'])) fail('Документ появится, когда карта будет выдана.', 409);
        $holder = isset($card['userId'], $usersById[$card['userId']]) ? $usersById[$card['userId']] : null;
        $editorial = '';
        if ($holder && !empty($holder['editorialId'])) {
            foreach (read_editorials($dir) as $e) {
                if ($e['id'] === $holder['editorialId']) $editorial = $e['name'];
            }
        }
        $state = card_state($card);
        respond(array(
            'ok' => true,
            'card' => public_card($card),
            'holder' => array(
                'name' => $holder ? $holder['name'] : (isset($card['authorName']) ? $card['authorName'] : ''),
                'region' => $holder && isset($holder['region']) ? $holder['region'] : '',
                'craft' => $holder && isset($holder['role']) ? $holder['role'] : '',
                'access' => $holder && isset($holder['access']) ? $holder['access'] : '',
                'editorial' => $editorial,
                'number' => $holder && isset($holder['number']) ? (int) $holder['number'] : 0,
            ),
            'issuedBy' => isset($card['issuedBy']) ? $card['issuedBy'] : '',
            'byRole' => !empty($card['byRole']),
            'own' => $own,
            'canPrint' => in_array($state, array('issued', 'expired', 'suspended'), true),
        ));
    }

    /* ------------------------------------------------------------ редакция */

    $usersById = array();
    foreach (read_users($dir) as $u) $usersById[$u['id']] = $u;
    $scope = staff_scope($me);

    if ($act === 'card-queue') {
        if (!can_any($me, array('cards.view', 'cards.issue'))) fail('Карты видит редакция.', 403);
        $out = array();
        $counts = array('pending' => 0, 'issued' => 0, 'suspended' => 0, 'expired' => 0);
        foreach (read_cards($dir) as $card) {
            if (!card_in_scope($scope, $card, $usersById)) continue;
            $user = isset($card['userId'], $usersById[$card['userId']]) ? $usersById[$card['userId']] : null;
            if ($user && isset($user['status']) && $user['status'] === 'deleted') continue;
            $row = staff_card($card, $user, sees_contacts($me, $scope, $user));
            $row['consent'] = $user ? (consent_exempt($user) ? 'exempt' : (consent_ok($dir, $user) ? 'approved' : 'none')) : 'none';
            if (isset($counts[$row['state']])) $counts[$row['state']]++;
            $out[] = $row;
        }
        usort($out, function ($a, $b) {
            $pa = $a['state'] === 'pending' ? 0 : 1;
            $pb = $b['state'] === 'pending' ? 0 : 1;
            if ($pa !== $pb) return $pa - $pb;
            return $pa === 0
                ? strcmp((string) $a['createdAt'], (string) $b['createdAt'])
                : strcmp((string) $b['createdAt'], (string) $a['createdAt']);
        });
        respond(array('ok' => true, 'requests' => array_slice($out, 0, 500), 'counts' => $counts,
            'can' => array(
                'issue' => can($me, 'cards.issue'),
                'revoke' => can($me, 'cards.revoke'),
                'extend' => can($me, 'cards.extend'),
            )));
    }

    if ($act === 'card-review') {
        $me = require_confirm($dir, $in, 'cards.issue');
        if (!can($me, 'cards.issue')) fail('Решение по карте принимает редакция с правом выдачи.', 403);
        $id = isset($in['id']) ? (string) $in['id'] : '';
        $decision = isset($in['decision']) ? (string) $in['decision'] : '';
        $note = text(isset($in['note']) ? $in['note'] : '', 600);
        if ($decision !== 'approve' && $decision !== 'reject') fail('Неизвестное решение.');
        if ($decision === 'reject' && slen($note) < 5) fail('Для отказа нужна причина: автор увидит её в кабинете.');

        $cards = read_cards($dir);
        if (!isset($cards[$id])) fail('Заявка не найдена.', 404);
        $card = $cards[$id];
        if (!card_in_scope($scope, $card, $usersById)) fail('Эта заявка — не в вашей редакции.', 403);
        if ((isset($card['status']) ? $card['status'] : '') !== 'pending') fail('По этой заявке решение уже принято.', 409);
        if (isset($card['userId']) && (string) $card['userId'] === (string) $me['id']) {
            fail('Свою заявку рассматривает другой сотрудник.', 403);
        }
        $holder = isset($card['userId'], $usersById[$card['userId']]) ? $usersById[$card['userId']] : null;
        if (!$holder || (isset($holder['status']) && $holder['status'] === 'deleted')) {
            fail('Аккаунт автора удалён — карту выдать некому.', 409);
        }

        if ($decision === 'approve') {
            if (!consent_ok($dir, $holder)) {
                fail('У автора нет принятого согласия на обработку данных — карту выдать нельзя.', 409);
            }
            card_issue($cards, $id, $me, $note);
        } else {
            $cards[$id]['status'] = 'rejected';
            $cards[$id]['note'] = $note;
            $cards[$id]['decidedAt'] = date('c');
            card_history_add($cards[$id], 'rejected', $me['name'], $note);
        }
        if (!write_cards($dir, $cards)) fail('Не удалось сохранить решение.', 500);
        if ($decision === 'approve') {
            /* баллы за первую карту — один раз на человека */
            points_award_rule($dir, $holder['id'], 'card.issued', 'редакция',
                'Пресс-карта ' . $cards[$id]['number'], 'card-issued:' . $holder['id']);
        }
        audit_log($dir, (string) $me['email'], 'card-review',
            ($decision === 'approve' ? 'карта выдана ' . $cards[$id]['number'] . ' — ' : 'в заявке на карту отказано — ') . $holder['name']);
        notify_user($dir, $holder['id'], $decision === 'approve'
            ? 'Пресс-карта выдана: номер ' . $cards[$id]['number'] . ', действует до ' . date('d.m.Y', strtotime($cards[$id]['validUntil'])) . '. Документ о присвоении — в кабинете, вкладка «Пресс-карта».'
            : 'В заявке на пресс-карту отказано: ' . $note,
            array('kind' => 'card', 'ref' => 'card:' . $id . ':' . $decision));
        respond(array('ok' => true, 'request' => staff_card($cards[$id], $holder, sees_contacts($me, $scope, $holder))));
    }

    /* Карта по должности: без заявки, сразу выдана. */
    if ($act === 'card-grant') {
        if (!can($me, 'cards.issue')) {
            fail('Карту выдаёт редакция с правом выдачи.', 403);
        }
        $userId = text(isset($in['id']) ? $in['id'] : '', 40);
        $target = isset($usersById[$userId]) ? $usersById[$userId] : null;
        if (!$target || (isset($target['status']) && $target['status'] === 'deleted')) fail('Участник не найден.', 404);
        if (!user_in_scope($scope, $target)) fail('Этот участник — не в вашей редакции.', 403);
        if ((string) $target['id'] === (string) $me['id']) fail('Себе карту выдаёт другой сотрудник.', 403);
        if (!consent_ok($dir, $target)) {
            fail('У участника нет принятого согласия на обработку данных — карту выдать нельзя.', 409);
        }
        $cards = read_cards($dir);
        $current = card_current(cards_of_user($cards, $userId));
        if ($current['card'] && card_state($current['card']) === 'issued') {
            fail('У участника уже есть действующая карта: ' . $current['card']['number'], 409);
        }
        if ($current['card'] && card_state($current['card']) === 'suspended') {
            fail('Карта участника приостановлена: сначала возобновите или отзовите её.', 409);
        }
        $now = date('c');
        /* если ждала заявка — выдаём по ней, а не заводим вторую запись */
        if ($current['request'] && $current['request']['status'] === 'pending') {
            $cardId = $current['request']['id'];
        } else {
            $cardId = new_id('c_');
            $cards[$cardId] = array(
                'id' => $cardId,
                'userId' => $userId,
                'authorName' => $target['name'],
                'authorRegion' => isset($target['region']) ? $target['region'] : '',
                'authorRole' => isset($target['role']) ? $target['role'] : '',
                'byRole' => true,
                'posts' => array(),
                'status' => 'pending',
                'number' => '',
                'note' => '',
                'createdAt' => $now,
                'history' => array(),
            );
        }
        card_issue($cards, $cardId, $me, text(isset($in['note']) ? $in['note'] : '', 300));
        if (!write_cards($dir, $cards)) fail('Не удалось выдать карту.', 500);
        points_award_rule($dir, $userId, 'card.issued', 'редакция',
            'Пресс-карта ' . $cards[$cardId]['number'], 'card-issued:' . $userId);
        audit_log($dir, (string) $me['email'], 'card-grant', 'карта ' . $cards[$cardId]['number'] . ' — ' . $target['name']);
        notify_user($dir, $userId, 'Вам выдана пресс-карта: номер ' . $cards[$cardId]['number'] .
            ', действует до ' . date('d.m.Y', strtotime($cards[$cardId]['validUntil'])) . '. Документ — в кабинете, вкладка «Пресс-карта».',
            array('kind' => 'card', 'ref' => 'card:' . $cardId . ':grant'));
        respond(array('ok' => true, 'number' => $cards[$cardId]['number'],
            'card' => staff_card($cards[$cardId], $target, sees_contacts($me, $scope, $target))));
    }

    if (in_array($act, array('card-suspend', 'card-restore', 'card-revoke', 'card-extend'), true)) {
        $cap = $act === 'card-extend' ? 'cards.extend' : 'cards.revoke';
        /* отзыв и продление необратимы или меняют срок — под код из письма */
        if ($act === 'card-revoke' || $act === 'card-extend') {
            $me = require_confirm($dir, $in, $cap);
        }
        if (!can($me, $cap)) fail('Для этого действия нужно право «' . $cap . '».', 403);
        $id = isset($in['id']) ? (string) $in['id'] : '';
        $note = text(isset($in['note']) ? $in['note'] : '', 400);
        $cards = read_cards($dir);
        if (!isset($cards[$id]) || empty($cards[$id]['number'])) fail('Карта не найдена.', 404);
        if (!card_in_scope($scope, $cards[$id], $usersById)) fail('Эта карта — не в вашей редакции.', 403);
        if (isset($cards[$id]['userId']) && (string) $cards[$id]['userId'] === (string) $me['id']) {
            fail('Со своей картой работает другой сотрудник.', 403);
        }
        $state = card_state($cards[$id]);
        $holderId = isset($cards[$id]['userId']) ? $cards[$id]['userId'] : '';
        $number = $cards[$id]['number'];
        $message = '';

        if ($act === 'card-suspend') {
            if ($state !== 'issued') fail('Приостановить можно только действующую карту.', 409);
            if (slen($note) < 5) fail('Нужна причина приостановки.');
            $cards[$id]['status'] = 'suspended';
            $cards[$id]['note'] = $note;
            card_history_add($cards[$id], 'suspended', $me['name'], $note);
            $message = 'Пресс-карта ' . $number . ' приостановлена: ' . $note;
        }
        if ($act === 'card-restore') {
            if ((isset($cards[$id]['status']) ? $cards[$id]['status'] : '') !== 'suspended') {
                fail('Возобновить можно только приостановленную карту.', 409);
            }
            $cards[$id]['status'] = 'issued';
            $cards[$id]['note'] = '';
            card_history_add($cards[$id], 'restored', $me['name'], $note);
            $message = 'Пресс-карта ' . $number . ' снова действует.';
        }
        if ($act === 'card-revoke') {
            if (!in_array($state, array('issued', 'suspended', 'expired'), true)) fail('Эта карта уже не действует.', 409);
            if (slen($note) < 5) fail('Нужна причина отзыва.');
            $cards[$id]['status'] = 'revoked';
            $cards[$id]['note'] = $note;
            $cards[$id]['decidedAt'] = date('c');
            card_history_add($cards[$id], 'revoked', $me['name'], $note);
            $message = 'Пресс-карта ' . $number . ' отозвана: ' . $note;
        }
        if ($act === 'card-extend') {
            if (!in_array($state, array('issued', 'expired'), true)) fail('Продлить можно действующую или истёкшую карту.', 409);
            $from = max(time(), (int) strtotime(card_valid_until($cards[$id])));
            $cards[$id]['validUntil'] = date('c', strtotime('+1 year', $from));
            $cards[$id]['status'] = 'issued';
            card_history_add($cards[$id], 'extended', $me['name'], 'до ' . date('d.m.Y', strtotime($cards[$id]['validUntil'])));
            $message = 'Пресс-карта ' . $number . ' продлена до ' . date('d.m.Y', strtotime($cards[$id]['validUntil'])) . '.';
        }
        if (!write_cards($dir, $cards)) fail('Не удалось сохранить.', 500);
        audit_log($dir, (string) $me['email'], $act, $number . ($note !== '' ? ' — ' . $note : ''));
        if ($holderId !== '' && $message !== '') {
            notify_user($dir, $holderId, $message, array('kind' => 'card', 'ref' => $act . ':' . $id . ':' . date('YmdHi')));
        }
        $holder = isset($usersById[$holderId]) ? $usersById[$holderId] : null;
        respond(array('ok' => true, 'card' => staff_card($cards[$id], $holder, sees_contacts($me, $scope, $holder))));
    }

    return false;
}
