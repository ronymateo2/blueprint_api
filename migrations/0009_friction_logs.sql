-- Reflexión de fricción: qué se interpuso en un día (sobre todo días sin registro).
-- Aislada de entries → cero impacto en puntos/streak/heatmap. Una por hábito por día.
-- `cause` se valida en zod (no con CHECK) para que la lista evolucione sin recrear la tabla.
CREATE TABLE friction_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  habit_id    TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  local_date  TEXT NOT NULL,
  cause       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(user_id, habit_id, local_date)
);

CREATE INDEX friction_logs_user_date  ON friction_logs(user_id, local_date);
CREATE INDEX friction_logs_habit_date ON friction_logs(habit_id, local_date);
