'use strict';
// SQLite (Node 22.5+ 標準の node:sqlite) を使用。外部依存なし。
// Phase 2 以降でテーブル追加（案件・マッチング等）がしやすいよう、
// スキル・メモ・対応履歴は正規化して別テーブルに分離している。

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./password');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'mrm.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ランサー（フリーランサー）本体
CREATE TABLE IF NOT EXISTS lancers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  phone             TEXT DEFAULT '',
  experience_years  INTEGER DEFAULT 0,
  summary           TEXT DEFAULT '',
  availability      TEXT DEFAULT '',        -- 稼働可能日数（週1〜2日 等）
  work_style        TEXT DEFAULT '',        -- フルリモート / 一部出社可 / 常駐可
  rate_band         TEXT DEFAULT '',        -- 希望単価帯
  portfolio_url     TEXT DEFAULT '',
  status            TEXT NOT NULL DEFAULT '新規登録',
  assigned_agent_id INTEGER REFERENCES agents(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- スキルマスタ
CREATE TABLE IF NOT EXISTS skills (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

-- ランサー×スキル（多対多）
CREATE TABLE IF NOT EXISTS lancer_skills (
  lancer_id INTEGER NOT NULL REFERENCES lancers(id) ON DELETE CASCADE,
  skill_id  INTEGER NOT NULL REFERENCES skills(id),
  PRIMARY KEY (lancer_id, skill_id)
);

-- 社内エージェント（管理画面ユーザー）
CREATE TABLE IF NOT EXISTS agents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'agent',  -- admin / agent
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 社内メモ（エージェントの自由記述）
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lancer_id  INTEGER NOT NULL REFERENCES lancers(id) ON DELETE CASCADE,
  agent_id   INTEGER NOT NULL REFERENCES agents(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 対応履歴（連絡ログ + ステータス変更等のシステムログ）
CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lancer_id  INTEGER NOT NULL REFERENCES lancers(id) ON DELETE CASCADE,
  agent_id   INTEGER REFERENCES agents(id),
  kind       TEXT NOT NULL DEFAULT 'contact',  -- contact:連絡 / system:自動記録
  channel    TEXT DEFAULT '',                  -- 電話 / メール / 面談 / その他
  detail     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ログインセッション（ランサー・エージェント共用）
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_type  TEXT NOT NULL,   -- lancer / agent
  user_id    INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lancers_status  ON lancers(status);
CREATE INDEX IF NOT EXISTS idx_lancers_created ON lancers(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_lancer    ON notes(lancer_id);
CREATE INDEX IF NOT EXISTS idx_act_lancer      ON activities(lancer_id);
`);

// ---- 選択肢の定義（フォーム・絞り込みで共用） ----
const SKILLS = [
  '広告運用', 'SEO', 'SNS運用', 'CRM/MA', 'ディレクション',
  'デザイン', 'データ分析', '動画制作', 'LPO/CRO', 'コンテンツ制作',
];
const AVAILABILITIES = ['週1〜2日', '週3日', '週4日', 'フルタイム'];
const WORK_STYLES = ['フルリモート', '一部出社可', '常駐可'];
const RATE_BANDS = ['〜30万円/月', '30〜50万円/月', '50〜80万円/月', '80〜120万円/月', '120万円〜/月', '応相談'];
const STATUSES = ['新規登録', '面談調整中', '面談済み', '提案中', '稼働中', '休止中', '登録解除'];

// ---- 初期データ投入（初回起動時のみ） ----
function seed() {
  const skillCount = db.prepare('SELECT COUNT(*) AS c FROM skills').get().c;
  if (skillCount === 0) {
    const ins = db.prepare('INSERT INTO skills (name, sort) VALUES (?, ?)');
    SKILLS.forEach((name, i) => ins.run(name, i));
  }

  const agentCount = db.prepare('SELECT COUNT(*) AS c FROM agents').get().c;
  if (agentCount === 0) {
    const ins = db.prepare('INSERT INTO agents (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
    ins.run('管理者', 'admin@aitrigger.co.jp', hashPassword('mrm-admin'), 'admin');
    ins.run('山田 太郎', 'yamada@aitrigger.co.jp', hashPassword('mrm-agent'), 'agent');
  }

  const lancerCount = db.prepare('SELECT COUNT(*) AS c FROM lancers').get().c;
  if (lancerCount === 0) {
    const samples = [
      { name: '佐藤 美咲', email: 'misaki.sato@example.com', phone: '090-1111-2222', years: 8,
        summary: '大手代理店で運用型広告を8年担当。Google/Yahoo!/Meta広告の月額3,000万円規模のアカウント運用経験あり。独立後はD2C企業を中心に支援。',
        availability: '週3日', work: 'フルリモート', rate: '50〜80万円/月',
        portfolio: 'https://example.com/misaki', status: '稼働中', skills: ['広告運用', 'データ分析'] },
      { name: '鈴木 健一', email: 'kenichi.suzuki@example.com', phone: '080-3333-4444', years: 5,
        summary: 'SEOコンサルとして事業会社・支援会社の両方を経験。コンテンツ設計からテクニカルSEOまで一気通貫で対応可能。',
        availability: '週1〜2日', work: '一部出社可', rate: '30〜50万円/月',
        portfolio: '', status: '面談調整中', skills: ['SEO', 'コンテンツ制作'] },
      { name: '高橋 由紀', email: 'yuki.takahashi@example.com', phone: '', years: 10,
        summary: 'BtoB SaaSのマーケティング責任者を経て独立。MAツール（HubSpot/Marketo）導入・CRM設計・ナーチャリング施策が得意領域。',
        availability: 'フルタイム', work: 'フルリモート', rate: '80〜120万円/月',
        portfolio: 'https://example.com/yuki', status: '新規登録', skills: ['CRM/MA', 'ディレクション', 'データ分析'] },
      { name: '伊藤 翔', email: 'sho.ito@example.com', phone: '070-5555-6666', years: 3,
        summary: 'SNS運用代行としてInstagram/TikTokアカウントのグロースを支援。動画編集も対応可能。',
        availability: '週3日', work: '常駐可', rate: '〜30万円/月',
        portfolio: 'https://example.com/sho', status: '面談済み', skills: ['SNS運用', '動画制作'] },
      { name: '渡辺 直子', email: 'naoko.watanabe@example.com', phone: '090-7777-8888', years: 12,
        summary: '事業会社でECサイトのグロース全般を統括。LPO/CRO・広告・CRMを横断したデジタルマーケ戦略の立案から実行まで。',
        availability: '週4日', work: 'フルリモート', rate: '120万円〜/月',
        portfolio: '', status: '休止中', skills: ['LPO/CRO', '広告運用', 'ディレクション'] },
    ];
    const insL = db.prepare(`INSERT INTO lancers
      (name, email, password_hash, phone, experience_years, summary, availability, work_style, rate_band, portfolio_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insLS = db.prepare('INSERT INTO lancer_skills (lancer_id, skill_id) VALUES (?, (SELECT id FROM skills WHERE name = ?))');
    for (const s of samples) {
      const r = insL.run(s.name, s.email, hashPassword('lancer-demo'), s.phone, s.years,
        s.summary, s.availability, s.work, s.rate, s.portfolio, s.status);
      for (const sk of s.skills) insLS.run(r.lastInsertRowid, sk);
    }
  }
}
seed();

module.exports = { db, SKILLS, AVAILABILITIES, WORK_STYLES, RATE_BANDS, STATUSES };
