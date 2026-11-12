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

/* Что роль умеет. Перечислены только отличия: всё, что ниже по уровню,
   получается наследованием — см. can(). */
const ROLE_CAPS = array(
    'Сооснователь' => array('*'),
    'Директор' => array(
        'people.view', 'people.edit', 'people.access', 'people.block', 'people.note',
        'posts.review', 'posts.remove',
        'editorials.manage', 'editorials.appoint', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.extend', 'cards.template',
        'school.manage', 'school.teach', 'school.review', 'school.enroll',
        'docs.manage', 'docs.publish',
        'points.award', 'points.rule',
        'support.answer', 'recovery.issue',
        'mail.manage', 'mail.use', 'site.manage', 'server.diag', 'audit.view',
        /* открыть редакцию в регионе решает только директор */
        'editorials.open',
    ),
    'Главный администратор' => array(
        'people.view', 'people.edit', 'people.access', 'people.block', 'people.note',
        'posts.review', 'posts.remove', 'editorials.manage', 'editorials.appoint', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.extend', 'cards.template',
        'school.manage', 'school.teach', 'school.review', 'school.enroll',
        'docs.manage', 'points.award', 'support.answer', 'recovery.issue',
        'mail.manage', 'mail.use', 'site.manage', 'server.diag', 'audit.view',
    ),
    'Администрация' => array(
        'people.view', 'people.edit', 'people.access', 'people.block', 'people.note',
        'posts.review', 'posts.remove', 'editorials.manage', 'editorials.appoint', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.extend', 'cards.template',
        'school.manage', 'school.teach', 'school.review', 'school.enroll',
        'docs.manage', 'points.award', 'support.answer', 'recovery.issue',
        'mail.manage', 'mail.use', 'site.manage', 'server.diag', 'audit.view',
        /* приём заявлений на открытие редакции: отметить, что подписанный
           документ пришёл на почту, или вернуть на доработку */
        'editorials.intake',
    ),
    /* Администратор ведёт людей и карты, но не трогает почту, сайт,
       настройки сервера и документы проекта. */
    'Администратор' => array(
        'people.view', 'people.edit', 'people.block', 'people.note',
        'posts.review', 'cards.view', 'cards.issue', 'cards.extend',
        'school.enroll', 'points.award', 'support.answer', 'audit.view',
        /* согласия на обработку данных — это паспорт и адрес человека,
           поэтому их видит узкий круг: от администратора и выше */
        'consents.review',
    ),
    'Центральная редакция' => array(
        'people.view', 'posts.review', 'posts.remove',
        'editorials.manage', 'editorials.appoint', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.template',
        'school.manage', 'school.review', 'docs.manage', 'points.award', 'audit.view',
    ),
    'Редакционный администратор региона' => array(
        'people.view', 'posts.review', 'cards.view', 'cards.issue', 'cards.extend',
    ),
    'Редакционный основатель' => array('people.view', 'posts.review'),
    'Руководитель региональной редакции' => array(
        'people.view', 'posts.review', 'editorials.manage', 'school.enroll',
    ),
    'Руководитель отдела' => array('people.view', 'posts.review'),
    'Редактор' => array('people.view', 'posts.review'),
    'Главный редактор' => array(
        'people.view', 'people.edit', 'people.note',
        'posts.review', 'posts.remove', 'editorials.manage', 'editorials.appoint', 'hiring.view', 'hiring.decide',
        'cards.view', 'cards.issue', 'cards.revoke', 'cards.extend', 'cards.template',
        'school.manage', 'school.teach', 'school.review', 'school.enroll',
        'docs.manage', 'points.award', 'support.answer', 'audit.view',
        /* публикация без очереди и отчёты редакций — с главного редактора */
        'posts.publish', 'reports.review',
    ),
    /* Технический администратор отвечает за сервер и почту, но не за людей:
       так он не может выдать себе роль или снять редактора. */
    'Технический администратор' => array(
        'people.view', 'server.diag', 'site.manage', 'mail.manage', 'mail.use',
        'audit.view', 'docs.manage',
    ),
    'Сотрудник' => array(),
    'Автор' => array(),
    /* Преподаватель ведёт медиашколу: уроки своих курсов и проверка заданий.
       Материалы сайта, людей и поддержку он не видит — см. ROLE_STANDALONE. */
    'Преподаватель' => array('school.teach', 'school.review'),
    'Модератор' => array('people.view', 'posts.review', 'support.answer'),
    'Участник' => array(),
    'Пользователь' => array(),
);

/* Роли «сбоку» от лестницы: их полномочия не наследуются. Преподаватель не
   становится модератором оттого, что стоит выше него по уровню, а руководитель
   школьной редакции не получает права вести медиашколу. Уровень у такой роли
   нужен только для вопроса «кто кого может назначить». */
const ROLE_STANDALONE = array('Преподаватель');

/* Наследование: роль получает полномочия всех ролей ниже по уровню.
   Так «Администратор» автоматически умеет всё, что умеет «Редактор». */
