// Generated from schema.sql by scripts/gen-schema.mjs. Safe to run many times (every statement is IF NOT EXISTS).
export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS scripts ( owner TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', meta TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, id) )",
  "CREATE INDEX IF NOT EXISTS scripts_owner_updated ON scripts (owner, deleted, updated DESC)",
  "CREATE TABLE IF NOT EXISTS versions ( id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, script_id TEXT NOT NULL, text TEXT NOT NULL, saved INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS versions_script ON versions (owner, script_id, id DESC)",
  "CREATE TABLE IF NOT EXISTS shares ( owner TEXT NOT NULL, script_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'editor', created INTEGER NOT NULL, PRIMARY KEY (owner, script_id, email) )",
  "CREATE INDEX IF NOT EXISTS shares_email ON shares (email)",
  "CREATE TABLE IF NOT EXISTS user_state ( email TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', updated INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS users ( email TEXT PRIMARY KEY, created INTEGER NOT NULL, last_login INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS login_codes ( email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0 )",
  "CREATE TABLE IF NOT EXISTS sessions ( hash TEXT PRIMARY KEY, email TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS sessions_email ON sessions (email)",
  "CREATE TABLE IF NOT EXISTS auth_events ( key TEXT NOT NULL, ts INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS auth_events_key ON auth_events (key, ts)",
];
