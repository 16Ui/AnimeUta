CREATE TABLE grammar_lesson_progress (
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'learning', 'review', 'mastered')),
  due_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  fsrs_state INTEGER NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  last_reviewed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE INDEX idx_grammar_progress_due ON grammar_lesson_progress(user_id, due_at);

CREATE TABLE grammar_review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 3),
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_before TEXT NOT NULL,
  due_after TEXT NOT NULL,
  scheduled_days REAL NOT NULL DEFAULT 0
);

CREATE INDEX idx_grammar_review_user_time ON grammar_review_log(user_id, reviewed_at);
