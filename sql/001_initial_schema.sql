-- tomato-todo schema v1, MySQL 8.4+, UTF-8. Run in the database selected by DB_NAME.
-- No DROP statements: existing data is preserved when this migration is rerun.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  checksum CHAR(64) CHARACTER SET ascii NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_state (
  id TINYINT UNSIGNED PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  timer JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_single_state CHECK (id = 1)
) ENGINE=InnoDB;
INSERT IGNORE INTO app_state (id, revision, timer) VALUES (1, 0, NULL);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  category ENUM('工作','学习','生活') NOT NULL,
  estimated_pomodoros INT UNSIGNED NOT NULL,
  duration_minutes INT UNSIGNED NOT NULL,
  due_date DATE NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  theme ENUM('sky','city','mint','violet') NULL,
  kind ENUM('pomodoro','goal','habit') NULL,
  timing_mode ENUM('countdown','countup','untimed') NULL,
  sort_order INT NOT NULL DEFAULT 0,
  INDEX idx_tasks_due_date (due_date),
  INDEX idx_tasks_completed_at (completed_at),
  CONSTRAINT chk_task_estimate CHECK (estimated_pomodoros BETWEEN 1 AND 1000),
  CONSTRAINT chk_task_duration CHECK (duration_minutes BETWEEN 1 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- No FK to tasks: deleting a task must retain focus history and its title/category snapshot.
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
  task_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  task_title VARCHAR(80) NOT NULL,
  category ENUM('工作','学习','生活') NOT NULL,
  duration_minutes DOUBLE NOT NULL,
  completed_at DATETIME(3) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  INDEX idx_sessions_completed_at (completed_at),
  INDEX idx_sessions_task_id (task_id),
  CONSTRAINT chk_session_duration CHECK (duration_minutes > 0 AND duration_minutes <= 10080)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
