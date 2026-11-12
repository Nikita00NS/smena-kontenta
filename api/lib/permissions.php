<?php
/* ============================================================================
   ПРАВА: роли, полномочия и проверка на сервере.

   Зачем отдельный файл: раньше в маршрутах стояли списки ролей строками
   («Директор», «Администрация»), и добавление новой роли требовало правки
   в десятке мест. Здесь одна таблица: роль → полномочия.

   Правило: интерфейс может что-то скрывать, но решение всегда принимает
   сервер. Любая новая функция сначала получает полномочие здесь.
   ========================================================================== */

/* Роли. Первые пять — исторические (уже стоят у людей), остальные — новые. */
const ROLE_LEVELS = array(
    'Сооснователь' => 100,
    'Директор' => 95,
    'Главный администратор' => 90,
    'Администрация' => 85,
    'Администратор' => 80,
    'Центральная редакция' => 70,
    'Редакционный администратор региона' => 60,
    'Редакционный основатель' => 55,
    'Руководитель региональной редакции' => 50,
    'Руководитель отдела' => 45,
    'Главный редактор' => 65,
    'Редактор' => 40,
    'Технический администратор' => 78,
    'Сотрудник' => 20,
    'Автор' => 12,
    'Преподаватель' => 35,
    'Модератор' => 30,
    'Участник' => 10,
    'Пользователь' => 5,
);

/* Полные наборы полномочий. Номер роли нужен только для сравнения
   старшинства и НЕ наследует права другой должности: технический
   администратор не становится редактором или кадровиком автоматически. */
const ROLE_CAPS = array(
    'Сооснователь' => array('*'),
    'Директор' => array(
        'people.view', 'people.edit', 'people.access', 'people.block', 'people.note',
        'posts.review', 'posts.remove', 'portfolio.review',
        'editorials.manage', 'editorials.appoint', 'editorials.review', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.extend', 'cards.template',
        'school.manage', 'school.teach', 'school.review', 'school.enroll',
        'docs.manage', 'docs.publish', 'consents.review',
        'points.award', 'points.rule',
        'support.answer', 'recovery.issue',
        'mail.manage', 'mail.use', 'site.manage', 'server.diag', 'audit.view',
    ),
    'Главный администратор' => array(
        'people.view', 'people.edit', 'people.access', 'people.block', 'people.note',
        'posts.review', 'posts.remove', 'portfolio.review', 'editorials.manage', 'editorials.appoint', 'editorials.review', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.extend', 'cards.template',
        'school.manage', 'school.teach', 'school.review', 'school.enroll',
        'docs.manage', 'consents.review', 'points.award', 'support.answer', 'recovery.issue',
        'mail.manage', 'mail.use', 'site.manage', 'server.diag', 'audit.view',
    ),
    'Администрация' => array(
        'people.view', 'people.edit', 'people.access', 'people.block', 'people.note',
        'posts.review', 'posts.remove', 'portfolio.review', 'editorials.manage', 'editorials.appoint', 'editorials.review', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.extend', 'cards.template',
        'school.manage', 'school.teach', 'school.review', 'school.enroll',
        'docs.manage', 'consents.review', 'points.award', 'support.answer', 'recovery.issue',
        'mail.manage', 'mail.use', 'site.manage', 'server.diag', 'audit.view',
    ),
    /* Администратор ведёт людей и карты, но не трогает почту, сайт,
       настройки сервера и документы проекта. */
    'Администратор' => array(
        'people.view', 'people.edit', 'people.block', 'people.note',
        'posts.review', 'portfolio.review', 'cards.view', 'cards.issue', 'cards.extend',
        'school.enroll', 'points.award', 'support.answer', 'audit.view',
    ),
    'Центральная редакция' => array(
        'people.view', 'posts.review', 'posts.remove', 'portfolio.review', 'mail.use', 'support.answer',
        'editorials.manage', 'editorials.appoint', 'editorials.review', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.template',
        'school.manage', 'school.review', 'docs.manage', 'consents.review', 'points.award', 'audit.view',
    ),
    'Редакционный администратор региона' => array(
        'people.view', 'posts.review', 'portfolio.review', 'cards.view', 'cards.issue', 'cards.extend',
    ),
    'Редакционный основатель' => array('people.view', 'posts.review', 'portfolio.review', 'editorials.review', 'mail.use'),
    'Руководитель региональной редакции' => array(
        'people.view', 'posts.review', 'portfolio.review', 'editorials.manage', 'editorials.review', 'school.enroll', 'mail.use',
    ),
    'Руководитель отдела' => array('people.view', 'posts.review', 'portfolio.review', 'mail.use'),
    'Редактор' => array('people.view', 'posts.review', 'portfolio.review', 'mail.use'),
    'Главный редактор' => array(
        'people.view', 'people.edit', 'people.note',
        'posts.review', 'posts.remove', 'portfolio.review', 'editorials.manage', 'editorials.appoint', 'editorials.review', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.extend', 'cards.template',
        'school.manage', 'school.teach', 'school.review', 'school.enroll',
        'docs.manage', 'points.award', 'support.answer', 'audit.view',
    ),
    /* Технический администратор отвечает за сервер и почту, но не за людей:
       так он не может выдать себе роль или снять редактора. */
    'Технический администратор' => array(
        'people.view', 'server.diag', 'site.manage', 'mail.manage', 'mail.use',
        'audit.view', 'docs.manage',
    ),
    'Сотрудник' => array(),
    'Автор' => array(),
    'Преподаватель' => array('people.view', 'school.teach', 'school.review'),
    'Модератор' => array('people.view', 'posts.review', 'portfolio.review', 'support.answer'),
    'Участник' => array(),
    'Пользователь' => array(),
);

