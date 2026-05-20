-- Composite index for habits to optimize filtering by user, archival state, and sorting by sort_order and created_at
CREATE INDEX idx_habits_user_archive_sort ON habits(user_id, archived_at, sort_order, created_at, id);

-- Composite index for entries to optimize queries filtering by user, habit, and date range
CREATE INDEX idx_entries_user_habit_date ON entries(user_id, habit_id, logged_at);
