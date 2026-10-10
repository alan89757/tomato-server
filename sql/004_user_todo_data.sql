-- Preserve legacy shared tables without assigning unknown ownership.
-- Account data starts empty and uses independent rows, IDs and revisions.
CREATE TABLE IF NOT EXISTS user_app_state (
  user_id INT UNSIGNED PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  timer JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_tasks (
  user_id INT UNSIGNED NOT NULL,
  id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
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
  PRIMARY KEY (user_id,id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tasks_due_date (due_date),
  INDEX idx_tasks_completed_at (completed_at),
  CONSTRAINT chk_user_task_estimate CHECK (estimated_pomodoros BETWEEN 1 AND 1000),
  CONSTRAINT chk_user_task_duration CHECK (duration_minutes BETWEEN 1 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


CREATE TABLE IF NOT EXISTS user_sessions (
  user_id INT UNSIGNED NOT NULL,
  id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  task_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  task_title VARCHAR(80) NOT NULL,
  category ENUM('工作','学习','生活') NOT NULL,
  duration_minutes DOUBLE NOT NULL,
  completed_at DATETIME(3) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id,id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_completed_at (completed_at),
  INDEX idx_sessions_task_id (task_id),
  CONSTRAINT chk_user_session_duration CHECK (duration_minutes > 0 AND duration_minutes <= 10080)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_abandoned_sessions (
  user_id INT UNSIGNED NOT NULL,
  id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  abandoned_at DATETIME(3) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id,id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_abandoned_at (abandoned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
