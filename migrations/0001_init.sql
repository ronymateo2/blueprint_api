-- Users: no passwords, OAuth-only. Timezone for correct "day" computation.
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url   TEXT,
  timezone     TEXT NOT NULL DEFAULT 'UTC',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- One row per linked OAuth provider (Google first; add more later).
CREATE TABLE oauth_accounts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  email       TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE(provider, provider_id)
);

-- Habit config (one per defined habit).
CREATE TABLE habits (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'star',
  type        TEXT NOT NULL CHECK(type IN ('count','time','yn','qty','at')),
  goal        INTEGER NOT NULL DEFAULT 1,
  unit        TEXT,
  points      INTEGER NOT NULL DEFAULT 5,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX habits_user ON habits(user_id);

-- Entries: one row per log event. Multiple per day allowed; sum = daily total.
-- value = actual amount logged (may differ from habit.goal).
CREATE TABLE entries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  value      REAL NOT NULL DEFAULT 1,
  points     INTEGER NOT NULL DEFAULT 5,
  logged_at  TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX entries_habit_date ON entries(habit_id, logged_at);
CREATE INDEX entries_user_date  ON entries(user_id, logged_at);

-- Multiple reminders per habit (e.g. pausa activa: 10:00, 12:00, 15:00).
CREATE TABLE reminders (
  id       TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  time     TEXT NOT NULL,
  days     TEXT NOT NULL DEFAULT 'LMXJVSD',
  enabled  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX reminders_habit ON reminders(habit_id);
