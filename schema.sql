-- Screenwriter cloud storage. Nothing is hard-deleted: deleted scripts are flagged,
-- and save points are kept in "versions".
CREATE TABLE IF NOT EXISTS scripts (
  owner   TEXT    NOT NULL,
  id      TEXT    NOT NULL,
  title   TEXT    NOT NULL DEFAULT '',
  text    TEXT    NOT NULL DEFAULT '',
  status  TEXT    NOT NULL DEFAULT 'draft',
  meta    TEXT    NOT NULL DEFAULT '{}',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS scripts_owner_updated ON scripts (owner, deleted, updated DESC);

CREATE TABLE IF NOT EXISTS versions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  owner     TEXT    NOT NULL,
  script_id TEXT    NOT NULL,
  text      TEXT    NOT NULL,
  saved     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_script ON versions (owner, script_id, id DESC);

-- Who else may open a script. role: 'editor' (can write) or 'reviewer' (read only).
CREATE TABLE IF NOT EXISTS shares (
  owner     TEXT NOT NULL,
  script_id TEXT NOT NULL,
  email     TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'editor',
  created   INTEGER NOT NULL,
  PRIMARY KEY (owner, script_id, email)
);
CREATE INDEX IF NOT EXISTS shares_email ON shares (email);

-- Small per-user state, such as the last script and cursor spot, so another device can pick up there.
CREATE TABLE IF NOT EXISTS user_state (
  email   TEXT PRIMARY KEY,
  data    TEXT NOT NULL DEFAULT '{}',
  updated INTEGER NOT NULL
);

-- Accounts and sign-in (email one-time code; no passwords are stored).
CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  created    INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);
-- One live code per email. Only a keyed hash of the code is stored.
CREATE TABLE IF NOT EXISTS login_codes (
  email   TEXT PRIMARY KEY,
  hash    TEXT    NOT NULL,
  expires INTEGER NOT NULL,
  tries   INTEGER NOT NULL DEFAULT 0
);
-- Only a hash of the session token is stored, so a database leak cannot be used to sign in.
CREATE TABLE IF NOT EXISTS sessions (
  hash    TEXT PRIMARY KEY,
  email   TEXT    NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_email ON sessions (email);
-- Used for rate limits (code requests per email and per network address).
CREATE TABLE IF NOT EXISTS auth_events (
  key TEXT    NOT NULL,
  ts  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_events_key ON auth_events (key, ts);
