CREATE TABLE IF NOT EXISTS abandoned_sessions (
  id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
  abandoned_at DATETIME(3) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  INDEX idx_abandoned_at (abandoned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
