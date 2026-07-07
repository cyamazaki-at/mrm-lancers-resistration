'use strict';
// HTMLレンダリング共通部（エスケープ・レイアウト・フォーム部品）

function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// 公開側（ランサー向け）レイアウト
function layout({ title, body, user = null, flash = '' }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@600;700&display=swap" rel="stylesheet">
<title>${esc(title)} | MRM フリーランサー登録</title>
<link rel="stylesheet" href="/public/styles.css">
</head>
<body>
<header class="site-header">
  <div class="container header-inner">
    <a href="/" class="brand"><img src="/public/logo.png" alt="AiTRIGGER" class="brand-logo"><span class="brand-sub">MRM フリーランサー登録</span></a>
    <nav class="header-nav">
      ${user && user.type === 'lancer'
        ? `<span class="nav-user">${esc(user.name)} さん</span><a href="/mypage">マイページ</a><a href="/logout">ログアウト</a>`
        : `<a href="/login">ログイン</a><a href="/register" class="btn btn-primary btn-sm">新規登録</a>`}
    </nav>
  </div>
</header>
<main class="container">
${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
${body}
</main>
<footer class="site-footer"><div class="container">&copy; AiTRIGGER Inc. MRM事業</div></footer>
</body>
</html>`;
}

// 管理側（エージェント向け）レイアウト
function adminLayout({ title, body, agent = null, flash = '' }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@600;700&display=swap" rel="stylesheet">
<title>${esc(title)} | MRM 管理画面</title>
<link rel="stylesheet" href="/public/styles.css">
</head>
<body class="admin">
<header class="site-header admin-header">
  <div class="container header-inner">
    <a href="/admin" class="brand"><img src="/public/logo.png" alt="AiTRIGGER" class="brand-logo"><span class="brand-sub admin-badge">MRM 管理画面</span></a>
    <nav class="header-nav">
      ${agent
        ? `<a href="/admin">ランサー一覧</a>${agent.role === 'admin' ? '<a href="/admin/agents">エージェント管理</a>' : ''}<a href="/admin/export.csv">CSV出力</a><span class="nav-user">${esc(agent.name)}</span><a href="/admin/logout">ログアウト</a>`
        : ''}
    </nav>
  </div>
</header>
<main class="container">
${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
${body}
</main>
<footer class="site-footer"><div class="container">MRM 社内管理画面（Phase 1）</div></footer>
</body>
</html>`;
}

// select要素の生成
function selectOptions(options, selected) {
  return options.map(o => `<option value="${esc(o)}"${o === selected ? ' selected' : ''}>${esc(o)}</option>`).join('');
}

// ステータスバッジ
const STATUS_CLASS = {
  '新規登録': 'st-new', '面談調整中': 'st-meeting', '面談済み': 'st-met',
  '提案中': 'st-proposal', '稼働中': 'st-active', '休止中': 'st-paused', '登録解除': 'st-closed',
};
function statusBadge(status) {
  return `<span class="badge ${STATUS_CLASS[status] || ''}">${esc(status)}</span>`;
}

module.exports = { esc, layout, adminLayout, selectOptions, statusBadge };
