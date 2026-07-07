'use strict';
// Cookieベースのセッション管理（lancer / agent 共用）

const crypto = require('node:crypto');
const { db } = require('./db');

const SESSION_TTL_HOURS = 24 * 7; // 7日

function createSession(userType, userId) {
  const id = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (id, user_type, user_id, expires_at)
              VALUES (?, ?, ?, datetime('now', 'localtime', '+${SESSION_TTL_HOURS} hours'))`)
    .run(id, userType, userId);
  return id;
}

function getSession(sid) {
  if (!sid) return null;
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now', 'localtime')`).get(sid);
  return row || null;
}

function destroySession(sid) {
  if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
}

// リクエストから現在のユーザーを解決する
function currentUser(req) {
  const session = getSession(req.cookies.sid);
  if (!session) return null;
  if (session.user_type === 'agent') {
    const agent = db.prepare('SELECT id, name, email, role FROM agents WHERE id = ?').get(session.user_id);
    return agent ? { type: 'agent', ...agent } : null;
  }
  const lancer = db.prepare('SELECT * FROM lancers WHERE id = ?').get(session.user_id);
  return lancer ? { type: 'lancer', ...lancer } : null;
}

function sessionCookie(sid) {
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_HOURS * 3600}`;
}

const CLEAR_COOKIE = 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

module.exports = { createSession, destroySession, currentUser, sessionCookie, CLEAR_COOKIE };
