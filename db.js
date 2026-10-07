// SQLite data layer (better-sqlite3). Tables are auto-created on boot so a
// fresh deploy works with zero manual migration steps.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const dir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.resolve(config.dbPath));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT,              -- NULL for Google-only accounts
  google_id      TEXT,              -- NULL until a Google account is linked
  name           TEXT,
  points_balance INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,      -- positive = earned, negative = redeemed
  reason     TEXT NOT NULL,
  ref_key    TEXT UNIQUE,           -- idempotency key for postbacks (NULL allowed)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS redemptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method         TEXT NOT NULL,     -- e.g. PayPal, Gift Card
  amount_points  INTEGER NOT NULL,
  account_detail TEXT NOT NULL,     -- e.g. PayPal email (user-supplied)
  status         TEXT NOT NULL DEFAULT 'PENDING',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions(user_id);
`);

const stmts = {
  createUser: db.prepare(
    `INSERT INTO users (email, password_hash, google_id, name)
     VALUES (@email, @password_hash, @google_id, @name)`
  ),
  findUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  findUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  findUserByGoogleId: db.prepare(`SELECT * FROM users WHERE google_id = ?`),
  linkGoogle: db.prepare(`UPDATE users SET google_id = ? WHERE id = ?`),
  setPassword: db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`),

  addLedger: db.prepare(
    `INSERT INTO ledger (user_id, delta, reason, ref_key) VALUES (?, ?, ?, ?)`
  ),
  addPoints: db.prepare(
    `UPDATE users SET points_balance = points_balance + ? WHERE id = ?`
  ),
  findLedgerByRefKey: db.prepare(`SELECT id FROM ledger WHERE ref_key = ?`),
  recentLedger: db.prepare(
    `SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 20`
  ),

  createRedemption: db.prepare(
    `INSERT INTO redemptions (user_id, method, amount_points, account_detail)
     VALUES (?, ?, ?, ?)`
  ),
  userRedemptions: db.prepare(
    `SELECT * FROM redemptions WHERE user_id = ? ORDER BY id DESC LIMIT 20`
  ),
};

// Credit (or debit, with negative delta) points atomically: the ledger row
// and the balance update happen in one transaction. When refKey is supplied
// and already exists, the call is a no-op returning null (idempotent —
// this is what makes duplicate CPX postbacks safe to ignore).
const creditPoints = db.transaction((userId, delta, reason, refKey) => {
  if (refKey) {
    const existing = stmts.findLedgerByRefKey.get(refKey);
    if (existing) return null;
  }
  const info = stmts.addLedger.run(userId, delta, reason, refKey || null);
  stmts.addPoints.run(delta, userId);
  return info.lastInsertRowid;
});

module.exports = { db, ...stmts, creditPoints };
