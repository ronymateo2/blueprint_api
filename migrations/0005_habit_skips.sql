CREATE TABLE habit_skips (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, habit_id, local_date)
);

CREATE INDEX habit_skips_user_date ON habit_skips(user_id, local_date);
