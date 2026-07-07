'use strict';
// 公開側（フリーランサー向け）: トップ / 登録フォーム / ログイン / マイページ

const { db, SKILLS, AVAILABILITIES, WORK_STYLES, RATE_BANDS } = require('../lib/db');
const { verifyPassword, hashPassword } = require('../lib/password');
const { createSession, destroySession, sessionCookie, CLEAR_COOKIE } = require('../lib/auth');
const { esc, layout, selectOptions, statusBadge } = require('../lib/render');

// ---- フォーム値の取り出し・検証 ----

function readForm(form) {
  return {
    name: (form.get('name') || '').trim(),
    email: (form.get('email') || '').trim().toLowerCase(),
    password: form.get('password') || '',
    phone: (form.get('phone') || '').trim(),
    skills: form.getAll('skills').filter(s => SKILLS.includes(s)),
    experience_years: (form.get('experience_years') || '').trim(),
    summary: (form.get('summary') || '').trim(),
    availability: form.get('availability') || '',
    work_style: form.get('work_style') || '',
    rate_band: form.get('rate_band') || '',
    portfolio_url: (form.get('portfolio_url') || '').trim(),
  };
}

function validate(v, { checkPassword = true } = {}) {
  const errors = [];
  if (!v.name) errors.push('氏名を入力してください。');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.push('メールアドレスの形式が正しくありません。');
  if (checkPassword && v.password.length < 8) errors.push('パスワードは8文字以上で設定してください。');
  if (v.skills.length === 0) errors.push('スキル/専門領域を1つ以上選択してください。');
  if (v.experience_years !== '' && !/^\d{1,2}$/.test(v.experience_years)) errors.push('実務経験年数は0〜99の数値で入力してください。');
  if (!AVAILABILITIES.includes(v.availability)) errors.push('稼働可能日数を選択してください。');
  if (!WORK_STYLES.includes(v.work_style)) errors.push('稼働形態を選択してください。');
  if (!RATE_BANDS.includes(v.rate_band)) errors.push('希望単価帯を選択してください。');
  if (v.portfolio_url && !/^https?:\/\//.test(v.portfolio_url)) errors.push('ポートフォリオURLは http(s):// から始まる形式で入力してください。');
  if (v.email && db.prepare('SELECT id FROM lancers WHERE email = ?').get(v.email)) {
    errors.push('このメールアドレスは既に登録されています。ログインをお試しください。');
  }
  return errors;
}

// ---- 画面 ----

function homePage() {
  return layout({
    title: 'トップ',
    body: `
<section class="hero">
  <h1>マーケティングのプロとして、<br>あなたの力を活かしませんか。</h1>
  <p class="hero-lead">MRM（Marketing Resource Management）は、アイトリガーの専任エージェントが<br>あなたのスキル・希望条件に合ったマーケティング案件をご紹介するサービスです。</p>
  <div class="hero-actions">
    <a href="/register" class="btn btn-primary btn-lg">無料でランサー登録する</a>
    <a href="/login" class="btn btn-ghost btn-lg">登録済みの方はログイン</a>
  </div>
</section>
<section class="features">
  <div class="feature-card"><h3>エージェントが伴走</h3><p>ご登録内容をもとに専任エージェントがヒアリングし、条件に合う案件を個別にご紹介。単価交渉もお任せください。</p></div>
  <div class="feature-card"><h3>柔軟な働き方</h3><p>週1〜2日の副業からフルタイムまで。フルリモート案件も多数。あなたの稼働可能な範囲でご紹介します。</p></div>
  <div class="feature-card"><h3>登録は3分で完了</h3><p>スキルと希望条件を入力するだけ。職務経歴書のアップロードは不要です。</p></div>
</section>`,
  });
}

function skillCheckboxes(selected) {
  return SKILLS.map(s => `
    <label class="check-item"><input type="checkbox" name="skills" value="${esc(s)}"${selected.includes(s) ? ' checked' : ''}> ${esc(s)}</label>`).join('');
}

function registerFormPage(v, errors = []) {
  return layout({
    title: 'ランサー登録',
    body: `
<div class="form-panel">
  <h1>ランサー登録</h1>
  <p class="form-note">ご登録内容は社内エージェントのみが閲覧します。外部に公開されることはありません。</p>
  ${errors.length ? `<div class="errors"><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  <form method="POST" action="/register">
    <input type="hidden" name="mode" value="confirm">

    <h2 class="form-section">基本情報</h2>
    <div class="field"><label>氏名 <span class="req">必須</span></label>
      <input type="text" name="name" value="${esc(v.name)}" placeholder="山田 花子" required></div>
    <div class="field"><label>メールアドレス <span class="req">必須</span><span class="hint">ログインIDになります</span></label>
      <input type="email" name="email" value="${esc(v.email)}" placeholder="example@email.com" required></div>
    <div class="field"><label>パスワード <span class="req">必須</span><span class="hint">8文字以上</span></label>
      <input type="password" name="password" value="${esc(v.password)}" minlength="8" required></div>
    <div class="field"><label>電話番号 <span class="opt">任意</span></label>
      <input type="tel" name="phone" value="${esc(v.phone)}" placeholder="090-1234-5678"></div>

    <h2 class="form-section">スキル・経歴</h2>
    <div class="field"><label>スキル/専門領域 <span class="req">必須</span><span class="hint">複数選択可</span></label>
      <div class="check-grid">${skillCheckboxes(v.skills)}</div></div>
    <div class="field"><label>実務経験年数 <span class="opt">任意</span></label>
      <div class="inline-unit"><input type="number" name="experience_years" value="${esc(v.experience_years)}" min="0" max="99" class="input-sm"> 年</div></div>
    <div class="field"><label>経歴・実績サマリー <span class="opt">任意</span></label>
      <textarea name="summary" rows="5" placeholder="これまでのご経歴、担当された案件の規模・実績などをご自由にお書きください。">${esc(v.summary)}</textarea></div>

    <h2 class="form-section">希望条件</h2>
    <div class="field"><label>稼働可能日数 <span class="req">必須</span></label>
      <select name="availability" required><option value="">選択してください</option>${selectOptions(AVAILABILITIES, v.availability)}</select></div>
    <div class="field"><label>稼働形態 <span class="req">必須</span></label>
      <select name="work_style" required><option value="">選択してください</option>${selectOptions(WORK_STYLES, v.work_style)}</select></div>
    <div class="field"><label>希望単価帯 <span class="req">必須</span></label>
      <select name="rate_band" required><option value="">選択してください</option>${selectOptions(RATE_BANDS, v.rate_band)}</select></div>
    <div class="field"><label>ポートフォリオURL <span class="opt">任意</span></label>
      <input type="url" name="portfolio_url" value="${esc(v.portfolio_url)}" placeholder="https://"></div>

    <div class="form-actions"><button type="submit" class="btn btn-primary btn-lg">確認画面へ進む</button></div>
  </form>
</div>`,
  });
}

function confirmPage(v) {
  const hidden = [
    ['name', v.name], ['email', v.email], ['password', v.password], ['phone', v.phone],
    ['experience_years', v.experience_years], ['summary', v.summary],
    ['availability', v.availability], ['work_style', v.work_style],
    ['rate_band', v.rate_band], ['portfolio_url', v.portfolio_url],
    ...v.skills.map(s => ['skills', s]),
  ].map(([k, val]) => `<input type="hidden" name="${k}" value="${esc(val)}">`).join('\n');

  const row = (label, val) => `<tr><th>${label}</th><td>${esc(val) || '<span class="muted">未入力</span>'}</td></tr>`;
  return layout({
    title: '登録内容の確認',
    body: `
<div class="form-panel">
  <h1>登録内容の確認</h1>
  <p class="form-note">以下の内容で登録します。よろしければ「この内容で登録する」を押してください。</p>
  <table class="confirm-table">
    ${row('氏名', v.name)}
    ${row('メールアドレス', v.email)}
    <tr><th>パスワード</th><td>${'●'.repeat(Math.min(v.password.length, 12))}</td></tr>
    ${row('電話番号', v.phone)}
    ${row('スキル/専門領域', v.skills.join('、'))}
    ${row('実務経験年数', v.experience_years === '' ? '' : v.experience_years + ' 年')}
    ${row('経歴・実績サマリー', v.summary)}
    ${row('稼働可能日数', v.availability)}
    ${row('稼働形態', v.work_style)}
    ${row('希望単価帯', v.rate_band)}
    ${row('ポートフォリオURL', v.portfolio_url)}
  </table>
  <form method="POST" action="/register" class="form-actions form-actions-split">
    ${hidden}
    <button type="submit" name="mode" value="edit" class="btn btn-ghost" formnovalidate>修正する</button>
    <button type="submit" name="mode" value="submit" class="btn btn-primary btn-lg">この内容で登録する</button>
  </form>
</div>`,
  });
}

// ---- ルーティング ----

function register(routes) {
  routes.get('/', (req, res) => {
    if (req.user?.type === 'lancer') return res.redirect('/mypage');
    res.html(homePage());
  });

  routes.get('/register', (req, res) => {
    res.html(registerFormPage(readForm(new URLSearchParams())));
  });

  routes.post('/register', (req, res) => {
    const v = readForm(req.form);
    const mode = req.form.get('mode');

    if (mode === 'edit') return res.html(registerFormPage(v));

    const errors = validate(v);
    if (errors.length) return res.html(registerFormPage(v, errors));
    if (mode === 'confirm') return res.html(confirmPage(v));

    // mode === 'submit' : 登録実行
    const r = db.prepare(`INSERT INTO lancers
      (name, email, password_hash, phone, experience_years, summary, availability, work_style, rate_band, portfolio_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(v.name, v.email, hashPassword(v.password), v.phone,
        v.experience_years === '' ? 0 : Number(v.experience_years),
        v.summary, v.availability, v.work_style, v.rate_band, v.portfolio_url);
    const lancerId = Number(r.lastInsertRowid);
    const insSkill = db.prepare('INSERT INTO lancer_skills (lancer_id, skill_id) VALUES (?, (SELECT id FROM skills WHERE name = ?))');
    for (const s of v.skills) insSkill.run(lancerId, s);
    db.prepare(`INSERT INTO activities (lancer_id, kind, detail) VALUES (?, 'system', '本人がWebフォームから登録')`).run(lancerId);

    res.setHeader('Set-Cookie', sessionCookie(createSession('lancer', lancerId)));
    res.redirect('/register/complete');
  });

  routes.get('/register/complete', (req, res) => {
    res.html(layout({
      title: '登録完了', user: req.user,
      body: `
<div class="form-panel center">
  <div class="done-mark">✓</div>
  <h1>ご登録ありがとうございます</h1>
  <p>担当エージェントがご登録内容を確認のうえ、面談のご案内をメールでお送りします。<br>通常2〜3営業日以内にご連絡いたします。</p>
  <div class="form-actions"><a href="/mypage" class="btn btn-primary">マイページで登録内容を確認する</a></div>
</div>`,
    }));
  });

  routes.get('/login', (req, res) => {
    if (req.user?.type === 'lancer') return res.redirect('/mypage');
    res.html(loginPage());
  });

  routes.post('/login', (req, res) => {
    const email = (req.form.get('email') || '').trim().toLowerCase();
    const password = req.form.get('password') || '';
    const lancer = db.prepare('SELECT * FROM lancers WHERE email = ?').get(email);
    if (!lancer || !verifyPassword(password, lancer.password_hash)) {
      return res.html(loginPage('メールアドレスまたはパスワードが正しくありません。', email));
    }
    res.setHeader('Set-Cookie', sessionCookie(createSession('lancer', lancer.id)));
    res.redirect('/mypage');
  });

  routes.get('/logout', (req, res) => {
    destroySession(req.cookies.sid);
    res.setHeader('Set-Cookie', CLEAR_COOKIE);
    res.redirect('/');
  });

  routes.get('/mypage', (req, res) => {
    if (req.user?.type !== 'lancer') return res.redirect('/login');
    const l = req.user;
    const skills = db.prepare(`SELECT s.name FROM lancer_skills ls JOIN skills s ON s.id = ls.skill_id WHERE ls.lancer_id = ? ORDER BY s.sort`).all(l.id).map(r => r.name);
    const row = (label, val, raw = false) => `<tr><th>${label}</th><td>${raw ? val : (esc(val) || '<span class="muted">未入力</span>')}</td></tr>`;
    res.html(layout({
      title: 'マイページ', user: l,
      body: `
<div class="form-panel">
  <h1>マイページ</h1>
  <p class="form-note">現在のご登録内容です。内容の変更をご希望の場合は、担当エージェントまでご連絡ください。<br>（マイページからの直接編集機能は今後追加予定です）</p>
  <table class="confirm-table">
    ${row('ステータス', statusBadge(l.status), true)}
    ${row('氏名', l.name)}
    ${row('メールアドレス', l.email)}
    ${row('電話番号', l.phone)}
    ${row('スキル/専門領域', skills.join('、'))}
    ${row('実務経験年数', `${l.experience_years} 年`)}
    ${row('経歴・実績サマリー', l.summary)}
    ${row('稼働可能日数', l.availability)}
    ${row('稼働形態', l.work_style)}
    ${row('希望単価帯', l.rate_band)}
    ${row('ポートフォリオURL', l.portfolio_url)}
    ${row('登録日', l.created_at)}
  </table>
</div>`,
    }));
  });
}

function loginPage(error = '', email = '') {
  return layout({
    title: 'ログイン',
    body: `
<div class="form-panel narrow">
  <h1>ログイン</h1>
  ${error ? `<div class="errors">${esc(error)}</div>` : ''}
  <form method="POST" action="/login">
    <div class="field"><label>メールアドレス</label><input type="email" name="email" value="${esc(email)}" required autofocus></div>
    <div class="field"><label>パスワード</label><input type="password" name="password" required></div>
    <div class="form-actions"><button type="submit" class="btn btn-primary btn-lg">ログイン</button></div>
  </form>
  <p class="form-note center">初めての方は <a href="/register">ランサー登録</a> へ</p>
</div>`,
  });
}

module.exports = { register };
