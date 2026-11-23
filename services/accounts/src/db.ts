// Nude Accounts storage (SQLite through node:sqlite). Secrets are never stored in the clear:
// passwords are scrypt hashes, session and access tokens are stored as SHA-256 hashes.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL,
      avatar BLOB, avatar_type TEXT, avatar_at INTEGER, created INTEGER NOT NULL, password_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, platform TEXT NOT NULL, app TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, last_ip TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, t INTEGER NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL, device TEXT, ip TEXT
    );
    CREATE INDEX IF NOT EXISTS events_user ON events(user, t DESC);
    CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY, client TEXT NOT NULL, user TEXT NOT NULL, redirect TEXT NOT NULL, scope TEXT NOT NULL,
      nonce TEXT, challenge TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS access (token TEXT PRIMARY KEY, client TEXT NOT NULL, user TEXT NOT NULL, scope TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS grants (user TEXT NOT NULL, client TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (user, client));
    CREATE TABLE IF NOT EXISTS sync (
      user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, space TEXT NOT NULL, key TEXT NOT NULL,
      value TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (user, space, key)
    );
    CREATE INDEX IF NOT EXISTS sync_t ON sync(user, space, t);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
  return db;
}

export interface User { id: string; username: string; name: string; password: string; avatar_at: number | null; created: number; password_at: number }
export interface Session { id: string; user: string; name: string; platform: string; app: string; created: number; last_seen: number; last_ip: string | null }