function role_caps($role) {
    if (!isset(ROLE_CAPS[$role])) return array();
    return ROLE_CAPS[$role];
}

function role_level($role) {
    return isset(ROLE_LEVELS[$role]) ? ROLE_LEVELS[$role] : 0;
}

/* Персональные разрешения: у человека в users.json может лежать
   perms: {"+": ["cards.issue"], "-": ["posts.remove"]} — точечно сверх роли. */
function user_caps($user) {
    if (!$user) return array();
    $role = isset($user['access']) ? $user['access'] : 'Пользователь';
    $caps = role_caps($role);
    $set = array();
    foreach ($caps as $c) $set[$c] = true;
    if (isset($user['perms']['+']) && is_array($user['perms']['+'])) {
        foreach ($user['perms']['+'] as $c) if (is_string($c)) $set[$c] = true;
    }
    if (isset($user['perms']['-']) && is_array($user['perms']['-'])) {
        foreach ($user['perms']['-'] as $c) if (is_string($c)) unset($set[$c]);
    }
    return array_keys($set);
}

function can($user, $cap) {
    if (!$user) return false;
    $caps = user_caps($user);
    return in_array('*', $caps, true) || in_array($cap, $caps, true);
}

function can_any($user, $list) {
    foreach ($list as $cap) if (can($user, $cap)) return true;
    return false;
}

/* Требование к маршруту: вернуть ошибку 403, если полномочия нет. */
function require_cap($dir, $in, $cap) {
    $user = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, $cap)) fail('Недостаточно прав: нужно «' . $cap . '».', 403);
    return $user;
}

/* Можно ли этому человеку управлять той ролью/человеком.
   Сооснователь и директор — верхний уровень; остальные не поднимают
   никого выше себя и не снимают равных. */
function can_manage_role($me, $targetRole) {
    if (!can($me, 'people.access')) return false;
    $my = role_level(isset($me['access']) ? $me['access'] : '');
    $theirs = role_level((string) $targetRole);
    if ($my >= ROLE_LEVELS['Сооснователь']) return true;
    return $theirs <= $my;
}

function can_manage_user($me, $target) {
    if (!$me || !$target) return false;
    if ((string) $me['id'] === (string) $target['id']) return true;
    $my = role_level(isset($me['access']) ? $me['access'] : '');
    $theirs = role_level(isset($target['access']) ? $target['access'] : '');
    /* равного или старшего не трогаем, кроме верхнего уровня */
    if ($my >= ROLE_LEVELS['Сооснователь']) return true;
    return $theirs < $my;
}

function roles_list() {
    $out = array();
    foreach (ROLE_LEVELS as $name => $level) $out[] = $name;
    return $out;
}

function public_capabilities($user) {
    return array(
        'role' => isset($user['access']) ? $user['access'] : 'Пользователь',
        'level' => role_level(isset($user['access']) ? $user['access'] : ''),
        'caps' => user_caps($user),
    );
}
