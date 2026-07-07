'use strict';
// 社内管理画面（エージェント向け）: 一覧・検索 / 詳細 / ステータス・メモ・対応履歴 / CSV出力 / エージェント管理

const { db, SKILLS, AVAILABILITIES, STATUSES } = require('../lib/db');
const { verifyPassword, hashPassword } = require('../lib/password');
const { createSession, destroySession, sessionCookie, CLEAR_COOKIE } = require('../lib/auth');
const { esc, adminLayout, selectOptions, statusBadge } = require('../lib/render');

// エージェント認証ガード。未ログインならログイン画面へ。
function requireAgent(req, res) {
  if (req.user?.type === 'agent') return req.user;
  res.redirect('/admin/login');
  return null;
}

function lancerSkills(lancerId) {
  return db.prepare(`SELECT s.name FROM lancer_skills ls JOIN skills s ON s.id = ls.skill_id
                     WHERE ls.lancer_id = ? ORDER BY s.sort`).all(lancerId).map(r => r.name);
}

function allAgents() {
  return db.prepare('SELECT id, name, email, role FROM agents ORDER BY id').all();
}

// ---- 一覧（検索・絞り込み） ----

function searchLancers(params) {
  const where = [];
  const args = [];
  const q = (params.get('q') || '').trim();
  if (q) {
    where.push('(l.name LIKE ? OR l.email LIKE ? OR l.summary LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  const skill = params.get('skill') || '';
  if (SKILLS.includes(skill)) {
    where.push('EXISTS (SELECT 1 FROM lancer_skills ls JOIN skills s ON s.id = ls.skill_id WHERE ls.lancer_id = l.id AND s.name = ?)');
    args.push(skill);
  }
  const status = params.get('status') || '';
  if (STATUSES.includes(status)) { where.push('l.status = ?'); args.push(status); }
  const availability = params.get('availability') || '';
  if (AVAILABILITIES.includes(availability)) { where.push('l.availability = ?'); args.push(availability); }
  const assigned = params.get('assigned') || '';
  if (/^\d+$/.test(assigned)) { where.push('l.assigned_agent_id = ?'); args.push(Number(assigned)); }
  else if (assigned === 'none') { where.push('l.assigned_agent_id IS NULL'); }

  const sorts = {
    created_desc: 'l.created_at DESC',
    created_asc: 'l.created_at ASC',
    years_desc: 'l.experience_years DESC',
    name_asc: 'l.name ASC',
  };
  const sort = sorts[params.get('sort')] ? params.get('sort') : 'created_desc';

  const rows = db.prepare(`
    SELECT l.*, a.name AS agent_name,
      (SELECT GROUP_CONCAT(s.name, '、') FROM lancer_skills ls JOIN skills s ON s.id = ls.skill_id
       WHERE ls.lancer_id = l.id) AS skill_names
    FROM lancers l LEFT JOIN agents a ON a.id = l.assigned_agent_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sorts[sort]}
  `).all(...args);
  return { rows, sort };
}

function listPage(agent, params, flash) {
  const { rows, sort } = searchLancers(params);
  const q = params.get('q') || '';
  const agents = allAgents();
  const total = db.prepare('SELECT COUNT(*) AS c FROM lancers').get().c;

  const sortOptions = [
    ['created_desc', '登録日が新しい順'], ['created_asc', '登録日が古い順'],
    ['years_desc', '経験年数が多い順'], ['name_asc', '氏名順'],
  ];

  const body = `
<div class="page-head">
  <h1>ランサー一覧 <span class="count">${rows.length} / ${total}件</span></h1>
</div>
<form method="GET" action="/admin" class="filter-bar">
  <input type="search" name="q" value="${esc(q)}" placeholder="氏名・メール・経歴で検索" class="filter-q">
  <select name="skill"><option value="">スキル: すべて</option>${selectOptions(SKILLS, params.get('skill'))}</select>
  <select name="status"><option value="">ステータス: すべて</option>${selectOptions(STATUSES, params.get('status'))}</select>
  <select name="availability"><option value="">稼働日数: すべて</option>${selectOptions(AVAILABILITIES, params.get('availability'))}</select>
  <select name="assigned"><option value="">担当: すべて</option><option value="none"${params.get('assigned') === 'none' ? ' selected' : ''}>未割当</option>
    ${agents.map(a => `<option value="${a.id}"${params.get('assigned') === String(a.id) ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
  <select name="sort">${sortOptions.map(([v, label]) => `<option value="${v}"${v === sort ? ' selected' : ''}>${label}</option>`).join('')}</select>
  <button type="submit" class="btn btn-primary">絞り込む</button>
  <a href="/admin" class="btn btn-ghost">クリア</a>
</form>
${rows.length === 0 ? '<p class="empty">条件に一致するランサーがいません。</p>' : `
<table class="data-table">
  <thead><tr><th>氏名</th><th>スキル</th><th>ステータス</th><th>稼働日数</th><th>希望単価</th><th>経験</th><th>担当</th><th>登録日</th></tr></thead>
  <tbody>
    ${rows.map(l => `
    <tr class="clickable" onclick="location.href='/admin/lancers/${l.id}'">
      <td><a href="/admin/lancers/${l.id}">${esc(l.name)}</a><div class="sub">${esc(l.email)}</div></td>
      <td class="skills-cell">${(l.skill_names || '').split('、').filter(Boolean).map(s => `<span class="tag">${esc(s)}</span>`).join('')}</td>
      <td>${statusBadge(l.status)}</td>
      <td>${esc(l.availability)}</td>
      <td>${esc(l.rate_band)}</td>
      <td>${l.experience_years}年</td>
      <td>${l.agent_name ? esc(l.agent_name) : '<span class="muted">未割当</span>'}</td>
      <td class="sub">${esc(String(l.created_at).slice(0, 10))}</td>
    </tr>`).join('')}
  </tbody>
</table>`}
`;
  return adminLayout({ title: 'ランサー一覧', agent, body, flash });
}

// ---- 詳細 ----

function detailPage(agent, lancer, flash) {
  const skills = lancerSkills(lancer.id);
  const agents = allAgents();
  const notes = db.prepare(`SELECT n.*, a.name AS agent_name FROM notes n JOIN agents a ON a.id = n.agent_id
                            WHERE n.lancer_id = ? ORDER BY n.created_at DESC, n.id DESC`).all(lancer.id);
  const acts = db.prepare(`SELECT ac.*, a.name AS agent_name FROM activities ac LEFT JOIN agents a ON a.id = ac.agent_id
                           WHERE ac.lancer_id = ? ORDER BY ac.created_at DESC, ac.id DESC`).all(lancer.id);
  const row = (label, val, raw = false) => `<tr><th>${label}</th><td>${raw ? val : (esc(val) || '<span class="muted">未入力</span>')}</td></tr>`;

  const body = `
<div class="page-head">
  <div><a href="/admin" class="back-link">← 一覧に戻る</a><h1>${esc(lancer.name)} ${statusBadge(lancer.status)}</h1></div>
</div>
<div class="detail-grid">
  <div class="detail-main">
    <section class="panel">
      <h2>登録情報</h2>
      <table class="confirm-table">
        ${row('メールアドレス', lancer.email)}
        ${row('電話番号', lancer.phone)}
        ${row('スキル/専門領域', skills.map(s => `<span class="tag">${esc(s)}</span>`).join(' '), true)}
        ${row('実務経験年数', `${lancer.experience_years} 年`)}
        ${row('経歴・実績サマリー', lancer.summary)}
        ${row('稼働可能日数', lancer.availability)}
        ${row('稼働形態', lancer.work_style)}
        ${row('希望単価帯', lancer.rate_band)}
        ${row('ポートフォリオURL', lancer.portfolio_url ? `<a href="${esc(lancer.portfolio_url)}" target="_blank" rel="noopener noreferrer">${esc(lancer.portfolio_url)}</a>` : '<span class="muted">未入力</span>', true)}
        ${row('登録日時', lancer.created_at)}
      </table>
    </section>

    <section class="panel">
      <h2>社内メモ <span class="hint">面談の印象・紹介実績など自由に記録できます（本人には表示されません）</span></h2>
      <form method="POST" action="/admin/lancers/${lancer.id}/memo" class="memo-form">
        <textarea name="body" rows="3" placeholder="メモを入力…" required></textarea>
        <button type="submit" class="btn btn-primary">メモを追加</button>
      </form>
      ${notes.length === 0 ? '<p class="empty">まだメモはありません。</p>' : notes.map(n => `
      <div class="note-item">
        <div class="note-meta"><strong>${esc(n.agent_name)}</strong><span>${esc(n.created_at)}</span></div>
        <div class="note-body">${esc(n.body).replaceAll('\n', '<br>')}</div>
      </div>`).join('')}
    </section>

    <section class="panel">
      <h2>対応履歴</h2>
      <form method="POST" action="/admin/lancers/${lancer.id}/activity" class="activity-form">
        <select name="channel">${selectOptions(['電話', 'メール', '面談', 'その他'], 'メール')}</select>
        <input type="text" name="detail" placeholder="対応内容（例: 初回面談の日程調整の連絡）" required>
        <button type="submit" class="btn btn-primary">記録する</button>
      </form>
      ${acts.length === 0 ? '<p class="empty">まだ対応履歴はありません。</p>' : `
      <table class="data-table history-table">
        <tbody>
        ${acts.map(a => `
        <tr>
          <td class="sub nowrap">${esc(a.created_at)}</td>
          <td class="nowrap">${a.kind === 'system' ? '<span class="tag tag-sys">自動記録</span>' : `<span class="tag">${esc(a.channel)}</span>`}</td>
          <td>${esc(a.detail)}</td>
          <td class="sub nowrap">${a.agent_name ? esc(a.agent_name) : '—'}</td>
        </tr>`).join('')}
        </tbody>
      </table>`}
    </section>
  </div>

  <aside class="detail-side">
    <section class="panel">
      <h2>ステータス</h2>
      <form method="POST" action="/admin/lancers/${lancer.id}/status" class="side-form">
        <select name="status">${selectOptions(STATUSES, lancer.status)}</select>
        <button type="submit" class="btn btn-primary btn-block">更新する</button>
      </form>
    </section>
    <section class="panel">
      <h2>担当エージェント</h2>
      <form method="POST" action="/admin/lancers/${lancer.id}/assign" class="side-form">
        <select name="agent_id">
          <option value="">未割当</option>
          ${agents.map(a => `<option value="${a.id}"${lancer.assigned_agent_id === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
        <button type="submit" class="btn btn-primary btn-block">割り当てる</button>
      </form>
    </section>
  </aside>
</div>`;
  return adminLayout({ title: `${lancer.name} | ランサー詳細`, agent, body, flash });
}

// ---- ルーティング ----

function register(routes) {
  routes.get('/admin/login', (req, res) => {
    if (req.user?.type === 'agent') return res.redirect('/admin');
    res.html(adminLoginPage());
  });

  routes.post('/admin/login', (req, res) => {
    const email = (req.form.get('email') || '').trim().toLowerCase();
    const password = req.form.get('password') || '';
    const agent = db.prepare('SELECT * FROM agents WHERE email = ?').get(email);
    if (!agent || !verifyPassword(password, agent.password_hash)) {
      return res.html(adminLoginPage('メールアドレスまたはパスワードが正しくありません。', email));
    }
    res.setHeader('Set-Cookie', sessionCookie(createSession('agent', agent.id)));
    res.redirect('/admin');
  });

  routes.get('/admin/logout', (req, res) => {
    destroySession(req.cookies.sid);
    res.setHeader('Set-Cookie', CLEAR_COOKIE);
    res.redirect('/admin/login');
  });

  routes.get('/admin', (req, res) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    res.html(listPage(agent, req.query, req.query.get('ok') || ''));
  });

  routes.get(/^\/admin\/lancers\/(\d+)$/, (req, res, m) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    const lancer = db.prepare('SELECT * FROM lancers WHERE id = ?').get(Number(m[1]));
    if (!lancer) return res.notFound();
    res.html(detailPage(agent, lancer, req.query.get('ok') || ''));
  });

  routes.post(/^\/admin\/lancers\/(\d+)\/status$/, (req, res, m) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    const id = Number(m[1]);
    const lancer = db.prepare('SELECT * FROM lancers WHERE id = ?').get(id);
    const status = req.form.get('status');
    if (!lancer || !STATUSES.includes(status)) return res.notFound();
    if (status !== lancer.status) {
      db.prepare(`UPDATE lancers SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(status, id);
      db.prepare(`INSERT INTO activities (lancer_id, agent_id, kind, detail) VALUES (?, ?, 'system', ?)`)
        .run(id, agent.id, `ステータスを「${lancer.status}」→「${status}」に変更`);
    }
    res.redirect(`/admin/lancers/${id}?ok=${encodeURIComponent('ステータスを更新しました。')}`);
  });

  routes.post(/^\/admin\/lancers\/(\d+)\/assign$/, (req, res, m) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    const id = Number(m[1]);
    const lancer = db.prepare('SELECT * FROM lancers WHERE id = ?').get(id);
    if (!lancer) return res.notFound();
    const agentIdRaw = req.form.get('agent_id') || '';
    const newAgent = /^\d+$/.test(agentIdRaw)
      ? db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(agentIdRaw)) : null;
    db.prepare(`UPDATE lancers SET assigned_agent_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(newAgent ? newAgent.id : null, id);
    db.prepare(`INSERT INTO activities (lancer_id, agent_id, kind, detail) VALUES (?, ?, 'system', ?)`)
      .run(id, agent.id, newAgent ? `担当を「${newAgent.name}」に設定` : '担当を未割当に変更');
    res.redirect(`/admin/lancers/${id}?ok=${encodeURIComponent('担当エージェントを更新しました。')}`);
  });

  routes.post(/^\/admin\/lancers\/(\d+)\/memo$/, (req, res, m) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    const id = Number(m[1]);
    const body = (req.form.get('body') || '').trim();
    if (!db.prepare('SELECT id FROM lancers WHERE id = ?').get(id)) return res.notFound();
    if (body) db.prepare('INSERT INTO notes (lancer_id, agent_id, body) VALUES (?, ?, ?)').run(id, agent.id, body);
    res.redirect(`/admin/lancers/${id}?ok=${encodeURIComponent('メモを追加しました。')}`);
  });

  routes.post(/^\/admin\/lancers\/(\d+)\/activity$/, (req, res, m) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    const id = Number(m[1]);
    const detail = (req.form.get('detail') || '').trim();
    const channel = req.form.get('channel') || 'その他';
    if (!db.prepare('SELECT id FROM lancers WHERE id = ?').get(id)) return res.notFound();
    if (detail) {
      db.prepare(`INSERT INTO activities (lancer_id, agent_id, kind, channel, detail) VALUES (?, ?, 'contact', ?, ?)`)
        .run(id, agent.id, channel, detail);
    }
    res.redirect(`/admin/lancers/${id}?ok=${encodeURIComponent('対応履歴を記録しました。')}`);
  });

  // CSVエクスポート（Excel向けにBOM付きUTF-8）
  routes.get('/admin/export.csv', (req, res) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    const { rows } = searchLancers(req.query);
    const header = ['ID', '氏名', 'メールアドレス', '電話番号', 'スキル', '実務経験年数', '経歴サマリー',
      '稼働可能日数', '稼働形態', '希望単価帯', 'ポートフォリオURL', 'ステータス', '担当エージェント', '登録日時'];
    const cell = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const lines = [header.map(cell).join(',')];
    for (const l of rows) {
      lines.push([l.id, l.name, l.email, l.phone, l.skill_names || '', l.experience_years, l.summary,
        l.availability, l.work_style, l.rate_band, l.portfolio_url, l.status, l.agent_name || '', l.created_at]
        .map(cell).join(','));
    }
    const csv = '﻿' + lines.join('\r\n'); // BOM付きUTF-8（Excelでの文字化け防止）
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mrm_lancers_${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    res.end(csv);
  });

  // エージェント管理（admin権限のみ）
  routes.get('/admin/agents', (req, res) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    if (agent.role !== 'admin') return res.redirect('/admin');
    res.html(agentsPage(agent, req.query.get('ok') || '', req.query.get('err') || ''));
  });

  routes.post('/admin/agents', (req, res) => {
    const agent = requireAgent(req, res);
    if (!agent) return;
    if (agent.role !== 'admin') return res.redirect('/admin');
    const name = (req.form.get('name') || '').trim();
    const email = (req.form.get('email') || '').trim().toLowerCase();
    const password = req.form.get('password') || '';
    const role = req.form.get('role') === 'admin' ? 'admin' : 'agent';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      return res.redirect(`/admin/agents?err=${encodeURIComponent('氏名・メールアドレス・パスワード（8文字以上）を正しく入力してください。')}`);
    }
    if (db.prepare('SELECT id FROM agents WHERE email = ?').get(email)) {
      return res.redirect(`/admin/agents?err=${encodeURIComponent('このメールアドレスは既に登録されています。')}`);
    }
    db.prepare('INSERT INTO agents (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, hashPassword(password), role);
    res.redirect(`/admin/agents?ok=${encodeURIComponent('エージェントアカウントを作成しました。')}`);
  });
}

function adminLoginPage(error = '', email = '') {
  return adminLayout({
    title: 'ログイン',
    body: `
<div class="form-panel narrow">
  <h1>社内エージェント ログイン</h1>
  <p class="form-note">この画面は株式会社アイトリガーの社内エージェント専用です。</p>
  ${error ? `<div class="errors">${esc(error)}</div>` : ''}
  <form method="POST" action="/admin/login">
    <div class="field"><label>メールアドレス</label><input type="email" name="email" value="${esc(email)}" required autofocus></div>
    <div class="field"><label>パスワード</label><input type="password" name="password" required></div>
    <div class="form-actions"><button type="submit" class="btn btn-primary btn-lg">ログイン</button></div>
  </form>
</div>`,
  });
}

function agentsPage(agent, flash, error) {
  const agents = allAgents();
  const counts = Object.fromEntries(
    db.prepare('SELECT assigned_agent_id AS id, COUNT(*) AS c FROM lancers WHERE assigned_agent_id IS NOT NULL GROUP BY assigned_agent_id')
      .all().map(r => [r.id, r.c]));
  const body = `
<div class="page-head"><h1>エージェント管理</h1></div>
${error ? `<div class="errors">${esc(error)}</div>` : ''}
<div class="detail-grid">
  <div class="detail-main">
    <section class="panel">
      <h2>登録済みエージェント</h2>
      <table class="data-table">
        <thead><tr><th>氏名</th><th>メールアドレス</th><th>権限</th><th>担当ランサー数</th></tr></thead>
        <tbody>
        ${agents.map(a => `<tr>
          <td>${esc(a.name)}</td><td>${esc(a.email)}</td>
          <td>${a.role === 'admin' ? '<span class="tag tag-sys">管理者</span>' : 'エージェント'}</td>
          <td>${counts[a.id] || 0} 名</td>
        </tr>`).join('')}
        </tbody>
      </table>
    </section>
  </div>
  <aside class="detail-side">
    <section class="panel">
      <h2>新規エージェント追加</h2>
      <form method="POST" action="/admin/agents" class="side-form">
        <div class="field"><label>氏名</label><input type="text" name="name" required></div>
        <div class="field"><label>メールアドレス</label><input type="email" name="email" required></div>
        <div class="field"><label>初期パスワード（8文字以上）</label><input type="password" name="password" minlength="8" required></div>
        <div class="field"><label>権限</label><select name="role"><option value="agent">エージェント</option><option value="admin">管理者</option></select></div>
        <button type="submit" class="btn btn-primary btn-block">作成する</button>
      </form>
    </section>
  </aside>
</div>`;
  return adminLayout({ title: 'エージェント管理', agent, body, flash });
}

module.exports = { register };
