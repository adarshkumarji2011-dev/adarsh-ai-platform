import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function ensureDirs() {
  for (const dir of [config.dataDir, path.join(config.dataDir, 'media')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Persistence layer.
 *
 * Uses better-sqlite3 when the native module is available. That is the normal
 * path for both local development and the container image (the Dockerfile
 * installs build tooling for it). The constructor is imported dynamically so a
 * broken native binding produces a clear diagnostic instead of a stack trace
 * at module load.
 */
let Database;
let sqliteAvailable = true;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (error) {
  sqliteAvailable = false;
  console.error(
    '[adarsh-ai] SQLite driver unavailable:',
    error?.message || error,
    '\n[adarsh-ai] Chat history and account data require better-sqlite3.',
  );
}

export const storage = {
  get available() {
    return sqliteAvailable;
  },
  kind: 'sqlite',
  file: path.join(config.dataDir, 'adarsh.db'),
};

let db = null;

export function getDb() {
  if (!sqliteAvailable) {
    const err = new Error(
      'Persistence is unavailable: the SQLite driver failed to load on this host.',
    );
    err.code = 'STORAGE_UNAVAILABLE';
    err.status = 503;
    throw err;
  }
  if (db) return db;
  ensureDirs();
  db = new Database(storage.file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      name TEXT NOT NULL DEFAULT 'Guest',
      password_hash TEXT,
      is_guest INTEGER NOT NULL DEFAULT 0,
      plan TEXT NOT NULL DEFAULT 'free',
      theme TEXT NOT NULL DEFAULT 'dark',
      language TEXT NOT NULL DEFAULT 'en',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New chat',
      kind TEXT NOT NULL DEFAULT 'chat',
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      attachments TEXT NOT NULL DEFAULT '[]',
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT 'realistic',
      file_name TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'image/png',
      revised_prompt TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS speaking_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'beginner',
      topic TEXT NOT NULL DEFAULT 'Free talk',
      transcript TEXT NOT NULL DEFAULT '[]',
      feedback TEXT NOT NULL DEFAULT '{}',
      score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_speaking_user ON speaking_sessions(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature TEXT NOT NULL,
      day TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage_events(user_id, feature, day);
  `);
}