function role_caps($role) {
    if (!isset(ROLE_LEVELS[$role])) return array();
    if (in_array($role, ROLE_STANDALONE, true)) return ROLE_CAPS[$role];
    $level = ROLE_LEVELS[$role];
    $caps = array();
    foreach (ROLE_CAPS as $name => $list) {
        if (!isset(ROLE_LEVELS[$name])) continue;
        if (in_array($name, ROLE_STANDALONE, true)) continue;
        if (ROLE_LEVELS[$name] <= $level) {
            foreach ($list as $cap) $caps[$cap] = true;
        }
    }
    return array_keys($caps);
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

/* ============================================================================
   ЗОНА ОТВЕТСТВЕННОСТИ

   Полномочие отвечает на вопрос «что можно», зона — «над кем». Руководитель
   региональной редакции проверяет материалы и видит людей только своей
   редакции, региональный администратор — своего региона. Центральные роли
   (от главного редактора и выше) и сотрудники без редакции видят всё.
   ========================================================================== */

const REGIONAL_ROLES = array(
    'Редакционный администратор региона',
    'Редакционный основатель',
    'Руководитель региональной редакции',
);

/* Руководство проекта: директор и сооснователь. */
function is_head_role($role) {
    return role_level((string) $role) >= ROLE_LEVELS['Директор'];
}

function is_staff_user($user) {
    return $user && count(user_caps($user)) > 0;
}

/* null — вся платформа; ['region' => …] — регион; ['editorialId' => …] — редакция. */
function staff_scope($me) {
    if (!$me) return array('editorialId' => '');
    $role = isset($me['access']) ? (string) $me['access'] : '';
    if (in_array('*', user_caps($me), true)) return null;
    if (role_level($role) >= ROLE_LEVELS['Главный редактор']) return null;
    $editorialId = isset($me['editorialId']) ? (string) $me['editorialId'] : '';
    if ($role === 'Редакционный администратор региона') {
        return array('region' => isset($me['region']) ? (string) $me['region'] : '');
    }
    if (in_array($role, REGIONAL_ROLES, true)) return array('editorialId' => $editorialId);
    if ($editorialId !== '') return array('editorialId' => $editorialId);
    return null;
}

function user_in_scope($scope, $user) {
    if ($scope === null) return true;
    if (!$user) return false;
    if (isset($scope['region'])) {
        return $scope['region'] !== '' && isset($user['region'])
            && (string) $user['region'] === (string) $scope['region'];
    }
    if (isset($scope['editorialId'])) {
        return $scope['editorialId'] !== '' && isset($user['editorialId'])
            && (string) $user['editorialId'] === (string) $scope['editorialId'];
    }
    return false;
}

/* Материал в зоне, если в ней его автор; для региона — ещё и по региону
   самого материала (автор из другого региона пишет про этот). */
function post_in_scope($scope, $post, $author) {
    if ($scope === null) return true;
    if (isset($scope['region']) && $scope['region'] !== ''
        && isset($post['region']) && (string) $post['region'] === (string) $scope['region']) {
        return true;
    }
    return $author ? user_in_scope($scope, $author) : false;
}

/* Смена роли — единственное место, где решается «кто кого может назначить».
   Возвращает пустую строку, если можно, иначе текст отказа.
   Правила: себе роль не меняют; чужую — только тому, кто ниже; выдать можно
   роль не выше своей; последнего руководителя проекта снять нельзя. */
function access_change_guard($me, $target, $newRole, $users) {
    if (!$me || !$target) return 'Участник не найден.';
    if (!can($me, 'people.access')) return 'Роли меняет только руководство проекта.';
    if ((string) $me['id'] === (string) $target['id']) {
        return 'Свою роль изменить нельзя: это делает другой руководитель.';
    }
    if (!isset(ROLE_LEVELS[$newRole])) return 'Такой роли нет.';
    $my = role_level(isset($me['access']) ? $me['access'] : '');
    $theirs = role_level(isset($target['access']) ? $target['access'] : '');
    $new = role_level($newRole);
    $top = $my >= ROLE_LEVELS['Сооснователь'];
    if (!$top && $theirs >= $my) return 'Этот участник не ниже вас по роли — его права меняет старший.';
    if (!$top && $new > $my) return 'Нельзя выдать роль выше своей.';
    if (is_head_role(isset($target['access']) ? $target['access'] : '') && !is_head_role($newRole)) {
        $heads = 0;
        foreach ((array) $users as $u) {
            if (isset($u['status']) && $u['status'] === 'deleted') continue;
            if (is_head_role(isset($u['access']) ? $u['access'] : '')) $heads++;
        }
        if ($heads <= 1) return 'Это единственный руководитель проекта: сначала назначьте второго.';
    }
    return '';
}

/* Почта в списках: полностью её видит тот, кто ведёт людей, и руководитель
   редакции — у своих. Остальным хватает «и***@mail.ru», чтобы узнать человека. */
function mask_email($email) {
    $email = (string) $email;
    $at = strrpos($email, '@');
    if ($at === false || $at < 1) return $email === '' ? '' : '***';
    /* первая буква может быть кириллицей: режем по символам, а не по байтам */
    $first = function_exists('mb_substr') ? mb_substr($email, 0, 1, 'UTF-8')
        : (ord($email[0]) < 128 ? $email[0] : '');
    return $first . '***' . substr($email, $at);
}

function sees_contacts($me, $scope, $target) {
    if (!$me) return false;
    if (can($me, 'people.edit')) return true;
    if ($target && (string) $me['id'] === (string) $target['id']) return true;
    return $scope !== null && user_in_scope($scope, $target);
}
